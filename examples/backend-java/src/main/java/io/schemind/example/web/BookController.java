package io.schemind.example.web;

import io.schemind.SchemindAdapter;
import io.schemind.example.model.BookInput;
import io.schemind.example.service.BookStore;
import io.schemind.example.service.StoreResult;
import io.schemind.example.wire.WireTypes;
import jakarta.servlet.http.HttpServletResponse;
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

import java.util.Map;

/**
 * Book Library CRUD API + the drift-toggle control surface.
 *
 * <p>Demonstrates the schemind-java adapter protocol: after each book operation
 * the controller stamps {@code X-Schemind-Schema-Hash} and
 * {@code X-Schemind-Schema-Version} onto the response. The hash is looked up
 * from the pre-computed {@link WireTypes#SCHEMA_HASH_BY_MODE} map using the
 * drift mode returned atomically by the store — no TOCTOU race with the drift
 * toggle. Mirrors {@code examples/backend-go/main.go} and
 * {@code examples/backend-py/main.py}.
 */
@RestController
@RequestMapping("/api")
public class BookController {

    private final BookStore store;

    public BookController(BookStore store) {
        this.store = store;
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    /**
     * Stamp the schemind schema headers for the drift mode that was active when
     * the response body was serialized. Both were captured under the same store
     * lock so the hash always describes the exact payload on the wire.
     */
    private void stampSchemind(HttpServletResponse response, String drift) {
        String hash    = WireTypes.SCHEMA_HASH_BY_MODE.get(drift);
        Integer version = WireTypes.SCHEMA_VERSION_BY_MODE.get(drift);
        if (hash != null && version != null) {
            SchemindAdapter.setHeaders(response, hash, version);
        }
    }

    // ── Book CRUD ─────────────────────────────────────────────────────────────

    @GetMapping("/books")
    public ResponseEntity<?> list(HttpServletResponse response) {
        StoreResult<Map<String, Object>> result = store.list();
        stampSchemind(response, result.drift());
        return ResponseEntity.ok(result.body());
    }

    @GetMapping("/books/{id}")
    public ResponseEntity<?> get(@PathVariable String id, HttpServletResponse response) {
        StoreResult<Map<String, Object>> result = store.get(id);
        if (result.body().containsKey("error")) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(result.body());
        }
        stampSchemind(response, result.drift());
        return ResponseEntity.ok(result.body());
    }

    @PostMapping("/books")
    public ResponseEntity<?> create(@RequestBody BookInput input, HttpServletResponse response) {
        StoreResult<Map<String, Object>> result = store.create(input);
        stampSchemind(response, result.drift());
        return ResponseEntity.status(HttpStatus.CREATED).body(result.body());
    }

    @PutMapping("/books/{id}")
    public ResponseEntity<?> update(@PathVariable String id,
                                    @RequestBody BookInput input,
                                    HttpServletResponse response) {
        StoreResult<Map<String, Object>> result = store.update(id, input);
        if (result.body().containsKey("error")) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(result.body());
        }
        stampSchemind(response, result.drift());
        return ResponseEntity.ok(result.body());
    }

    @DeleteMapping("/books/{id}")
    public ResponseEntity<?> remove(@PathVariable String id, HttpServletResponse response) {
        StoreResult<Map<String, Object>> result = store.remove(id);
        if (result.body().containsKey("error")) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(result.body());
        }
        stampSchemind(response, result.drift());
        return ResponseEntity.ok(result.body());
    }

    // ── Drift control (not observed — control-plane traffic) ──────────────────

    @PostMapping("/_drift")
    public ResponseEntity<?> setDrift(@RequestParam String mode) {
        if (!BookStore.DRIFT_MODES.contains(mode)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "invalid mode", "allowed", BookStore.DRIFT_MODES));
        }
        StoreResult<Map<String, Object>> result = store.setDrift(mode);
        return ResponseEntity.ok(result.body());
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
