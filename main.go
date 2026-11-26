package main

import (
	"bufio"
	"bytes"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"rsc.io/qr"
)

//go:embed web
var webFS embed.FS

const (
	port      = "8787"
	idleLimit = 10 * time.Minute
	pairLife  = 5 * time.Minute
	maxUpload = 200 << 20
)

type pairing struct {
	token   string
	person  int64
	folder  int64
	expires time.Time
	used    bool
	pages   int
	files   int
}

type App struct {
	mu         sync.Mutex
	store      *Store
	session    string
	lastActive time.Time
	pair       *pairing
}

func main() {
	if err := run(); err != nil {
		fmt.Println("Porta failed:", err)
		fmt.Println("Press Enter to close.")
		bufio.NewReader(os.Stdin).ReadString('\n')
		os.Exit(1)
	}
}

func run() error {
	mime.AddExtensionType(".webm", "video/webm")
	mime.AddExtensionType(".mp4", "video/mp4")
	mime.AddExtensionType(".ico", "image/x-icon")
	base := os.Getenv("PORTA_HOME")
	if base == "" {
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		if exe, err = filepath.EvalSymlinks(exe); err != nil {
			return err
		}
		base = filepath.Dir(exe)
	}
	dir := filepath.Join(base, "Porta-Data")
	tmp := filepath.Join(dir, "tmp")
	os.RemoveAll(tmp)
	for _, d := range []string{filepath.Join(dir, "blobs"), tmp} {
		if err := os.MkdirAll(d, 0700); err != nil {
			return err
		}
	}
	for _, k := range []string{"TMPDIR", "TMP", "TEMP", "SQLITE_TMPDIR"} {
		os.Setenv(k, tmp)
	}
	store, err := openStore(dir)
	if err != nil {
		return err
	}
	app := &App{store: store}
	ln, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return err
	}
	url := "http://127.0.0.1:" + port
	banner(url, dir)
	if os.Getenv("PORTA_NO_BROWSER") == "" {
		openBrowser(url)
	}
	go app.watchIdle()
	return http.Serve(ln, app.routes())
}

func openBrowser(url string) {
	if runtime.GOOS == "windows" {
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	} else {
		exec.Command("xdg-open", url).Start()
	}
}

func (a *App) watchIdle() {
	for range time.Tick(15 * time.Second) {
		a.mu.Lock()
		if a.store.key != nil && time.Since(a.lastActive) > idleLimit {
			a.lockLocked()
		}
		a.mu.Unlock()
	}
}

func (a *App) lockLocked() {
	a.store.lock()
	a.session = ""
	a.pair = nil
}

func (a *App) routes() http.Handler {
	m := http.NewServeMux()
	static, _ := fs.Sub(webFS, "web")
	m.Handle("GET /", local(http.FileServerFS(static)))
	m.Handle("GET /style.css", http.FileServerFS(static))
	m.Handle("GET /favicon.ico", http.FileServerFS(static))
	m.Handle("GET /apple-touch-icon.png", http.FileServerFS(static))
	m.Handle("GET /media/{file}", http.FileServerFS(static))
	m.HandleFunc("GET /api/state", local(http.HandlerFunc(a.state)))
	m.HandleFunc("POST /api/setup", local(http.HandlerFunc(a.setup)))
	m.HandleFunc("POST /api/unlock", local(http.HandlerFunc(a.unlock)))
	m.HandleFunc("POST /api/lock", a.authed(func(w http.ResponseWriter, r *http.Request) { a.lockLocked(); reply(w, "ok") }))
	m.HandleFunc("POST /api/ping", a.authed(func(w http.ResponseWriter, r *http.Request) { reply(w, "ok") }))
	m.HandleFunc("GET /api/people", a.authed(a.listPeople))
	m.HandleFunc("POST /api/people", a.authed(a.addPerson))
	m.HandleFunc("GET /api/people/{id}/{kind}", a.authed(a.listChildren))
	m.HandleFunc("POST /api/people/{id}/docs", a.authed(a.addDoc))
	m.HandleFunc("POST /api/people/{id}/{kind}", a.authed(a.addChild))
	m.HandleFunc("GET /api/creds/{id}", a.authed(a.getCred))
	m.HandleFunc("GET /api/docs/{id}/file", a.authed(a.docFile))
	m.HandleFunc("PUT /api/{kind}/{id}", a.authed(a.update))
	m.HandleFunc("DELETE /api/{kind}/{id}", a.authed(a.remove))
	m.HandleFunc("GET /api/search", a.authed(a.search))
	m.HandleFunc("POST /api/pair", a.authed(a.startPair))
	m.HandleFunc("GET /api/pair", a.authed(a.pairStatus))
	m.HandleFunc("GET /api/pair/qr", a.authed(a.pairQR))
	m.HandleFunc("GET /m/{token}", a.phonePage)
	m.HandleFunc("GET /m/{token}/info", a.phoneInfo)
	m.HandleFunc("POST /m/{token}", a.phoneSend)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		m.ServeHTTP(w, r)
	})
}

