package reconcile

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Account operations and ordinary reconciliation must never mutate the same host concurrently.
var accountMutation sync.Mutex

const AccountCapability = "account-management-v1"

type LocalAccount struct {
	Username           string `json:"username"`
	UID                int    `json:"uid"`
	GID                int    `json:"gid"`
	Home               string `json:"home"`
	PrimaryGroup       string `json:"primaryGroup"`
	Fingerprint        string `json:"fingerprint"`
	Eligible           bool   `json:"eligible"`
	Reason             string `json:"reason"`
	OwnerWorkstationID string `json:"ownerWorkstationId"`
	Exists             bool   `json:"exists"`
}
type AccountSnapshot struct {
	ObservedAt time.Time      `json:"observedAt"`
	Complete   bool           `json:"complete"`
	Accounts   []LocalAccount `json:"accounts"`
}
type AccountInstruction struct {
	APIVersion      string       `json:"apiVersion"`
	ID              string       `json:"id"`
	WorkstationID   string       `json:"workstationId"`
	WorkstationName string       `json:"workstationName"`
	AssignmentID    string       `json:"assignmentId"`
	Generation      int          `json:"generation"`
	Kind            string       `json:"kind"`
	Account         LocalAccount `json:"account"`
	DeleteHome      bool         `json:"deleteHome"`
	ExpiresAt       time.Time    `json:"expiresAt"`
}
type AccountResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

func inspectAccount(name string, state ManagedState) LocalAccount {
	a := LocalAccount{Username: name}
	account, err := lookupUser(name)
	if err != nil {
		a.Reason = "Cannot inspect local account"
		return a
	}
	if record, ok := state.Users[name]; ok {
		a.OwnerWorkstationID = record.WorkstationID
		a.UID, a.GID, a.Home, a.PrimaryGroup = record.UID, record.GID, record.HomeDirectory, record.PrimaryGroup
	}
	if account != nil {
		a.Exists = true
		a.UID, _ = strconv.Atoi(account.Uid)
		a.GID, _ = strconv.Atoi(account.Gid)
		a.Home = account.HomeDir
		a.PrimaryGroup = ""
		if primary, err := lookupGroupID(a.GID); err == nil && primary != nil {
			a.PrimaryGroup = primary.Name
		}
	}
	group, groupErr := lookupGroup(name)
	groupID := ""
	if group != nil {
		groupID = group.Gid
	}
	info, statErr := os.Lstat(a.Home)
	identity := fmt.Sprintf("%s:%d:%d:%s:%t:%s:%s", name, a.UID, a.GID, a.Home, a.Exists, groupID, a.OwnerWorkstationID)
	if record, ok := state.Users[name]; ok {
		identity += ":" + record.AssignmentID + ":" + record.WorkstationName
	}
	// Linux has no immutable user incarnation identifier. A change to either local identity file
	// invalidates outstanding approvals, including deletion/recreation with the same UID and home.
	for _, path := range []string{"/etc/passwd", "/etc/group"} {
		if file, err := os.Stat(path); err == nil {
			if st, ok := file.Sys().(*syscall.Stat_t); ok {
				identity += fmt.Sprintf(":%d:%d:%d", st.Dev, st.Ino, file.ModTime().UnixNano())
			}
		}
	}
	if statErr == nil {
		if st, ok := info.Sys().(*syscall.Stat_t); ok {
			identity += fmt.Sprintf(":%d:%d:%d:%d:%d", st.Dev, st.Ino, st.Uid, st.Gid, info.Mode())
		}
	}
	sum := sha256.Sum256([]byte(identity))
	a.Fingerprint = hex.EncodeToString(sum[:])
	switch {
	case !a.Exists:
		a.Reason = "Account is absent; managed cleanup may still be required"
	case !usernamePattern.MatchString(name):
		a.Reason = "Incompatible username"
	case a.UID < minimumManagedID || a.UID > maximumManagedID || a.UID != a.GID:
		a.Reason = "Requires matching UID/GID in 20000–59999"
	case groupErr != nil || group == nil || groupID != strconv.Itoa(a.GID) || a.PrimaryGroup != name:
		a.Reason = "Requires a matching same-name private group"
	case a.Home != filepath.Join("/home", name):
		a.Reason = "Requires /home/username"
	case a.DeleteUnsafeHome():
		a.Reason = "Home parent must be an ordinary root-owned directory"
	case statErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0:
		a.Reason = "Home must be an ordinary directory"
	default:
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != uint32(a.UID) {
			a.Reason = "Home ownership differs from the account"
		} else {
			a.Eligible = true
		}
	}
	return a
}

