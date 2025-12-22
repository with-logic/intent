# Intent

`intent` is an LLM-based reranker library that offers ranking, filtering, and selection all with explicit, inspectable reasoning.

Unlike black-box models, `intent` generates an explanation alongside every score. This transparency allows for easier debugging and enables you to surface reasoning directly to users.

## Usage

Intent is designed to be simple to use while remaining flexible. Start with the basics and add configuration as needed.

### Simplest Case: Rank Primitives

When working with simple types like strings or numbers, just create an Intent and call `rank()`. Intent will use sensible defaults for everything:

```typescript
import { Intent } from "intent";

const intent = new Intent();
const items = ["apple", "banana", "orange", "grape"];

const ranked = await intent.rank("citrus fruits", items);
//
// Returns: ["orange"] (if threshold filters out non-citrus)
```

**What's happening:**

- No configuration needed – Intent auto-detects your `GROQ_API_KEY` from environment variables
- Keys and summaries are generated automatically using pretty-printed JSON and hashing
- Default threshold of 0 includes all results scored above zero
- Works great for prototyping and simple use cases

### With Type Safety: Custom Item Types

For structured data, specify the type and provide extractors to tell Intent how to identify and describe your items:

```typescript
import { Intent } from "intent";

type Document = {
  id: string;
  title: string;
  content: string;
  category: string;
};

const intent = new Intent<Document>({
  key: (doc) => doc.title,
  summary: (doc) => `${doc.category}: ${doc.content.slice(0, 200)}`,
});

const docs: Document[] = [
  { id: "1", title: "Q2 Expenses", content: "Travel and meals...", category: "Finance" },
  { id: "2", title: "OKR Planning", content: "Team goals for...", category: "Strategy" },
  { id: "3", title: "Equipment Purchases", content: "New laptops...", category: "Finance" },
];

const results = await intent.rank("expense reports", docs);
// Returns finance-related docs, scored by relevance to "expense reports"
```

**What's happening:**

- `key` provides a human-readable identifier for each item (used in LLM prompts)
- `summary` gives the LLM context about each item to make scoring decisions
- Type parameter `<Document>` ensures type safety for your extractors
- Still using GROQ_API_KEY auto-detection and default config

### Tuning Results: Configuration Options

Adjust Intent's behavior using configuration options:

```typescript
import { Intent } from "intent";

const intent = new Intent<Document>({
  key: (doc) => doc.title,
  summary: (doc) => doc.content.slice(0, 150),
  relevancyThreshold: 5, // Only return items scored 6+ (0-10 scale)
  batchSize: 30, // Process 30 items per LLM call
  timeoutMs: 5000, // Wait up to 5 seconds for LLM responses
});
```

**What's happening:**

- `relevancyThreshold` controls selectivity – higher values = fewer, more relevant results
- `batchSize` affects token usage and latency (larger = fewer LLM calls, more tokens per call)
- `timeoutMs` prevents long waits on slow LLM responses
- These can also be set via environment variables (`INTENT_RELEVANCY_THRESHOLD`, etc.)

### Custom LLM: Bring Your Own Client

Use any LLM provider by implementing the simple `LlmClient` interface:

```typescript
import { Intent, type LlmClient } from "intent";
import Anthropic from "@anthropic-ai/sdk";

// Adapt your LLM SDK to Intent's interface
const myClient: LlmClient = {
  async call(messages, outputSchema, config, userId) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: config?.model ?? "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      // Use outputSchema to validate response structure
    });
    // Parse and return { data: Record<string, number> }
    const content = response.content[0].text;
    return { data: JSON.parse(content) };
  },
};

const intent = new Intent<Document>({
  llm: myClient,
  key: (doc) => doc.title,
  summary: (doc) => doc.content,
});
```

**What's happening:**

- Provide your own `llm` client that implements the `LlmClient` interface
- Intent works with any LLM that can return structured JSON
- The `messages` parameter contains the full prompt with query and candidates
- The `outputSchema` parameter specifies the expected response structure

### Full Configuration: All Options Together

Combine everything for complete control:

