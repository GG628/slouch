#!/usr/bin/env bash
# Slouch installer: wires the slouch function into your shell and installs
# the global Expo agent rules. Safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"
LINE="source \"$HERE/shell/expo-dev.zsh\""

# 1. Source the function from ~/.zshrc (idempotent - update later with `git pull`).
if grep -Fqs "$LINE" "$ZSHRC"; then
  echo "slouch: already sourced in $ZSHRC"
else
  printf '\n# slouch\n%s\n' "$LINE" >> "$ZSHRC"
  echo "slouch: added source line to $ZSHRC"
fi

# 2. Install the global Expo rules for Claude Code (never overwrite an existing one).
mkdir -p "$HOME/.claude"
if [[ -e "$HOME/.claude/CLAUDE.md" ]]; then
  echo "slouch: ~/.claude/CLAUDE.md already exists - left untouched (see templates/CLAUDE.md)"
else
  cp "$HERE/templates/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  echo "slouch: installed global ~/.claude/CLAUDE.md"
fi

echo
echo "Done. Open a new terminal (or run: source \"$ZSHRC\")."
echo "Then, in any Expo project:  slouch init   &&   slouch start"
