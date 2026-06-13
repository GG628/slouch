# Expo project — agent rules (pocket-expo)

This project is developed **live from a phone**: an agent edits files here while
Expo Go shows a hot-reloading preview on the same device. Everything below exists
to protect that loop. (This file is the Codex-facing copy of the same rules in
`CLAUDE.md` — keep the two in sync.)

## Stack
- Expo (expo-router, TypeScript). Match the project's existing Expo SDK — check
  `package.json`; do not assume a version.
- Previewed in Expo Go (matching custom dev build) over LAN, or `--tunnel` off-network.

## The live-reload contract (read this first)
- **Prefer JS/TS-only changes.** They Fast Refresh instantly in Expo Go — this is
  the whole point of the setup.
- **Stop and flag before any change that needs a native rebuild.** These silently
  break the live preview and force a new dev build:
  - adding/removing a native module, or any dependency that ships native code
  - editing `app.json` / `app.config.*`, config plugins, `Info.plist`,
    entitlements, the `android/` or `ios/` dirs, the URL scheme, or bundle id
  - changing native permissions
  - bumping the Expo SDK version
  When a request needs one of these, **say so explicitly and ask before doing it.**
- **Never start, stop, or restart the Metro bundler.** It runs in a separate tmux
  window. Just edit files; Fast Refresh delivers the change.

## Working style for a phone-driven loop
- Make **small, incremental edits** so reloads stay fast and diffs stay readable
  on a small screen.
- After each change, state in **one line** what should now look or behave
  differently on screen, so it can be verified at a glance.
- Keep diffs focused. No sweeping refactors unless asked.

## Parallel agents
- If another agent (e.g. Claude Code) is working in this repo at the same time,
  work in a separate **git worktree** so you don't clobber each other's edits.
