# Architecture

```text
Browser dashboard
  |-- REST /api/* ----------- Express API
  |-- WebSocket /ws/terminal ----> OpenSSH interactive process
  |-- POST /mcp ------------- Streamable HTTP MCP
                                      |
AI client -- stdio --> MCP server ----+---- SshService
                                      |       |-- ~/.ssh/config + Include
                                      |       |-- managed host overlay
                                      |       |-- TCP/BatchMode checks
                                      |       `-- fixed metrics probe
                                      |
                                      `---- ProjectIndexer
                                              `-- .ssh-nexus/index.json
```

## Runtime entry points

- `src/dashboard-server.ts`: Express, static production UI, REST routes, Streamable HTTP MCP, and terminal WebSocket upgrades.
- `src/mcp-stdio.ts`: local process transport used by Codex, Claude Code, Claude Desktop, and other stdio clients.
- `src/mcp/server.ts`: transport-independent MCP tools, resources, prompts, annotations, and instructions.

## Core modules

- `src/ssh/config-parser.ts`: flattens `Include` files, extracts safe explicit aliases, and asks `ssh -G` for effective connection values.
- `src/ssh/managed-hosts.ts`: validates and atomically writes the dashboard-owned host overlay, creates backups, and builds the effective OpenSSH include wrapper.
- `src/ssh/client.ts`: reachability, metrics, opt-in remote commands, and terminal process creation.
- `src/indexer/project-index.ts`: root-bounded metadata indexing and content search with sensitive/build exclusions.
- `src/config.ts`: environment parsing and the loopback/token invariant.
- `src/shared.ts`: API contracts shared with React.

## Dashboard

The Vite/React UI lives in `src/ui`. Development uses port `5173` with API and WebSocket proxies. Production builds static assets into `dist/ui`; the compiled server in `dist/server` serves them on port `3100`.

The browser starts a status-and-metrics refresh every 30 seconds. A refresh uses at most eight concurrent per-host operations, reuses an in-flight refresh for duplicate requests, and skips overlapping fleet cycles. Metrics use a short server-side cache and are collected only after reachability succeeds; stale metrics are removed when a host goes offline or a later metrics probe fails.

When managed editing is enabled, the API accepts only alias, hostname, user, port, and allowlisted `ProxyJump` aliases. Managed entries are resolved before the source config through a generated include wrapper, so they can override connection fields while inheriting unedited OpenSSH options. Every terminal uses a separate local OpenSSH child process and is terminated when its WebSocket closes.

## Deliberate constraints

- No database: SSH config is the inventory source of truth; the project index is a generated JSON artifact.
- No SSH key parser: OpenSSH owns all credential and connection behavior.
- No raw SSH config editor: source files remain untouched and dashboard writes require an explicit gate plus bearer token.
- No arbitrary dashboard command endpoint: interactive terminal traffic is user-driven.
- MCP arbitrary commands are present only as an explicit, environment-gated tool.
- The HTTP MCP endpoint is stateless for simple local interoperability. Use stdio for the strongest local process boundary.
