package reconcile

import (
	"context"
	"fmt"
	"regexp"

	"github.com/Joshimello/cluster-manager/node/internal/protocol"
)

var (
	usernamePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{2,31}$`)
	passwordPattern = regexp.MustCompile(`^\$6\$[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$`)
	uuidPattern     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
)

type Reconciler interface {
	Apply(context.Context, protocol.DesiredState) ([]protocol.ReconciliationResult, error)
}

func Validate(state protocol.DesiredState, workstationName string) error {
	if state.APIVersion != "v1" {
		return fmt.Errorf("unsupported desired-state API version %q", state.APIVersion)
	}
	if state.Workstation.Name != workstationName {
		return fmt.Errorf("desired state is for workstation %q, not %q", state.Workstation.Name, workstationName)
	}
	seen := make(map[string]struct{}, len(state.Users))
	for _, desired := range state.Users {
		if !uuidPattern.MatchString(desired.AssignmentID) {
			return fmt.Errorf("invalid assignment ID for user %q", desired.Username)
		}
		if !usernamePattern.MatchString(desired.Username) {
			return fmt.Errorf("unsafe Linux username %q", desired.Username)
		}
		if _, exists := seen[desired.Username]; exists {
			return fmt.Errorf("duplicate desired user %q", desired.Username)
		}
		seen[desired.Username] = struct{}{}
		if desired.Generation < 1 {
			return fmt.Errorf("invalid generation for user %q", desired.Username)
		}
		if desired.Enabled && !passwordPattern.MatchString(desired.PasswordHash) {
			return fmt.Errorf("invalid Linux password hash for user %q", desired.Username)
		}
		if !desired.Enabled && desired.PasswordHash != "" {
			return fmt.Errorf("disabled user %q unexpectedly has password material", desired.Username)
		}
	}
	return nil
}

func result(user protocol.DesiredUser, status, message string, errorCode ...string) protocol.ReconciliationResult {
	code := ""
	if len(errorCode) > 0 {
		code = errorCode[0]
	}
	return protocol.ReconciliationResult{
		AssignmentID: user.AssignmentID,
		Generation:   user.Generation,
		Status:       status,
		Message:      message,
		ErrorCode:    code,
	}
}
