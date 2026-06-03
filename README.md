# Codex LAN Companion

[中文说明](README.zh-CN.md)

Codex LAN Companion is a small self-hosted web service for viewing and lightly controlling Codex Desktop from another device on the same LAN. It is designed for local/home-network use: start it on the Mac that runs Codex Desktop, then open the companion UI from any browser device on the same network: phone, tablet, Windows PC, Linux laptop, smart display, Kindle/e-reader, or anything else with a usable web browser.

This is an unofficial tool. It reads local Codex Desktop state and, by default, can use local Codex Desktop IPC to send messages from the LAN web UI. Start with `--readonly` if you only want to view conversations.

## First Release Notice

This repository is being prepared as the first public release of Codex LAN Companion.

Important compatibility note: this first release was developed and verified only with the latest Codex Desktop available to the author at release time: Codex Desktop `26.527.60818` on macOS, tested on 2026-06-03. Codex Desktop local files and IPC are private implementation details, not public compatibility contracts. Newer Codex Desktop versions may change these interfaces and may partially or completely break this companion. If that happens, update this project against the new Codex Desktop behavior before relying on it.

## Features

- LAN browser UI for Codex Desktop conversations
- Browser-device access across the LAN: macOS, Windows, Linux, phones, tablets, Kindle/e-readers, smart displays, and more
- Mobile-friendly conversation list and message view
- Live-ish sync, including an active "thinking" indicator
- Account and local plan-usage summary when available from Codex local state
- Plugin picker in the composer, including friendly plugin chips
- Skill picker in the composer, including `/` trigger and friendly skill chips
- Image attachments when writable
- Approval and important notice display when detectable from Codex Desktop events
- New conversation creation from the web UI
- Access-code protected API by default
- Friendly access-code prompt in the browser
- Writable by default for sending messages back to Codex Desktop
- Optional `--readonly` mode for view-only use
- Terminal QR code sign-in for browser devices

## Install

### Quick Start For Users

Prerequisites:

1. Install Codex Desktop on your Mac and sign in.
2. Install Node.js 18 or newer.
3. Put your Mac and the browser device you want to use on the same Wi-Fi network.

Run without installing globally:

```bash
npx codex-lan-companion
```

Or install once and then run it:

```bash
npm install -g codex-lan-companion
codex-lan-companion
```

The terminal prints a local URL, a LAN URL, a short numeric access code, and a QR code. Scan the QR code from a phone/tablet to open the LAN web page and sign in automatically, or open the LAN URL manually from any browser device and enter the access code shown in the terminal.

Default mode allows sending messages from the web UI back to Codex Desktop. To view conversations only, start with:

```bash
codex-lan-companion --readonly
```

### From Source

For contributors or local development, clone the repo and run:

```bash
npm install
npm start
```

## Usage

Default mode is writable and access-code protected:

```bash
codex-lan-companion
```

The terminal prints local and LAN URLs like:

```text
Codex LAN Companion is running
Local:  http://127.0.0.1:8787/
LAN:    http://10.0.0.131:8787/
Access code: 482913
Mode:   write enabled · access-code protected
Type:   qr, no-auth, auth, or help + Enter for runtime commands

QR:     opens the LAN page and signs in automatically
```

Open the LAN URL from any browser device on the same Wi-Fi, or scan the terminal QR code from a camera-capable device to open and sign in automatically. When no password is provided, the service generates a short 6-digit numeric code each time it starts. The QR code contains a temporary sign-in URL for the current launch; after the browser opens it, the page removes the login parameter from the address bar. By default the code is kept only in page memory, so reloading or reopening the page asks again. Check "Remember this device" on the login screen if you want the browser to keep it across restarts.

## QR Code Sign-In / 手机扫码登录

Codex LAN Companion prints a QR code in the terminal when it starts. The QR code contains the LAN URL plus a temporary sign-in parameter for the current service launch.

Scan the QR code from a phone, tablet, or other camera-capable device on the same Wi-Fi network to open the web UI and sign in automatically. Devices without a camera can open the LAN URL manually and enter the access code.

If the terminal output has scrolled away, type `qr` in the same terminal and press Enter to print the sign-in QR code again:

