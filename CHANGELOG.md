# Changelog

## Unreleased

- Support comma-separated bind addresses so LAN access and an existing Tailscale Serve proxy can coexist; stop startup on any bind failure and close all listeners during shutdown.
- Decode native generated-image tool output, recover image records split at tail-read boundaries, and merge images into their matching replies without dropping standalone images.
- Display uncropped image previews with original-image dialogs; load existing generated files separately and reject local-image symlink escapes.
- Hide developer/system instructions and source-tagged injected context without filtering user-authored rule text or actionable notices.
- Adapt to installed Desktop IPC versions and share concurrent connection attempts.
- Hide internal Guardian review chats and automatic approval-review records.
- Expand bounded tail scans when tool-heavy conversations contain too few visible messages.
- Read plan usage backwards in bounded chunks and stop old timestamps from keeping finished turns active.
- Recover Desktop-owned sends after owner discovery or IPC reconnection; report missing threads with structured errors.
- Send text steering through Desktop's follower interface and keep steering failures on the Desktop path.
- Document recent-message limits and add regression tests for sync, steering, and thread visibility.

## 0.1.0

Initial public release.

- View Codex Desktop conversations from another device on the same LAN.
- Mobile-friendly conversation list, drawer behavior, and message view.
- Near-real-time conversation refresh with thinking/status indicators.
- Writable by default for sending messages from the web UI to Codex Desktop, with optional `--readonly` mode.
- Plugin picker, skill picker, image attachments, interruption support, and approval display where detectable.
- Account and local plan-usage display when available from Codex local state.
- Short 6-digit access code and terminal QR sign-in for local browser access.
- Documentation screenshots for desktop and mobile browser UI.
- macOS LaunchAgent install/uninstall commands for running the companion as a background service.
- Clear fatal startup logs for port conflicts, permission errors, uncaught exceptions, and unhandled promise rejections.

Compatibility note: this release was verified only with Codex Desktop `26.601.21317` on macOS. Codex Desktop local storage and IPC are private implementation details and may change in future builds.
