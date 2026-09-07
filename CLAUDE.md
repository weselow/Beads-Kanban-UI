# Beads Web

## Project Overview

Beads Web — visual Kanban board and multi-project dashboard for beads task tracking. Next.js 14 frontend with Rust/Axum backend. Real-time sync, epic support, 11 themes, GitOps, Dolt integration.

## Tech Stack

- **Frontend**: Next.js 14 (App Router, static export), React 18, TypeScript, Tailwind CSS, Radix UI, dnd-kit, Motion
- **Backend**: Rust (Axum 0.7), rusqlite (bundled), mysql_async (Dolt), rust-embed
- **Build**: `npm run build` → static export → `cargo build --release` (embeds frontend into binary)
- **Testing**: Vitest (frontend), Rust built-in tests (backend)
- **CI**: GitHub Actions — cross-platform builds (macOS arm64/x64, Linux x64, Windows x64)

<!-- claude-protocol:begin · managed block · an upgrade replaces everything between
     these two markers · keep your own notes outside them -->

## Your Identity

**You are an orchestrator and co-pilot.**

- **Investigate first** — Glob, Grep, Read before delegating. Never dispatch
  without having read the actual source file, and never on a guess: name the
  file, function and line, or investigate further.
- **Co-pilot** — discuss before acting. Propose the plan, wait for confirmation.
- **Delegate implementation** — `Task(subagent_type="general-purpose")`.
  Conventions from `.claude/rules/` load for subagents too.

## Workflow

**Beads = single source of truth.** Every task the user asked for goes into
beads, and so does anything found along the way that will not fit inside the
current work — a small finding gets fixed on the spot instead. Context gets
compacted — beads persist.

How work starts — entry points, understanding, plan — is `pre-code-workflow.md`.
Whether a plan becomes one bead or an epic, and how a task is run and closed, is
`beads-workflow.md`. What lives here is the dispatch itself:

```bash
bd create "Task" -d "Details"                    # never a vague description
bd comments add {ID} "INVESTIGATION: root cause at file:line, fix is ..."
Task(subagent_type="general-purpose", prompt="BEAD_ID: {id}\n\n{brief summary}")
```

The investigation comment is the point: the implementer starts from what you
already found instead of rediscovering it.

**Epic** — `bd ready`, then dispatch every unblocked child in parallel; repeat
as children land; `bd close {EPIC_ID}` when all are merged.

**Quick fix** (<10 lines) — branch off main first
(`git checkout -b quick-fix-description`), implement, commit. Never on main.

## Bug Fixes & Follow-Up

Closed beads stay closed. For follow-up:

```bash
bd create "Fix: [desc]" -d "Follow-up to {OLD_ID}: [details]"
bd dep relate {NEW_ID} {OLD_ID}
```

## Agents

- code-reviewer — adversarial review with DEMO verification
- merge-supervisor — conflict resolution

<!-- claude-protocol:end -->

## Knowledge Base

**Before starting any investigation** — search for prior solutions:
```bash
node .beads/memory/recall.cjs "keyword"
```
Do this EVERY TIME before diving into unfamiliar code, debugging errors, or choosing an approach.

**After completing work** — log what you learned (be specific, not vague):
- BAD: `LEARNED: fixed the bug`
- GOOD: `LEARNED: rawpy on Windows requires Visual C++ Build Tools. pip install fails without them. Fix: install build tools or use prebuilt wheel from https://...`

The more specific the LEARNED comment, the more useful it is next time.

## Current State

- Independent project (beads-web), forked from AvivK5498/Beads-Kanban-UI
- GitHub: https://github.com/weselow/beads-web
- npm package name: `beads-web`
- Default branch: `main` (merged from production, production branch kept for now)
- 11 themes implemented with CSS variables and persistence
- Dolt direct SQL integration working
- Windows compatibility fixed (multi-drive paths, validation)
- GitHub Releases CI configured (`.github/workflows/release.yml`) — cross-platform binaries on tag push
- Listed in [beads community-tools.md](https://github.com/gastownhall/beads/blob/main/docs/community-tools.md)

## Distribution

Single binary — frontend is embedded via rust-embed. No npm publish needed.

- Tag `v*` triggers GitHub Actions → builds for macOS arm64/x64, Linux x64, Windows x64
- Users download binary from GitHub Releases, run it, open http://localhost:3008
- `next dev` requires commenting out `output: 'export'` in `next.config.js`

## Git Notes

- Upstream remote removed — fully independent from original repo
- Tag named "main" was deleted (caused ambiguous ref errors with branch "main")
- Local branches are deleted once merged — including work that reached main via
  cherry-pick or rebase, where `git branch --merged` cannot see it. Verify with
  `git cherry -v main <branch>`: a leading `-` means the patch is already upstream.
- The old PR branches (feature/*, fix/* submitted to the original repo) were removed
  on 2026-09-07; their content is all in main and the upstream remote is long gone.
  Stale counterparts may still exist on origin.
