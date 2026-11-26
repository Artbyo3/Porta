package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/crypto/argon2"
	_ "modernc.org/sqlite"
)

// fields lists, per table, the record keys a client may set. A doc's name, type, size and blob are set by the server only.
var fields = map[string][]string{
	"people":  {"name", "notes", "icon", "color"},
	"folders": {"name", "parent"},
	"creds":   {"label", "url", "username", "password", "notes"},
	"tasks":   {"text", "done"},
	"docs":    {"title", "folder", "date", "notes"},
}

// idFields hold a record id; 0 means none (a folder at the top level, a document outside any folder).
var idFields = map[string]bool{"parent": true, "folder": true}

var errWrongPassword = errors.New("wrong password")

type Store struct {
	dir string
	db  *sql.DB
	key []byte
}

func openStore(dir string) (*Store, error) {
	dsn := "file:" + filepath.ToSlash(filepath.Join(dir, "porta.db")) +
		"?_pragma=journal_mode(DELETE)&_pragma=temp_store(MEMORY)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS people(id INTEGER PRIMARY KEY, person INTEGER NOT NULL, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS folders(id INTEGER PRIMARY KEY, person INTEGER NOT NULL, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, person INTEGER NOT NULL, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS creds(id INTEGER PRIMARY KEY, person INTEGER NOT NULL, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, person INTEGER NOT NULL, data BLOB NOT NULL);`)
	if err != nil {
		return nil, err
	}
	return &Store{dir: dir, db: db}, nil
}

func kek(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
}

func seal(key, plain []byte) []byte {
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	nonce := randBytes(gcm.NonceSize())
	return gcm.Seal(nonce, nonce, plain, nil)
}

func unseal(key, sealed []byte) ([]byte, error) {
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("ciphertext too short")
	}
	n := gcm.NonceSize()
	return gcm.Open(nil, sealed[:n], sealed[n:], nil)
}

func randBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

func randHex(n int) string { return hex.EncodeToString(randBytes(n)) }

func (s *Store) initialized() bool {
	var n int
	s.db.QueryRow(`SELECT count(*) FROM meta WHERE k='wrapped'`).Scan(&n)
	return n == 1
}

func (s *Store) create(password string) error {
	salt, dek := randBytes(16), randBytes(32)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tx.Exec(`INSERT INTO meta(k,v) VALUES('salt',?)`, salt)
	if _, err := tx.Exec(`INSERT INTO meta(k,v) VALUES('wrapped',?)`, seal(kek(password, salt), dek)); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.key = dek
	return nil
}

func (s *Store) unlock(password string) error {
	var salt, wrapped []byte
	if err := s.db.QueryRow(`SELECT v FROM meta WHERE k='salt'`).Scan(&salt); err != nil {
		return err
	}
	if err := s.db.QueryRow(`SELECT v FROM meta WHERE k='wrapped'`).Scan(&wrapped); err != nil {
		return err
	}
	dek, err := unseal(kek(password, salt), wrapped)
	if err != nil {
		return errWrongPassword
	}
	s.key = dek
	return nil
}

func (s *Store) lock() {
	for i := range s.key {
		s.key[i] = 0
	}
	s.key = nil
}

type Record = map[string]any

func (s *Store) put(table string, id, person int64, rec Record) (int64, error) {
	delete(rec, "id")
	delete(rec, "person")
	plain, err := json.Marshal(rec)
	if err != nil {
		return 0, err
	}
	data := seal(s.key, plain)
	if id != 0 {
		_, err := s.db.Exec(`UPDATE `+table+` SET data=? WHERE id=?`, data, id)
		return id, err
	}
	res, err := s.db.Exec(`INSERT INTO `+table+`(person,data) VALUES(?,?)`, person, data)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) decode(id, person int64, data []byte) (Record, error) {
	plain, err := unseal(s.key, data)
	if err != nil {
		return nil, err
	}
	rec := Record{}
	if err := json.Unmarshal(plain, &rec); err != nil {
		return nil, err
	}
	rec["id"], rec["person"] = id, person
	return rec, nil
}

