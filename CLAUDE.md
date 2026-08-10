# Project Instructions

## Git
- Always ask the user before committing or pushing. Show what you plan to commit and wait for approval.
- Use `git commit -F` with a temp file for commit messages, never `$()` substitution.
- Keep history granular — never squash.
- Do all work locally and push to remote. Do NOT merge via the remote/PR (no `gh pr merge`, especially `--squash`); merge locally with `git merge` and push `main`. (`Closes #NN` in a commit message still auto-closes the issue — no PR needed.)
- Never run a remote mutation that assumes `origin` is current without checking first: `git fetch`, then compare `git log origin/main..main` and `git log main..origin/main`. If local is ahead, push it before branching.

## Agent skills

### Issue tracker

Issues and PRDs live in this repo's GitHub Issues (via the `gh` CLI). External
PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root.
See `docs/agents/domain.md`.
