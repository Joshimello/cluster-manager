package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCredentialIsPersistentAndPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "credential")
	first, created, err := loadOrCreateCredential(path, true)
	if err != nil || !created || !validCredential(first) {
		t.Fatalf("create credential: %q %v %v", first, created, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("credential mode is %o", info.Mode().Perm())
	}
	second, created, err := loadOrCreateCredential(path, false)
	if err != nil || created || second != first {
		t.Fatalf("credential was not reused: %q %v %v", second, created, err)
	}
}

func TestCredentialRequiresEnrollmentToCreate(t *testing.T) {
	_, _, err := loadOrCreateCredential(filepath.Join(t.TempDir(), "credential"), false)
	if err == nil {
		t.Fatal("expected enrollment requirement")
	}
}
