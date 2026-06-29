# Slouch - drive your Expo projects from your phone.
#
# `slouch start`            boot/attach a tmux session for the Expo project in $PWD
# `slouch start <name>`     same, with an explicit session name
# `slouch start --tunnel`   start Metro with --tunnel (for cellular / off-LAN)
# `slouch demo`             boot/attach a private copy of the bundled demo app
# `slouch demo --reset`     recreate that copy from the tracked template
# `slouch restart`          restart the Metro window of an existing session
# `slouch init`             drop CLAUDE.md + AGENTS.md into the current project
# `slouch awake`            keep the Mac awake while the display may sleep
# `slouch doctor`           check the phone-driven dev loop
#
# Backwards compatible:
# `expo-dev`                alias for `slouch start`
# `expo-dev init`           alias for `slouch init`
#
# Source this file from ~/.zshrc (install.sh does that for you).

# Resolve the repo root from this file's own location, so `init` can find templates.
# Keep POCKET_EXPO_HOME as a temporary compatibility fallback for old shells.
SLOUCH_HOME="${SLOUCH_HOME:-${POCKET_EXPO_HOME:-${${(%):-%x}:A:h:h}}}"

_slouch_session_name() {
  local name="$1"
  [[ -z "$name" ]] && name="${PWD:t}"
  name="${name//./-}"; name="${name//:/-}"
  print -r -- "$name"
}

_slouch_has_expo_config() {
  [[ -f app.json || -f app.config.js || -f app.config.ts ]]
}

_slouch_ok() { print "ok    $1"; }
_slouch_warn() { print "warn  $1"; }
_slouch_fail() { print "fail  $1"; }
_slouch_info() { print "info  $1"; }

_slouch_init() {
  emulate -L zsh

  if ! _slouch_has_expo_config; then
    print -u2 "slouch: no app.json/app.config.* here - run from an Expo project root."
    return 1
  fi

  local f
  for f in CLAUDE.md AGENTS.md; do
    if [[ -e "$f" ]]; then
      print "slouch: $f already exists, skipping"
    elif cp "$SLOUCH_HOME/templates/$f" "./$f"; then
      print "slouch: wrote $f"
    fi
  done
}

_slouch_awake() {
  emulate -L zsh

  local duration=""
  if [[ "$1" == "--for" && -n "$2" ]]; then
    duration="$2"
  elif [[ -n "$1" ]]; then
    print -u2 "usage: slouch awake [--for seconds]"
    return 1
  fi

  if ! command -v caffeinate >/dev/null 2>&1; then
    print -u2 "slouch: caffeinate not found"
    return 1
  fi

  if [[ -n "$duration" ]]; then
    print "slouch: keeping the Mac awake for ${duration}s; display may sleep."
    caffeinate -is -t "$duration"
  else
    print "slouch: keeping the Mac awake until you stop this command; display may sleep."
    caffeinate -is
  fi
}

_slouch_start() {
  emulate -L zsh

  local tunnel=0 name="" arg
  for arg in "$@"; do
    case "$arg" in
      --tunnel) tunnel=1 ;;
      *)        name="$arg" ;;
    esac
  done
  name="$(_slouch_session_name "$name")"

  if ! _slouch_has_expo_config; then
    print -u2 "slouch: no app.json/app.config.* here - run from an Expo project root."
    return 1
  fi

  if ! command -v tmux >/dev/null 2>&1; then
    print -u2 "slouch: tmux not installed - 'brew install tmux'"
    return 1
  fi

  # Already running? Just attach, or switch if already inside tmux.
  if tmux has-session -t "$name" 2>/dev/null; then
    if [[ -n "$TMUX" ]]; then tmux switch-client -t "$name"; else tmux attach -t "$name"; fi
    return
  fi

  # Env passed to Metro so the in-app bridge knows which tmux session to type
  # prompts into, and (if a whisper model is present) how to transcribe dictation.
  # Harmless for projects without the bridge middleware.
  local metro_env="SLOUCH_SESSION=$name"
  local model="${SLOUCH_WHISPER_MODEL:-$HOME/.cache/whisper/ggml-base.en.bin}"
  [[ -f "$model" ]] && metro_env="$metro_env SLOUCH_WHISPER_MODEL=$model"

  local metro="$metro_env npx expo start"
  (( tunnel )) && metro="$metro_env npx expo start --tunnel"

  tmux new-session  -d -s "$name" -c "$PWD" -n metro
  tmux send-keys    -t "$name:metro"  "$metro" C-m

  # Launch claude in acceptEdits so phone-driven prompts apply JS/TS edits without
  # pausing for approval (heavier actions like installs still prompt). Override with
  # SLOUCH_CLAUDE_FLAGS, e.g. "--permission-mode auto".
  local claude_flags="${SLOUCH_CLAUDE_FLAGS:---permission-mode acceptEdits}"
  local agent first_agent="" launch
  for agent in claude codex; do
    if command -v "$agent" >/dev/null 2>&1; then
      [[ -z "$first_agent" ]] && first_agent="$agent"
      launch="$agent"
      [[ "$agent" == claude ]] && launch="claude $claude_flags"
      tmux new-window -t "$name" -c "$PWD" -n "$agent"
      tmux send-keys  -t "$name:$agent" "$launch" C-m
    fi
  done

  tmux new-window   -t "$name" -c "$PWD" -n shell
  tmux new-window   -t "$name" -c "$PWD" -n awake
  tmux send-keys    -t "$name:awake"  "slouch awake" C-m

  if [[ -n "$first_agent" ]]; then
    tmux select-window -t "$name:$first_agent"
  else
    tmux select-window -t "$name:shell"
  fi

  if [[ -n "$TMUX" ]]; then tmux switch-client -t "$name"; else tmux attach -t "$name"; fi
}