// local admits only requests from this machine addressed to the loopback origin.
func local(h http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() || (r.Host != "127.0.0.1:"+port && r.Host != "localhost:"+port) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h.ServeHTTP(w, r)
	}
}

func (a *App) authed(h http.HandlerFunc) http.HandlerFunc {
	return local(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		defer a.mu.Unlock()
		c, err := r.Cookie("porta")
		if a.store.key == nil || err != nil || a.session == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(a.session)) != 1 {
			fail(w, http.StatusUnauthorized, "locked")
			return
		}
		if r.Header.Get("X-Porta-Poll") == "" {
			a.lastActive = time.Now()
		}
		h(w, r)
	}))
}

func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func readJSON(r *http.Request) (Record, error) {
	rec := Record{}
	err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&rec)
	return rec, err
}

func (a *App) state(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c, err := r.Cookie("porta")
	unlocked := a.store.key != nil && err == nil && a.session != "" && subtle.ConstantTimeCompare([]byte(c.Value), []byte(a.session)) == 1
	reply(w, map[string]bool{"initialized": a.store.initialized(), "unlocked": unlocked})
}

func (a *App) startSession(w http.ResponseWriter) {
	a.session = randHex(32)
	a.lastActive = time.Now()
	http.SetCookie(w, &http.Cookie{Name: "porta", Value: a.session, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
	reply(w, "ok")
}

func (a *App) setup(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	rec, err := readJSON(r)
	pw := str(rec["password"])
	if err != nil || len(pw) < 8 {
		fail(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if a.store.initialized() {
		fail(w, http.StatusConflict, "already set up")
		return
	}
	if err := a.store.create(pw); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.startSession(w)
}

func (a *App) unlock(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	rec, err := readJSON(r)
	if err != nil || !a.store.initialized() {
		fail(w, http.StatusBadRequest, "bad request")
		return
	}
	if a.store.key == nil {
		if err := a.store.unlock(str(rec["password"])); err != nil {
			fail(w, http.StatusUnauthorized, "wrong password")
			return
		}
		if err := a.store.migrateCategories(); err != nil {
			a.store.lock()
			fail(w, http.StatusInternalServerError, "could not upgrade documents to folders: "+err.Error())
			return
		}
	} else if err := (&Store{db: a.store.db}).unlock(str(rec["password"])); err != nil {
		fail(w, http.StatusUnauthorized, "wrong password")
		return
	}
	a.startSession(w)
}

func pathID(r *http.Request) int64 {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id
}

// clean keeps only the fields a client may set on a table, coerced to their stored types.
func clean(table string, in Record) Record {
	out := Record{}
	for _, f := range fields[table] {
		v, ok := in[f]
		if !ok {
			continue
		}
		if f == "done" {
			b, _ := v.(bool)
			out[f] = b
		} else if idFields[f] {
			out[f] = toID(v)
		} else {
			out[f] = str(v)
		}
	}
	return out
}

func (a *App) personExists(id int64) bool {
	_, err := a.store.get("people", id)
	return err == nil
}

// folderIn reports whether folder is 0 (the top level) or one of person's folders.
func (a *App) folderIn(person, folder int64) bool {
	if folder == 0 {
		return true
	}
	f, err := a.store.get("folders", folder)
	return err == nil && toID(f["person"]) == person
}

// placeFolder checks that a folder named name may sit under parent. id is the folder being renamed or moved, 0 for a new one.
func (a *App) placeFolder(person, id, parent int64, name string) error {
	if name == "" {
		return errors.New("folder name required")
	}
	folders, err := a.store.list("folders", person)
	if err != nil {
		return err
	}
	byID := map[int64]Record{}
	for _, f := range folders {
		byID[toID(f["id"])] = f
	}
	if parent != 0 && byID[parent] == nil {
		return errors.New("no such folder")
	}
	for p := parent; p != 0; p = toID(byID[p]["parent"]) {
		if p == id {
			return errors.New("a folder cannot go inside itself")
		}
	}
	for _, f := range folders {
		if toID(f["id"]) != id && toID(f["parent"]) == parent && strings.EqualFold(str(f["name"]), name) {
			return fmt.Errorf("there is already a folder named %q here", name)
		}
	}
	return nil
}

// folderPaths maps each folder of person (of everyone when -1) to its path from the top level, such as "Tax / 2024".
func (a *App) folderPaths(person int64) (map[int64]string, error) {
	folders, err := a.store.list("folders", person)
	if err != nil {
		return nil, err
	}
	byID := map[int64]Record{}
	for _, f := range folders {
		byID[toID(f["id"])] = f
	}
	paths := map[int64]string{}
	var path func(id int64) string
	path = func(id int64) string {
		f := byID[id]
		if f == nil {
			return ""
		}
		if p, ok := paths[id]; ok {
			return p
		}
		p := str(f["name"])
		if parent := path(toID(f["parent"])); parent != "" {
			p = parent + " / " + p
		}
		paths[id] = p
		return p
	}
	for id := range byID {
		path(id)
	}
	return paths, nil
}

func (a *App) listPeople(w http.ResponseWriter, r *http.Request) {
	recs, err := a.store.list("people", 0)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	type counts struct{ docs, folders, creds, openTasks int }
	byID := map[int64]*counts{}
	for _, p := range recs {
		byID[toID(p["id"])] = &counts{}
	}
	for _, kind := range []string{"docs", "folders", "creds", "tasks"} {
		children, err := a.store.list(kind, -1)
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, c := range children {
			n := byID[toID(c["person"])]
			if n == nil {
				continue
			}
			switch kind {
			case "docs":
				n.docs++
			case "folders":
				n.folders++
			case "creds":
				n.creds++
			case "tasks":
				if done, _ := c["done"].(bool); !done {
					n.openTasks++
				}
			}
		}
	}
	for _, p := range recs {
		n := byID[toID(p["id"])]
		p["docs"], p["folders"], p["creds"], p["openTasks"] = n.docs, n.folders, n.creds, n.openTasks
	}
	reply(w, recs)
}

func (a *App) addPerson(w http.ResponseWriter, r *http.Request) {
	rec, err := readJSON(r)
	if err != nil || strings.TrimSpace(str(rec["name"])) == "" {
		fail(w, http.StatusBadRequest, "name required")
		return
	}
	id, err := a.store.put("people", 0, 0, clean("people", rec))
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	reply(w, map[string]int64{"id": id})
}

func childKind(w http.ResponseWriter, r *http.Request) (string, bool) {
	kind := r.PathValue("kind")
	if kind != "docs" && kind != "folders" && kind != "creds" && kind != "tasks" {
		http.NotFound(w, r)
		return "", false
	}
	return kind, true
}

func (a *App) listChildren(w http.ResponseWriter, r *http.Request) {
	kind, ok := childKind(w, r)
	if !ok {
		return
	}
	recs, err := a.store.list(kind, pathID(r))
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, rec := range recs {
		delete(rec, "password")
		delete(rec, "blob")
	}
	reply(w, recs)
}

func (a *App) addChild(w http.ResponseWriter, r *http.Request) {
	kind, ok := childKind(w, r)
	if !ok {
		return
	}
	person := pathID(r)
	rec, err := readJSON(r)
	if err != nil || !a.personExists(person) || kind == "docs" {
		fail(w, http.StatusBadRequest, "bad request")
		return
	}
	rec = clean(kind, rec)
	if kind == "folders" {
		rec["name"] = strings.TrimSpace(str(rec["name"]))
		if err := a.placeFolder(person, 0, toID(rec["parent"]), str(rec["name"])); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	id, err := a.store.put(kind, 0, person, rec)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	reply(w, map[string]int64{"id": id})
}

// inlineTypes are the only types the browser may render; every other file is served as a download.
var inlineTypes = map[string]bool{
	"application/pdf": true, "image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true, "text/plain; charset=utf-8": true,
}

var extTypes = map[string]string{
	".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
	".webp": "image/webp", ".heic": "image/heic", ".tif": "image/tiff", ".tiff": "image/tiff",
	".txt": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
	".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".odt": "application/vnd.oasis.opendocument.text", ".ods": "application/vnd.oasis.opendocument.spreadsheet",
	".rtf": "application/rtf", ".zip": "application/zip", ".eml": "message/rfc822",
}

// fileType trusts magic bytes for the binary types the browser renders inline, and the extension for the rest.
func fileType(name string, b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return "application/pdf"
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg"
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(b, []byte("GIF8")):
		return "image/gif"
	case len(b) > 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "image/webp"
	}
	t := extTypes[strings.ToLower(filepath.Ext(name))]
	switch {
	case t == "":
		return "application/octet-stream"
	case strings.HasPrefix(t, "text/"):
		if !utf8.Valid(b) {
			return "application/octet-stream"
		}
	case inlineTypes[t]:
		return "application/octet-stream"
	}
	return t
}

func cleanName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	if name == "." || name == "/" {
		return ""
	}
	return name
}

// saveDoc stores data as a new document. meta holds the client-settable fields; missing ones get defaults.
// The caller checks that meta's folder belongs to person.
func (a *App) saveDoc(person int64, name string, data []byte, meta Record) (int64, error) {
	blob, err := a.store.writeBlob(data)
	if err != nil {
		return 0, err
	}
	rec := clean("docs", meta)
	if strings.TrimSpace(str(rec["title"])) == "" {
		rec["title"] = strings.TrimSuffix(name, filepath.Ext(name))
	}
	rec["folder"] = toID(rec["folder"])
	rec["name"], rec["mime"], rec["size"], rec["created"], rec["blob"] = name, fileType(name, data), len(data), time.Now().Unix(), blob
	return a.store.put("docs", 0, person, rec)
}

func (a *App) addDoc(w http.ResponseWriter, r *http.Request) {
	person := pathID(r)
	q := r.URL.Query()
	name := cleanName(q.Get("name"))
	folder, _ := strconv.ParseInt(q.Get("folder"), 10, 64)
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUpload))
	if err != nil || !a.personExists(person) || len(data) == 0 || name == "" {
		fail(w, http.StatusBadRequest, "empty or unreadable file")
		return
	}
	if !a.folderIn(person, folder) {
		fail(w, http.StatusBadRequest, "no such folder")
		return
	}
	id, err := a.saveDoc(person, name, data, Record{"title": q.Get("title"), "folder": folder, "date": q.Get("date")})
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	reply(w, map[string]int64{"id": id})
}

func (a *App) docFile(w http.ResponseWriter, r *http.Request) {
	rec, err := a.store.get("docs", pathID(r))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	data, err := a.store.readBlob(str(rec["blob"]))
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	mimeType, disp := str(rec["mime"]), "inline"
	if !inlineTypes[mimeType] {
		mimeType = "application/octet-stream"
	}
	if r.URL.Query().Has("dl") || mimeType == "application/octet-stream" {
		disp = "attachment"
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disp, map[string]string{"filename": str(rec["name"])}))
	w.Write(data)
}

