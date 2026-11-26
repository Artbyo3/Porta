# Builds Porta for Windows and Linux into dist\Porta. Needs Go 1.27 or newer.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  Write-Host "Go is not installed. Get it from https://go.dev/dl/ (version 1.27 or newer)."
  exit 1
}
New-Item -ItemType Directory -Force 'dist\Porta' | Out-Null
$env:CGO_ENABLED = '0'
$env:GOARCH = 'amd64'
foreach ($target in @(@('windows', 'dist/Porta/porta.exe'), @('linux', 'dist/Porta/porta-linux'))) {
  $env:GOOS = $target[0]
  go build -trimpath -ldflags=-s -o $target[1] .
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Copy-Item 'START.sh' 'dist\Porta\' -Force
Write-Host "Built dist\Porta: porta.exe (Windows), porta-linux and START.sh (Linux)."
