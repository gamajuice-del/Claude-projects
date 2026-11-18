# Roblox (or any Windows game) on a 2x T4 machine, played in your browser

The official Roblox client on a Windows machine with two NVIDIA T4s: the game renders on T4 #0, T4 #1 encodes
the video (NVENC), and ShellStream streams the whole desktop to your browser. You install Roblox, sign in and
join games online exactly as on a PC. Looking around with the mouse is predicted in the browser, so it responds
locally; everything else takes one network round trip.

## Why not on Kaggle

* Roblox has no Linux client, and Kaggle kernels are Linux containers without a display server or GPU graphics
  driver to run a game with.
* Running a game service on Kaggle falls under the "activity unrelated to ML data science" that Kaggle's
  Acceptable Use Policy is quoted as prohibiting. The Kaggle notebook stays a research benchmark.
* A machine with the same two T4s that you rent and control has neither problem. Google Cloud lets you attach
  two T4s to one VM. AWS and Azure offer T4 machines with one or four.

## What works

| | |
|---|---|
| Whole desktop | Install, sign in, menus, chat, the Roblox app, any Windows program |
| Mouse | Captured mouse in game: relative counts, mouse-look **predicted locally**. Menus: a pointer drawn in your browser at display rate, absolute positions sent to the game. Uncaptured: plain clicks work too |
| Keyboard | Every key, sent as a hardware scan code. In fullscreen, Esc, Alt+Tab and the Windows key go to the game as well (keyboard lock; hold Esc to leave) |
| Audio | Game sound captured from the default output (WASAPI loopback), Opus at 128 kbit/s, about 90 ms of jitter buffer |
| Frame rate | 60 fps by default (`-Fps` in the setup script), 1080p at about 12 Mbit/s; NVENC on T4 #1 |
| Security | HTTPS (self-signed; browsers decode H.264/Opus only on HTTPS or localhost) and an access token |

## Steps

1. **Create the machine.** A Windows image with two T4s and NVIDIA's display driver for them, e.g. the
   GRID / virtual-workstation driver your cloud documents for T4s. Without it the T4 is only a compute device and
   Windows renders with its basic display adapter. Set the desktop to 1920x1080. Check that the Roblox client
   installs on the image you choose.
2. **Copy ShellStream** to the machine (`git clone`, or copy the `shellstream` folder).
3. **Run the setup** in an elevated PowerShell:
   `powershell -ExecutionPolicy Bypass -File shellstream\windows\setup.ps1`.
   It installs Python and the packages, turns off pointer acceleration, enables the audio service, opens the
   port, creates an access token and starts ShellStream at every logon. Also open the port (8765) in your cloud
   firewall.
4. **Log off and on again** (Remote Desktop), then open the printed `https://<public IP>:8765/?token=...` on your
   own computer. Accept the certificate once (compare the SHA-256 fingerprint with the server output). Click to
   start.
5. **Install Roblox** from roblox.com in the streamed desktop, sign in, pick a game, press Play.
6. **Before closing Remote Desktop**, run "Leave RDP, keep streaming" from the desktop as administrator. A
   disconnected Remote Desktop session is locked and can't be captured. The batch file hands the session to the
   console instead.

## Playing

| | |
|---|---|
| Click the stream | capture the mouse (mouse-look) |
| Esc | with the mouse captured: release it (browser rule). Otherwise, or in fullscreen: Esc for the game |
| Fullscreen button | fullscreen with keyboard lock |
| Alt+P | mouse-look prediction on/off |
| Alt+L | pointer mode: automatic / always look / always pointer (for games that hide the pointer in menus) |

Prediction helps most in first person and with Shift Lock. Roblox's default third-person camera orbits around
the character; the online fit sees that as a poor linear model and turns prediction off by itself. The stream
is unaffected.

## When something's wrong

* **The server says `libx264` instead of `h264_nvenc`.** The driver exposes no NVENC to FFmpeg. Check the
  NVIDIA driver; x264 works but costs CPU and frame rate.
* **Black or frozen picture.** The session is locked or disconnected; see step 6.
* **No sound.** Many cloud VMs have no audio device. Install a virtual one (e.g. VB-Audio's VB-CABLE), make it the
  default output, restart ShellStream.
* **The camera turns too much or too little at first.** The calibrator learns pixels per count from your first
  seconds of looking around; give it a few seconds in a bright, textured scene.

## What was tested, and what wasn't

Tested in the development environment (Linux, no GPU, `bench/host_full.py` and `tests/test_host_win.py`):

* the whole browser path against an unmodified game (Minetest): token rejection, HTTPS with a self-signed
  certificate giving a secure context (WebCodecs), automatic switching between mouse-look and pointer mode,
  clicking a menu button through the absolute pointer, audio arriving and playing;
* the Windows backend's input records (structure layout, scan codes, absolute coordinates on a multi-monitor
  desktop, buttons, wheel) and pointer-state logic, with a simulated `user32`.

Not tested, because there was no Windows machine, GPU or Roblox account here: the Windows backend against real
Windows APIs, DXGI capture, WASAPI loopback, NVENC on Windows, this setup script (reviewed by hand, never run or
parsed), and Roblox itself. Roblox's anti-cheat may treat injected input or virtual machines differently from a
desk PC; if it ignores injected input, a virtual HID driver would be needed (not built). Roblox's terms of use
apply as on any PC.
