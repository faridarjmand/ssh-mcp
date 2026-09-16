# Installation and operations

## 1. Install prerequisites

Confirm Node.js and OpenSSH:

```bash
node --version
npm --version
ssh -V
```

Node must be version 22 or newer. SSH Nexus calls the system OpenSSH client so your existing `IdentityFile`, SSH agent, `ProxyJump`, `ProxyCommand`, host-key policy, and hardware keys continue to work.

## 2. Install the project

```bash
git clone https://github.com/YOUR_USERNAME/ssh-nexus-mcp.git
cd ssh-nexus-mcp
npm install
cp .env.example .env
```

Edit `.env` only when the defaults do not match your machine. This file is ignored by Git.

## 3. Confirm OpenSSH first

SSH Nexus does not replace SSH authentication. Verify each important alias directly:

```bash
ssh production-web
```

Automatic metrics use `BatchMode=yes`, so password/passphrase prompts cannot stall the dashboard. Load a protected key into your SSH agent first:

```bash
ssh-add ~/.ssh/id_ed25519
ssh-add -l
```

## 4. Development mode

```bash
npm run dev
```

- Dashboard: <http://127.0.0.1:5173>
- API and MCP HTTP: <http://127.0.0.1:3100>
- Terminal WebSocket: `ws://127.0.0.1:3100/ws/terminal`

## 5. Production-style local mode

```bash
npm run check
npm start
```

Open <http://127.0.0.1:3100>.

## 6. Enable managed server editing

The editor is opt-in and requires a bearer token, including on loopback:

```bash
export SSH_NEXUS_TOKEN="$(openssl rand -hex 32)"
export ALLOW_SSH_CONFIG_WRITES=true
npm run dev
```

Entries are written to `~/.ssh/ssh-nexus/hosts.conf` by default. Set `SSH_NEXUS_MANAGED_CONFIG` to use another dedicated path. The source `~/.ssh/config` is never rewritten.

## 7. Protect or expose the listener

The default bind is loopback-only. If you deliberately bind to a LAN address, a token is mandatory:

```bash
export SSH_NEXUS_TOKEN="$(openssl rand -hex 32)"
export DASHBOARD_HOST=0.0.0.0
npm start
```

The browser asks for this token and keeps it in `sessionStorage`. For any connection beyond a trusted LAN, place SSH Nexus behind HTTPS and an identity-aware reverse proxy. The built-in bearer token is not a complete internet-facing authentication system.

## 8. Docker Compose

```bash
export SSH_NEXUS_TOKEN="$(openssl rand -hex 32)"
export ALLOW_SSH_CONFIG_WRITES=true
docker compose up --build
```

Open <http://127.0.0.1:3100> and enter the token. Compose keeps `${HOME}/.ssh` read-only and persists dashboard-managed hosts in the `ssh-nexus-data` volume. Leave `ALLOW_SSH_CONFIG_WRITES` unset or `false` for an inventory-only deployment.

## 9. Run MCP over stdio

```bash
npm run build
npm run start:mcp
```

An stdio MCP process waits silently for JSON-RPC on stdin. Its startup message is written to stderr so stdout remains a valid protocol channel.

## 10. Troubleshooting

### A server is red but normal SSH works

- Direct hosts are tested with a TCP connection to the effective `HostName` and `Port`.
- `ProxyJump` hosts are tested with non-interactive SSH and therefore also require working authentication.
- Increase `SSH_CHECK_TIMEOUT_MS` for slow networks.
- Confirm VPN and DNS state from the same machine/container.

### Metrics are unavailable on a green server

Green direct-host status proves the SSH port is reachable, not that authentication succeeded. Run:

```bash
ssh -o BatchMode=yes your-alias true
```

If that fails, load the key into `ssh-agent` or correct the SSH config. Full metrics currently target Linux `/proc`; other systems return partial data.

### Terminal closes immediately

Run `ssh your-alias` in a normal terminal and resolve host-key, key-permission, or authentication errors there. In Docker, `${HOME}/.ssh` is read-only, so add host keys before starting the container; managed dashboard entries live in a separate writable volume.

### No hosts appear

Only safe explicit aliases matching letters, numbers, `.`, `_`, and `-` are shown. Wildcard patterns, negated patterns, and option-like aliases are intentionally excluded.

### Project path is rejected

Add its absolute parent directory to `PROJECT_ROOTS`. Separate multiple roots using `:` on macOS/Linux or `;` on Windows.
