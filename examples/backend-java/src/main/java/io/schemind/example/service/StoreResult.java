package io.schemind.example.service;

/**
 * Carries a store response body alongside the drift mode that was active when
 * the body was serialized — both captured under the same store lock.
 *
 * <p>This eliminates the TOCTOU race between reading the drift mode and
 * serializing the response body: the controller receives a consistent
 * (body, mode) pair and can stamp the correct schemind schema hash without
 * worrying about a concurrent {@code POST /api/_drift} changing the mode
 * in between. Mirrors the Python backend's 3-tuple return convention.
 *
 * @param <T>   type of the response body
 * @param body  the serialized response payload
 * @param drift the drift mode active at serialization time
 */
public record StoreResult<T>(T body, String drift) {}
