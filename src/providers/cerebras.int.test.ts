import { describe, expect, test } from "vitest";

import { CONFIG } from "../config";
import { buildMessages } from "../messages";
import { buildRelevancySchema } from "../schema";

import { createDefaultCerebrasClient } from "./cerebras";

describe("cerebras provider integration", () => {
  test.concurrent("provider returns scores for all schema keys", async () => {
    const client = createDefaultCerebrasClient(CONFIG.CEREBRAS.API_KEY);
    const candidates = [
      { key: "A", summary: "first" },
      { key: "B", summary: "second" },
    ];
    const schema = buildRelevancySchema(
      candidates.map((c) => c.key),
      0,
      10,
    );
    const messages = buildMessages("choose best", candidates, { minScore: 0, maxScore: 10 });
    const { data } = await client.call<Record<string, { explanation: string; score: number }>>(
      messages,
      schema,
      { timeoutMs: 10000 },
    );
    expect(Object.keys(data)).toEqual(["A", "B"]);
    for (const k of Object.keys(data)) {
      expect(typeof data[k]?.explanation).toBe("string");
      expect(typeof data[k]?.score).toBe("number");
      expect(data[k]?.score).toBeGreaterThanOrEqual(0);
      expect(data[k]?.score).toBeLessThanOrEqual(10);
    }
  });

  test.concurrent(
    "assigns 0 to unrelated and >0 to related",
    async () => {
      const client = createDefaultCerebrasClient(CONFIG.CEREBRAS.API_KEY);
      const candidates = [
        { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
        { key: "Saturns Moons", summary: "The chemical composition of Saturn's moons" },
        { key: "Eiffel Tower", summary: "Directions to the tower" },
      ];
      const schema = buildRelevancySchema(
        candidates.map((c) => c.key),
        0,
        10,
      );
      const messages = buildMessages("Help me with JavaScript array sorting", candidates, {
        minScore: 0,
        maxScore: 10,
      });
      const { data } = await client.call<Record<string, { explanation: string; score: number }>>(
        messages,
        schema,
        { timeoutMs: 10000 },
      );
      expect(data["JS Arrays"]?.score).toBeGreaterThan(0);
      expect(data["Saturns Moons"]?.score).toBe(0);
      expect(data["Eiffel Tower"]?.score).toBe(0);
    },
    15000,
  );
});
