package lifecycle

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestArchitectureSelection(t *testing.T) {
	for input, want := range map[string]string{"amd64": "amd64", "arm64": "arm64"} {
		got, err := releaseArchitecture(input)
		if err != nil || got != want {
			t.Fatalf("%s => %s, %v", input, got, err)
		}
	}
	if _, err := releaseArchitecture("386"); err == nil {
		t.Fatal("expected unsupported architecture")
	}
}

func TestChecksumSelection(t *testing.T) {
	hash := strings.Repeat("a", 64)
	got, err := checksumFor([]byte(hash+"  cluster-node-linux-amd64\n"), "cluster-node-linux-amd64")
	if err != nil || got != hash {
		t.Fatalf("unexpected checksum: %q, %v", got, err)
	}
	if _, err := checksumFor([]byte("bad"), "cluster-node-linux-amd64"); err == nil {
		t.Fatal("expected malformed checksum to fail")
	}
}

func TestLatestReleaseSelection(t *testing.T) {
	payload := []byte("replacement")
	digest := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/releases/latest":
			_, _ = response.Write([]byte(`{"tag_name":"v1.2.3","prerelease":false}`))
		case "/download/v1.2.3/checksums.txt":
			_, _ = response.Write([]byte(hex.EncodeToString(digest[:]) + "  cluster-node-linux-amd64\n"))
		case "/download/v1.2.3/cluster-node-linux-amd64":
			_, _ = response.Write(payload)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	manager := New("old", strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{})
	manager.ReleaseAPI = server.URL
	manager.ReleaseBase = server.URL + "/download"
	version, err := manager.latestVersion(context.Background())
	if err != nil || version != "v1.2.3" {
		t.Fatalf("unexpected version %q: %v", version, err)
	}
}

func TestAtomicWriteLeavesNoTemporaryFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bin", "cluster-node")
	if err := atomicWrite(path, []byte("ok"), 0o755); err != nil {
		t.Fatal(err)
	}
	if contents, _ := os.ReadFile(path); string(contents) != "ok" {
		t.Fatalf("unexpected contents %q", contents)
	}
	if _, err := os.Stat(path + ".new"); !os.IsNotExist(err) {
		t.Fatalf("temporary file remains: %v", err)
	}
}
