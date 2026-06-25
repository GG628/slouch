# Slouch demo — agent rules

This app is driven live from a phone via the Slouch overlay. Follow the global
live-reload contract (JS/TS-only changes, never restart Metro, flag native
rebuilds).

## Do not touch the overlay infrastructure

These files are Slouch plumbing, **not** app code. Never edit them in response to a
user's app request — editing them can break the very overlay the user is typing
into:

- `index.js` (entry point)
- `slouch/` (`SlouchRoot.tsx`, `SlouchOverlay.tsx`)

When asked to change "the app", edit `App.tsx` (and any new app files you create).
The overlay floats on top regardless and must keep working.
