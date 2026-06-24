# Slouch Demo

A tiny Expo app for testing the Slouch phone-driven development loop.

Use this before pointing Slouch at a real app with auth, API calls, native config,
or messy working-tree state.

## Run

From this directory:

```bash
source ../../shell/expo-dev.zsh
slouch init
slouch doctor
slouch start
```

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

