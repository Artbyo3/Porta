#!/bin/sh
# Builds Porta for Windows and Linux into dist/Porta. Needs Go 1.27 or newer.
# Run from anywhere:  sh build.sh
set -e
cd "$(dirname "$0")"
if ! command -v go >/dev/null 2>&1; then
  echo "Go is not installed. Get it from https://go.dev/dl/ (version 1.27 or newer)." >&2
  exit 1
fi
mkdir -p dist/Porta
export CGO_ENABLED=0 GOARCH=amd64
GOOS=windows go build -trimpath -ldflags=-s -o dist/Porta/porta.exe .
GOOS=linux go build -trimpath -ldflags=-s -o dist/Porta/porta-linux .
cp START.sh dist/Porta/
echo "Built dist/Porta: porta.exe (Windows), porta-linux and START.sh (Linux)."
