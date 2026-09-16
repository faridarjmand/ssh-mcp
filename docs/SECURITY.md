# Security model

SSH Nexus controls access to infrastructure. Treat the process and every connected MCP client as privileged local software.

## Defaults

- Dashboard binds to `127.0.0.1`.
- A non-loopback bind fails at startup unless `SSH_NEXUS_TOKEN` is set.
- SSH aliases come from a server-side allowlist derived from the config; browser input cannot select arbitrary destinations or SSH options.
- Child processes use argument arrays instead of shell interpolation for destinations.
- Automatic metrics run one fixed read-only script with `BatchMode=yes` and a timeout.
- Dashboard SSH config writes are disabled unless `ALLOW_SSH_CONFIG_WRITES=true`, and enabling them requires a bearer token even on loopback.
- The source SSH config remains read-only; structured changes go to a separate regular file with mode `0600` and an atomic backup.
- Arbitrary MCP commands are disabled unless `ALLOW_REMOTE_COMMANDS=true`.
- The project index stays under an allowed root and excludes symlinks and secret-like files.
- Common browser hardening headers and origin checks protect the terminal upgrade.

## Credentials

Private keys, passphrases, SSH-agent sockets, and SSH configuration contents are never sent to the browser. The browser sees effective connection metadata such as alias, host, user, port, and proxy-jump name. MCP clients receive the same inventory, so connect only trusted clients.

OpenSSH may invoke configured helpers such as `ProxyCommand`, `Match exec`, security-key providers, or password managers. Review `~/.ssh/config` before giving this process access to it.

## Interactive terminal

The WebSocket forwards keystrokes and terminal output. It does not record sessions. Browser extensions, reverse proxies, and anyone holding the bearer token may still observe or initiate sessions; keep the dashboard local.

## Managed SSH entries

The editor accepts only a safe alias, hostname/IP, optional user, numeric port, and `ProxyJump` aliases already present in the server-side inventory. It rejects whitespace/control-character injection, unknown SSH directives, duplicate entries, and symlink-backed managed files.

Edits never rewrite `SSH_NEXUS_CONFIG`. They atomically replace `SSH_NEXUS_MANAGED_CONFIG` and preserve the previous version beside it with a `.bak` suffix. A generated process-local wrapper loads managed entries before the source config so an override can inherit options such as `IdentityFile` without revealing them to the browser.

Docker mounts `${HOME}/.ssh` read-only and stores the managed file in a separate named volume. Disabling the write gate makes the managed write endpoint return `403`.

## Project index

The generated JSON stores metadata and SHA-256 hashes, not content. The search tool reads current text files and returns matching line previews to the caller. Do not add a secret directory to `PROJECT_ROOTS`.

## Remote command opt-in

`ALLOW_REMOTE_COMMANDS=true` lets an AI client supply arbitrary command text to remote SSH. MCP annotations mark the tool as non-read-only and destructive, but client behavior varies. Use approval prompts and least-privilege remote accounts.

## Reporting a vulnerability

Do not open a public issue containing hostnames, SSH output, tokens, or configuration. Use a private GitHub security advisory for the repository.
