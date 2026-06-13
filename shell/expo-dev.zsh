# pocket-expo — drive your Expo projects from your phone.
#
# `expo-dev`            boot/attach a tmux session for the Expo project in $PWD
# `expo-dev <name>`     same, with an explicit session name
# `expo-dev --tunnel`   start Metro with --tunnel (for cellular / off-LAN)
# `expo-dev init`       drop CLAUDE.md + AGENTS.md into the current project
#
# Source this file from ~/.zshrc (install.sh does that for you).

# Resolve the repo root from this file's own location, so `init` can find templates.
POCKET_EXPO_HOME="${POCKET_EXPO_HOME:-${${(%):-%x}:A:h:h}}"

expo-dev() {
  emulate -L zsh

  # --- subcommand: init -----------------------------------------------------
  if [[ "$1" == "init" ]]; then
    if [[ ! -f app.json && ! -f app.config.js && ! -f app.config.ts ]]; then
      print -u2 "expo-dev: no app.json/app.config.* here — run from an Expo project root."
      return 1
    fi
    local f
    for f in CLAUDE.md AGENTS.md; do
      if [[ -e "$f" ]]; then
        print "expo-dev: $f already exists, skipping"
      elif cp "$POCKET_EXPO_HOME/templates/$f" "./$f"; then
        print "expo-dev: wrote $f"
      fi
    done
    return 0
  fi

  # --- boot / attach a session ---------------------------------------------
  local tunnel=0 name="" arg
  for arg in "$@"; do
    case "$arg" in
      --tunnel) tunnel=1 ;;
      *)        name="$arg" ;;
    esac
  done
  [[ -z "$name" ]] && name="${PWD:t}"
  name="${name//./-}"; name="${name//:/-}"

  if ! command -v tmux >/dev/null 2>&1; then
    print -u2 "expo-dev: tmux not installed — 'brew install tmux'"; return 1
  fi

  # Already running? Just attach (or switch if we're already inside tmux).
  if tmux has-session -t "$name" 2>/dev/null; then
    if [[ -n "$TMUX" ]]; then tmux switch-client -t "$name"; else tmux attach -t "$name"; fi
    return
  fi

  local metro="npx expo start"
  (( tunnel )) && metro="npx expo start --tunnel"

  tmux new-session  -d -s "$name" -c "$PWD" -n metro
  tmux send-keys    -t "$name:metro"  "$metro" C-m
  tmux new-window   -t "$name" -c "$PWD" -n claude
  tmux send-keys    -t "$name:claude" "claude" C-m
  tmux new-window   -t "$name" -c "$PWD" -n codex
  tmux send-keys    -t "$name:codex"  "codex" C-m
  tmux new-window   -t "$name" -c "$PWD" -n shell
  tmux new-window   -t "$name" -c "$PWD" -n awake
  tmux send-keys    -t "$name:awake"  "caffeinate -dis" C-m   # keep the Mac awake while you're away
  tmux select-window -t "$name:claude"

  if [[ -n "$TMUX" ]]; then tmux switch-client -t "$name"; else tmux attach -t "$name"; fi
}
