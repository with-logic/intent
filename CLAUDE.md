# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Intent is a TypeScript library that uses LLMs to rerank arbitrary items based on relevance to a query. It scores items 0-10, filters by threshold, and returns results sorted by score with stable ordering on ties.

## Core Principles

**Quality First**: This library maintains strict quality standards:

- ✅ 100% test coverage (unit tests)
- ✅ Zero TypeScript errors
- ✅ Clean linting (Prettier + ESLint)
- ✅ Comprehensive JSDoc on all functions

**Code Style Fundamentals**:

- **Small Functions**: Target 20-30 lines, maximum 50 lines per function
- **Small Files**: Under 300 lines per file
- **Early Returns**: Always prefer early returns over nested conditionals
- **Always Use Braces**: No single-line if statements, even for simple returns
- **Minimal Nesting**: Maximum 2-3 levels of nesting depth
- **Document Everything**: Every function (public and private) must have JSDoc
- **Many Small Helpers**: Prefer many focused functions over few large ones

## Commands

### Build & Type Checking

- `npm run build` - Compile TypeScript to dist/
- `npm run typecheck` - Type check without emitting files
- `npm run clean` - Remove dist/ folder

### Testing

- `npm test` - Run all tests with coverage (unit + integration)
- `npm run test:unit` - Unit tests only (100% coverage enforced)
- `npm run test:int` - Integration tests only (requires `CEREBRAS_API_KEY`)
- Test files are co-located: `*.unit.test.ts` for unit, `*.int.test.ts` for integration

### Linting

- `npm run lint` - Auto-fix linting and formatting issues
- `npm run lint:check` - Check without fixing
- **Line Length**: Prettier configured for 100-character line width (`printWidth: 100`)

## Architecture

### Core Reranking Flow

The `Intent` class orchestrates the entire ranking process:

1. **Preparation** (`prepareCandidates`): Normalizes items into a consistent shape with key/summary/index
2. **Batching** (`batchProcess` in batches.ts): Splits candidates into batches, merges tiny trailing batches to avoid inefficient LLM calls
3. **Batch Processing** (`processBatch`):
   - Ensures unique keys by appending index to duplicates: `"Key (idx)"`
   - Builds JSON schema (`buildRelevancySchema`) with required properties for each candidate key
   - Builds chat messages (`buildMessages`) with system prompt + user query/candidates
   - Calls LLM via pluggable `LlmClient` interface
   - Filters by relevancy threshold and sorts (score desc, then input order)
4. **Fallback**: On any error, preserves original order for affected batch/entire input

### LLM Client Architecture

- **Interface**: `LlmClient` (types.ts) - single `call()` method accepting messages, JSON schema, config, userId
- **Default Provider**: Cerebras adapter (providers/cerebras.ts) with strict JSON schema response format and a repair retry for invalid JSON
- **Selection Logic**: `selectLlmClient()` chooses ctx.llm if provided, else creates Cerebras client if `CEREBRAS_API_KEY` exists, else undefined

### Configuration System

All config lives in config.ts using lib/config helpers:

- Environment variables: `INTENT_MODEL`, `INTENT_TIMEOUT_MS`, `INTENT_RELEVANCY_THRESHOLD`, `INTENT_BATCH_SIZE`, `INTENT_TINY_BATCH_FRACTION`
- Cerebras-specific: `CEREBRAS_API_KEY`, `CEREBRAS_DEFAULT_MODEL`, `CEREBRAS_DEFAULT_REASONING_EFFORT`, `CEREBRAS_JSON_REPAIR_ATTEMPTS` (total calls per request including the first)
- Config is loaded automatically via `dotenv/config` import at top of config.ts
- Intent constructor accepts options as a single optional object

**Config Naming Convention**: By design, config keys in `CONFIG` use `UPPER_SNAKE_CASE` to mirror their environment variable names (e.g., `CONFIG.INTENT.MODEL` matches `INTENT_MODEL`). The user-facing API uses `camelCase` (e.g., `options.model`). This intentional distinction keeps config keys aligned with environment variables while providing an ergonomic API. Internal code converts between these formats as needed.

### Key Design Patterns

- **Stable fallbacks**: Any failure (LLM error, timeout, invalid response) returns items in original order
- **Duplicate key handling**: Internal disambiguation using `"Key (idx)"` suffix
- **Strict typing**: Uses TypeScript strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **Generic item support**: Intent is `Intent<T>` with user-provided key/summary extractors
- **Zero/one-item fast path**: Avoids LLM calls when unnecessary

