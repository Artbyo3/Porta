# Porta
Build (Go 1.27+, no CGO), from this folder:
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags=-s -o dist/Porta/porta.exe .
    CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags=-s -o dist/Porta/porta-linux .
    cp START.sh dist/Porta/
Copy dist/Porta to the stick. Data goes in Porta/Porta-Data next to the binaries.
Windows: double-click porta.exe. Linux: sh START.sh (works without exec permissions).
The browser opens http://127.0.0.1:8787. Close the console window (or Ctrl+C) to quit.
Phone scanning needs the phone on the same network as this computer (port 8787).
