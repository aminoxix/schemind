package io.schemind.example;

import io.schemind.SchemindAdapter;
import io.schemind.example.wire.WireTypes;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.matchesPattern;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class BookApiTest {

    @Autowired MockMvc mvc;

    @BeforeEach
    void resetDrift() throws Exception {
        mvc.perform(post("/api/_drift").param("mode", "none"))
           .andExpect(status().isOk());
    }

    // ── Canonical shape ───────────────────────────────────────────────────────

    @Test
    void list_canonicalShape_stampsCorrectHashAndVersion() throws Exception {
        String expectedHash = WireTypes.SCHEMA_HASH_BY_MODE.get("none");

        mvc.perform(get("/api/books"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.count").value(3))
           .andExpect(jsonPath("$.data[0].author.name").exists())
           .andExpect(jsonPath("$.data[0].authorInfo").doesNotExist())
           .andExpect(header().string(SchemindAdapter.HEADER_HASH,    expectedHash))
           .andExpect(header().string(SchemindAdapter.HEADER_VERSION, "1"));
    }

    @Test
    void hash_is8CharLowercaseHex() throws Exception {
        mvc.perform(get("/api/books"))
           .andExpect(header().string(SchemindAdapter.HEADER_HASH, matchesPattern("[0-9a-f]{8}")));
    }

    // ── Drift modes change the hash ───────────────────────────────────────────

    @Test
    void breakingDrift_renamesAuthorToAuthorInfo_hashChanges() throws Exception {
        String noneHash     = WireTypes.SCHEMA_HASH_BY_MODE.get("none");
        String breakingHash = WireTypes.SCHEMA_HASH_BY_MODE.get("breaking");
        assertNotEquals(noneHash, breakingHash, "breaking hash must differ from none");

        mvc.perform(post("/api/_drift").param("mode", "breaking")).andExpect(status().isOk());

        mvc.perform(get("/api/books"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.data[0].authorInfo").exists())
           .andExpect(jsonPath("$.data[0].author").doesNotExist())
           .andExpect(header().string(SchemindAdapter.HEADER_HASH,    breakingHash))
           .andExpect(header().string(SchemindAdapter.HEADER_VERSION, "4"));
    }

    @Test
    void warnDrift_ratingBecomesNull_hashChanges() throws Exception {
        mvc.perform(post("/api/_drift").param("mode", "warn")).andExpect(status().isOk());

        mvc.perform(get("/api/books"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.data[0].rating").isEmpty())
           .andExpect(header().string(SchemindAdapter.HEADER_HASH,
                   WireTypes.SCHEMA_HASH_BY_MODE.get("warn")))
           .andExpect(header().string(SchemindAdapter.HEADER_VERSION, "3"));
    }

    @Test
    void infoDrift_additiveGenreField_hashChanges() throws Exception {
        mvc.perform(post("/api/_drift").param("mode", "info")).andExpect(status().isOk());

        mvc.perform(get("/api/books"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.data[0].genre").value("fiction"))
           .andExpect(header().string(SchemindAdapter.HEADER_HASH,
                   WireTypes.SCHEMA_HASH_BY_MODE.get("info")))
           .andExpect(header().string(SchemindAdapter.HEADER_VERSION, "2"));
    }

    // ── CRUD — hash present on all write operations ───────────────────────────

    @Test
    void create_returnsCreatedWithSchemaHash() throws Exception {
        String body = """
                {
                  "title": "Pragmatic Programmer",
                  "author": {"name": "Dave Thomas", "country": "USA"},
                  "tags": ["craft"],
                  "rating": 4.8
                }
                """;

        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON).content(body))
           .andExpect(status().isCreated())
           .andExpect(jsonPath("$.data.title").value("Pragmatic Programmer"))
           .andExpect(header().string(SchemindAdapter.HEADER_HASH,
                   WireTypes.SCHEMA_HASH_BY_MODE.get("none")));
    }

    // ── Control-plane ─────────────────────────────────────────────────────────

    @Test
    void invalidDriftMode_returnsBadRequest() throws Exception {
        mvc.perform(post("/api/_drift").param("mode", "not-a-real-mode"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.error").value("invalid mode"));
    }

    @Test
    void health_ok() throws Exception {
        mvc.perform(get("/api/health"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.status").value("ok"));
    }
}