## Testing Strategy

- **Unit tests**: Mock all LLM calls, enforce 100% coverage
- **Integration tests**: Live Cerebras API calls, no coverage requirements
- **Test scope control**: Set `TEST_SCOPE=unit|int|all` environment variable
- Coverage excludes: index.ts, types.ts, test files, type definitions

## Code Style Guidelines

### Naming Conventions

- **Descriptive Names**: Use purpose-driven names for all variables, functions, and types
  - PascalCase for classes and types
  - camelCase for functions and variables
  - Avoid generic names like "default", "temp", "main"
  - Avoid ambiguous abbreviations without context
- **Clarity and Context**: Include context in variable names to distinguish similar entities
  - Example: `batchSize` vs `tinyBatchFraction` instead of `size1` and `size2`
  - Example: `candidateKey` vs `uniqueKey` vs `baseKey` to show different stages
- **Booleans**: Use positive forms (`isValid`, `hasData`) over negative (`isNotValid`, `hasNoData`)
- **Leading Underscores**: Indicate unused variables only, not private members
- **Accuracy**: Ensure names reflect actual behavior, especially after refactoring. Add comments if renaming isn't possible

### TypeScript Best Practices

- **Strict Mode**: Use TypeScript strict configuration
  - Avoid `any` types and non-null assertions
  - Use proper type imports (`import type`) for type-only imports
  - Use type guards for array operations when needed
- **Type Safety**: Prefer explicit types over implicit any
  - Don't cast to `any` to bypass type checking
  - Use proper type narrowing and guards
  - Validate types at boundaries (function inputs, API responses)

### Error Handling

- **Structured Patterns**: Use consistent error handling throughout
  - Avoid silent failures
  - Return appropriate types (null, empty arrays) vs throwing errors
  - Include context in error messages
- **Meaningful Checks**: Check for the actual condition that matters
  - Check error presence, not just null values
  - Validate data shape, not just existence
- **Graceful Degradation**: Return empty collections instead of throwing when appropriate
  - Missing optional data → empty array
  - Invalid input → null or undefined with clear contract

### Code Organization

- **Imports**: Keep organized and grouped by type
  - Never use inline imports - always import at the top
  - Group by: standard library, external deps, internal modules, types
- **File Size**: Keep files focused and manageable
  - Aim for under 300 lines per file
  - Split large files into logical modules
  - Each file should have a single, clear purpose
- **Function/Method Size**: Keep functions small and focused
  - **Target: 20-30 lines maximum per function**
  - Absolute limit: 50 lines per method
  - If a function exceeds 30 lines, look for opportunities to extract helpers
  - Each function should do one thing well
  - Extract complex logic blocks into well-named helper functions
- **Reduce Nesting**: Minimize nested code for readability
  - **Always prefer early returns** over deeply nested conditionals
  - Use guard clauses at the start of functions
  - Return early for error conditions and edge cases
  - Avoid `else` blocks when the `if` block returns
  - Maximum nesting depth: 2-3 levels
  - **Always use braces**: No single-line if statements, even for simple returns
  - Example of preferred pattern:

    ```typescript
    // ❌ Avoid deep nesting
    function process(data: Data | null) {
      if (data) {
        if (data.isValid) {
          if (data.items.length > 0) {
            return data.items.map(transform);
          }
        }
      }
      return [];
    }

    // ❌ Avoid single-line if statements (no braces)
    function process(data: Data | null) {
      if (!data) return [];
      if (!data.isValid) return [];
      if (data.items.length === 0) return [];
      return data.items.map(transform);
    }

    // ✅ Prefer early returns with braces
    function process(data: Data | null) {
      if (!data) {
        return [];
      }
      if (!data.isValid) {
        return [];
      }
      if (data.items.length === 0) {
        return [];
      }

      return data.items.map(transform);
    }
    ```

- **Helper Functions**: Extract logic into small, well-named helpers
  - Create helpers for repeated patterns
  - Name helpers descriptively based on what they do
  - Keep helpers close to where they're used (same file or dedicated utils file)
  - Prefer many small functions over few large ones
- **Variable Declaration**: Prefer immutable declarations when possible
  - Use `const` by default, `let` only when necessary
  - Structure with early returns to enable const usage
  - Avoid mutable default values (empty strings, undefined placeholders)
  - Early returns eliminate the need for reassignment

### Comments and Documentation

