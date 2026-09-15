package session

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestControlFrame(t *testing.T) {
	var b bytes.Buffer
	if err := WriteFrame(&b, Welcome{OK: true, Version: 1}, 1024); err != nil {
		t.Fatal(err)
	}
	var h [4]byte
	copy(h[:], b.Bytes())
	if binary.BigEndian.Uint32(h[:]) == 0 {
		t.Fatal("empty")
	}
}
func TestReadFrameLimit(t *testing.T) {
	b := []byte{0, 0, 4, 0}
	if _, err := ReadFrame(bytes.NewReader(b), 32); err == nil {
		t.Fatal("expected limit")
	}
}
func FuzzReadFrame(f *testing.F) {
	f.Add([]byte{0, 0, 0, 13, '{', '"', 'v', 'e', 'r', 's', 'i', 'o', 'n', '"', ':', '1', '}'})
	f.Fuzz(func(t *testing.T, b []byte) { _, _ = ReadFrame(bytes.NewReader(b), 4096) })
}
