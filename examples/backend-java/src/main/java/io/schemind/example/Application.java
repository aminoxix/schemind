package io.schemind.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * schemind example — Book Library CRUD API (Spring Boot).
 *
 * Runs on :8081. Serves the same Book shape and the same runtime "drift toggle"
 * as the Go example, so the Next.js frontend (and schemind) treat them
 * identically.
 */
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
