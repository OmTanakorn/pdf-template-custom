# Project Guidelines (CLAUDE.md)

This file provides instructions to Claude Code and AI pair programmers working in this repository.

## 1. Project Overview & Environment
- **Language / Runtime:** 
- **Framework & Libraries:** 
- **Architecture Pattern:** Clean Architecture / Layered (Controller -> Service -> Repository)
- **Database / ORM:** 

## 2. Commands & Testing
- **Lint & Format:** 
- **Run Dev Server:** 
- **Unit Tests (Fast, Mocked):** 
- **Integration Tests:** 

## 3. Strict Architecture & Layering Rules
- Place all business logic in dedicated service classes.
- Controllers and views handle HTTP request/response orchestration only.
- Preserve existing comments and docstrings.
- Strict typing and explicit error handling required.

## 4. Git & Commit Conventions
- Use Conventional Commits format: `<type>(<scope>): <short description> [JIRA-ID]`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`

## 5. Definition of Done (DoD)
Before completing any task or opening a PR:
1. Run linter and formatter cleanly.
2. Execute test suite and verify 100% pass rate.
3. Remove unused imports and debug logs.
