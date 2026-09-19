package lifecycle

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
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

func TestSupportedOSRelease(t *testing.T) {
	for name, contents := range map[string]string{
		"Ubuntu 24.04": "ID=ubuntu\nVERSION_ID=\"24.04\"\n",
		"newer Ubuntu": "ID=ubuntu\nVERSION_ID=26.04\n",
		"Debian 12":    "ID=debian\nVERSION_ID=\"12\"\n",
		"Debian 13":    "ID=debian\nVERSION_ID=13\n",
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateOSRelease(contents); err != nil {
				t.Fatalf("expected supported release: %v", err)
			}
		})
	}
}

func TestUnsupportedOSRelease(t *testing.T) {
	for name, contents := range map[string]string{
		"old Ubuntu":   "ID=ubuntu\nVERSION_ID=22.04\n",
		"old Debian":   "ID=debian\nVERSION_ID=11\n",
		"other distro": "ID=fedora\nVERSION_ID=43\n",
		"bad version":  "ID=debian\nVERSION_ID=trixie\n",
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateOSRelease(contents); err == nil {
				t.Fatal("expected unsupported release to fail")
			}
		})
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

func TestLatestReleaseRejectsPrerelease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"tag_name":"v2.0.0-rc1","prerelease":true}`))
	}))
	defer server.Close()
	manager := New("old", strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{})
	manager.ReleaseAPI = server.URL
	if _, err := manager.latestVersion(context.Background()); err == nil {
		t.Fatal("expected prerelease to be rejected")
	}
}

func TestInteractiveTokenIsNotEchoed(t *testing.T) {
	var output bytes.Buffer
	manager := New("test", strings.NewReader("enroll_secret_value\n"), &output, &output)
	token, err := manager.readToken(context.Background(), "")
	if err != nil || token != "enroll_secret_value" {
		t.Fatalf("unexpected token read: %q, %v", token, err)
	}
	if strings.Contains(output.String(), token) {
		t.Fatalf("secret was echoed: %q", output.String())
	}
}

func TestInteractivePlatformURLRepromptsBeforeNextField(t *testing.T) {
	var output bytes.Buffer
	manager := New("test", strings.NewReader("d\nhttps://manager.example/\n"), &output, &output)

	platformURL, err := manager.setupPlatformURL(context.Background(), "", false)
	if err != nil {
		t.Fatal(err)
	}
	if platformURL != "https://manager.example" {
		t.Fatalf("unexpected platform URL %q", platformURL)
	}
	if !strings.Contains(output.String(), "Invalid platform URL: must be an absolute URL") {
		t.Fatalf("missing immediate validation error: %q", output.String())
	}
	if strings.Contains(output.String(), "Workstation name") {
		t.Fatalf("setup advanced before the URL was valid: %q", output.String())
	}
}

func TestPlatformURLAllowsHTTPOnlyWhenExplicit(t *testing.T) {
	manager := New("test", strings.NewReader(""), io.Discard, io.Discard)

	if _, err := manager.setupPlatformURL(context.Background(), "http://100.64.0.10:3000", false); err == nil {
		t.Fatal("expected HTTP URL to be rejected by default")
	}
	platformURL, err := manager.setupPlatformURL(context.Background(), "http://100.64.0.10:3000/", true)
	if err != nil {
		t.Fatal(err)
	}
	if platformURL != "http://100.64.0.10:3000" {
		t.Fatalf("unexpected platform URL %q", platformURL)
	}
}

func TestInteractiveValuesShareBufferedInput(t *testing.T) {
	manager := New("test", strings.NewReader("first\nsecond\n"), io.Discard, io.Discard)

	first, err := manager.value(context.Background(), "", "First")
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.value(context.Background(), "", "Second")
	if err != nil {
		t.Fatal(err)
	}
	if first != "first" || second != "second" {
		t.Fatalf("unexpected values %q and %q", first, second)
	}
}

func TestInteractivePromptStopsWhenContextIsCancelled(t *testing.T) {
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	manager := New("test", reader, io.Discard, io.Discard)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := manager.value(ctx, "", "Platform URL")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
}

func TestServiceAndMigrationPathsUseNewNames(t *testing.T) {
	paths := DefaultPaths()
	if !strings.Contains(ServiceUnit, "ExecStart=/usr/local/sbin/cluster-node run") || strings.Contains(ServiceUnit, "ExecStart=/usr/local/sbin/cluster-manager-node") {
		t.Fatalf("unexpected service unit: %s", ServiceUnit)
	}
	if paths.Binary == paths.OldBinary || paths.Unit == paths.OldUnit {
		t.Fatalf("new and migration paths must remain distinct: %#v", paths)
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