func (a *App) getCred(w http.ResponseWriter, r *http.Request) {
	rec, err := a.store.get("creds", pathID(r))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	reply(w, rec)
}

func (a *App) update(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if fields[kind] == nil {
		http.NotFound(w, r)
		return
	}
	id := pathID(r)
	cur, err := a.store.get(kind, id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	in, err := readJSON(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad request")
		return
	}
	for k, v := range clean(kind, in) {
		cur[k] = v
	}
	person := toID(cur["person"])
	switch kind {
	case "docs":
		if !a.folderIn(person, toID(cur["folder"])) {
			fail(w, http.StatusBadRequest, "no such folder")
			return
		}
	case "folders":
		cur["name"] = strings.TrimSpace(str(cur["name"]))
		if err := a.placeFolder(person, id, toID(cur["parent"]), str(cur["name"])); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if _, err := a.store.put(kind, id, 0, cur); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	reply(w, "ok")
}

func (a *App) remove(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if _, ok := fields[kind]; !ok {
		http.NotFound(w, r)
		return
	}
	if err := a.store.remove(kind, pathID(r)); err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	reply(w, "ok")
}

func (a *App) search(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	type hit struct {
		Kind   string `json:"kind"`
		Text   string `json:"text"`
		Detail string `json:"detail"`
		ID     int64  `json:"id"`
		Person int64  `json:"person"`
		Folder int64  `json:"folder"`
	}
	hits := []hit{}
	if q == "" {
		reply(w, hits)
		return
	}
	searched := []struct {
		table, label string
		match        []string
	}{
		{"people", "name", []string{"name", "notes"}},
		{"folders", "name", []string{"name"}},
		{"docs", "title", []string{"title", "name", "notes", "date"}},
		{"creds", "label", []string{"label", "url"}},
	}
	paths, err := a.folderPaths(-1)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, sr := range searched {
		recs, err := a.store.list(sr.table, -1)
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, rec := range recs {
			for _, f := range sr.match {
				if !strings.Contains(strings.ToLower(str(rec[f])), q) {
					continue
				}
				h := hit{Kind: sr.table, Text: str(rec[sr.label]), ID: toID(rec["id"]), Person: toID(rec["person"])}
				if sr.table == "people" {
					h.Person = h.ID
				}
				switch sr.table {
				case "docs":
					h.Folder = toID(rec["folder"])
					h.Detail = strings.TrimSpace(paths[h.Folder] + "  " + str(rec["date"]))
				case "folders":
					h.Folder = h.ID
					h.Detail = paths[toID(rec["parent"])]
				}
				hits = append(hits, h)
				break
			}
		}
	}
	reply(w, hits)
}

func lanIP() string {
	// Connecting a UDP socket only selects the outbound interface; no packet is sent.
	if c, err := net.Dial("udp", "192.0.2.1:9"); err == nil {
		defer c.Close()
		return c.LocalAddr().(*net.UDPAddr).IP.String()
	}
	addrs, _ := net.InterfaceAddrs()
	for _, ad := range addrs {
		if n, ok := ad.(*net.IPNet); ok && n.IP.To4() != nil && n.IP.IsPrivate() {
			return n.IP.String()
		}
	}
	return "127.0.0.1"
}

func (a *App) pairURL() string { return "http://" + lanIP() + ":" + port + "/m/" + a.pair.token }

func (a *App) startPair(w http.ResponseWriter, r *http.Request) {
	rec, err := readJSON(r)
	person, folder := toID(rec["person"]), toID(rec["folder"])
	if err != nil || !a.personExists(person) {
		fail(w, http.StatusBadRequest, "select a person first")
		return
	}
	if !a.folderIn(person, folder) {
		fail(w, http.StatusBadRequest, "no such folder")
		return
	}
	a.pair = &pairing{token: randHex(16), person: person, folder: folder, expires: time.Now().Add(pairLife)}
	reply(w, map[string]string{"url": a.pairURL()})
}

func (a *App) live(token string) bool {
	p := a.pair
	return p != nil && a.store.key != nil && !p.used && time.Now().Before(p.expires) &&
		subtle.ConstantTimeCompare([]byte(token), []byte(p.token)) == 1
}

func (a *App) pairStatus(w http.ResponseWriter, r *http.Request) {
	if a.pair == nil {
		reply(w, map[string]any{"active": false})
		return
	}
	reply(w, map[string]any{"active": a.live(a.pair.token), "done": a.pair.used, "pages": a.pair.pages, "files": a.pair.files,
		"person": a.pair.person, "url": a.pairURL(), "expires": a.pair.expires.Unix()})
}

func (a *App) pairQR(w http.ResponseWriter, r *http.Request) {
	if a.pair == nil || !a.live(a.pair.token) {
		http.NotFound(w, r)
		return
	}
	code, err := qr.Encode(a.pairURL(), qr.M)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	const q = 4
	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="264" height="264" shape-rendering="crispEdges"><rect width="100%%" height="100%%" fill="#fff"/><path fill="#000" d="`, code.Size+2*q, code.Size+2*q)
	for y := range code.Size {
		for x := range code.Size {
			if code.Black(x, y) {
				fmt.Fprintf(&b, "M%d %dh1v1h-1z", x+q, y+q)
			}
		}
	}
	b.WriteString(`"/></svg>`)
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Write([]byte(b.String()))
}

func (a *App) phonePage(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	ok := a.live(r.PathValue("token"))
	a.mu.Unlock()
	if !ok {
		http.Error(w, "This scan link is invalid, expired or already used.", http.StatusForbidden)
		return
	}
	page, _ := webFS.ReadFile("web/phone.html")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(page)
}

func (a *App) phoneInfo(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.live(r.PathValue("token")) {
		http.Error(w, "This scan link is invalid, expired or already used.", http.StatusForbidden)
		return
	}
	p, err := a.store.get("people", a.pair.person)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	paths, err := a.folderPaths(a.pair.person)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	reply(w, map[string]string{"person": str(p["name"]), "folder": paths[a.pair.folder]})
}

type upload struct {
	meta  Record
	pages [][]byte
	files []namedFile
}

type namedFile struct {
	name string
	data []byte
}

func (a *App) phoneSend(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	a.mu.Lock()
	ok := a.live(token)
	a.mu.Unlock()
	if !ok {
		http.Error(w, "This scan link is invalid, expired or already used.", http.StatusForbidden)
		return
	}
	up, err := readUpload(http.MaxBytesReader(w, r.Body, maxUpload), r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.live(token) {
		http.Error(w, "This scan link is invalid, expired or already used.", http.StatusForbidden)
		return
	}
	// The person or folder may have been deleted on the computer since the link was made.
	if !a.personExists(a.pair.person) {
		http.Error(w, "This person was deleted in Porta. Start a new scan from the computer.", http.StatusGone)
		return
	}
	if !a.folderIn(a.pair.person, a.pair.folder) {
		a.pair.folder = 0
	}
	if len(up.pages) > 0 {
		pdf, err := jpegsToPDF(up.pages)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		title := strings.TrimSpace(str(up.meta["title"]))
		if title == "" {
			title = "Scan " + time.Now().Format("2006-01-02 15-04-05")
		}
		meta := clean("docs", up.meta)
		meta["title"], meta["folder"] = title, a.pair.folder
		if _, err := a.saveDoc(a.pair.person, title+".pdf", pdf, meta); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	for _, f := range up.files {
		meta := clean("docs", up.meta)
		delete(meta, "title")
		meta["folder"] = a.pair.folder
		if _, err := a.saveDoc(a.pair.person, f.name, f.data, meta); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	a.pair.used, a.pair.pages, a.pair.files = true, len(up.pages), len(up.files)
	reply(w, map[string]int{"pages": len(up.pages), "files": len(up.files)})
}

// readUpload reads the multipart parts in order, in memory only (ParseMultipartForm would spill to disk).
// Parts: "meta" (JSON document fields), "page" (JPEG pages of one scan, in order), "file" (files kept as they are).
func readUpload(body io.Reader, r *http.Request) (*upload, error) {
	r.Body = io.NopCloser(body)
	mr, err := r.MultipartReader()
	if err != nil {
		return nil, err
	}
	up := &upload{meta: Record{}}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(part)
		if err != nil {
			return nil, err
		}
		switch part.FormName() {
		case "meta":
			if err := json.Unmarshal(data, &up.meta); err != nil {
				return nil, errors.New("bad metadata")
			}
		case "page":
			if fileType("", data) != "image/jpeg" {
				return nil, fmt.Errorf("page %d is not a JPEG", len(up.pages)+1)
			}
			up.pages = append(up.pages, data)
		case "file":
			name := cleanName(part.FileName())
			if name == "" || len(data) == 0 {
				return nil, errors.New("empty or unnamed file")
			}
			up.files = append(up.files, namedFile{name, data})
		}
	}
	if len(up.pages) == 0 && len(up.files) == 0 {
		return nil, errors.New("nothing to send")
	}
	return up, nil
}
