package io.schemind.example;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class BookApiTest {

    @Autowired
    MockMvc mvc;

    @Test
    void listsSeededBooksWithCanonicalShape() throws Exception {
        mvc.perform(post("/api/_drift").param("mode", "none")).andExpect(status().isOk());
        mvc.perform(get("/api/books"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(3))
                .andExpect(jsonPath("$.data[0].author.name").exists())
                .andExpect(jsonPath("$.data[0].authorInfo").doesNotExist());
    }

    @Test
    void breakingDriftRenamesAuthorToAuthorInfo() throws Exception {
        mvc.perform(post("/api/_drift").param("mode", "breaking"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.drift").value("breaking"));

        mvc.perform(get("/api/books"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].authorInfo").exists())
                .andExpect(jsonPath("$.data[0].author").doesNotExist());

        mvc.perform(post("/api/_drift").param("mode", "none")).andExpect(status().isOk());
    }
}
