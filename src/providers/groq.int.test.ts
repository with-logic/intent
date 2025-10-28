import { describe, expect, test } from "vitest";

import { buildMessages } from "../messages";
import { buildRelevancySchema } from "../schema";

import { createDefaultGroqClient } from "./groq";

const hasKey = Boolean(process.env.GROQ_API_KEY);

describe.skipIf(!hasKey)("groq provider integration", () => {
  test.concurrent("provider returns scores for all schema keys", async () => {
    const client = createDefaultGroqClient(process.env.GROQ_API_KEY!);
    const candidates = [
      { key: "A", summary: "first" },
      { key: "B", summary: "second" },
    ];
    const schema = buildRelevancySchema(candidates.map((c) => c.key));
    const messages = buildMessages("choose best", candidates);
    const { data } = await client.call<Record<string, number>>(messages, schema, {
      timeoutMs: 5000,
    });
    expect(Object.keys(data)).toEqual(["A", "B"]);
    for (const k of Object.keys(data)) {
      expect(typeof data[k]).toBe("number");
      expect(data[k]).toBeGreaterThanOrEqual(0);
      expect(data[k]).toBeLessThanOrEqual(10);
    }
  });

  test.concurrent("assigns 0 to unrelated and >0 to related", async () => {
    const client = createDefaultGroqClient(process.env.GROQ_API_KEY!);
    const candidates = [
      { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
      { key: "Banana Bread Recipe", summary: "How to bake banana bread" },
      { key: "Eiffel Tower History", summary: "Timeline of the Eiffel Tower construction" },
    ];
    const schema = buildRelevancySchema(candidates.map((c) => c.key));
    const messages = buildMessages("Help me with JavaScript array sorting", candidates);
    const { data } = await client.call<Record<string, number>>(messages, schema, {
      timeoutMs: 6000,
    });
    // Related candidate should be > 0
    expect(data["JS Arrays"]).toBeGreaterThan(0);
    // Unrelated candidates should be 0
    expect(data["Banana Bread Recipe"]).toBe(0);
    expect(data["Eiffel Tower History"]).toBe(0);
  });
});
