# PR Review Instructions

Please review this pull request according to the Intent library's engineering standards. Focus on providing actionable feedback with specific line references.

Some of this document may not apply to this PR, so use your judgment to skip sections that are not relevant.

## Code Quality Standards

### Function and File Size

- **Functions**: Target 20-30 lines, absolute maximum 50 lines
  - Each function should do one thing well
  - Extract complex logic into well-named helper functions
- **Files**: Keep under 300 lines
  - Split large files into logical modules
  - Each file should have a single, clear purpose

### Code Structure

- **Always use braces**: No single-line if statements, even for simple returns
- **Early returns**: Always prefer early returns over nested conditionals
- **Minimal nesting**: Maximum 2-3 levels of nesting depth
- **Many small helpers**: Prefer many focused functions over few large ones
- **Immutable declarations**: Use `const` by default, `let` only when necessary

### Example of Preferred Pattern:

```typescript
// ✅ Good: Early returns with braces
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

// ❌ Bad: Nested or single-line
function process(data: Data | null) {
  if (data) {
    if (data.isValid && data.items.length > 0) {
      return data.items.map(transform);
    }
  }
  return [];
}
```

## Documentation Requirements

### JSDoc Standards

- **Document ALL functions**: Every function (public and private) must have JSDoc
- **@param**: Describe each parameter's purpose and constraints
- **@returns**: Explain what the function returns and when
- **@throws**: Document any errors the function might throw
- **@example**: Include usage examples for public APIs and complex functions
- **@private**: Mark internal/private functions clearly

### Documentation Best Practices

- Write in complete sentences with proper punctuation
- Be specific and detailed, not vague
- Explain edge cases and assumptions
- Document why, not just what (code shows what)
- Include type information for readability

## TypeScript Best Practices

### Type Safety

- Use TypeScript strict mode configuration
- Avoid `any` types and non-null assertions
- Use proper type imports (`import type`) for type-only imports
- Don't cast to `any` to bypass type checking
- Use proper type narrowing and guards
- Validate types at boundaries (function inputs, API responses)

### Naming Conventions

- **Classes and Types**: PascalCase (`Reranker`, `LlmClient`)
- **Functions and Variables**: camelCase (`buildMessages`, `candidateKey`)
- **Constants**: UPPER_SNAKE_CASE (`BATCH_SIZE`, `TIMEOUT_MS`)
- **Test files**: `*.unit.test.ts` or `*.int.test.ts`
- **Descriptive names**: Use purpose-driven names, avoid generic names like "temp", "data", "handle"
- **Boolean names**: Use positive forms (`isValid`, `hasData`) over negative (`isNotValid`)

## Testing Requirements (100% Coverage for Unit Tests)

### Test Quality Checks

- All public methods must have tests
- All private methods should have coverage through public method tests
- Both success and error paths tested
- Edge cases explicitly covered
- Descriptive test names explaining the scenario
- No test interdependencies
- Each test should be independent

### Test Best Practices

- Use top-level `describe` blocks to explain test scope
- Organize setup with `beforeAll`/`beforeEach` inside describe blocks
- Use precise assertions (test exact values, not approximations)
- Clean up test code with same rigor as production code
- No empty catch blocks
- Include error types in catch: `${error instanceof Error ? error.message : String(error)}`
- Never commit `.only` or `.skip` flags

### Mock Safety

- Maintain proper TypeScript types in mocks
- Don't cast mocks to `any`
- Return new instances, not shared references
- Prefer dependency injection over global mocks

## Error Handling

### Structured Patterns

- Use consistent error handling throughout
- Avoid silent failures
- Return appropriate types (null, empty arrays) vs throwing errors
- Include context in error messages
- Validate inputs at function boundaries

### Graceful Degradation

- Return empty collections instead of throwing when appropriate
- Missing optional data → empty array
- Invalid input → null or undefined with clear contract
- Always preserve original order on errors (as fallback)

## Code Organization

### Import Standards

- Keep imports organized and grouped by type
- Never use inline imports - always import at the top
- Group by: standard library, external deps, internal modules, types
- Remove unused imports

### Comments

- Code should be self-documenting through naming
- When comments are needed:
  - Be specific and detailed
  - Keep accurate during refactoring
  - Remove outdated comments
  - Apply production code quality standards

## Library-Specific Patterns

### Reranking Architecture

- Maintain stable fallbacks: errors should return original order
- Use early returns for fast paths (0 or 1 candidates)
- Keep batch processing logic separate from ranking logic
- Ensure duplicate key handling is correct

### LLM Integration

- Mock all LLM calls in unit tests
- Use integration tests for real LLM verification
- Handle JSON schema validation errors gracefully
- Implement retry logic for transient failures

## Final Checklist

- [ ] No functions over 50 lines (target: 20-30)
- [ ] All if statements use braces
- [ ] All functions have JSDoc documentation
- [ ] No `any` types without justification
- [ ] No hardcoded values that should be config
- [ ] No commented-out code
- [ ] No console.log statements
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint:check`)
- [ ] Tests pass with 100% coverage (`npm run test:unit`)
- [ ] Build succeeds (`npm run build`)

## Review Approach

Provide specific, actionable feedback with line numbers. Be objective and balanced—point out both strengths and areas for improvement, even if the PR is generally solid. Avoid excessive praise; focus on:

- **Clarity**: Is the code easy to understand?
- **Maintainability**: Will this be easy to modify later?
- **Correctness**: Does it work as intended?
- **Best Practices**: Does it follow the guidelines above?

Remember: The goal is to maintain a world-class TypeScript library with excellent code quality, comprehensive documentation, and robust testing.