```typescript
import { Intent } from "intent";

const intent = new Intent<Document>({
  // LLM client
  llm: myCustomClient,
  userId: "org-12345", // Optional: for provider abuse monitoring

  // Extractors
  key: (doc) => doc.title,
  summary: (doc) => `[${doc.category}] ${doc.content.slice(0, 200)}`,

  // Configuration
  model: "openai/gpt-4o",
  relevancyThreshold: 7,
  batchSize: 25,
  timeoutMs: 10000,
  tinyBatchFraction: 0.15,

  // Logging
  logger: console,
});
```

**What's happening:**

- All options in one place for maximum flexibility
- `userId` is passed to your LLM provider (useful for rate limiting, abuse detection)
- `model` overrides the default model (when using Groq or compatible clients)
- `logger` receives warnings and errors (any object with `info`, `warn`, `error` methods)
- `tinyBatchFraction` controls batch merging behavior (avoids inefficient tiny final batches)

## Highlights

- Pluggable LLM client interface (Groq/OpenAI/etc.)
- Stable, safe behavior with fallbacks
- Strict JSON schema scoring, duplicate-key handling
- Fully typed TypeScript API with tests

## How It Works

- Listwise LLM reranker: given a user query and a set of candidate items (each with a short key and optional summary), the LLM sees the query and all candidates together and assigns each a relevance score from 0–10.
- Intent-aware ranking: the prompt emphasizes the user’s intent, task framing, and constraints (not just surface similarity). Items that best satisfy the intent rise, even when lexical overlap is low.
- Threshold + stable ordering: scores are filtered by a configurable threshold and returned in descending order; ties preserve original input order.
- Retriever-agnostic: use with any first-stage retriever (vector, BM25, hybrid) or any arbitrary list of items. Summaries help the LLM reason efficiently within token limits.

Why It Excels At User Intent

- Interprets nuance: weighs the goal behind the query (task, specificity, constraints, entities, and outcome) instead of matching keywords alone.
- Cross-candidate reasoning: considers all candidates in one pass, comparing which best fulfills the intent relative to the rest.
- Robust to wording: prioritizes items that truly answer the need, even if phrased differently than the query.
- Configurable strictness: tune the relevancy threshold to be more selective for high-precision top results.

Best Practices

### Data Quality

- **Keep summaries short and structured**: Include title, 1–2 key facts, entities, dates, and outcomes. Aim for consistent length across items so the LLM compares fairly.
- **Encode user intent explicitly**: Pass the user's goal, constraints, timeframe, and domain context in the query string you provide to Intent.
- **Use helpful metadata**: Incorporate type, tags, author, and dates into the summary string to improve intent alignment.

### Performance & Cost

- **Size the candidate set to fit context**: Start with 50–100 items with concise summaries. Tune `BATCH_SIZE` (or `INTENT_BATCH_SIZE`) to your model's token budget.
- **Favor determinism for stable ranking**: Run with temperature 0 and a fixed prompt template. Ties are already stable by input order.

### Accuracy & Results

- **Tune selectivity**: Set `RELEVANCY_THRESHOLD` (or `INTENT_RELEVANCY_THRESHOLD`) to emphasize high-precision top results for RAG and QA. Values 0-10 are supported, with 0 including all results.
- **Optional score fusion**: For even stronger robustness, combine LLM scores with retriever scores (e.g., a weighted sum) when you have them.

### Monitoring

- **Monitor and iterate**: Log query, candidate count, raw/normalized scores, and token usage to fine-tune thresholds and batch sizes.

Install

```bash
npm install intent
```

Or with yarn:

```bash
yarn add intent
```

Configuration

The library reads `.env` automatically when imported. Create a `.env` file in your project root:

```env
# Required only if not providing ctx.llm
GROQ_API_KEY=your_groq_api_key_here

# Optional: customize defaults
INTENT_MODEL=openai/gpt-oss-120b
INTENT_TIMEOUT_MS=30000
INTENT_RELEVANCY_THRESHOLD=0
INTENT_BATCH_SIZE=20
INTENT_TINY_BATCH_FRACTION=0.15
```

**Configuration Options:**

