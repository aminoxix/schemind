package schemind

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
)

type author struct {
	Name    string `json:"name"`
	Country string `json:"country"`
}

type book struct {
	ID     string   `json:"id"`
	Title  string   `json:"title"`
	Author author   `json:"author"`
	Tags   []string `json:"tags"`
	Rating float64  `json:"rating"`
}

func TestHashIsStable8Hex(t *testing.T) {
	h1 := Hash(book{})
	h2 := Hash(book{})
	if h1 != h2 {
		t.Fatalf("hash not deterministic: %s vs %s", h1, h2)
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}$`).MatchString(h1) {
		t.Fatalf("hash not 8-hex: %q", h1)
	}
}

func TestHashChangesOnRename(t *testing.T) {
	type bookRenamed struct {
		ID         string `json:"id"`
		Title      string `json:"title"`
		Author     author `json:"authorInfo"` // renamed in JSON
		Tags       []string
		Rating float64 `json:"rating"`
	}
	if Hash(book{}) == Hash(bookRenamed{}) {
		t.Fatal("hash should change when a field is renamed")
	}
}

func TestHashIgnoresFieldOrder(t *testing.T) {
	type a struct {
		X string `json:"x"`
		Y string `json:"y"`
	}
	type b struct {
		Y string `json:"y"`
		X string `json:"x"`
	}
	if Hash(a{}) != Hash(b{}) {
		t.Fatal("hash should be order-independent")
	}
}

func TestMiddlewareSetsHeaders(t *testing.T) {
	mw := Middleware(3, book{})
	handler := mw(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", "/api/books", nil))

	if got := rec.Header().Get(HeaderHash); got != Hash(book{}) {
		t.Fatalf("hash header = %q, want %q", got, Hash(book{}))
	}
	if got := rec.Header().Get(HeaderVersion); got != "3" {
		t.Fatalf("version header = %q, want 3", got)
	}
}
