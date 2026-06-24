---
description: Reference for the Slouch phone-driven Expo dev loop - how to launch it and what each tmux window does.
---

You are helping with **Slouch**: vibe-coding an Expo app from a phone with a
live Expo Go preview. Apply the `expo-live-reload` skill rules to all edits in this
project.

When the user asks how to start or use the loop, give them this, adapted to their
project:

**Launch (on the Mac, in the project root):**
```bash
slouch doctor          # check the loop before leaving the Mac alone
slouch start           # LAN / same Wi-Fi
slouch start --tunnel  # cellular / off-network
```
This opens one tmux session named after the project, with windows:
`metro` (Expo dev server) · `claude` · `codex` (if installed) · `shell` · `awake`
(`slouch awake` keeping the Mac awake while the display may sleep).

**From the phone:** connect with Blink + Mosh, `tmux attach -t <project>`, switch
windows with `Ctrl-b n`, and swipe to Expo Go to watch changes hot-reload.

Then proceed with whatever edit the user requested, following the live-reload
contract (prefer JS/TS; flag anything needing a native rebuild; never restart Metro).
