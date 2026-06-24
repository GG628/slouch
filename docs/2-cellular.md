# 2. Cellular — coding from the bus

Two things need to reach across the internet when you leave the house:
the **terminal** (phone → agent) and the **Metro bundler** (phone → live preview).

## Terminal over cellular: Tailscale

[Tailscale](https://tailscale.com) is a free, zero-config mesh VPN. It gives your
Mac and phone stable private addresses that work anywhere.

1. Install Tailscale on the **Mac** and the **phone**, sign into the same account.
2. Find the Mac's Tailscale address (the Tailscale app shows it, e.g. `100.x.y.z`
   or its MagicDNS name like `georges-mbp`).
3. From Blink, connect to that address instead of the LAN one:
   ```bash
   mosh george@georges-mbp        # MagicDNS name, works on cellular
   tmux attach -t <project-name>
   ```

Mosh + Tailscale together mean you can walk out of the house mid-session, switch
from Wi-Fi to LTE, lock the phone, and pick up exactly where you were.

## Live preview over cellular: `--tunnel`

On LAN, Expo Go reaches Metro directly. Off-LAN you need a tunnel so the phone can
reach the bundler:

```bash
slouch start --tunnel
```

This starts Metro with `npx expo start --tunnel`, which exposes a public proxy URL
Expo Go can load from anywhere. Open that project in Expo Go as usual; Fast Refresh
still works, just over the tunnel.

## Checklist before you leave the house

- [ ] Mac plugged in, **lid open**, `slouch start --tunnel` running (the `awake`
      window keeps it from sleeping).
- [ ] Tailscale up on Mac and phone.
- [ ] Test `mosh ... && tmux attach` once on Wi-Fi so the session is live.
- [ ] Project already open in Expo Go.

Then leave. On the bus: Blink to prompt, swipe to Expo Go to watch.