_slouch_demo() {
  emulate -L zsh

  local template="$SLOUCH_HOME/examples/slouch-demo"
  local workspace="${SLOUCH_DEMO_HOME:-$HOME/.slouch/demo-workspace}"
  local reset=0 tunnel=0 arg

  for arg in "$@"; do
    case "$arg" in
      --reset)  reset=1 ;;
      --tunnel) tunnel=1 ;;
      *)
        print -u2 "usage: slouch demo [--tunnel] [--reset]"
        return 1
        ;;
    esac
  done

  if (( reset )) || [[ ! -f "$workspace/app.json" ]]; then
    print "slouch: preparing private demo workspace at $workspace"
    mkdir -p "$workspace" || return
    rsync -a --delete \
      --exclude node_modules \
      --exclude .expo \
      --exclude .git \
      "$template/" "$workspace/" || return

    if [[ ! -e "$workspace/node_modules" ]]; then
      if [[ -d "$template/node_modules" ]]; then
        ln -s "$template/node_modules" "$workspace/node_modules" || return
      else
        print "slouch: installing demo dependencies (first run only)"
        npm --prefix "$workspace" install || return
      fi
    fi

    rm -rf "$workspace/.git"
    git -C "$workspace" init -q -b main || return
    git -C "$workspace" add -A || return
    git -C "$workspace" \
      -c user.name=Slouch \
      -c user.email=slouch@local \
      commit -q -m "Slouch demo baseline" || return
    print "slouch: demo reset to the tracked template"
  elif [[ ! -d "$workspace/.git" ]]; then
    git -C "$workspace" init -q -b main || return
    git -C "$workspace" add -A || return
    git -C "$workspace" \
      -c user.name=Slouch \
      -c user.email=slouch@local \
      commit -q -m "Slouch demo baseline" || return
  fi

  # Replace sessions created by older Slouch versions that ran the tracked
  # template directly. When invoked inside that session, rename it first so the
  # new one can start before the old shell is removed.
  local legacy_session="" session_path=""
  if tmux has-session -t slouch-demo 2>/dev/null; then
    session_path="$(tmux display-message -p -t slouch-demo:metro '#{pane_current_path}' 2>/dev/null)"
    if [[ "$session_path" != "$workspace" ]]; then
      if [[ -n "$TMUX" ]]; then
        legacy_session="slouch-demo-legacy-${EPOCHSECONDS}"
        tmux rename-session -t slouch-demo "$legacy_session" || return
      else
        tmux kill-session -t slouch-demo || return
      fi
    fi
  fi

  cd "$workspace" || return
  if (( tunnel )); then
    _slouch_start --tunnel slouch-demo
  else
    _slouch_start slouch-demo
  fi

  [[ -n "$legacy_session" ]] && print "slouch: previous demo session kept as $legacy_session"
  return 0
}

# Restart just the Metro window of an existing session (e.g. after changing
# metro.config.js or adding deps). Add --tunnel for cellular/off-LAN.
_slouch_restart() {
  emulate -L zsh

  local tunnel=0 name="" arg
  for arg in "$@"; do
    case "$arg" in
      --tunnel) tunnel=1 ;;
      *)        name="$arg" ;;
    esac
  done
  name="$(_slouch_session_name "$name")"

  if ! tmux has-session -t "$name" 2>/dev/null; then
    print -u2 "slouch: no session '$name' — use 'slouch start' or 'slouch demo'"
    return 1
  fi

  local metro_env="SLOUCH_SESSION=$name"
  local model="${SLOUCH_WHISPER_MODEL:-$HOME/.cache/whisper/ggml-base.en.bin}"
  [[ -f "$model" ]] && metro_env="$metro_env SLOUCH_WHISPER_MODEL=$model"

  local metro="$metro_env npx expo start --clear"
  (( tunnel )) && metro="$metro_env npx expo start --tunnel --clear"

  tmux send-keys -t "$name:metro" C-c
  sleep 1
  tmux send-keys -t "$name:metro" "$metro" C-m
  print "slouch: restarting Metro in '$name' (window 0)"
}

