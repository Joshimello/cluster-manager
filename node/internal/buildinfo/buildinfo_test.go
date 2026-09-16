package buildinfo

import "testing"

func TestDevelopmentVersionIsPresent(t *testing.T) {
	if Version == "" {
		t.Fatal("Version must not be empty")
	}
}