- **Self-Documenting Code**: Code should be clear through naming
  - Well-named functions and variables reduce the need for comments
  - Code tells "what", comments explain "why" when necessary
- **Document All Functions**: Every function should have JSDoc documentation
  - **Public functions**: Comprehensive documentation with examples
  - **Private functions**: Document purpose, parameters, and return values
  - **Helper functions**: Brief description of what they do and why they exist
  - **No exceptions**: Even small utility functions deserve documentation
- **JSDoc Standards**: Use comprehensive JSDoc for all functions
  - **@param**: Describe each parameter's purpose and constraints
  - **@returns**: Explain what the function returns and when
  - **@throws**: Document any errors the function might throw
  - **@example**: Include usage examples for public APIs and complex functions
  - **@private**: Mark internal/private functions clearly
  - **@see**: Reference related functions or documentation when helpful
- **JSDoc Best Practices**:
  - Write in complete sentences with proper punctuation
  - Be specific and detailed, not vague
  - Explain edge cases and assumptions
  - Document why, not just what (code shows what)
  - Include type information even when TypeScript types exist (helps with readability)
- **Comment Maintenance**:
  - Keep comments accurate during refactoring
  - Remove or update outdated comments immediately
  - Apply production code quality standards to comments (fix typos, improve clarity)
  - Review comments when copying code patterns

## Test Writing Guidelines

### Test Organization

- **Test Files**: Use clear naming patterns
  - `*.unit.test.ts` for unit tests
  - `*.int.test.ts` for integration tests
- **Top-Level Describe**: All test files should have a top-level `describe` block explaining scope
- **Test Structure**: Organize with beforeAll/beforeEach for setup
  - Put setup inside describe blocks, not at module level

### Test Quality

- **Test Isolation**: Each test should be independent
  - Don't rely on state from other tests
  - Create fresh test data when needed
- **Assertion Counting**: Use appropriate assertion verification
  - `expect.assertions(n)` for conditional assertions in try/catch
  - Verify error handling paths execute correctly
- **Precise Assertions**: Test exact values, not approximations
  - Use baseline + delta patterns (e.g., `initialCount + 3`)
  - Don't just check `> 0` when you know the exact expected value
- **Test Code Quality**: Clean up test code with same rigor as production code
  - Remove unused variables and imports
  - No empty catch blocks
  - Include error types in catch: `${error instanceof Error ? error.message : String(error)}`

### Test Best Practices

- **Dependency Injection Over Mocking**: Prefer testable designs
  - Pass dependencies as parameters instead of global mocks
  - Example: `currentDate: () => Date` parameter vs mocking `Date` globally
- **Prefer Integration Tests**: For external services (LLMs, APIs)
  - Real service calls provide more value
  - Catch integration issues mocks cannot simulate
- **Test Flag Hygiene**: Never commit temporary flags
  - No `.only` or `.skip` in committed code
  - Use only during local development
- **Consistent Test Data**: Use standardized test fixtures
  - Reduces confusion and enables predictable behavior
  - Use constants instead of hardcoded values in assertions

### Mock Safety

- **Type Safety**: Maintain proper TypeScript types in mocks
  - Don't cast mocks to `any`
  - Use proper mock types throughout
- **Memory Safety**: Return new instances, not shared references
  - `new Date(fixedDate)` instead of returning same Date instance
  - Prevents unintended mutations between tests

## Development Guidelines

### Quality Requirements

- **Coverage**: 100% code coverage required for unit tests
  - All statements, branches, functions, and lines
  - Integration tests don't require coverage
- **Type Checking**: All code must pass `npm run typecheck`
- **Linting**: All code must pass `npm run lint:check`
- **Complete Feature**: Feature is done when all checks pass

### Pre-commit Hooks

- **Full Quality Checks**: The pre-commit hook intentionally runs the full suite (lint, typecheck, test, build)
- **Fast Tests**: Our tests run quickly, so comprehensive pre-commit checks don't slow down development
- **Rationale**: Catching issues before commit prevents broken code from entering the repository
- **Override if Needed**: Use `git commit --no-verify` for work-in-progress commits when absolutely necessary

### File Handling

- **Prefer Editing**: Always prefer editing existing files over creating new ones
- **No Proactive Documentation**: Never create documentation files (\*.md) unless explicitly requested

### Async/Await Usage

- **Evaluate Necessity**: Don't declare methods async unless they perform async operations
- **Fire-and-Forget vs Await**: Consider whether operations should block
  - Metrics recording might be fire-and-forget
  - Critical operations should be awaited