func (s *Store) get(table string, id int64) (Record, error) {
	var person int64
	var data []byte
	if err := s.db.QueryRow(`SELECT person,data FROM `+table+` WHERE id=?`, id).Scan(&person, &data); err != nil {
		return nil, err
	}
	return s.decode(id, person, data)
}

// list returns the records of one person, or every record when person is -1.
func (s *Store) list(table string, person int64) ([]Record, error) {
	rows, err := s.db.Query(`SELECT id,person,data FROM `+table+` WHERE ?=-1 OR person=? ORDER BY id`, person, person)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Record{}
	for rows.Next() {
		var id, p int64
		var data []byte
		if err := rows.Scan(&id, &p, &data); err != nil {
			return nil, err
		}
		rec, err := s.decode(id, p, data)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *Store) remove(table string, id int64) error {
	if table == "docs" {
		if rec, err := s.get("docs", id); err == nil {
			os.Remove(s.blobPath(str(rec["blob"])))
		}
	}
	if table == "folders" {
		if err := s.removeFolderContents(id); err != nil {
			return err
		}
	}
	if table == "people" {
		for _, t := range []string{"docs", "folders", "creds", "tasks"} {
			recs, err := s.list(t, id)
			if err != nil {
				return err
			}
			for _, r := range recs {
				if err := s.remove(t, toID(r["id"])); err != nil {
					return err
				}
			}
		}
	}
	_, err := s.db.Exec(`DELETE FROM `+table+` WHERE id=?`, id)
	return err
}

// removeFolderContents deletes the documents and subfolders inside a folder, at every depth.
func (s *Store) removeFolderContents(id int64) error {
	folder, err := s.get("folders", id)
	if err != nil {
		return nil
	}
	person := toID(folder["person"])
	for _, t := range []string{"docs", "folders"} {
		key := map[string]string{"docs": "folder", "folders": "parent"}[t]
		recs, err := s.list(t, person)
		if err != nil {
			return err
		}
		for _, r := range recs {
			if toID(r[key]) == id {
				if err := s.remove(t, toID(r["id"])); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// migrateCategories turns each document category from older versions into a top-level folder of the same name.
// Documents that were Unsorted stay at the top level. It only touches documents that still carry a category.
func (s *Store) migrateCategories() error {
	docs, err := s.list("docs", -1)
	if err != nil {
		return err
	}
	folders, err := s.list("folders", -1)
	if err != nil {
		return err
	}
	type key struct {
		person int64
		name   string
	}
	top := map[key]int64{}
	for _, f := range folders {
		if toID(f["parent"]) == 0 {
			top[key{toID(f["person"]), str(f["name"])}] = toID(f["id"])
		}
	}
	for _, d := range docs {
		cat, ok := d["category"]
		if !ok {
			continue
		}
		delete(d, "category")
		person := toID(d["person"])
		d["folder"] = int64(0)
		if name := str(cat); name != "" && name != "Unsorted" {
			k := key{person, name}
			if top[k] == 0 {
				if top[k], err = s.put("folders", 0, person, Record{"name": name, "parent": int64(0)}); err != nil {
					return err
				}
			}
			d["folder"] = top[k]
		}
		if _, err := s.put("docs", toID(d["id"]), person, d); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) blobPath(name string) string {
	return filepath.Join(s.dir, "blobs", filepath.Base(name))
}

func (s *Store) writeBlob(plain []byte) (string, error) {
	name := randHex(16)
	tmp := filepath.Join(s.dir, "tmp", name)
	if err := os.WriteFile(tmp, seal(s.key, plain), 0600); err != nil {
		return "", err
	}
	return name, os.Rename(tmp, s.blobPath(name))
}

func (s *Store) readBlob(name string) ([]byte, error) {
	sealed, err := os.ReadFile(s.blobPath(name))
	if err != nil {
		return nil, err
	}
	return unseal(s.key, sealed)
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func toID(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case float64:
		return int64(n)
	}
	return 0
}
