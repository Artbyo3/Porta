//go:build !windows

package main

import (
	"fmt"
	"os"
)

// enableANSI reports whether standard output is a terminal that understands color escape codes.
func enableANSI() bool {
	fi, err := os.Stdout.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0 && os.Getenv("TERM") != "dumb"
}

func setTitle(title string) {
	if enableANSI() {
		fmt.Print("\x1b]0;" + title + "\a")
	}
}
