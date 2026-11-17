package main

import (
	"errors"
	"io"
	"testing"

	"golang.org/x/sys/unix"
)

type scriptedTunWrite struct {
	steps  []scriptedTunWriteStep
	output []byte
}

type scriptedTunWriteStep struct {
	count int
	err   error
}

type scriptedTunRead struct {
	steps []scriptedTunReadStep
}

type scriptedTunReadStep struct {
	data []byte
	err  error
}

func (r *scriptedTunRead) Read(packet []byte) (int, error) {
	if len(r.steps) == 0 {
		return 0, io.EOF
	}
	step := r.steps[0]
	r.steps = r.steps[1:]
	return copy(packet, step.data), step.err
}

func (w *scriptedTunWrite) Write(packet []byte) (int, error) {
	if len(w.steps) == 0 {
		return 0, io.ErrNoProgress
	}
	step := w.steps[0]
	w.steps = w.steps[1:]
	if step.count > len(packet) {
		step.count = len(packet)
	}
	w.output = append(w.output, packet[:step.count]...)
	return step.count, step.err
}

func TestReadTunPacketRetriesTransientErrors(t *testing.T) {
	reader := &scriptedTunRead{
		steps: []scriptedTunReadStep{
			{err: unix.EAGAIN},
			{err: unix.EINTR},
			{data: []byte("packet")},
		},
	}

	packet := make([]byte, 16)
	read, err := readTunPacket(reader, packet)
	if err != nil {
		t.Fatalf("readTunPacket returned error: %v", err)
	}
	if got := string(packet[:read]); got != "packet" {
		t.Fatalf("readTunPacket returned %q, want packet", got)
	}
}

func TestWriteTunPacketCompletesShortAndTransientWrites(t *testing.T) {
	writer := &scriptedTunWrite{
		steps: []scriptedTunWriteStep{
			{count: 2},
			{err: unix.EAGAIN},
			{count: 3},
		},
	}

	packet := []byte("hello")
	written, err := writeTunPacket(writer, packet)
	if err != nil {
		t.Fatalf("writeTunPacket returned error: %v", err)
	}
	if written != len(packet) {
		t.Fatalf("writeTunPacket wrote %d bytes, want %d", written, len(packet))
	}
	if string(writer.output) != string(packet) {
		t.Fatalf("writeTunPacket output %q, want %q", writer.output, packet)
	}
}

func TestWriteTunPacketRejectsNoProgress(t *testing.T) {
	writer := &scriptedTunWrite{
		steps: []scriptedTunWriteStep{{count: 0}},
	}
	if _, err := writeTunPacket(writer, []byte("packet")); !errors.Is(err, io.ErrNoProgress) {
		t.Fatalf("writeTunPacket error = %v, want io.ErrNoProgress", err)
	}
}
