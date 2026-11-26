package main

import (
	"syscall"
	"unsafe"
)

var kernel32 = syscall.NewLazyDLL("kernel32.dll")

// enableANSI turns on color escape codes and UTF-8 in the console window. It reports false when there is no console.
func enableANSI() bool {
	h, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	var mode uint32
	if err != nil || syscall.GetConsoleMode(h, &mode) != nil {
		return false
	}
	const enableVirtualTerminalProcessing = 0x0004
	ok, _, _ := kernel32.NewProc("SetConsoleMode").Call(uintptr(h), uintptr(mode|enableVirtualTerminalProcessing))
	kernel32.NewProc("SetConsoleOutputCP").Call(65001)
	return ok != 0
}

func setTitle(title string) {
	if p, err := syscall.UTF16PtrFromString(title); err == nil {
		kernel32.NewProc("SetConsoleTitleW").Call(uintptr(unsafe.Pointer(p)))
	}
}
