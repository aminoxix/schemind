package io.schemind;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.lang.reflect.TypeVariable;
import java.lang.reflect.WildcardType;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;

/**
 * schemind backend adapter for Java (Spring Boot / Jakarta Servlet / Quarkus / Micronaut).
 *
 * <p>Computes a deterministic schema hash of a response type (at startup, via
 * reflection — never per-request) and injects the schemind header protocol so
 * the core can take the hash fast-path: skip shape extraction entirely when the
 * hash is unchanged.
 *
 * <p>Supported response types: Java records, dataclass-style POJOs (declared
 * fields), and Lombok {@code @Data} / {@code @Value} classes. Generic containers
 * ({@link java.util.List}, {@link java.util.Map}, {@link java.util.Optional}) are
 * resolved at the call site — pass a concrete parameterized type via
 * {@link #schemaHash(java.lang.reflect.Type)} for full generic resolution.
 *
 * <h2>Usage — static response type (Spring Boot)</h2>
 * <pre>{@code
 * // Compute once at startup:
 * private static final String HASH    = SchemindAdapter.schemaHash(BookResponse.class);
 * private static final int    VERSION = 1;
 *
 * // In your controller method:
 * SchemindAdapter.setHeaders(response, HASH, VERSION);
 * }</pre>
 *
 * <h2>Usage — dynamic shapes (drift demo)</h2>
 * <pre>{@code
 * // Pre-compute one hash per shape variant:
 * Map<String, String> hashByMode = Map.of(
 *     "none",  SchemindAdapter.schemaHash(BookNone.class),
 *     "info",  SchemindAdapter.schemaHash(BookInfo.class)
 * );
 *
 * // In your controller method — call setHeaders with the right hash for the
 * // mode captured atomically alongside the response body:
 * SchemindAdapter.setHeaders(response, hashByMode.get(mode), version);
 * }</pre>
 *
 * <h2>Usage — servlet filter (static type)</h2>
 * <pre>{@code
 * @Bean
 * public FilterRegistrationBean<SchemindAdapter.SchemindFilter> schemindFilter() {
 *     var reg = new FilterRegistrationBean<>(
 *             SchemindAdapter.filterFor(BookResponse.class, 1));
 *     reg.addUrlPatterns("/api/*");
 *     return reg;
 * }
 * }</pre>
 *
 * <p>⚠️ The hash reflects the <em>static</em> type definition. If your handler
 * mutates the serialized shape at runtime (like the drift-toggling example
 * backend), use per-mode hashes and stamp them per-request — a single static
 * hash would make the core skip extraction and miss the drift entirely.
 */
public final class SchemindAdapter {

    /** Header name for the schema hash (adapter protocol). */
    public static final String HEADER_HASH    = "X-Schemind-Schema-Hash";
    /** Header name for the schema version (adapter protocol). */
    public static final String HEADER_VERSION = "X-Schemind-Schema-Version";

    private SchemindAdapter() {}

    // ── Hash ─────────────────────────────────────────────────────────────────

    /**
     * Compute the 8-char schema hash for {@code type}.
     *
     * <p>A SHA-256 (truncated) of a canonical string of the type's field names +
     * types. Stable across JVM restarts; changes whenever a field is added,
     * removed, renamed, or retyped. Field order is always sorted so the hash is
     * independent of declaration order.
     *
     * @param type  a class — record, POJO, Lombok {@code @Data} etc.
     * @return 8-character lowercase hex string
     */
    public static String schemaHash(Class<?> type) {
        return schemaHash((Type) type);
    }