// Discovery reads local passwd entries only; directory-service and service identities are excluded.
func (l *Linux) DiscoverAccounts() AccountSnapshot {
	accountMutation.Lock()
	defer accountMutation.Unlock()
	snapshot := AccountSnapshot{ObservedAt: time.Now().UTC(), Accounts: []LocalAccount{}}
	state, err := loadManagedState(l.managedStatePath)
	if err != nil {
		return snapshot
	}
	file, err := os.Open("/etc/passwd")
	if err != nil {
		return snapshot
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	seen := map[string]bool{}
	for scanner.Scan() {
		p := strings.Split(scanner.Text(), ":")
		if len(p) != 7 {
			return snapshot
		}
		uid, err := strconv.Atoi(p[2])
		if err != nil {
			return snapshot
		}
		if uid < 1000 || uid == 65534 || strings.Contains(p[6], "nologin") || strings.HasSuffix(p[6], "/false") {
			continue
		}
		if len(snapshot.Accounts) >= 4096 {
			return snapshot
		}
		seen[p[0]] = true
		account := inspectAccount(p[0], state)
		if account.Fingerprint == "" {
			return snapshot
		}
		snapshot.Accounts = append(snapshot.Accounts, account)
	}
	if scanner.Err() != nil {
		return snapshot
	}
	for name := range state.Users {
		if !seen[name] {
			if len(snapshot.Accounts) >= 4096 {
				return snapshot
			}
			account := inspectAccount(name, state)
			if account.Fingerprint == "" {
				return snapshot
			}
			snapshot.Accounts = append(snapshot.Accounts, account)
		}
	}
	snapshot.Complete = true
	return snapshot
}

type accountJournal struct {
	Results  map[string]AccountResult `json:"results"`
	Reported map[string]bool          `json:"reported,omitempty"`
	Removed  map[string]int           `json:"removed,omitempty"`
}

func writeDurableJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(path+".new", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(path+".new", path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func (l *Linux) ExecuteAccount(ctx context.Context, instruction AccountInstruction) AccountResult {
	accountMutation.Lock()
	defer accountMutation.Unlock()
	result := AccountResult{ID: instruction.ID, Status: "blocked", Detail: "Invalid or expired account operation"}
	if os.Geteuid() != 0 || instruction.APIVersion != "v1" || !uuidPattern.MatchString(instruction.ID) || !uuidPattern.MatchString(instruction.WorkstationID) || !uuidPattern.MatchString(instruction.AssignmentID) || instruction.Generation < 1 || instruction.WorkstationName != l.workstationName {
		return result
	}
	journalPath := filepath.Join(filepath.Dir(l.managedStatePath), "account-operations.json")
	journal := accountJournal{Results: map[string]AccountResult{}}
	data, err := os.ReadFile(journalPath)
	if err == nil {
		if json.Unmarshal(data, &journal) != nil || journal.Results == nil {
			result.Detail = "Unreadable operation journal"
			return result
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		result.Detail = "Unreadable operation journal"
		return result
	}
	if previous, ok := journal.Results[instruction.ID]; ok {
		if previous.Status == "executing" {
			previous.Status = "blocked"
			previous.Detail = "Operation interrupted; inspect the account and explicitly retry"
			journal.Results[instruction.ID] = previous
			_ = writeDurableJSON(journalPath, journal)
		}
		return previous
	}
	refuse := func() AccountResult {
		journal.Results[instruction.ID] = result
		if err := writeDurableJSON(journalPath, journal); err != nil {
			result.Detail = "Cannot persist refusal; operation journal requires inspection"
		}
		return result
	}
	if time.Now().After(instruction.ExpiresAt) {
		return refuse()
	}
	a := instruction.Account
	if !usernamePattern.MatchString(a.Username) || a.UID < minimumManagedID || a.UID > maximumManagedID || a.UID != a.GID || a.PrimaryGroup != a.Username || a.Home != filepath.Join("/home", a.Username) || len(a.Fingerprint) != 64 {
		return refuse()
	}
	state, err := loadManagedState(l.managedStatePath)
	if err != nil {
		result.Detail = "Unreadable account ownership ledger"
		return refuse()
	}
	current := inspectAccount(a.Username, state)
	if current.Fingerprint != a.Fingerprint || current.UID != a.UID || current.GID != a.GID {
		result.Detail = "Account identity changed since approval"
		return refuse()
	}
	record, owned := state.Users[a.Username]
	if instruction.Kind == "adopt" {
		if !current.Eligible {
			result.Detail = current.Reason
			return refuse()
		}
		// Foreign provenance is transferred only after exact current host identity validation.
		if owned && (record.UID != a.UID || record.GID != a.GID || record.HomeDirectory != a.Home || record.PrimaryGroup != a.Username) {
			result.Detail = "Prior ownership ledger differs from local identity"
			return refuse()
		}
	} else if instruction.Kind == "remove" {
		if !owned || record.WorkstationID != instruction.WorkstationID || record.WorkstationName != instruction.WorkstationName || record.UID != a.UID || record.GID != a.GID || record.HomeDirectory != a.Home || record.PrimaryGroup != a.Username {
			result.Detail = "Account is not owned by this workstation registration"
			return refuse()
		}
		if current.Exists && !current.Eligible {
			result.Detail = current.Reason
			return refuse()
		}
	} else {
		return refuse()
	}
	journal.Results[instruction.ID] = AccountResult{ID: instruction.ID, Status: "executing"}
	if instruction.Kind == "remove" {
		if journal.Removed == nil {
			journal.Removed = map[string]int{}
		}
		journal.Removed[instruction.WorkstationID+":"+instruction.AssignmentID] = instruction.Generation
	}
	if err = writeDurableJSON(journalPath, journal); err != nil {
		result.Detail = "Cannot journal operation"
		return result
	}
	result = l.executeAccountMutation(ctx, instruction, state, record, owned)
	journal.Results[instruction.ID] = result
	// An explicit adoption authorizes this assignment's new incarnation. Preserve the
	// stale-generation guard while allowing the newly approved generation after CLI purge.
	key := instruction.WorkstationID + ":" + instruction.AssignmentID
	if instruction.Kind == "adopt" && result.Status == "completed" && journal.Removed[key] >= instruction.Generation {
		journal.Removed[key] = instruction.Generation - 1
	}
	if err = writeDurableJSON(journalPath, journal); err != nil {
		return AccountResult{ID: instruction.ID, Status: "blocked", Detail: "Cannot persist result; inspect account before explicit retry"}
	}
	return result
}

func (l *Linux) executeAccountMutation(ctx context.Context, instruction AccountInstruction, state ManagedState, record ManagedUser, owned bool) AccountResult {
	a := instruction.Account
	result := AccountResult{ID: instruction.ID, Status: "blocked"}
	fail := func(err error) AccountResult { result.Detail = err.Error(); return result }
	failed := func(message string) AccountResult { result.Status = "failed"; result.Detail = message; return result }
	if instruction.Kind == "adopt" {
		if !owned {
			record = ManagedUser{Username: a.Username, UID: a.UID, GID: a.GID, HomeDirectory: a.Home, PrimaryGroup: a.Username, GroupCreated: true, CreatedAt: time.Now().UTC()}
		}
		record.WorkstationID = instruction.WorkstationID
		record.WorkstationName = instruction.WorkstationName
		record.AssignmentID = instruction.AssignmentID
		record.CreationPhase = "active"
		record.Adopted = true
		state.WorkstationID = instruction.WorkstationID
		state.WorkstationName = instruction.WorkstationName
		state.Users[a.Username] = record
		if err := saveManagedState(l.managedStatePath, state); err != nil {
			return failed("Cannot record account ownership")
		}
		result.Status = "completed"
		result.Detail = "Ownership transferred; awaiting password synchronization"
		return result
	}
	homeBefore, homeErr := os.Lstat(a.Home)
	if homeErr != nil && !errors.Is(homeErr, os.ErrNotExist) {
		return fail(fmt.Errorf("Cannot inspect home"))
	}
	if latest := inspectAccount(a.Username, state); latest.Fingerprint != a.Fingerprint {
		return fail(fmt.Errorf("Account identity changed before removal"))
	}
	if a.Exists {
		if err := disableLogin(ctx, a.Username); err != nil {
			return failed("Cannot lock account before removal")
		}
	}
	// usermod may rewrite passwd/group itself. Capture that intentional file change, while
	// requiring the approved account and home to remain identical before checking for activity.
	locked := inspectAccount(a.Username, state)
	homeNow, _ := os.Lstat(a.Home)
	if locked.UID != a.UID || locked.GID != a.GID || locked.Home != a.Home || locked.Exists != a.Exists || locked.OwnerWorkstationID != a.OwnerWorkstationID || (homeBefore != nil && (homeNow == nil || !os.SameFile(homeBefore, homeNow))) {
		return fail(fmt.Errorf("Account identity changed while locking login"))
	}
	if err := accountIdle(ctx, a.UID, a.Username, a.Home); err != nil {
		return fail(err)
	}
	if a.DeleteUnsafeHome() {
		return fail(fmt.Errorf("Unsafe home directory"))
	}
	if latest := inspectAccount(a.Username, state); latest.Fingerprint != locked.Fingerprint {
		return fail(fmt.Errorf("Account identity changed before removal"))
	}
	if a.Exists {
		if err := run(ctx, "", "userdel", a.Username); err != nil {
			return failed("Account removal failed; inspect host before retry")
		}
	}
	if instruction.DeleteHome {
		if account, err := lookupUser(a.Username); err != nil || account != nil {
			return fail(fmt.Errorf("Account reappeared; home preserved"))
		}
		if err := accountIdle(ctx, a.UID, a.Username, a.Home); err != nil {
			return fail(err)
		}
		if err := safeRemoveHome(a, homeBefore); err != nil {
			return fail(err)
		}
	}
	group, err := lookupGroup(a.Username)
	if err != nil {
		return fail(fmt.Errorf("Cannot inspect private group"))
	}
	if group != nil {
		if group.Gid != strconv.Itoa(a.GID) {
			return fail(fmt.Errorf("Private group identity changed"))
		}
		output, err := exec.CommandContext(ctx, "getent", "passwd").Output()
		if err != nil {
			return fail(fmt.Errorf("Cannot inspect group use"))
		}
		shared := false
		for _, line := range strings.Split(string(output), "\n") {
			p := strings.Split(line, ":")
			if len(p) == 7 && p[3] == group.Gid {
				shared = true
			}
		}
		members, err := exec.CommandContext(ctx, "getent", "group", a.Username).Output()
		if err != nil {
			return fail(fmt.Errorf("Cannot inspect group membership"))
		}
		p := strings.Split(strings.TrimSpace(string(members)), ":")
		if len(p) != 4 {
			return fail(fmt.Errorf("Cannot inspect group membership"))
		}
		shared = shared || p[3] != ""
		if !shared {
			if err := run(ctx, "", "groupdel", a.Username); err != nil {
				return failed("Private group cleanup failed")
			}
		}
	}
	delete(state.Users, a.Username)
	if err := saveManagedState(l.managedStatePath, state); err != nil {
		return failed("Cannot finalize ownership ledger")
	}
	result.Status = "completed"
	result.Detail = "Linux account removed"
	if !instruction.DeleteHome {
		result.Detail += "; home files preserved"
	}
	return result
}

func (a LocalAccount) DeleteUnsafeHome() bool {
	parent, err := os.Lstat("/home")
	if err != nil || !parent.IsDir() || parent.Mode()&os.ModeSymlink != 0 || parent.Mode().Perm()&0022 != 0 {
		return true
	}
	st, ok := parent.Sys().(*syscall.Stat_t)
	return !ok || st.Uid != 0
}
func accountIdle(ctx context.Context, uid int, name, home string) error {
	output, err := exec.CommandContext(ctx, "pgrep", "-u", strconv.Itoa(uid)).Output()
	if len(output) > 0 {
		return fmt.Errorf("Account has running processes; explicit retry required")
	}
	var exit *exec.ExitError
	if err != nil && (!errors.As(err, &exit) || exit.ExitCode() != 1) {
		return fmt.Errorf("Cannot inspect running processes")
	}
	sessions, err := exec.CommandContext(ctx, "loginctl", "list-sessions", "--no-legend").Output()
	if err != nil { // Containers may have no logind; utmp is still checked, but real hosts fail closed.
		if _, e := os.Stat("/run/systemd/system"); e == nil {
			return fmt.Errorf("Cannot inspect login sessions")
		}
	}
	for _, line := range strings.Split(string(sessions), "\n") {
		for _, field := range strings.Fields(line) {
			if field == name || field == strconv.Itoa(uid) {
				return fmt.Errorf("Account has active sessions; explicit retry required")
			}
		}
	}
	utmp, err := exec.CommandContext(ctx, "who").Output()
	if err != nil {
		return fmt.Errorf("Cannot inspect interactive sessions")
	}
	for _, line := range strings.Split(string(utmp), "\n") {
		f := strings.Fields(line)
		if len(f) > 0 && f[0] == name {
			return fmt.Errorf("Account has active sessions; explicit retry required")
		}
	}
	mounts, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return fmt.Errorf("Cannot inspect home mounts")
	}
	for _, line := range strings.Split(string(mounts), "\n") {
		f := strings.Fields(line)
		if len(f) > 4 {
			mount := strings.NewReplacer("\\040", " ", "\\011", "\t", "\\012", "\n", "\\134", "\\").Replace(f[4])
			if mount == home || strings.HasPrefix(mount, home+"/") {
				return fmt.Errorf("Home has mounts; explicit retry required")
			}
		}
	}
	return nil
}
func safeRemoveHome(a LocalAccount, approved os.FileInfo) error {
	if a.DeleteUnsafeHome() {
		return fmt.Errorf("Unsafe home parent")
	}
	info, err := os.Lstat(a.Home)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("Cannot inspect home")
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || approved == nil || !os.SameFile(approved, info) || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || st.Uid != uint32(a.UID) {
		return fmt.Errorf("Home identity changed; files preserved")
	}
	// /home is root-owned and not writable by other accounts; RemoveAll does not follow child symlinks.
	return os.RemoveAll(a.Home)
}

// Completed receipts are retried independently of command expiry. Execution receipts are retained
// after acknowledgement so replay can never operate on a newly recreated account.
func (l *Linux) PendingAccountResults() []AccountResult {
	accountMutation.Lock()
	defer accountMutation.Unlock()
	data, err := os.ReadFile(filepath.Join(filepath.Dir(l.managedStatePath), "account-operations.json"))
	if err != nil {
		return nil
	}
	var j accountJournal
	if json.Unmarshal(data, &j) != nil {
		return nil
	}
	results := []AccountResult{}
	for id, r := range j.Results {
		if !j.Reported[id] {
			if r.Status == "executing" {
				r.Status = "blocked"
				r.Detail = "Operation interrupted; inspect account and explicitly retry"
			}
			results = append(results, r)
		}
	}
	return results
}
func (l *Linux) AcknowledgeAccountResult(id string) {
	accountMutation.Lock()
	defer accountMutation.Unlock()
	path := filepath.Join(filepath.Dir(l.managedStatePath), "account-operations.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var j accountJournal
	if json.Unmarshal(data, &j) != nil {
		return
	}
	if j.Reported == nil {
		j.Reported = map[string]bool{}
	}
	j.Reported[id] = true
	_ = writeDurableJSON(path, j)
}
