# HTTP and WebSocket API

All `/api` endpoints except `/api/health`, plus `/mcp` and the terminal WebSocket, require a bearer token when `SSH_NEXUS_TOKEN` is configured.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Process and authentication mode |
| `GET` | `/api/hosts` | Explicit SSH inventory |
| `GET` | `/api/managed-hosts` | Managed entries and write-gate state |
| `PUT` | `/api/managed-hosts/:alias` | Create or update a managed entry |
| `POST` | `/api/hosts/:alias/check` | Reachability check |
| `GET` | `/api/hosts/:alias/metrics` | Cached fixed metrics (`?refresh=true` bypasses cache) |
| `GET` | `/api/project` | Latest index metadata |
| `POST` | `/api/project/index` | Build index; optional JSON `{ "root": "..." }` |
| `GET` | `/api/project/search?q=...` | Search indexed text files |
| `GET` | `/api/client-configs` | Copy-ready local MCP client definitions |
| `POST` | `/mcp` | Stateless Streamable HTTP MCP transport |

Errors use JSON:

```json
{ "error": "Human-readable message" }
```

## Managed SSH hosts

Mutation endpoints require `ALLOW_SSH_CONFIG_WRITES=true` and a configured bearer token. `PUT` accepts:

```json
{
  "hostname": "203.0.113.10",
  "user": "deploy",
  "port": 22,
  "proxyJump": "bastion"
}
```

The URL alias is authoritative. `user` and `proxyJump` are optional; each proxy-jump name must already be an explicit inventory alias. Responses include the refreshed public inventory. Raw directives, identity paths, and private-key material are not accepted.

## Terminal WebSocket

Connect to:

```text
ws://127.0.0.1:3100/ws/terminal?host=ALIAS&token=TOKEN
```

Client message:

```json
{ "type": "input", "data": "ls -la\r" }
```

Server messages:

```json
{ "type": "output", "data": "..." }
{ "type": "status", "data": "Connected to ALIAS" }
{ "type": "error", "data": "..." }
```

The alias must exist in the loaded SSH inventory. Payloads are capped at 32 KiB.
