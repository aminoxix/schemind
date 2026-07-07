// schemind example backend — Book Library CRUD API (Go, stdlib only).
//
// Runs on :8080. Serves the same Book shape the Java/Next examples use. Has a
// runtime "drift toggle" (POST /api/_drift?mode=...) so tests can make the API's
// response shape mutate on demand — exactly what schemind is built to catch.
package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	schemind "github.com/aminoxix/schemind/adapters/schemind-go"
)

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Author struct {
	Name    string
	Country string
}

type Book struct {
	ID          string
	Title       string
	Author      Author
	Tags        []string
	Rating      float64
	PublishedAt *string
	CreatedAt   string
}

// ---------------------------------------------------------------------------
// Drift modes — change the *shape* of serialized books at runtime.
// ---------------------------------------------------------------------------

const (
	driftNone     = "none"     // canonical shape
	driftBreaking = "breaking" // author -> authorInfo (field renamed/removed)
	driftWarn     = "warn"     // rating becomes null (nullable)
	driftInfo     = "info"     // add a new `genre` field (additive)
)

// ---------------------------------------------------------------------------
// schemind adapter protocol — per-drift-mode schema hashes.
//
// Each drift mode serializes a different *shape*, so each mode is a distinct
// schema version with its own hash (computed once at startup via the real
// schemind-go adapter). Within a mode the hash is stable → the core's
// trustAdapterHash fast-path can skip extraction; flipping the mode changes
// the hash → the core re-extracts and catches the drift. A single static hash
// here would be a footgun (unchanged hash + mutated shape = missed drift).
// ---------------------------------------------------------------------------

type bookWireAuthor struct {
	Name    string `json:"name"`
	Country string `json:"country"`
}

// The canonical serialized book (drift mode "none").
type bookWireNone struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Author      bookWireAuthor `json:"author"`
	Tags        []string       `json:"tags"`
	Rating      float64        `json:"rating"`
	PublishedAt *string        `json:"publishedAt"`
	CreatedAt   string         `json:"createdAt"`
}

// "breaking": author renamed to authorInfo.
type bookWireBreaking struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	AuthorInfo  bookWireAuthor `json:"authorInfo"`
	Tags        []string       `json:"tags"`
	Rating      float64        `json:"rating"`
	PublishedAt *string        `json:"publishedAt"`
	CreatedAt   string         `json:"createdAt"`
}

// "warn": rating becomes nullable.
type bookWireWarn struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Author      bookWireAuthor `json:"author"`
	Tags        []string       `json:"tags"`
	Rating      *float64       `json:"rating"`
	PublishedAt *string        `json:"publishedAt"`
	CreatedAt   string         `json:"createdAt"`
}

// "info": additive genre field.
type bookWireInfo struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Author      bookWireAuthor `json:"author"`
	Tags        []string       `json:"tags"`
	Rating      float64        `json:"rating"`
	PublishedAt *string        `json:"publishedAt"`
	CreatedAt   string         `json:"createdAt"`
	Genre       string         `json:"genre"`
}

var schemaHashByMode = map[string]string{
	driftNone:     schemind.Hash(bookWireNone{}),
	driftInfo:     schemind.Hash(bookWireInfo{}),
	driftWarn:     schemind.Hash(bookWireWarn{}),
	driftBreaking: schemind.Hash(bookWireBreaking{}),
}

var schemaVersionByMode = map[string]int{
	driftNone: 1, driftInfo: 2, driftWarn: 3, driftBreaking: 4,
}

type store struct {
	mu    sync.RWMutex
	books map[string]*Book
	order []string
	drift string
}

func newStore() *store {
	s := &store{books: map[string]*Book{}, drift: driftNone}
	seed := []Book{
		{Title: "Refactoring", Author: Author{"Martin Fowler", "UK"}, Tags: []string{"oop", "design"}, Rating: 4.6},
		{Title: "Clean Code", Author: Author{"Robert C. Martin", "USA"}, Tags: []string{"craft"}, Rating: 4.2},
		{Title: "The Go Programming Language", Author: Author{"Alan Donovan", "USA"}, Tags: []string{"go"}, Rating: 4.7},
	}
	for i := range seed {
		b := seed[i]
		b.ID = newID()
		b.CreatedAt = time.Now().UTC().Format(time.RFC3339)
		s.books[b.ID] = &b
		s.order = append(s.order, b.ID)
	}
	return s
}

