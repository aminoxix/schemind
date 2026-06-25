package io.schemind.example.web;

import io.schemind.example.model.BookInput;
import io.schemind.example.service.BookStore;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** Book Library CRUD API + the drift-toggle control surface. Mirrors the Go example. */
@RestController
@RequestMapping("/api")
public class BookController {

    private final BookStore store;

    public BookController(BookStore store) {
        this.store = store;
    }

    @GetMapping("/books")
    public Map<String, Object> list() {
        List<Map<String, Object>> data = store.list();
        return Map.of("data", data, "count", data.size());
    }

    @GetMapping("/books/{id}")
    public ResponseEntity<?> get(@PathVariable String id) {
        Map<String, Object> book = store.get(id);
        if (book == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
        }
        return ResponseEntity.ok(Map.of("data", book));
    }

    @PostMapping("/books")
    public ResponseEntity<?> create(@RequestBody BookInput input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("data", store.create(input)));
    }

    @PutMapping("/books/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @RequestBody BookInput input) {
        Map<String, Object> book = store.update(id, input);
        if (book == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
        }
        return ResponseEntity.ok(Map.of("data", book));
    }

    @DeleteMapping("/books/{id}")
    public ResponseEntity<?> remove(@PathVariable String id) {
        if (!store.remove(id)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
        }
        return ResponseEntity.ok(Map.of("data", Map.of("id", id)));
    }

    @PostMapping("/_drift")
    public ResponseEntity<?> setDrift(@RequestParam String mode) {
        if (!BookStore.DRIFT_MODES.contains(mode)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "invalid mode", "allowed", BookStore.DRIFT_MODES));
        }
        store.setDrift(mode);
        return ResponseEntity.ok(Map.of("drift", mode));
    }

    @GetMapping("/_drift")
    public Map<String, Object> getDrift() {
        return Map.of("drift", store.getDrift());
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok");
    }
}
