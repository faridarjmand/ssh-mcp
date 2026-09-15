# AI agent integration

SSH Nexus is an MCP server rather than a direct integration with one model API. This keeps provider credentials out of the project and gives Codex, Claude, and other compatible clients the same tools.

## Recommended workflow

1. Call `list_ssh_hosts` to resolve an exact configured alias.
2. Call `check_ssh_host` before attempting metrics.
3. Call `get_host_metrics` only for an online host.
4. Use `get_project_index` or `search_project` for code context.
5. Propose changes and tests before modifying the project.
6. Do not use `run_ssh_command` unless the operator enabled it and approved the exact remote action.

The server's MCP `instructions` field communicates these rules to capable clients. Tool annotations additionally distinguish read-only and destructive operations.

## Codex

```bash
npm run build
codex mcp add ssh-nexus -- node "$(pwd)/dist/server/mcp-stdio.js"
codex mcp list
```

## Claude Code

```bash
npm run build
claude mcp add ssh-nexus -- node "$(pwd)/dist/server/mcp-stdio.js"
claude mcp get ssh-nexus
```

## Generic stdio client

```json
{
  "command": "node",
  "args": ["/absolute/path/to/dist/server/mcp-stdio.js"],
  "env": {
    "SSH_NEXUS_CONFIG": "/absolute/path/to/.ssh/config",
    "PROJECT_ROOTS": "/absolute/path/to/project"
  }
}
```

## Generic Streamable HTTP client

Connect to `http://127.0.0.1:3100/mcp`. When `SSH_NEXUS_TOKEN` is configured, send it as a bearer token. Stdio is preferred for local agents because the client owns the server lifetime and no listening MCP endpoint is required.
