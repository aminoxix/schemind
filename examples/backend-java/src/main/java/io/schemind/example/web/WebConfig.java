package io.schemind.example.web;

import io.schemind.SchemindAdapter;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Permissive CORS for the local demo frontend. Exposes schemind adapter headers. */
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                // schemind adapter protocol headers must be explicitly exposed so
                // the browser (and schemind core running client-side) can read them
                // from cross-origin responses.
                .exposedHeaders(SchemindAdapter.HEADER_HASH, SchemindAdapter.HEADER_VERSION);
    }
}
