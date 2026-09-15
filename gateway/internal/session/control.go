package session

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const ProtocolVersion = 1

type Hello struct {
	Version int    `json:"version"`
	Token   string `json:"token,omitempty"`
}
type Welcome struct {
	OK         bool   `json:"ok"`
	Version    int    `json:"version"`
	SessionID  string `json:"sessionId,omitempty"`
	MaxStreams int    `json:"maxStreams,omitempty"`
	Error      string `json:"error,omitempty"`
}

func ReadFrame(r io.Reader, max int) (Hello, error) {
	var h [4]byte
	if _, err := io.ReadFull(r, h[:]); err != nil {
		return Hello{}, err
	}
	n := binary.BigEndian.Uint32(h[:])
	if n == 0 || uint64(n) > uint64(max) {
		return Hello{}, fmt.Errorf("control frame length %d exceeds limit", n)
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(r, b); err != nil {
		return Hello{}, err
	}
	var msg Hello
	if err := json.Unmarshal(b, &msg); err != nil {
		return Hello{}, fmt.Errorf("decode control frame: %w", err)
	}
	if msg.Version != ProtocolVersion {
		return Hello{}, errors.New("unsupported protocol version")
	}
	return msg, nil
}
func WriteFrame(w io.Writer, msg Welcome, max int) error {
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	if len(b) > max {
		return errors.New("response frame exceeds limit")
	}
	var h [4]byte
	binary.BigEndian.PutUint32(h[:], uint32(len(b)))
	if _, err = w.Write(h[:]); err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}
