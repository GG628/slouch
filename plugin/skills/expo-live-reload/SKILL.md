---
name: expo-live-reload
description: Rules for editing an Expo (SDK 55, expo-router) project that is being previewed live in Expo Go on a phone. Use whenever changing files in an Expo app so Fast Refresh keeps working and any change that needs a native rebuild is flagged before it breaks the preview.
---

# Expo live-reload contract

This Expo project is edited **live from a phone**: changes you make hot-reload in
Expo Go on the same device. Protect that loop.

## Prefer JS/TS-only changes
They Fast Refresh instantly in Expo Go. This is the whole point — keep edits inside
the JS/TS layer whenever the task allows.

## Stop and flag native-rebuild changes
These silently break the live preview and require a brand-new dev build. Before
making any of them, **say so explicitly and confirm with the user first**:

- adding/removing a native module, or any dependency that ships native code
- editing `app.json` / `app.config.*`, config plugins, `Info.plist`, entitlements
- touching the `android/` or `ios/` directories
- changing the URL scheme, bundle id, or native permissions
- bumping the Expo SDK version

## Never touch Metro
Do not start, stop, or restart the Metro bundler — it runs in a separate window.
Just edit files; Fast Refresh delivers the change.

## Phone-friendly working style
- Small, incremental edits so reloads stay fast and diffs are readable on a phone.
- After each change, state in one line what should now look/behave differently on
  screen, so it can be verified at a glance.
- Keep diffs focused; no sweeping refactors unless asked.
