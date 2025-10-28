# PR Lessons Learned Extraction

You are tasked with analyzing the feedback from a just-approved pull request and extracting generalized lessons that should be remembered for future development. Your goal is to update the CLAUDE.md file with these lessons to help prevent similar issues in the future.

## Your Task

1. **Review the PR comments and feedback** - Look through all review comments, suggestions, and discussions _EXCEPT_ those written by Claude. Never consider Claude's comments for lessons.
2. **Extract generalizable lessons** - Focus on patterns and principles that apply beyond this specific PR
3. **Check existing guidelines** - Verify if the lesson is already documented in CLAUDE.md
4. **Update CLAUDE.md** - Add new lessons or emphasize existing ones that weren't followed

## Guidelines for Lesson Extraction

### What makes a good lesson:

- **Generalizable** - Applies to multiple scenarios, not just this specific code
- **Actionable** - Provides clear guidance on what to do or avoid
- **Specific enough** - Not so vague that it's unhelpful
- **Pattern-based** - Identifies recurring issues or best practices

### Examples of good lessons for this library:

- "Always document helper functions with JSDoc, even if they're only a few lines"
- "Use early returns with braces for guard clauses, never single-line if statements"
- "Extract complex logic in batch processing into well-named helper functions"
- "Mock LLM responses should return new instances, not shared references, to prevent test interference"

### What to avoid:

- Overly specific fixes that only apply to one file
- Lessons that duplicate existing extensive documentation
- Minor style preferences already covered by linting
- Anything written by Claude (automated assistant comments should not be considered)

## Process

1. Read through all PR review comments and feedback, excluding those by Claude
2. Identify patterns or principles that emerged from the review
3. For each potential lesson, check if it's already in CLAUDE.md
4. If new, add it to the appropriate section in CLAUDE.md:
   - **Code Style Guidelines** - for naming, structure, organization
   - **Test Writing Guidelines** - for testing patterns
   - **Development Guidelines** - for general workflow and practices
5. If existing but not followed, consider emphasizing it or adding an example
6. Group related lessons together for clarity

## Output

Update the CLAUDE.md file with:

- New lessons in the appropriate sections
- Enhanced examples or emphasis for existing lessons that were missed
- Clear, concise guidelines that will help future development

**Important Instructions:**

- Do NOT leave any new comments on the PR
- Simply update the CLAUDE.md file and commit your changes directly
- _Only make changes if there are meaningful lessons to add_
- If no lessons are worth documenting, do nothing (no comments needed)

## Context: Intent Library Standards

This is a TypeScript library for LLM-based reranking with strict quality standards:

- 100% test coverage (unit tests)
- Functions: 20-30 lines target, 50 lines maximum
- Files: Under 300 lines
- Always use braces, even for simple if statements
- Early returns over nested conditionals
- Comprehensive JSDoc on all functions (public and private)
- Many small helpers over few large functions

Remember: The goal is continuous improvement. Not every PR will have lessons worth documenting, and that's okay. Focus on meaningful patterns that will genuinely help maintain the high quality standards of this library.
