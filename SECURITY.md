# Security Policy

Codex LAN Companion is intended for trusted local networks only. Do not expose it to the public internet.

## Supported Versions

The first public release is `0.1.x`.

## Reporting Issues

If you find a security issue, please do not post sensitive details publicly. Open a minimal report with reproduction context and avoid including private Codex conversation data, account information, access codes, screenshots of QR codes, or local auth files.

## Local Data Exposure

When running, this service can expose local Codex conversation titles, messages, tool output, project paths, account display information, and local usage summaries to browsers that can reach the service and pass access-code authentication.

Recommended defaults:

- Keep access-code authentication enabled.
- Keep read-only mode unless web input is needed.
- Do not share terminal screenshots, QR codes, or fixed access codes with untrusted people.
- Do not bind or proxy this service to the public internet.

## Compatibility Risk

This project depends on Codex Desktop local files and private IPC behavior. These are not public compatibility contracts. Future Codex Desktop versions may break or change behavior in ways that affect security, sync, or write-mode controls.
