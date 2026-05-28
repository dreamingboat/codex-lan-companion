# Codex LAN Companion

Codex LAN Companion is a small self-hosted web service for viewing Codex Desktop conversations from another device on the same LAN. It is designed for local/home-network use: start it on your Mac, scan the terminal QR code, and open the companion UI from your phone browser.

This is an unofficial tool. It reads local Codex Desktop state and uses local Codex Desktop IPC only when write mode is explicitly enabled.

## Features

- LAN browser UI for Codex Desktop conversations
- Mobile-friendly conversation list and message view
- Live-ish sync, including an active "thinking" indicator
- Account and local plan-usage summary when available from Codex local state
- Token-protected API by default
- Friendly access-code prompt in the browser
- Read-only by default
- Optional `--write` mode for sending messages back to Codex Desktop
- Terminal QR code for quick phone access

## Install

From a cloned repo:

```bash
npm install
npm start
```

As an npm package after publishing:

```bash
npx codex-lan-companion
```

or:

```bash
npm install -g codex-lan-companion
codex-lan-companion
```

## Usage

Default mode is read-only and token-protected:

```bash
codex-lan-companion
```

The terminal prints local and LAN URLs like:

```text
Codex LAN Companion is running
Local:  http://127.0.0.1:8787/
LAN:    http://10.0.0.131:8787/
Access code: 7f3a91c2
Mode:   read-only · token protected
```

Open the LAN URL from a phone or tablet on the same Wi-Fi. The browser asks for the access code once, stores it locally, and uses it for later API requests.

Enable web-to-Codex input:

```bash
codex-lan-companion --write
```

Choose a port or fixed token:

```bash
codex-lan-companion --port 8790 --password home-only
```

Disable auth only on a trusted local network:

```bash
codex-lan-companion --no-auth
```

## Options

```text
--host <host>          Bind host. Default: 0.0.0.0
--port <port>          Bind port. Default: 8787
--password <password>  Friendly access code. Default: generated per launch
--token <token>        Alias for --password
--write                Enable sending messages to Codex Desktop
--readonly             Force read-only mode. Default
--no-auth              Disable access token guard
--codex-home <path>    Codex data directory. Default: ~/.codex
--ipc-socket <path>    Codex Desktop IPC socket override
-h, --help             Show help
```

Environment variables are also supported:

```bash
PORT=8790 HOST=0.0.0.0 CODEX_LAN_PASSWORD=home-only CODEX_LAN_ALLOW_WRITE=1 codex-lan-companion
```

## Requirements

- macOS
- Codex Desktop installed and logged in
- Node.js 18+
- Phone and Mac on the same LAN
- `sqlite3` available on the Mac

Write mode additionally requires Codex Desktop to be running with the target conversation available to the desktop app.

## Data Sources

- Conversation list: `$CODEX_HOME/state_5.sqlite`
- Conversation content: `$CODEX_HOME/sessions/**/rollout-*.jsonl`
- Optional account display: `$CODEX_HOME/auth.json`, decoded locally without returning tokens
- Optional send support: Codex Desktop local IPC socket

The server never returns Codex auth tokens to the browser.

## Security Notes

This service exposes local Codex conversation titles, messages, tool output, project paths, and account display information to anyone who can access the URL and token. Use it only on networks you trust.

Recommended defaults:

- Keep token auth enabled.
- Keep read-only mode unless you need phone input.
- Do not expose the port to the public internet.
- Use a fixed access code only if you can keep it private.

## Stability Notes

This project depends on Codex Desktop local files and private IPC behavior. Those are not public compatibility contracts and may change in future Codex releases.

## Trademark Note

This is an unofficial companion project and is not affiliated with OpenAI. The bundled UI mark is original project artwork, not an OpenAI or Codex app icon.
