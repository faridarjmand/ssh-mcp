# HTTP and WebSocket API

All `/api` endpoints except `/api/health`, plus `/mcp` and the terminal WebSocket, require a bearer token when `SSH_NEXUS_TOKEN` is configured.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Process and authentication mode |
| `GET` | `/api/hosts` | Explicit SSH inventory |
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
