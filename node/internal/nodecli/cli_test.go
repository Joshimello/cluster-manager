package nodecli

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestVersionCommands(t *testing.T) {
	for _, args := range [][]string{{"version"}, {"--version"}} {
		var output bytes.Buffer
		if err := Run(context.Background(), args, "v1.2.3", strings.NewReader(""), &output, &output); err != nil {
			t.Fatal(err)
		}
		if output.String() != "cluster-node v1.2.3\n" {
			t.Fatalf("unexpected output %q", output.String())
		}
	}
}

func TestHelpListsLifecycleCommands(t *testing.T) {
	var output bytes.Buffer
	if err := Run(context.Background(), []string{"help"}, "test", strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	for _, command := range []string{"setup", "run", "status", "doctor", "re-enroll", "upgrade", "uninstall"} {
		if !strings.Contains(output.String(), "cluster-node "+command) {
			t.Fatalf("help omits %s: %s", command, output.String())
		}
	}
}

func TestParsingRejectsTokensAndTrailingArguments(t *testing.T) {
	for _, args := range [][]string{{"setup", "--enrollment-token", "secret"}, {"status", "extra"}, {"upgrade", "--version", "v1.2.3", "extra"}} {
		if err := Run(context.Background(), args, "test", strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
			t.Fatalf("expected %v to fail", args)
		}
	}
}

func TestUnknownCommandShowsUsage(t *testing.T) {
	err := Run(context.Background(), []string{"wat"}, "test", strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "Usage:") {
		t.Fatalf("unexpected error: %v", err)
	}
}