- **`GROQ_API_KEY`**: Your Groq API key. Required if not providing a custom `ctx.llm` client.
- **`INTENT_MODEL`**: LLM model to use for reranking (default: `openai/gpt-oss-20b`). Any Groq-supported model works here.
- **`INTENT_TIMEOUT_MS`**: Maximum time in milliseconds to wait for LLM responses (default: `3000`). Increase for larger batches or slower models.
- **`INTENT_RELEVANCY_THRESHOLD`**: Minimum relevance score (0-10) to include in results (default: `0`). Higher values = more selective filtering.
- **`INTENT_BATCH_SIZE`**: Number of candidates to score per LLM call (default: `20`). Tune based on your model's context window and candidate summary length.
- **`INTENT_TINY_BATCH_FRACTION`**: Threshold for merging small trailing batches (default: `0.2`). If the last batch is smaller than this fraction of `BATCH_SIZE`, it gets merged with the previous batch to avoid inefficient LLM calls.

Development

- Build: `npm run build` (requires TypeScript)
- Lint and format: `npm run lint:check` (check) or `npm run lint` (auto-fix)
- Tests with coverage: `npm test` (uses Vitest + v8 coverage)

Tests

- Co-located alongside source for easy association.
  - Unit: `src/**/*.unit.test.ts` (100% coverage enforced)
  - Integration: `src/**/*.int.test.ts` (live Groq; requires `GROQ_API_KEY`)
- Scripts
  - `npm run test:unit` — unit tests only
  - `npm run test:int` — integration tests only (concurrent)
  - `npm test` — all tests
  - Optional: set `TEST_SCOPE=unit|int|all` to control scope

Groq default

- Uses `groq-sdk` under the hood. If `GROQ_API_KEY` is set in the environment, you can omit `ctx.llm` and Intent will use a built‑in Groq adapter automatically.
- Otherwise, provide your own `llm` client via `ctx.llm`.

## Config

- Config can be supplied at construction or via environment variables (see Configuration section above for details).
- The library reads `.env` automatically when imported, so `INTENT_*` keys in your `.env` are honored.
- Constructor config overrides environment variables for fine-grained control per instance.

## API Reference

### Constructor

```typescript
new Intent<T = any>(options?: IntentOptions<T>)
```

Creates a new Intent instance with optional configuration. All parameters are optional with sensible defaults.

**Type Parameters:**

- `T` - The type of items to rerank (defaults to `any`)

**Options:**

_LLM Client & Context:_

- `llm?: LlmClient` - Custom LLM client. If omitted, auto-detects Groq via `GROQ_API_KEY`
- `logger?: LoggerLike` - Logger for warnings and errors (any object with `info`, `warn`, `error` methods)
- `userId?: string` - User identifier passed to LLM provider for monitoring

_Extractors:_

- `key?: (item: T) => string` - Extracts human-readable identifier from items. Default: hash of pretty-printed JSON
- `summary?: (item: T) => string` - Extracts description for LLM reasoning. Default: pretty-printed JSON (2-space indentation)

_Configuration:_

- `model?: string` - LLM model name (default: `INTENT_MODEL` env or `"openai/gpt-oss-20b"`)
- `timeoutMs?: number` - Request timeout in milliseconds (default: `INTENT_TIMEOUT_MS` env or `3000`)
- `relevancyThreshold?: number` - Minimum score (0-10) to include in results (default: `INTENT_RELEVANCY_THRESHOLD` env or `0`)
- `batchSize?: number` - Candidates per LLM call (default: `INTENT_BATCH_SIZE` env or `20`)
- `tinyBatchFraction?: number` - Threshold for merging small batches (default: `INTENT_TINY_BATCH_FRACTION` env or `0.2`)

**Throws:**

- `Error` - If no LLM client provided and `GROQ_API_KEY` not set
- `Error` - If `relevancyThreshold` not between 0 and 10

### rank Method

```typescript
rank(query: string, candidates: T[], options?: { userId?: string }): Promise<T[]>
```

Ranks candidates based on relevance to the query.

**Parameters:**

- `query` - The search query or user intent to rank against
- `candidates` - Array of items to rerank
- `options.userId` - Optional user ID for this call (overrides constructor `userId`)

**Returns:** Filtered and sorted array of items

**Behavior:**

- Fast-path: Returns empty array for 0 candidates, unchanged array for 1 candidate (no LLM calls)
- Scores each candidate 0-10 based on relevance
- Filters results by `relevancyThreshold`
- Sorts by score descending, preserving input order for ties
- On error: Returns items in original order (graceful degradation)

## Notes

- Always returns a list; on any failure, it preserves the original order for the affected batch.
- Ties keep original order (stable sort by input index).
- Duplicate keys are internally disambiguated: `"Key (idx)"`.
