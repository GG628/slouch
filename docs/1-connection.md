# 1. Connection — the reliable phone → Mac transport

This is the part that kills the "wiggle the mouse / re-enter the passcode" loop.
The trick is **Mosh**, not plain SSH: Mosh keeps your session alive across phone
sleep and Wi-Fi/cellular changes, so you reconnect to the exact same tmux state.

## On the Mac (one-time)

1. **Enable Remote Login (SSH):**
   System Settings → General → Sharing → turn on **Remote Login**. Note the
   username and the Mac's address shown there (e.g. `george@georges-mbp.local`).

2. **Install tmux and mosh:**
   ```bash
   brew install tmux mosh
   ```

3. **Keep the Mac awake while you're away.** `slouch start` already starts
   `slouch awake` in its `awake` window, which blocks idle system sleep while
   allowing the display to sleep.
   Caveat: on battery, **closing the lid still sleeps** the Mac — keep the lid open
   (and ideally plugged in) for sofa/bus sessions.

## On the phone (one-time)

1. Install **[Blink Shell](https://blink.sh)** (best Mosh support on iOS) or
   **Termius**.
2. Add a host pointing at your Mac (the address from step 1 above), with your
   Mac username. SSH keys are nicer than passwords — Blink can generate one and you
   add its public key to `~/.ssh/authorized_keys` on the Mac.
3. Connect with **Mosh**, not SSH:
   ```
   mosh george@georges-mbp.local
   ```

## The loop, on the sofa

1. On the Mac (or over the phone, once connected), in your project:
   ```bash
   slouch doctor
   slouch start
   ```
2. On the phone, in Blink:
   ```bash
   mosh george@georges-mbp.local
   tmux attach -t <project-name>      # name = your project folder
   ```
   Switch agent/Metro windows with `Ctrl-b n` / `Ctrl-b p` (or `Ctrl-b <number>`).
3. Swipe to **Expo Go** to watch the app hot-reload. Swipe back to prompt again.

> Tip: set the phone's Auto-Lock longer (Settings → Display & Brightness →
> Auto-Lock) so you're not unlocking constantly — but with Mosh you no longer
> *lose the session* when it does lock.