    /**
     * Overload accepting a {@link Type} so callers can pass generic types like
     * {@code new TypeToken<List<BookResponse>>(){}.getType()} for full resolution.
     */
    public static String schemaHash(Type type) {
        try {
            String canon  = canonicalOf(type, new HashSet<>());
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(canon.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(16);
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.substring(0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    // ── Header utility ────────────────────────────────────────────────────────

    /**
     * Write the schema hash + version onto {@code response}.
     *
     * <p>Call this in your controller method after capturing the drift mode
     * atomically with the response body to avoid TOCTOU race conditions.
     *
     * @param response  the HTTP response to stamp
     * @param hash      pre-computed hash from {@link #schemaHash}
     * @param version   schema version (increment when intentionally changing shape)
     */
    public static void setHeaders(HttpServletResponse response, String hash, int version) {
        response.setHeader(HEADER_HASH,    hash);
        response.setHeader(HEADER_VERSION, String.valueOf(version));
    }

    // ── Servlet filter (static type) ──────────────────────────────────────────

    /**
     * Build a {@link SchemindFilter} for a fixed response type. The hash is
     * computed once here — zero per-request reflection cost.
     *
     * <p>Register it as a {@code @Bean} of type
     * {@code FilterRegistrationBean<SchemindFilter>} in Spring Boot, or wire it
     * into your servlet container's filter chain.
     */
    public static SchemindFilter filterFor(Class<?> responseType, int version) {
        return new SchemindFilter(schemaHash(responseType), version);
    }

    /**
     * Jakarta Servlet {@link Filter} that stamps the schemind schema headers on
     * every HTTP response passing through it.
     *
     * <p>Intended for <em>static</em> response types. For APIs whose shape
     * changes at runtime, stamp headers manually from the controller using
     * {@link SchemindAdapter#setHeaders}.
     */
    public static final class SchemindFilter implements Filter {

        private final String hash;
        private final String version;

        SchemindFilter(String hash, int version) {
            this.hash    = hash;
            this.version = String.valueOf(version);
        }

        @Override
        public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
                throws IOException, ServletException {
            if (res instanceof HttpServletResponse http) {
                http.setHeader(HEADER_HASH,    hash);
                http.setHeader(HEADER_VERSION, version);
            }
            chain.doFilter(req, res);
        }

        @Override public void init(FilterConfig cfg) {}
        @Override public void destroy() {}
    }

    // ── Canonical string ──────────────────────────────────────────────────────

    static String canonicalOf(Type type, Set<Class<?>> seen) {
        if (type == null) return "null";

        // --- Parameterized types: List<T>, Map<K,V>, Optional<T> ---
        if (type instanceof ParameterizedType pt) {
            Class<?> raw  = (Class<?>) pt.getRawType();
            Type[]   args = pt.getActualTypeArguments();

            // Optional<T>  →  (null|T)   (same convention as Go *T / Python Optional[T])
            if (raw == Optional.class && args.length == 1) {
                return "(null|" + canonicalOf(args[0], seen) + ")";
            }
            // List / Collection / Set  →  [T]
            if (List.class.isAssignableFrom(raw) || Collection.class.isAssignableFrom(raw)) {
                String elem = args.length > 0 ? canonicalOf(args[0], seen) : "any";
                return "[" + elem + "]";
            }
            // Map<K,V>  →  map[K]V
            if (Map.class.isAssignableFrom(raw)) {
                String key = args.length > 0 ? canonicalOf(args[0], seen) : "any";
                String val = args.length > 1 ? canonicalOf(args[1], seen) : "any";
                return "map[" + key + "]" + val;
            }
            return canonicalOf(raw, seen);
        }

        // --- Wildcard / type variable: ? extends T, T ---
        if (type instanceof WildcardType wt) {
            Type[] upper = wt.getUpperBounds();
            return upper.length > 0 ? canonicalOf(upper[0], seen) : "any";
        }
        if (type instanceof TypeVariable<?> tv) {
            Type[] bounds = tv.getBounds();
            return bounds.length > 0 ? canonicalOf(bounds[0], seen) : "any";
        }

        // --- Raw class ---
        if (!(type instanceof Class<?> cls)) return "any";

        if (cls == String.class)                          return "string";
        if (cls == Boolean.class || cls == boolean.class) return "bool";
        if (isNumber(cls))                                return "number";
        if (cls == Object.class)                          return "any";
        if (cls == Void.class   || cls == void.class)     return "null";

        // arrays  →  [element]
        if (cls.isArray()) return "[" + canonicalOf(cls.getComponentType(), seen) + "]";

        // unparameterized raw collection/map
        if (List.class.isAssignableFrom(cls) || Collection.class.isAssignableFrom(cls))
            return "[any]";
        if (Map.class.isAssignableFrom(cls)) return "map[any]any";

        // --- Structured type: record or POJO ---
        if (seen.contains(cls)) return "ref:" + cls.getSimpleName();
        seen.add(cls);

        // TreeMap for sorted, deterministic output (independent of declaration order).
        TreeMap<String, String> fieldMap = new TreeMap<>();

        if (cls.isRecord()) {
            // Records: component names are the canonical JSON keys (Jackson default).
            for (RecordComponent rc : cls.getRecordComponents()) {
                fieldMap.put(rc.getName(), canonicalOf(rc.getGenericType(), seen));
            }
        } else {
            // POJOs: walk the entire hierarchy, skip statics and synthetics.
            for (Field f : allDeclaredFields(cls)) {
                if (Modifier.isStatic(f.getModifiers())) continue;
                if (f.isSynthetic())                      continue;
                fieldMap.put(f.getName(), canonicalOf(f.getGenericType(), seen));
            }
        }

        // Release the slot so sibling fields of the same type can still resolve.
        seen.remove(cls);

        List<String> entries = new ArrayList<>(fieldMap.size());
        fieldMap.forEach((k, v) -> entries.add(k + ":" + v));
        return "{" + String.join(",", entries) + "}";
    }

    private static boolean isNumber(Class<?> t) {
        return t == int.class  || t == long.class  || t == float.class || t == double.class
            || t == short.class || t == byte.class
            || Number.class.isAssignableFrom(t);
    }

    private static List<Field> allDeclaredFields(Class<?> type) {
        List<Field> out = new ArrayList<>();
        for (Class<?> c = type; c != null && c != Object.class; c = c.getSuperclass()) {
            out.addAll(List.of(c.getDeclaredFields()));
        }
        return out;
    }
}
