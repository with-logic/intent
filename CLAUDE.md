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
- `npm run test:int` - Integration tests only (requires `GROQ_API_KEY`)
- Test files are co-located: `*.unit.test.ts` for unit, `*.int.test.ts` for integration

### Linting

- `npm run lint` - Auto-fix linting and formatting issues
- `npm run lint:check` - Check without fixing
- **Line Length**: Prettier configured for 100-character line width (`printWidth: 100`)

## Architecture

### Core Reranking Flow

The `Reranker` class orchestrates the entire reranking process:

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
- **Default Provider**: Groq adapter (providers/groq.ts) with JSON schema response format and retry logic for validation failures
- **Selection Logic**: `selectLlmClient()` chooses ctx.llm if provided, else creates Groq client if `GROQ_API_KEY` exists, else undefined

### Configuration System

All config lives in config.ts using lib/config helpers:

- Environment variables: `INTENT_MODEL`, `INTENT_TIMEOUT_MS`, `INTENT_RELEVANCY_THRESHOLD`, `INTENT_BATCH_SIZE`, `INTENT_TINY_BATCH_FRACTION`
- Groq-specific: `GROQ_API_KEY`, `GROQ_DEFAULT_MODEL`, `GROQ_DEFAULT_TEMPERATURE`
- Config is loaded automatically via `dotenv/config` import at top of config.ts
- Reranker constructor accepts overrides as third parameter

### Key Design Patterns

- **Stable fallbacks**: Any failure (LLM error, timeout, invalid response) returns items in original order
- **Duplicate key handling**: Internal disambiguation using `"Key (idx)"` suffix
- **Strict typing**: Uses TypeScript strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **Generic item support**: Reranker is `Reranker<T>` with user-provided key/summary extractors
- **Zero/one-item fast path**: Avoids LLM calls when unnecessary

## Testing Strategy

- **Unit tests**: Mock all LLM calls, enforce 100% coverage
- **Integration tests**: Live Groq API calls, no coverage requirements
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
