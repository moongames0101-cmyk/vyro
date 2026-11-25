<div align="center">
  <img src="assets/icon-192.png" width="110" height="110" alt="VYRO Logo" />
  <h1>VYRO</h1>
  <p><strong>Where Discord Servers &amp; Voice Lounges Meet Snapchat Snaps, Streaks &amp; 24h Stories.</strong></p>
</div>

---

## Features

- **Full Login & 3-Step Sign Up Portal (`#/login`, `#/signup`, `#/reset`, `#/download`)**
  - Log in with email, username, or `username#tag`, password visibility toggle, password recovery, and 1-click Demo Account switcher.
  - 3-Step Registration: Live username availability check, password strength meter, Discord-style `#discriminator` generator, birthday check, and interactive **Bitmoji-style SVG Avatar Builder** (or custom photo upload).
- **Discord Features**
  - Server rail, create/join servers via invite codes (`VYROHQ`, `OWLS24`), Text channels, **⚡ Ephemeral Flash Snap Rooms**, and **🔊 Voice & Stage Lounges** with live occupant & mute/deafen/camera indicators.
  - Inline replies, emoji reactions, message pinning, member roles & profile inspector.
- **Snapchat Features**
  - **Snap Studio**: Live webcam + CSS/Canvas filters (`Neon`, `Gold`, `Noir`, `Cyber`) OR freehand Doodle Canvas, emoji stickers, draggable caption banner, and timed delivery (`3s`, `6s`, `10s`, `∞ Keep`).
  - **Timed Snap Viewer**: Animated countdown bar, 1x Replay, **Save in Chat** highlight, and **Screenshot Alert** notifications.
  - **24h Stories Bar**: Multi-segment viewer, view counts, and direct Story replies.
  - **Snap Score & Daily Streaks (`🔥`)**.
- **Cross-Platform: Windows `.exe` + Mobile PWA + GitHub Auto-Updates**
  - Built-in **Mobile QR Connect** modal so phones on the same Wi-Fi can scan and install VYRO as a Mobile PWA.
  - Configurable **Server Switcher** so desktop `.exe` and mobile clients can connect to a single hosted server (`Dockerfile` / `render.yaml` included).
  - Automated **GitHub Actions** workflow (`.github/workflows/release.yml`) builds `VYRO-Setup.exe` & `VYRO-Portable.exe` with the VYRO logo and publishes `latest.yml` to **GitHub Releases** for automatic desktop updates via `electron-updater`.

---

## Quick Start (Web & Mobile Local Server)

Requires Node.js 24+ (zero npm installs needed just to run the web/mobile server):

```bash
node server/index.js
```

Open `http://localhost:3847` on PC, or click **Mobile QR** inside VYRO to scan and open on your phone!

---

## Building the Windows `.exe` Locally

```bash
npm install
npm run build:exe
```

Outputs appear in `dist/`:
- `dist/VYRO-Setup-1.0.0.exe` (Windows Installer with Start Menu & Desktop shortcut)
- `dist/VYRO-1.0.0-Portable.exe` (Single portable `.exe` — no installation needed)

---

## Publishing on GitHub (So People Download `.exe` & Get Auto-Updates)

1. Create a GitHub repository (for example, `YOUR_USERNAME/vyro`) and push this project.
2. Push a version tag to trigger the automated Windows `.exe` build & GitHub Release:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. GitHub Actions (`.github/workflows/release.yml`) automatically:
   - Runs the test suite (`npm test`)
   - Syncs your `owner/repo` into `package.json` and `vyro.config.json`
   - Builds `VYRO-Setup-<version>.exe`, `VYRO-<version>-Portable.exe`, and `latest.yml`
   - Creates a **GitHub Release** where users can download VYRO and automatically receive future updates!

---

## Running Tests

```bash
npm test
```
