# Porta

A portable, encrypted vault for documents, credentials and tasks. It runs from a USB stick on Windows or Linux and needs no installation and no internet. Your browser is the interface.

- Each person keeps their own folders, documents, credentials and tasks.
- Everything is encrypted with one master password (Argon2id key, AES-256-GCM), in a folder next to the program.
- Documents can be previewed in Porta (PDF, images, text), including full screen.
- Phone scanning: scan a QR code, photograph pages, and Porta flattens and crops them into one PDF.

## Using it

Copy the `dist/Porta` folder (see Building) to a USB stick.

- **Windows:** double-click `porta.exe`.
- **Linux:** open a terminal in the folder and run `sh START.sh`. It works even when the stick does not allow running programs.

The browser opens `http://127.0.0.1:8787`. Your data goes in `Porta-Data`, next to the program. To quit, close the console window (or press Ctrl+C).

Phone scanning needs the phone on the same Wi-Fi as the computer. If the phone shows a black page, use **Allow phone access** in the scan window.

## Building

You need [Go](https://go.dev/dl/) 1.27 or newer and nothing else. There is no C compiler, Node or npm to install. Any of Windows, Linux or macOS can build for both Windows and Linux.

```sh
git clone https://github.com/Artbyo3/Porta.git
cd Porta
```

Then run one of these:

```sh
sh build.sh                                        # Linux, macOS, or Git Bash on Windows
powershell -ExecutionPolicy Bypass -File build.ps1   # Windows
```

Both put `porta.exe`, `porta-linux` and `START.sh` in `dist/Porta`. macOS is not a supported target yet.

## Developing

The web files in `web/` are built into the program, so rebuild after changing them. To run straight from the source with a throwaway vault:

```sh
PORTA_HOME=/tmp/porta-dev go run .
```

On Windows PowerShell:

```powershell
$env:PORTA_HOME = "$env:TEMP\porta-dev"; go run .
```

Environment variables:

| Variable | Effect |
|---|---|
| `PORTA_HOME` | Folder that holds `Porta-Data`. By default, the folder of the program. |
| `PORTA_NO_BROWSER` | Set it to anything to stop Porta from opening the browser. |
| `NO_COLOR` | Plain console output, without colors or the animated grass. |

Check your changes with `go vet ./...` before sending them.

Porta always listens on port 8787. The main app answers only this computer (`127.0.0.1`). The phone can reach only the scan page with its one-time link, plus the style, icons and background media.

## How the code is laid out

| File | What it does |
|---|---|
| `main.go` | Startup, HTTP routes, sessions, people, folders, documents, search, phone pairing |
| `store.go` | Encrypted SQLite storage, encrypted file blobs, key handling, data migrations |
| `assets.go` | Serves the files from `web/`, with caching and compression |
| `pdf.go` | Builds a PDF from scanned JPEG pages |
| `console*.go` | The console banner and animated grass |
| `firewall*.go` | Asks Windows to let phones reach Porta |
| `web/index.html`, `web/app.js` | The app in the computer's browser |
| `web/phone.html` | The phone scan page: camera, cropping, color modes, sending |
| `web/style.css` | Styles for both pages |
| `docs/` | Static showcase website for GitHub Pages |
| `START.sh` | Linux launcher, also for sticks that do not allow running programs |

## License

The source code is under the MIT License (see LICENSE).

The background media in web/media/ (grass.mp4, grass.webm and the still frame grass.jpg) are not covered by the MIT License. They are re-encoded versions of "Grass, dew, field" by JustYøu on Pixabay, used under the Pixabay Content License:
https://pixabay.com/videos/grass-dew-field-fog-morning-66810/
https://pixabay.com/service/license-summary/
The footage is part of Porta's interface. It may not be redistributed on its own; to use it elsewhere, download it from Pixabay under their license.
