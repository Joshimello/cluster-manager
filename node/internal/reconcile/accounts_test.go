package reconcile

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAccountReceiptsPersistAcrossRestartAndAcknowledgement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "managed-state.json")
	receiptPath := filepath.Join(filepath.Dir(path), "account-operations.json")
	j := accountJournal{Results: map[string]AccountResult{"done": {ID: "done", Status: "completed", Detail: "Removed"}, "interrupted": {ID: "interrupted", Status: "executing"}}, Removed: map[string]int{"workstation:assignment": 4}}
	if err := writeDurableJSON(receiptPath, j); err != nil {
		t.Fatal(err)
	}
	l := NewLinuxWithStatePath("test", path)
	results := l.PendingAccountResults()
	if len(results) != 2 {
		t.Fatalf("missing receipts: %#v", results)
	}
	for _, r := range results {
		if r.ID == "interrupted" && r.Status != "blocked" {
			t.Fatalf("interrupted execution was resumable: %#v", r)
		}
	}
	l.AcknowledgeAccountResult("done")
	l = NewLinuxWithStatePath("test", path)
	if len(l.PendingAccountResults()) != 1 {
		t.Fatal("receipt acknowledgement did not survive restart")
	}
	data, _ := os.ReadFile(receiptPath)
	var stored accountJournal
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Results["done"].Status != "completed" || stored.Removed["workstation:assignment"] != 4 {
		t.Fatal("acknowledgement lost replay protection")
	}
	info, err := os.Stat(receiptPath)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("unsafe journal permissions: %v %v", info, err)
	}
}

func TestDurableWriteRepairsTemporaryFilePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	if err := os.WriteFile(path+".new", []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeDurableJSON(path, map[string]string{"state": "new"}); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("existing temporary file leaked journal data")
	}
}
