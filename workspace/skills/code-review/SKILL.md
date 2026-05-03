---
name: code-review
description: Review code for quality, security, correctness, and maintainability. Use when the user asks to review, check, audit, or improve code. NOT for writing new code.
type: workflow
allowed_tools: [read_file, bash, list_directory]
---

# Code Review Skill

## When to Use
- User asks to "review", "check", "audit", or "improve" code
- Before merging PRs
- After implementing a feature

## Checklist

### Security
- [ ] SQL injection vulnerabilities
- [ ] XSS vulnerabilities
- [ ] Hardcoded secrets/credentials
- [ ] Path traversal risks
- [ ] Unvalidated user input

### Correctness
- [ ] Logic errors
- [ ] Off-by-one errors
- [ ] Null/undefined handling
- [ ] Error handling completeness

### Performance
- [ ] Unnecessary re-renders (frontend)
- [ ] N+1 queries
- [ ] Missing caching opportunities
- [ ] Large bundle sizes

### Maintainability
- [ ] Clear naming conventions
- [ ] Single responsibility principle
- [ ] DRY violations
- [ ] Missing or outdated comments

## Output Format
Provide findings as:
1. **Critical** - Must fix before merge
2. **Warning** - Should fix, non-blocking
3. **Suggestion** - Nice to have improvement
