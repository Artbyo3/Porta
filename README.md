# Porta
Build (Go 1.27+, no CGO), from this folder:
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags=-s -o dist/Porta/porta.exe .
    CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags=-s -o dist/Porta/porta-linux .
    cp START.sh dist/Porta/
Copy dist/Porta to the stick. Data goes in Porta/Porta-Data next to the binaries.
Windows: double-click porta.exe. Linux: sh START.sh (works without exec permissions).
The browser opens http://127.0.0.1:8787. Close the console window (or Ctrl+C) to quit.
Phone scanning needs the phone on the same network as this computer (port 8787).

## License
The source code is under the MIT License (see LICENSE).

The background media in web/media/ (grass.mp4, grass.webm and the still frame grass.jpg) are not covered by the MIT License. They are re-encoded versions of "Grass, dew, field" by JustYøu on Pixabay, used under the Pixabay Content License:
https://pixabay.com/videos/grass-dew-field-fog-morning-66810/
https://pixabay.com/service/license-summary/
The footage is part of Porta's interface. It may not be redistributed on its own; to use it elsewhere, download it from Pixabay under their license.
