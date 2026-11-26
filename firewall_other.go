//go:build !windows

package main

import "errors"

const canAllowPhones = false

func allowPhoneAccess() error {
	return errors.New("allow port " + port + " in this computer's firewall")
}
