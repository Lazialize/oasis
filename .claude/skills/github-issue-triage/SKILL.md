---
name: github-issue-triage
description: Triage open GitHub issues, dispatch fixes to size-matched subagents in parallel worktrees, review each result, and open one PR per issue
---

# GitHub issue triage & dispatch

Orchestrates fixing multiple issues in one session: pick the highest-priority issues, hand each to a background subagent sized to the work, review every result yourself, then push and open one PR per issue. The subagent implements; the supervisor (you) is the reviewer and the only one who pushes.

## 1. Triage

1. `gh issue list --state open --limit 50 --json number,title,labels` and rank by priority label (`p1` > `p2`), then by user guidance.
2. Select at most the number of issues the user asked for (default 3). Prefer a spread of `size:*` labels so models can be matched. Avoid picking two issues that touch the same files — their PRs will conflict.
3. Fetch each selected issue's full body with `gh issue view <n>`; the body (summary, reproduction, root cause, test expectations) goes verbatim into the subagent prompt.

## 2. Dispatch

Model per `size:*` label — `size:large` → opus, `size:medium` → sonnet, `size:small` → haiku.

Launch all agents in one message (parallel, background, `isolation: "worktree"`). Each prompt must be self-contained and include:

- The full issue body (number, title, labels).
- Repo conventions the agent must follow: CLAUDE.md rules, TypeScript strict/ESM/`.ts` imports, minimal diffs, version-branching (3.0 vs 3.1) where schemas are involved.
- Workflow: create `fix/issue-<n>-<slug>` from `origin/main` (fetch first) **inside the isolated worktree**; TDD (failing test first); scoped `bun test packages/<pkg>` + `bun run typecheck`, then full `bun test` once; hand-write a `.changeset/<slug>.md` (patch, matching existing files' format) for user-facing changes; conventional commit ending with the Claude co-author trailer.
- **Explicitly: do NOT push and do NOT create a PR** — the supervisor reviews first.
- Report back: worktree path, branch name, files + approach, deliberately unhandled edge cases, full test/typecheck output.

## 3. Review (per completion notification)

Never trust the agent's self-report. For each finished agent:

1. **Locate the work**: `git worktree list` — confirm the branch actually lives in the agent's isolated worktree. Agents sometimes work in the main checkout instead; if so, note the original branch (reflog) and restore it (`git checkout main`) after pushing.
2. **Read the full diff**: `git -C <worktree> diff origin/main..<branch>`. Check: fix matches the issue's expected behavior; 3.0 behavior not weakened by a 3.1 fix (and vice versa); tests cover both positive and negative cases; docs updated when a rule's behavior changed; no unrelated refactoring.
3. **Validate the changeset**: frontmatter package names must be actual workspace members (`@oasis/*` only — `editors/vscode`/`oasis-vscode` is NOT changeset-managed; its version is synced by script). Run `bunx changeset status --since origin/main` from the branch to prove it parses. An invalid name fails CI's `changeset version`.
4. **Re-run verification yourself** in the agent's worktree: scoped `bun test packages/<pkg>` and `bun run typecheck`.
5. Small problems (wrong changeset, message tweaks): fix and `git commit --amend` yourself. Real defects: `SendMessage` the same agent back with the findings — don't respawn.

## 4. Ship

Per approved branch: push, then `gh pr create --base main` with body: `Closes #<n>`, a Summary of what changed and why, Tests/verification evidence, docs+changeset notes, and the standard Claude Code footer. One PR per issue, no stacking.

## Final report to the user

Table of issue → size/model → PR link → review verdict, plus anything you had to fix during review (that detail is what makes the supervision worth it).