### Code Reviews

- **Verify Changes**:
  - No duplicate or conflicting logic
  - Type contracts maintained end-to-end
  - Error handling covers edge cases
  - Test coverage is comprehensive

## Required local review

This step needs read access to `with-logic/skills`, which is private to Logic. If
you do not have that access (Crew reports that it cannot reach
`with-logic/skills`), skip the local review. This is not a failed preparation: do
not ask the user about it, and say in the pull request that the local review was
skipped.

This section applies to local coding-agent sessions only. A hosted CI review
gets its instructions from the workflow. In hosted CI, do not run Crew and do not
treat missing Crew as a failed review. Run the local review before you open a
pull request. It does not replace the hosted review, which stays the merge
requirement.

The shared local review supports Codex and Claude Code. With another agent,
report the local review as not run and ask the user before you open the pull
request.

Prepare each required local review in the existing coding-agent session. From this
repository root, run `crew version` and `crew install --latest --json` with the
command timeout of your tool. Require a published Crew release at or above the
minimum that [Shared local review](#shared-local-review) names. If the installed
shared procedure names a higher minimum, the higher minimum applies. Then read the
updated project `review/SKILL.md`: `.agents/skills/review/SKILL.md` for Codex or
`.claude/skills/review/SKILL.md` for Claude Code. Follow its shared preparation
procedure to verify this agent's full roster, the `pull-request-description`
helper and source records, then continue `/review` in this session. A refresh is
one run of `crew install --latest --json`. Refresh once per invocation.

Failed preparation stops required review. A timeout is a failed preparation. A
`no_agents` result is a failed preparation. `npm install` does not run Crew, so
it does not prove readiness. An install for another agent does not prove that
this agent is ready. Do not use stale or personal skills as a fallback. See
[Shared local review](#shared-local-review) for setup and recovery. If you
cannot recover the preparation for any other reason, report the local review as
not run and ask the user before you open the pull request.

The shared procedure includes proposed PR title and body text from the separately
installed helper. This local step does not edit the PR or change the code-review
verdict. Keep `.crewrc` and its generated lock tracked and downloaded copies
ignored. Do not commit files under `.agents/skills/` or `.claude/skills/` that
Crew installed. As the agent, do not discard a `.crewrc.lock` change. The author
commits it in the pull request under review or discards it after the review. Do
not refresh while reviewers run: a refresh replaces the files that the reviewers
read, and the review then mixes two revisions. Do not add a script or workflow
to this repository that downloads or selects review skills: `.crewrc` is the
only place that selects them, and the plain command
`crew install --latest --json` installs them.

The hosted review workflow is the one exception to the rule against a script or
workflow that downloads or selects review skills: its `review-source` input, with the
variable `PIPELINE_SOURCE_APP_CLIENT_ID` and the secret `PIPELINE_SOURCE_APP_PRIVATE_KEY`,
selects the Skills source for hosted CI only. The local review still uses `.crewrc`.

## Shared local review

Shared review skills and the PR-description helper come from `.crewrc` through
Crew.

Use a published [Crew release](https://crew.logic.inc/) with project manifests
(0.13+; 0.14.0 verified). Run `crew version`. Confirm Git read access to
`with-logic/skills` with `git ls-remote https://github.com/with-logic/skills.git`.
Enable the agent if needed with `crew agents enable codex` or
`crew agents enable claude-code`, then run this from the repository root:

```sh
crew install --latest --json
```

A failure exits nonzero; fix the reported cause and run it again. For a
`no_agents` result, enable your agent with the command above. A zero exit does
not prove that your agent is ready. The preparation checks of each review
confirm readiness.

Commit `.crewrc` and its Crew-generated `.crewrc.lock`. Plain `crew install`
retains the locked revision; `--latest` can advance it. `--latest` installs and
runs the current `main` of `with-logic/skills` immediately. No one in this
repository reviews that revision first. The lock change only records which
revision ran. [Required local review](#required-local-review) says who commits
or discards a lock advance. The command to discard it is
`git restore .crewrc.lock`. After a discard, the installed
copies are newer than the lock until the next `crew install`. If `.crewrc.lock`
conflicts with the base branch, keep the base branch's lock; the next refresh
can advance it again. The release scripts (`npm run release` and its variants)
run `npm version`, which stops when the Git working tree is not clean. Commit or
restore a `.crewrc.lock` change before a release.

A skill that you author here under a name that Crew does not use is not ignored;
commit it as usual.
