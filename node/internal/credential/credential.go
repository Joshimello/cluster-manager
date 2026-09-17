package credential

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func Generate() (string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate credential: %w", err)
	}
	return "cmnode_" + base64.RawURLEncoding.EncodeToString(secret), nil
}

func Valid(value string) bool {
	if !strings.HasPrefix(value, "cmnode_") || len(value) != len("cmnode_")+43 {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "cmnode_"))
	return err == nil
}

func Load(path string) (string, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read credential: %w", err)
	}
	value := strings.TrimSpace(string(contents))
	if !Valid(value) {
		return "", fmt.Errorf("credential file %s is invalid", path)
	}
	return value, nil
}

func Write(path, value string) error {
	if !Valid(value) {
		return errors.New("refusing to write an invalid node credential")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create credential directory: %w", err)
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, []byte(value+"\n"), 0o600); err != nil {
		return fmt.Errorf("write credential: %w", err)
	}
	if err := os.Chmod(temporary, 0o600); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("secure credential: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("install credential: %w", err)
	}
	return nil
}
