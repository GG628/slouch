# 3. Agents — running Claude Code and Codex together

`slouch start` opens a window for **each** agent (`claude` and `codex`) in the same
tmux session, so you can use whichever you want without leaving your phone. Both
read the project rules `slouch init` installed (`CLAUDE.md` / `AGENTS.md`).

## The one rule: don't point both at the same files at once

Two agents editing the same working directory simultaneously will clobber each
other. If you want them working **in parallel**, give the second one its own
**git worktree** — a separate checkout of the same repo on its own branch:

```bash
# from the project root
git worktree add ../myapp-codex -b codex-lane
```

Then run that agent's window in `../myapp-codex`. Two isolated working trees, one
repo, no collisions. Merge branches when you're happy.

## Suggested patterns

- **Single lane (simplest):** pick one agent per session, ignore the other window.
  Switch agents between sessions, not within a task.
- **Primary + reviewer:** drive changes with one agent; ask the other to review the
  diff before you commit.
- **Two parallel features:** agent A on the main checkout, agent B in a worktree,
  each on its own feature. Only the main checkout's changes hot-reload in your live
  Expo Go preview — keep the app you're *watching* on the main lane.

## Keeping the rules in sync

`CLAUDE.md` and `AGENTS.md` carry the same Expo live-reload contract. If you edit
one (e.g. add a project-specific convention), mirror it into the other so both
agents behave the same.
