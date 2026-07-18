---
name: audit-package-issues
description: Audit one or more Oasis packages for reproducible bugs, correctness gaps, maintainability risks, and concrete refactoring opportunities, then publish each verified finding as a separate GitHub issue with priority, size, and package labels using the gh CLI. Use when asked to inspect a package or subsystem, identify technical debt or bugs, create a package backlog, or turn an audit into classified GitHub issues.
---

# Audit Package Issues

Audit implementation and tests, validate every finding, de-duplicate against GitHub, and publish actionable issues one at a time with `gh`.

## Workflow

### 1. Establish scope and repository rules

- Resolve the requested package paths. If no package is named, inspect the repository structure and derive the intended scope from the request.
- Read applicable `AGENTS.md`, architecture/design documents, package README files, manifests, and public API entry points before judging behavior.
- Check `git status --short`. Preserve unrelated and pre-existing changes.
- Treat the audit as read-only. Do not implement fixes, change production files, create branches, or add changesets unless separately requested.
- Use temporary or inline repros when needed. Do not leave audit artifacts in the worktree.

### 2. Run the baseline

- Run the narrowest relevant tests first, then the repository typecheck or equivalent static check.
- Record whether failures predate the audit. A green suite is only a baseline; continue reviewing untested boundaries.
- Inspect source and tests together. Search history, changelogs, and TODO-like comments for known limitations without assuming they are still correct.

### 3. Audit systematically

Cover the dimensions that apply to the target:

- public API contracts, error handling, malformed input, boundary values, and platform differences;
- source locations, diagnostics, identity/canonicalization, caching, concurrency, and I/O abstractions;
- OpenAPI 3.0 versus 3.1 semantics and referenced-document behavior;
- precision or serialization loss, URI/path handling, cycles, aliases, and duplicate identifiers;
- duplicated classification/traversal logic, unsafe mutable caches, avoidable complexity, and drift between parallel implementations;
- missing regression tests around behavior that downstream packages depend on.

Trace effects into consumers when useful, but assign the Issue to the package that owns the faulty abstraction. Do not manufacture a finding merely to cover every category.

### 4. Validate each candidate

Create an Issue only when the candidate has all of the following:

1. A specific current behavior tied to code.
2. A minimal reproduction, failing assertion, or direct static proof.
3. User or maintainer impact.
4. A bounded fix direction and testable acceptance criteria.
5. No existing Issue that already covers the same root cause.

For refactoring findings, name the concrete duplication, coupling, performance cost, or change hazard. Do not publish aesthetic preferences or vague cleanup requests.

Prefer a few high-confidence Issues over a long speculative list. Keep separate root causes in separate Issues; combine symptoms only when one change should fix all of them.

### 5. Check GitHub access, labels, and duplicates

Use `gh` for all GitHub reads and writes in this workflow.

```sh
gh auth status
gh label list --limit 200
gh issue list --state all --limit 200 --json number,title,body,labels,url
```

- Stop before publishing if authentication is invalid.
- Verify required labels already exist. Do not create or rename labels without explicit authorization.
- Search candidate-specific keywords in both open and closed Issues. Compare root cause and acceptance criteria, not only title wording.
- Do not use another connector to bypass a request that explicitly requires `gh`.

## Classification

Apply exactly one priority, one size, and one owning-package label to every Issue.

### Priority

- `p0`: release-blocking behavior, severe data loss/corruption, critical security exposure, or a failure that makes a primary workflow unusable.
- `p1`: incorrect output or resolution, standards violation, crash in realistic input, or a substantial reliability problem with meaningful downstream impact.
- `p2`: uncommon edge case, bounded maintainability/performance problem, testability improvement, or concrete refactoring that reduces future defect risk.

When uncertain, choose the less urgent priority and explain impact in the body.

### Size

- `size:small`: localized change with straightforward regression tests and little design uncertainty.
- `size:medium`: touches several functions/files or requires non-trivial compatibility and regression coverage.
- `size:large`: architectural change, cross-cutting migration, public API redesign, or extensive multi-package validation.

Estimate implementation complexity, not Issue-writing effort.

### Package

Choose the owner from:

- `package:server`
- `package:linter`
- `package:cli`
- `package:bundler`
- `package:core`
- `package:vscode`

Mention affected consumers in the body instead of adding extra package labels unless the root cause is genuinely co-owned.

## Issue format

Use a concise package-prefixed title, such as `core: preserve overflowing numeric literals during serialization`.

Write the body in this structure:

```markdown
## Summary

State the defect or refactoring outcome in one paragraph.

## Evidence

Identify relevant files/functions and explain the current behavior.

## Reproduction

Provide the smallest command, fixture, or code snippet that demonstrates it, including actual and expected results.

## Impact

Explain affected users, workflows, standards compliance, or maintenance risk.

## Proposed scope

Describe a bounded implementation direction without over-prescribing internals.

## Acceptance criteria

- [ ] State observable completion conditions.
- [ ] Require focused regression coverage.
- [ ] Require the relevant package tests and typecheck to pass.
```

For pure refactors, replace `Reproduction` with `Current structure` and show the duplicated paths or dependency problem.

Do not include uncertain claims, private scratch paths, tool chatter, or an implementation generated during the audit.

## Publish one by one

Prepare each Markdown body in a temporary file, then run one mutation at a time:

```sh
gh issue create \
  --title "<package>: <actionable title>" \
  --body-file "<temporary-body-file>" \
  --label "<p0|p1|p2>" \
  --label "<size:large|size:medium|size:small>" \
  --label "<package label>"
```

After every creation:

1. Capture the returned URL.
2. Verify title, body, and labels with `gh issue view <url> --json title,body,labels,url`.
3. Continue only after verification succeeds.

If a write partially succeeds, inspect the created Issue before retrying so the retry cannot create a duplicate.

## Completion report

Report:

- baseline test/typecheck status;
- each Issue as title, URL, priority, size, and package;
- candidates deliberately omitted as duplicates or insufficiently proven;
- any blocker such as invalid `gh` authentication or missing labels.

Do not claim completion until every intended Issue has been created and verified.
