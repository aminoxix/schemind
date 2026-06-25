package io.schemind.example.model;

import java.util.List;

/** Request payload for create/update. */
public record BookInput(String title, Author author, List<String> tags, Double rating) {
}
