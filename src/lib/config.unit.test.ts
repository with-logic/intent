import { describe, it, expect, beforeEach, afterEach } from "vitest";

import * as cfg from "./config";

const VAR = "TEST_ENV_VAR";

const saveEnv = { ...process.env };

function unset(name: string) {
  delete process.env[name];
}

describe("lib/config", () => {
  beforeEach(() => {
    // reset variable used in tests
    unset(VAR);
  });

  afterEach(() => {
    // restore the full env afterwards
    process.env = { ...saveEnv };
  });

  describe("string()", () => {
    it("returns the env value when set", () => {
      process.env[VAR] = "hello";
      expect(cfg.string(VAR)).toBe("hello");
    });

    it("returns default when not set", () => {
      unset(VAR);
      expect(cfg.string(VAR, { default: "x" })).toBe("x");
    });

    it("throws when not set and no default", () => {
      unset(VAR);
      expect(() => cfg.string(VAR)).toThrowError(`${VAR} is required.`);
    });

    it("treats empty string as unset", () => {
      process.env[VAR] = "";
      expect(() => cfg.string(VAR)).toThrowError(`${VAR} is required.`);
    });
  });

  describe("boolean()", () => {
    it("interprets 'false' and '0' as false", () => {
      process.env[VAR] = "false";
      expect(cfg.boolean(VAR)).toBe(false);
      process.env[VAR] = "0";
      expect(cfg.boolean(VAR)).toBe(false);
    });

    it("treats any other non-empty value as true (case-sensitive)", () => {
      process.env[VAR] = "true";
      expect(cfg.boolean(VAR)).toBe(true);
      process.env[VAR] = "1";
      expect(cfg.boolean(VAR)).toBe(true);
      process.env[VAR] = "FALSE"; // not matched by 'false'
      expect(cfg.boolean(VAR)).toBe(true);
      process.env[VAR] = " "; // non-empty string counts as set
      expect(cfg.boolean(VAR)).toBe(true);
    });

    it("returns default when missing", () => {
      unset(VAR);
      expect(cfg.boolean(VAR, { default: true })).toBe(true);
      expect(cfg.boolean(VAR, { default: false })).toBe(false);
    });

    it("throws when missing and no default", () => {
      unset(VAR);
      expect(() => cfg.boolean(VAR)).toThrowError(`${VAR} is required.`);
    });
  });

  describe("int()", () => {
    it("parses integers and clamps to min/max", () => {
      process.env[VAR] = "10";
      expect(cfg.int(VAR)).toBe(10);
      process.env[VAR] = "-5";
      expect(cfg.int(VAR, { min: 0 })).toBe(0);
      process.env[VAR] = "50";
      expect(cfg.int(VAR, { max: 20 })).toBe(20);
      process.env[VAR] = "15";
      expect(cfg.int(VAR, { min: 10, max: 12 })).toBe(12);
    });

    it("throws on invalid integer", () => {
      process.env[VAR] = "abc";
      expect(() => cfg.int(VAR)).toThrowError(`${VAR} must be a valid integer`);
    });

    it("uses default (truncated) and clamps when missing", () => {
      unset(VAR);
      expect(cfg.int(VAR, { default: 3.9 })).toBe(3);
      expect(cfg.int(VAR, { default: 100, max: 10 })).toBe(10);
      expect(cfg.int(VAR, { default: -5, min: 0 })).toBe(0);
    });

    it("treats empty string as missing (default or error)", () => {
      process.env[VAR] = "";
      expect(() => cfg.int(VAR)).toThrowError(`${VAR} is required.`);
      process.env[VAR] = "";
      expect(cfg.int(VAR, { default: 7 })).toBe(7);
    });
  });

  describe("number()", () => {
    it("parses floats and clamps to min/max", () => {
      process.env[VAR] = "3.14";
      expect(cfg.number(VAR)).toBeCloseTo(3.14);
      process.env[VAR] = "-1.5";
      expect(cfg.number(VAR, { min: 0 })).toBe(0);
      process.env[VAR] = "99.9";
      expect(cfg.number(VAR, { max: 10 })).toBe(10);
      process.env[VAR] = "5";
      expect(cfg.number(VAR, { min: 6, max: 8 })).toBe(6);
    });

    it("throws on invalid number", () => {
      process.env[VAR] = "nope";
      expect(() => cfg.number(VAR)).toThrowError(`${VAR} must be a valid number`);
    });

    it("uses default and clamps when missing", () => {
      unset(VAR);
      expect(cfg.number(VAR, { default: 2.5 })).toBeCloseTo(2.5);
      expect(cfg.number(VAR, { default: -2, min: -1 })).toBe(-1);
      expect(cfg.number(VAR, { default: 100, max: 1 })).toBe(1);
    });

    it("treats empty string as missing (default or error)", () => {
      process.env[VAR] = "";
      expect(() => cfg.number(VAR)).toThrowError(`${VAR} is required.`);
      process.env[VAR] = "";
      expect(cfg.number(VAR, { default: 9.9 })).toBeCloseTo(9.9);
    });
  });
});
