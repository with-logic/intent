/**
 * Default extractor functions for Intent.
 *
 * These provide sensible defaults when users don't specify custom key/summary extractors.
 */

/**
 * Computes a simple 32-bit hash from a string using the djb2 algorithm.
 *
 * @param str - The string to hash
 * @returns A 32-bit hash value
 * @private
 */
function hash32(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) + hash + char) | 0; // hash * 33 + char, keep in 32-bit range
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Converts any value to a pretty-printed JSON string with error handling.
 *
 * This is the canonical helper for all JSON stringification in the codebase.
 * Pretty-prints with 2-space indentation for better LLM readability.
 * Falls back to String(value) if JSON.stringify fails (e.g., circular references).
 * Handles undefined explicitly since JSON.stringify(undefined) returns undefined.
 *
 * @param value - The value to stringify
 * @returns Pretty-printed JSON string, or String() fallback
 * @throws Never throws - gracefully falls back to String() on any error
 */
export function jsonStringify(value: unknown): string {
  try {
    const result = JSON.stringify(value, null, 2);
    // JSON.stringify returns undefined for undefined values
    if (result === undefined) {
      return String(value);
    }
    return result;
  } catch {
    return String(value);
  }
}

/**
 * Converts any value to a hash-based string key.
 *
 * Serializes the value to JSON, computes a 32-bit hash, and returns it as a string.
 * This provides unique-enough keys for items without requiring explicit key extractors.
 *
 * @param value - The value to convert to a key
 * @returns A string representation of the hash (e.g., "2847561")
 * @throws Never throws - uses jsonStringify which handles all errors internally
 */
export function hashToString<T>(value: T): string {
  const json = jsonStringify(value);
  const hashValue = hash32(json);
  return String(hashValue);
}

/**
 * Default key extractor: generates hash-based string keys from items.
 *
 * Generic function that works with any item type T. The generic parameter
 * enables type-safe usage without type casts when assigned to typed extractors.
 *
 * @param item - The item to extract a key from
 * @returns A hash-based string key
 * @throws Never throws - uses hashToString which handles all errors internally
 */
export function DEFAULT_KEY_EXTRACTOR<T>(item: T): string {
  return hashToString(item);
}

/**
 * Default summary extractor: converts items to pretty-printed JSON strings.
 *
 * Uses 2-space indentation for better LLM readability.
 * Generic function that works with any item type T. The generic parameter
 * enables type-safe usage without type casts when assigned to typed extractors.
 *
 * @param item - The item to extract a summary from
 * @returns A pretty-printed JSON string representation of the item
 * @throws Never throws - uses jsonStringify which handles all errors internally
 */
export function DEFAULT_SUMMARY_EXTRACTOR<T>(item: T): string {
  return jsonStringify(item);
}
