package io.schemind.example.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Book {
    private String id;
    private String title;
    private Author author;            // nested object
    private List<String> tags;        // array
    private Double rating;            // number
    private String publishedAt;       // nullable
    private String createdAt;
}