```text
qr
```

The QR code is equivalent to the current access code. Do not share terminal screenshots or QR codes with people you do not trust.

## Runtime Terminal Commands

While the service is running in an interactive terminal, you can type these commands and press Enter:

```text
qr       Print the sign-in QR code again
url      Print local and LAN URLs again
code     Print the current access code
no-auth  Disable access-code auth without restarting
auth     Enable access-code auth again and print the current sign-in QR code
help     Show available commands
```

Use view-only mode:

```bash
codex-lan-companion --readonly
```

By default, the web UI can send text, selected plugin or skill mentions, and supported image attachments to Codex Desktop through local Desktop IPC. Codex Desktop should be open and signed in on the Mac running this service. `--readonly` disables sending, interruption, and approval actions from the browser.

Choose a port or fixed token:

```bash
codex-lan-companion --port 8790 --password home-only
```

Use a fixed access code only when you want the same code every time. Otherwise, let the service generate a fresh 6-digit code on each launch.

Disable auth only on a trusted local network:

```bash
codex-lan-companion --no-auth
```

## Options

```text
--host <host>          Bind host. Default: 0.0.0.0
--port <port>          Bind port. Default: 8787
--password <password>  Friendly access code. Default: generated 6-digit code per launch
--token <token>        Alias for --password
--readonly             Disable sending messages to Codex Desktop
--no-auth              Disable access-code guard
--codex-home <path>    Codex data directory. Default: ~/.codex
--ipc-socket <path>    Codex Desktop IPC socket override
-h, --help             Show help
```

Environment variables are also supported:

```bash
PORT=8790 HOST=0.0.0.0 CODEX_LAN_PASSWORD=home-only codex-lan-companion
```

## Requirements

- macOS
- Codex Desktop installed and logged in
- Node.js 18+
- Mac and browser device on the same LAN
- `sqlite3` available on the Mac

Sending from the browser requires Codex Desktop to be running with the target conversation available to the desktop app.

Validated environment for the first release:

- macOS
- Codex Desktop `26.527.60818`
- Node.js 18+

Other environments may work, but have not been verified for this first release.

## Data Sources

- Conversation list: `$CODEX_HOME/state_5.sqlite`
- Conversation content: `$CODEX_HOME/sessions/**/rollout-*.jsonl`
- Optional account display: `$CODEX_HOME/auth.json`, decoded locally without returning tokens
- Optional send support: Codex Desktop local IPC socket
- Optional plugin list: local Codex plugin metadata exposed by the current Codex home

The server never returns Codex auth tokens to the browser.

## Known Limitations

- Compatibility is tied to Codex Desktop local storage and private IPC behavior. Future Codex Desktop updates may break conversation sync, account display, approvals, plugin mentions, sending, or interruption support.
- Sync is near-real-time rather than push-perfect. Conversation data is refreshed frequently, but some Codex Desktop UI-only states may appear with delay or may not be detectable.
- Some Codex Desktop prompts, warnings, or approval states may not be fully actionable from the web UI. Keep Codex Desktop accessible for fallback.
- New conversations created by the web UI may not appear immediately in Codex Desktop's own sidebar; Codex Desktop appears to refresh its list on its own schedule.
- This is intended for trusted LAN use. It is not hardened for public internet exposure.

## Security Notes

This service exposes local Codex conversation titles, messages, tool output, project paths, and account display information to anyone who can access the URL and access code. Use it only on networks you trust.

Recommended defaults:

- Keep access-code auth enabled.
- Use `--readonly` when you only need to view conversations.
- Do not expose the port to the public internet.
- Do not share terminal screenshots or QR codes with people you do not trust.
- Use a fixed access code only if you can keep it private.

## Stability Notes

This project depends on Codex Desktop local files and private IPC behavior. Those are not public compatibility contracts and may change in future Codex releases.

For the first release, the author only verified against Codex Desktop `26.527.60818`, which was the latest available Codex Desktop build at the time of development and testing. There is no guarantee that this project will work with newer Codex Desktop builds without updates.

## Trademark Note

This is an unofficial companion project and is not affiliated with OpenAI. The bundled UI mark is original project artwork, not an OpenAI or Codex app icon.
