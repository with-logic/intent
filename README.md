# Intent

LLM-based reranker for arbitrary items. Provide a query and a list of items, Intent asks an LLM to score each item’s relevance (0–10), filters by a configurable threshold, and returns the items ordered by score (stable on ties).

Highlights

- Pluggable LLM client interface (Groq/OpenAI/etc.)
- Stable, safe behavior with fallbacks
- Strict JSON schema scoring, duplicate-key handling
- Fully typed TypeScript API with tests

How It Works

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
- **Encode user intent explicitly**: Pass the user's goal, constraints, timeframe, and domain context in the query string you provide to the reranker.
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
INTENT_MODEL=llama-3.1-70b-versatile
INTENT_TIMEOUT_MS=30000
INTENT_RELEVANCY_THRESHOLD=0
INTENT_BATCH_SIZE=20
INTENT_TINY_BATCH_FRACTION=0.15
```

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

Config

- Reranker config can be supplied at construction or via environment variables.
- Env keys (all optional):
  - `INTENT_MODEL`
  - `INTENT_TIMEOUT_MS`
  - `INTENT_RELEVANCY_THRESHOLD`
  - `INTENT_BATCH_SIZE`
  - `INTENT_TINY_BATCH_FRACTION`
- The library reads `.env` automatically when imported, so `INTENT_*` keys in your `.env` are honored.

Usage

```ts
import { Reranker } from "intent";

// Minimal LLM client (adapt your SDK to this shape)
const llm = {
  async call(messages, schema, config, userId) {
    // call your LLM here; must return `{ data: Record<string, number> }`
    // Example: { data: { "Travel Expenses": 8, "OKR Plan": 2 } }
    return { data: {} };
  },
};

type Item = { title: string; description: string };
const reranker = new Reranker<Item>(
  { llm, userId: "org-123" },
  {
    key: (x) => x.title,
    summary: (x) => x.description,
  },
  { relevancyThreshold: 0, batchSize: 20 },
);

const ordered = await reranker.rerank("find expense reports", [
  { title: "Travel Expenses", description: "Q2 reimbursements" },
  { title: "OKR Plan", description: "Q3 planning" },
]);

// Or, if GROQ_API_KEY is set in your environment, you can omit `llm`:
const rerankerWithDefault = new Reranker<Item>(
  {
    /* no llm needed here if GROQ_API_KEY is set */
  },
  { key: (x) => x.title, summary: (x) => x.description },
);
```

API

- `new Reranker<T>(ctx, extractors, config?)`
  - `ctx.llm`: LLM client with `call(messages, schema, config, userId)`
  - `ctx.userId?`: optional user identifier forwarded to provider
  - `ctx.logger?`: optional logger with `.warn()` (and `.info/.error`)
  - `extractors.key(item)`: required, short human-readable key
  - `extractors.summary?(item)`: optional short description
  - `config`: `{ model, timeoutMs, relevancyThreshold, batchSize, tinyBatchFraction }`
- `rerank(query, candidates, { userId? })` returns `T[]`

Notes

- Always returns a list; on any failure, it preserves the original order for the affected batch.
- Ties keep original order (stable sort by input index).
- Duplicate keys are internally disambiguated: `"Key (idx)"`.
