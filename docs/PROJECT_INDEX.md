# Project map

This hand-maintained map helps a new human or AI agent locate the important code before using the generated runtime index.

| Area | Files | Responsibility |
| --- | --- | --- |
| Configuration | `src/config.ts`, `.env.example` | Parse and validate runtime policy |
| SSH inventory | `src/ssh/config-parser.ts` | Includes, aliases, `ssh -G` resolution |
| SSH operations | `src/ssh/client.ts` | Reachability, metrics, terminal, command gate |
| MCP | `src/mcp/server.ts`, `src/mcp-stdio.ts` | Tools/resources/prompts and stdio transport |
| Dashboard API | `src/dashboard-server.ts` | REST, HTTP MCP, auth, WebSocket, static UI |
| Project context | `src/indexer/project-index.ts` | Generated metadata index and bounded search |
| UI | `src/ui/*` | Inventory, metrics, terminal, agent config, index UI |
| Tests | `tests/*` | Parser, security boundary, and index behavior |
| Operations | `Dockerfile`, `compose.yaml`, `docs/*` | Install, deploy, extend, and secure |

## Change checklist

1. Preserve the local-only/token startup invariant.
2. Never put private-key data or raw SSH config in API responses.
3. Keep alias values after the OpenSSH `--` option separator.
4. Keep automatic remote commands fixed and read-only.
5. Add or update a test for security-boundary changes.
6. Run `npm run check`.
7. Update this map and relevant docs when modules or behavior move.