_slouch_doctor() {
  emulate -L zsh

  local tunnel=0 name="" arg
  for arg in "$@"; do
    case "$arg" in
      --tunnel) tunnel=1 ;;
      *)        name="$arg" ;;
    esac
  done
  name="$(_slouch_session_name "$name")"

  print "Slouch doctor"
  print "cwd   $PWD"
  print "sess  $name"
  print

  local cmd missing=0
  for cmd in tmux mosh caffeinate node npx; do
    if command -v "$cmd" >/dev/null 2>&1; then
      _slouch_ok "$cmd installed"
    else
      _slouch_fail "$cmd missing"
      missing=1
    fi
  done

  if command -v tailscale >/dev/null 2>&1; then
    _slouch_ok "tailscale installed"
    if tailscale status >/dev/null 2>&1; then
      _slouch_ok "tailscale running"
    else
      _slouch_warn "tailscale installed but not connected"
    fi
  else
    _slouch_warn "tailscale missing; bus/cellular SSH will be harder"
  fi

  if _slouch_has_expo_config; then
    _slouch_ok "Expo config found"
  else
    _slouch_warn "no app.json/app.config.* here"
  fi

  if command -v tmux >/dev/null 2>&1; then
    if tmux has-session -t "$name" 2>/dev/null; then
      _slouch_ok "tmux session '$name' running"
      if tmux list-windows -t "$name" -F '#W' | grep -q '^metro$'; then
        _slouch_ok "metro window exists"
      else
        _slouch_warn "no metro tmux window in '$name'"
      fi
      if tmux list-windows -t "$name" -F '#W' | grep -q '^awake$'; then
        _slouch_ok "awake window exists"
      else
        _slouch_warn "no awake tmux window in '$name'"
      fi
    else
      _slouch_warn "tmux session '$name' not running; use 'slouch start'"
    fi
  fi

  local found_agent=0
  for cmd in claude codex aider cursor opencode gemini copilot; do
    if pgrep -x "$cmd" >/dev/null 2>&1 || pgrep -f "$cmd" >/dev/null 2>&1; then
      _slouch_ok "agent process detected: $cmd"
      found_agent=1
    fi
  done
  (( found_agent )) || _slouch_warn "no known agent process detected"

  if pgrep -f "expo start" >/dev/null 2>&1 || pgrep -f "@expo/cli" >/dev/null 2>&1; then
    _slouch_ok "Expo/Metro process detected"
  else
    _slouch_warn "Expo/Metro process not detected"
  fi

  print
  if command -v pmset >/dev/null 2>&1; then
    local source
    source="$(pmset -g batt 2>/dev/null | head -n 1 | sed 's/^Now drawing from //')"
    [[ -n "$source" ]] && _slouch_info "power source: $source"

    if pmset -g assertions 2>/dev/null | grep -q "NoIdleSleepAssertion.*1"; then
      _slouch_ok "active no-idle-sleep assertion"
    else
      _slouch_warn "no active no-idle-sleep assertion; use 'slouch awake'"
    fi

    if pmset -g assertions 2>/dev/null | grep -qi "caffeinate"; then
      _slouch_ok "caffeinate assertion visible"
    else
      _slouch_warn "no caffeinate assertion visible"
    fi
  else
    _slouch_warn "pmset unavailable; cannot inspect Mac sleep state"
  fi

  print
  if (( tunnel )); then
    _slouch_info "tunnel requested; use 'slouch start --tunnel' for cellular preview"
  else
    _slouch_info "LAN mode; use 'slouch start --tunnel' before bus/cellular sessions"
  fi

  return "$missing"
}

slouch() {
  emulate -L zsh

  local subcommand="$1"
  shift || true

  case "$subcommand" in
    ""|start) _slouch_start "$@" ;;
    demo) _slouch_demo "$@" ;;
    restart) _slouch_restart "$@" ;;
    init) _slouch_init "$@" ;;
    awake) _slouch_awake "$@" ;;
    doctor) _slouch_doctor "$@" ;;
    help|-h|--help)
      print "usage: slouch <command>"
      print
      print "commands:"
      print "  start [--tunnel] [name]  boot/attach the Expo tmux session"
      print "  demo [--tunnel] [--reset] boot/attach a private demo workspace"
      print "  restart [--tunnel]       restart the Metro window of a session"
      print "  init                     install Expo agent rules"
      print "  awake [--for seconds]    keep Mac awake while display may sleep"
      print "  doctor [--tunnel] [name] check the phone-driven dev loop"
      ;;
    *)
      print -u2 "slouch: unknown command '$subcommand'"
      print -u2 "try: slouch help"
      return 1
      ;;
  esac
}

expo-dev() {
  emulate -L zsh

  if [[ "$1" == "init" ]]; then
    shift
    slouch init "$@"
  else
    slouch start "$@"
  fi
}
