import { describe, expect, test } from "vitest";

import {
  DEFAULT_KEY_EXTRACTOR,
  DEFAULT_SUMMARY_EXTRACTOR,
  hashToString,
  jsonStringify,
} from "./extractors";

describe("extractors", () => {
  describe("jsonStringify", () => {
    test("pretty-prints simple values", () => {
      expect(jsonStringify("hello")).toBe('"hello"');
      expect(jsonStringify(123)).toBe("123");
      expect(jsonStringify(true)).toBe("true");
      expect(jsonStringify(null)).toBe("null");
    });

    test("pretty-prints objects and arrays with 2-space indentation", () => {
      expect(jsonStringify({ a: 1, b: 2 })).toBe('{\n  "a": 1,\n  "b": 2\n}');
      expect(jsonStringify([1, 2, 3])).toBe("[\n  1,\n  2,\n  3\n]");
    });

    test("falls back to String() for circular references", () => {
      const circular: any = { a: 1 };
      circular.self = circular;
      const result = jsonStringify(circular);
      expect(result).toBe("[object Object]");
    });

    test("handles deeply nested objects consistently", () => {
      const complex = {
        level1: {
          level2: {
            level3: {
              value: [1, 2, { nested: "data" }],
            },
          },
        },
      };
      const json1 = jsonStringify(complex);
      const json2 = jsonStringify(complex);
      expect(json1).toBe(json2);
    });

    test("produces stable output for objects with same keys in different order", () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, b: 2, a: 1 };
      const json1 = jsonStringify(obj1);
      const json2 = jsonStringify(obj2);
      // Note: JSON.stringify preserves insertion order, so these will differ
      // This test documents the behavior - objects with different key order produce different JSON
      expect(json1).not.toBe(json2);
    });
  });

  describe("hashToString", () => {
    test("returns consistent hash for same input", () => {
      const input = { key: "value", num: 42 };
      const hash1 = hashToString(input);
      const hash2 = hashToString(input);
      expect(hash1).toBe(hash2);
    });

    test("returns different hashes for different inputs", () => {
      const hash1 = hashToString({ a: 1 });
      const hash2 = hashToString({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });

    test("returns string representation of hash", () => {
      const hash = hashToString("test");
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^\d+$/); // Should be all digits
    });

    test("handles edge cases", () => {
      expect(hashToString("")).toBeTruthy();
      expect(hashToString(null)).toBeTruthy();
      expect(hashToString(undefined)).toBeTruthy();
    });

    test("produces consistent hashes for deeply nested objects", () => {
      const complex = {
        level1: {
          level2: {
            level3: {
              value: [1, 2, { nested: "data" }],
              metadata: { timestamp: 123456, tags: ["a", "b", "c"] },
            },
          },
        },
      };
      const hash1 = hashToString(complex);
      const hash2 = hashToString(complex);
      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe("string");
      expect(hash1).toMatch(/^\d+$/);
    });

    test("produces different hashes for objects with different key orders", () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, b: 2, a: 1 };
      const hash1 = hashToString(obj1);
      const hash2 = hashToString(obj2);
      // Hashes differ because JSON.stringify preserves insertion order
      expect(hash1).not.toBe(hash2);
    });

    test("produces different hashes for nested arrays with different element orders", () => {
      const arr1 = { items: [1, 2, 3] };
      const arr2 = { items: [3, 2, 1] };
      const hash1 = hashToString(arr1);
      const hash2 = hashToString(arr2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("DEFAULT_KEY_EXTRACTOR", () => {
    test("extracts hash-based key from items", () => {
      const item = { id: "123", name: "Test" };
      const key = DEFAULT_KEY_EXTRACTOR(item);
      expect(typeof key).toBe("string");
      expect(key).toMatch(/^\d+$/);
    });

    test("returns consistent keys for same input", () => {
      const item = { value: 42 };
      const key1 = DEFAULT_KEY_EXTRACTOR(item);
      const key2 = DEFAULT_KEY_EXTRACTOR(item);
      expect(key1).toBe(key2);
    });

    test("returns consistent keys for deeply nested objects", () => {
      const complex = {
        user: {
          profile: {
            name: "Test User",
            metadata: { created: 123456, tags: ["admin", "active"] },
          },
        },
      };
      const key1 = DEFAULT_KEY_EXTRACTOR(complex);
      const key2 = DEFAULT_KEY_EXTRACTOR(complex);
      expect(key1).toBe(key2);
    });
  });

  describe("DEFAULT_SUMMARY_EXTRACTOR", () => {
    test("extracts pretty-printed JSON string from items", () => {
      const item = { id: "123", content: "Hello" };
      const summary = DEFAULT_SUMMARY_EXTRACTOR(item);
      expect(summary).toBe('{\n  "id": "123",\n  "content": "Hello"\n}');
    });

    test("handles primitives", () => {
      expect(DEFAULT_SUMMARY_EXTRACTOR("test")).toBe('"test"');
      expect(DEFAULT_SUMMARY_EXTRACTOR(42)).toBe("42");
      expect(DEFAULT_SUMMARY_EXTRACTOR(true)).toBe("true");
    });

    test("extracts consistent summaries for deeply nested objects", () => {
      const complex = {
        document: {
          metadata: {
            author: "Test Author",
            tags: ["important", "review"],
          },
          content: {
            sections: [
              { title: "Introduction", text: "Lorem ipsum" },
              { title: "Body", text: "Main content" },
            ],
          },
        },
      };
      const summary1 = DEFAULT_SUMMARY_EXTRACTOR(complex);
      const summary2 = DEFAULT_SUMMARY_EXTRACTOR(complex);
      expect(summary1).toBe(summary2);
      expect(summary1).toContain("Test Author");
      expect(summary1).toContain("Introduction");
    });
  });
});
