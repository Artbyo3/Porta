package main

import (
	"errors"
	"os/exec"
	"strings"
	"syscall"
)

const canAllowPhones = true

// phoneRule lets devices on the same private network reach Porta's port, whichever drive Porta runs from.
// A rule tied to the program's path breaks on a USB stick: Windows stores the path against the drive's
// volume number, which can change each time the stick is plugged in.
const phoneRule = `netsh advfirewall firewall delete rule name="Porta phone scanning" >nul 2>&1 & ` +
	`netsh advfirewall firewall add rule name="Porta phone scanning" dir=in action=allow protocol=TCP localport=` + port +
	` profile=private,domain remoteip=localsubnet`

var errDeclined = errors.New("Windows did not allow it. Try again and choose Yes in the Windows prompt.")

// allowPhoneAccess adds phoneRule through the Windows administrator prompt and waits for the answer.
func allowPhoneAccess() error {
	ps := "try { $p = Start-Process -FilePath cmd.exe -ArgumentList '/c " + strings.ReplaceAll(phoneRule, "'", "''") +
		"' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode } catch { exit 1223 }"
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &exit) && exit.ExitCode() == 1223: // ERROR_CANCELLED: the prompt was declined
		return errDeclined
	default:
		return errors.New("Windows could not add the firewall rule: " + err.Error())
	}
}
