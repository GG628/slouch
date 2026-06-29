# Slouch Demo

A tiny Expo app for testing the Slouch phone-driven development loop.

Use this before pointing Slouch at a real app with auth, API calls, native config,
or messy working-tree state.

## Run the demo

The files in this directory are the tracked template. Run Slouch from anywhere
to create and use a private working copy at `~/.slouch/demo-workspace`:

```bash
slouch demo
```

Use a tunnel away from the Mac's network, or reset the working copy to discard
all demo experiments:

```bash
slouch demo --tunnel
slouch demo --reset
```

Only run `npm start` from this template directory when developing the demo
infrastructure itself. Ordinary prompts should target the private working copy.

From your phone terminal:

```bash
tmux attach -t slouch-demo
```

Open Expo Go on the same phone, connect to the project, then ask an agent for a
small visible JS-only change. For example:

```text
Change the hero title to "Sofa mode works" and make the main button blue.
Keep it JS/TS only.
```

## Overlay bridge

The demo app includes the Slouch overlay: a small bottom status pill inside Expo
Go that expands into a focused chat sheet. The bridge is built into Metro via
`metro.config.js`, which exposes `/slouch/prompt`
on the same host/port as the bundler and forwards each prompt to the agent's tmux
window with `tmux send-keys`.

Because it rides Metro's own connection, it works over both LAN and `--tunnel`
(cellular) with no extra port or process. The app auto-derives the bridge URL from
the Metro connection. Raw terminal and connection details are collapsed under
**Activity** instead of occupying the conversation.

`slouch start`/`slouch demo` export `SLOUCH_SESSION` so the middleware types into
the right tmux session (`<session>:claude`). To point at a different window, set
`SLOUCH_AGENT_WINDOW` (e.g. `codex`). You can also override the whole URL with
`EXPO_PUBLIC_SLOUCH_BRIDGE_URL`.

## Architecture: the overlay is infrastructure, not app code

The overlay does **not** live in `App.tsx`. It's mounted at the root so it floats
over your app and survives edits the agent makes:

- `index.js` — entry point (`"main"` in `package.json`). Registers `SlouchRoot`
  instead of `App`.
- `slouch/SlouchRoot.tsx` — wraps your `App` in an error boundary and renders
  `SlouchOverlay` as a sibling on top (dev-only, via `__DEV__`).
- `slouch/SlouchOverlay.tsx` — the status pill, focused chat sheet, bridge client, and dictation.
- `App.tsx` — just your app. Edit it freely; the overlay can't be broken by it.

A **runtime** error in `App.tsx` is caught by the boundary (you get a recovery panel
and the overlay stays usable). A **syntax** error still red-screens the whole
Metro bundle — recover from the agent window in that case.

Your in-progress prompt is persisted to disk (`expo-file-system`) and rehydrated on
load, so a **full reload** doesn't lose what you were typing. It survives the
constant edit-reloads, just not a syntax-error red-screen.

## Dictation (voice prompts)

The mic button records in Expo Go (`expo-audio`), sends the audio to the bridge's
`/slouch/transcribe` endpoint, and drops the transcript into the prompt box. The app
side needs nothing extra; the **Mac** needs a transcriber. Two options:

```bash
# Option 1 — local whisper.cpp (no account, ~150MB model download)
brew install whisper-cpp ffmpeg
# download a model, e.g. base.en, then point Slouch at it:
export SLOUCH_WHISPER_MODEL=/path/to/ggml-base.en.bin
```

```bash
# Option 2 — any engine of your choice. Audio path is in $SLOUCH_AUDIO,
# transcript is read from stdout:
export SLOUCH_TRANSCRIBE_CMD='your-stt-cli "$SLOUCH_AUDIO"'
```

Set the variable in the shell that launches Metro (so the bridge inherits it). With
neither set, the mic still records but the bridge returns a "needs setup" message.

## In-app chat

Tap the bottom Slouch pill to open one focused conversation. Your prompts remain
the primary content. Slouch turns recognizable agent events into a short lifecycle
such as **Thinking**, **Reading App.tsx**, and **Editing App.tsx**, then collapses
the deduplicated steps under **Activity**. Raw `tmux capture-pane` output and the
bridge address sit one level deeper under **Technical details**.

Slouch intentionally does not present captured terminal text as an assistant
message. The current tmux bridge has no structured final-response event, so the
honest result is the app changing through Fast Refresh. A structured agent transport
could add real assistant messages later without making terminal noise the product.

Note: the bridge runs `tmux` and `git` commands on your Mac with no auth, reachable
by anyone who has your tunnel URL. That's fine for your own private tunnel; don't
share the URL. PR creation is intentionally not wired up (it's an outward-facing
action — do that from the terminal for now).
