// Package schemind is the Go backend adapter for schemind.
//
// It computes a deterministic schema hash of a response struct (at startup, via
// reflection — never per-request) and injects the schemind header protocol so
// the core can take the hash fast-path: skip shape extraction entirely when the
// hash is unchanged.
//
//	import schemind "github.com/aminoxix/schemind/adapters/schemind-go"
//
//	router.Use(schemind.Middleware(1, BookResponse{}))
package schemind

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

// Header names of the schemind adapter protocol.
const (
	HeaderHash    = "X-Schemind-Schema-Hash"
	HeaderVersion = "X-Schemind-Schema-Version"
)

// Hash returns the 8-char schema hash for v's type — a SHA-256 (truncated) of a
// canonical string of the struct's exported field names + types. Stable across
// runs; changes whenever a field is added, removed, renamed, or retyped.
func Hash(v any) string {
	sum := sha256.Sum256([]byte(canonical(reflect.TypeOf(v), map[reflect.Type]bool{})))
	return hex.EncodeToString(sum[:])[:8]
}

// SetHeaders writes the schema hash + version onto a response.
func SetHeaders(h http.Header, hash string, version int) {
	h.Set(HeaderHash, hash)
	h.Set(HeaderVersion, strconv.Itoa(version))
}

// Middleware injects the schema headers for responseType on every response. The
// hash is computed once here, so there is zero per-request reflection cost.
func Middleware(version int, responseType any) func(http.Handler) http.Handler {
	hash := Hash(responseType)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			SetHeaders(w.Header(), hash, version)
			next.ServeHTTP(w, r)
		})
	}
}

func canonical(t reflect.Type, seen map[reflect.Type]bool) string {
	if t == nil {
		return "nil"
	}
	for t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.Struct:
		if seen[t] {
			return "ref:" + t.Name()
		}
		seen[t] = true
		fields := make([]string, 0, t.NumField())
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			if f.PkgPath != "" {
				continue // unexported
			}
			if name, skip := jsonName(f); !skip {
				fields = append(fields, name+":"+canonical(f.Type, seen))
			}
		}
		sort.Strings(fields)
		return "{" + strings.Join(fields, ",") + "}"
	case reflect.Slice, reflect.Array:
		return "[" + canonical(t.Elem(), seen) + "]"
	case reflect.Map:
		return "map[" + canonical(t.Key(), seen) + "]" + canonical(t.Elem(), seen)
	case reflect.String:
		return "string"
	case reflect.Bool:
		return "bool"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return "number"
	default:
		return t.Kind().String()
	}
}

// jsonName resolves the serialized field name (honoring a `json:"..."` tag) and
// reports whether the field is omitted (`json:"-"`).
func jsonName(f reflect.StructField) (string, bool) {
	tag := f.Tag.Get("json")
	if tag == "" {
		return f.Name, false
	}
	name := strings.Split(tag, ",")[0]
	if name == "-" {
		return "", true
	}
	if name == "" {
		return f.Name, false
	}
	return name, false
}
