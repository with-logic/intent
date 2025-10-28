import { describe, it, expect } from "vitest";

import { clamp } from "./number";

describe("lib/number", () => {
  it("returns the value when within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("applies only min when max is undefined", () => {
    expect(clamp(-1, 0)).toBe(0);
    expect(clamp(7, 0)).toBe(7);
  });

  it("applies only max when min is undefined", () => {
    expect(clamp(11, undefined, 10)).toBe(10);
    expect(clamp(7, undefined, 10)).toBe(7);
  });

  it("handles equal bounds and boundary values", () => {
    expect(clamp(5, 5, 5)).toBe(5);
    expect(clamp(4, 5, 5)).toBe(5);
    expect(clamp(6, 5, 5)).toBe(5);
  });
});
