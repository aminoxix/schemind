package io.schemind.example.model;

/** A book's author. Nested object in the Book response shape. */
public record Author(String name, String country) {
}