// stampSchema writes the schemind adapter headers for the current drift mode.
// Callers must already hold the store lock (read or write).
func (s *store) stampSchema(w http.ResponseWriter) {
	schemind.SetHeaders(w.Header(), schemaHashByMode[s.drift], schemaVersionByMode[s.drift])
}

// serialize renders a book into a map whose *shape* depends on the drift mode.
func (s *store) serialize(b *Book) map[string]any {
	m := map[string]any{
		"id":          b.ID,
		"title":       b.Title,
		"author":      map[string]any{"name": b.Author.Name, "country": b.Author.Country},
		"tags":        b.Tags,
		"rating":      b.Rating,
		"publishedAt": valueOrNil(b.PublishedAt),
		"createdAt":   b.CreatedAt,
	}
	switch s.drift {
	case driftBreaking:
		m["authorInfo"] = m["author"]
		delete(m, "author")
	case driftWarn:
		m["rating"] = nil
	case driftInfo:
		m["genre"] = "fiction"
	}
	return m
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (s *store) list(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	s.stampSchema(w)
	data := make([]map[string]any, 0, len(s.order))
	for _, id := range s.order {
		data = append(data, s.serialize(s.books[id]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data, "count": len(data)})
}

func (s *store) get(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, ok := s.books[r.PathValue("id")]
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}
	s.stampSchema(w)
	writeJSON(w, http.StatusOK, map[string]any{"data": s.serialize(b)})
}

type bookInput struct {
	Title  string   `json:"title"`
	Author Author   `json:"author"`
	Tags   []string `json:"tags"`
	Rating float64  `json:"rating"`
}

func (s *store) create(w http.ResponseWriter, r *http.Request) {
	var in bookInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	b := &Book{ID: newID(), Title: in.Title, Author: in.Author, Tags: orEmpty(in.Tags), Rating: in.Rating, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	s.books[b.ID] = b
	s.order = append(s.order, b.ID)
	s.stampSchema(w)
	writeJSON(w, http.StatusCreated, map[string]any{"data": s.serialize(b)})
}

func (s *store) update(w http.ResponseWriter, r *http.Request) {
	var in bookInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.books[r.PathValue("id")]
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}
	b.Title, b.Author, b.Tags, b.Rating = in.Title, in.Author, orEmpty(in.Tags), in.Rating
	s.stampSchema(w)
	writeJSON(w, http.StatusOK, map[string]any{"data": s.serialize(b)})
}

func (s *store) remove(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.books[id]; !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}
	delete(s.books, id)
	for i, x := range s.order {
		if x == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"id": id}})
}

// setDrift switches the active drift mode. Test-only control surface.
func (s *store) setDrift(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	switch mode {
	case driftNone, driftBreaking, driftWarn, driftInfo:
		s.mu.Lock()
		s.drift = mode
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"drift": mode})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid mode", "allowed": []string{driftNone, driftBreaking, driftWarn, driftInfo}})
	}
}

func (s *store) getDrift(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"drift": s.drift})
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

func main() {
	s := newStore()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/books", s.list)
	mux.HandleFunc("POST /api/books", s.create)
	mux.HandleFunc("GET /api/books/{id}", s.get)
	mux.HandleFunc("PUT /api/books/{id}", s.update)
	mux.HandleFunc("DELETE /api/books/{id}", s.remove)
	mux.HandleFunc("POST /api/_drift", s.setDrift)
	mux.HandleFunc("GET /api/_drift", s.getDrift)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})

	addr := ":8080"
	log.Printf("schemind example (Go) listening on %s", addr)
	if err := http.ListenAndServe(addr, cors(mux)); err != nil {
		log.Fatal(err)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Expose-Headers", "X-Schemind-Schema-Hash, X-Schemind-Schema-Version")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func valueOrNil(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
