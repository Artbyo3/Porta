package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

// asset is one embedded web file, prepared once at startup: its type, a fingerprint browsers can revalidate
// against, and a gzip copy for text files. Reading every file here also pulls them off a slow USB stick at
// startup instead of during the first page load.
type asset struct {
	data, gz []byte
	ctype    string
	etag     string
}

type assets map[string]*asset

func loadAssets(fsys fs.FS) (assets, error) {
	out := assets{}
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		a := &asset{data: data, ctype: mime.TypeByExtension(path.Ext(p)), etag: hex.EncodeToString(sum[:10])}
		if a.ctype == "" {
			a.ctype = http.DetectContentType(data)
		}
		if strings.HasPrefix(a.ctype, "text/") || strings.Contains(a.ctype, "javascript") || strings.Contains(a.ctype, "svg") || strings.HasPrefix(a.ctype, "image/x-icon") {
			var b bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&b, gzip.BestCompression)
			zw.Write(data)
			zw.Close()
			if b.Len() < len(data)*9/10 {
				a.gz = b.Bytes()
			}
		}
		out["/"+p] = a
		return nil
	})
	return out, err
}

// serve writes a, compressed when the browser accepts gzip. With cache set, the browser keeps the file and
// revalidates it on each use (a tiny 304 reply when unchanged); without, it is never stored.
func (a *asset) serve(w http.ResponseWriter, r *http.Request, cache bool) {
	h := w.Header()
	h.Set("Content-Type", a.ctype)
	body, etag := a.data, a.etag
	if a.gz != nil {
		h.Add("Vary", "Accept-Encoding")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			h.Set("Content-Encoding", "gzip")
			body, etag = a.gz, etag+"-gz"
		}
	}
	if cache {
		h.Set("Cache-Control", "no-cache")
		h.Set("ETag", `"`+etag+`"`)
	}
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(body))
}

// handler serves the files under the request path; "/" is index.html.
func (as assets) handler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Path
	if name == "/" {
		name = "/index.html"
	}
	a := as[name]
	if a == nil {
		http.NotFound(w, r)
		return
	}
	a.serve(w, r, true)
}
