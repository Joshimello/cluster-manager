package structuredlog

import (
	"bytes"
	"encoding/json"
	"log"
	"testing"
)

func TestWriterProducesJSONLine(t *testing.T) {
	var output bytes.Buffer
	logger := log.New(Writer{Destination: &output, Component: "node"}, "", 0)
	logger.Printf("heartbeat accepted for %s", "ws01")

	var entry map[string]string
	if err := json.Unmarshal(bytes.TrimSpace(output.Bytes()), &entry); err != nil {
		t.Fatalf("parse log: %v", err)
	}
	if entry["component"] != "node" || entry["message"] != "heartbeat accepted for ws01" {
		t.Fatalf("unexpected entry: %#v", entry)
	}
	if entry["timestamp"] == "" || entry["level"] != "info" {
		t.Fatalf("missing standard fields: %#v", entry)
	}
}
