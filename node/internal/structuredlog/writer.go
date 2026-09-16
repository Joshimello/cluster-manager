package structuredlog

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"
)

// Writer converts the standard logger's messages to one JSON object per line.
type Writer struct {
	Destination io.Writer
	Component   string
}

func (w Writer) Write(p []byte) (int, error) {
	line, err := json.Marshal(map[string]string{
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"level":     "info",
		"component": w.Component,
		"message":   strings.TrimSpace(string(p)),
	})
	if err != nil {
		return 0, err
	}
	if _, err = fmt.Fprintln(w.Destination, string(line)); err != nil {
		return 0, err
	}
	return len(p), nil
}
