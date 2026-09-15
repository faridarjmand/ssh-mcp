# SSH Nexus MCP

SSH Nexus is a local-first dashboard and [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for an existing OpenSSH inventory. It reads explicit aliases from `~/.ssh/config`, shows live reachability and Linux resource usage, opens an interactive browser terminal, indexes a project for agent context, and exposes the same safe operations to Codex, Claude, and other MCP clients.

![License](https://img.shields.io/badge/license-MIT-49dd88) ![Node](https://img.shields.io/badge/node-%3E%3D22-60a5fa) ![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-c084fc)

## What it includes

- OpenSSH inventory with `Host`, `Include`, effective hostname, user, port, and `ProxyJump` support
- Green/red reachability status with text labels and connection latency
- Interactive xterm.js terminal backed by the local `ssh` executable
- CPU, RAM, root-disk, load, uptime, and disk-I/O metrics over authenticated SSH
- Provider-neutral MCP tools, resources, and prompts for Codex, Claude Code, Claude Desktop, and compatible clients
- Bounded project indexing and text search for other AI agents
- Local-only binding by default, optional bearer authentication, alias allowlisting, and no private keys in the browser
- Responsive, keyboard-accessible dashboard

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- OpenSSH client (`ssh` in `PATH`)
- A working `~/.ssh/config`
- Key-based/non-interactive SSH authentication for automatic metrics
- Linux remote hosts for the full metrics set (non-Linux hosts show the fields they support)

## Quick start

```bash
git clone https://github.com/YOUR_USERNAME/ssh-nexus-mcp.git
cd ssh-nexus-mcp
npm install
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:5173>. Vite serves the development UI and proxies the API/WebSocket to port `3100`.

For a production-style local run:

```bash
npm run build
npm start
```

Open <http://127.0.0.1:3100>.

The default configuration already reads `~/.ssh/config`. A minimal SSH entry looks like:

```sshconfig
Host production-web
    HostName 203.0.113.10
    User deploy
    Port 22
    IdentityFile ~/.ssh/id_ed25519
```

SSH Nexus lists explicit aliases only. Wildcard blocks such as `Host *` contribute OpenSSH defaults but do not become dashboard cards.

## Connect an AI agent

Build the project first:

```bash
npm run build
```

### Codex

```bash
codex mcp add ssh-nexus -- node "$(pwd)/dist/server/mcp-stdio.js"
codex mcp list
```

Codex also supports project-scoped `.codex/config.toml`:

```toml
[mcp_servers.ssh_nexus]
command = "node"
args = ["/absolute/path/to/ssh-nexus-mcp/dist/server/mcp-stdio.js"]
default_tools_approval_mode = "writes"
```

See the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Claude Code

```bash
claude mcp add ssh-nexus -- node "$(pwd)/dist/server/mcp-stdio.js"
claude mcp get ssh-nexus
```

Use `--scope user` before `--` if you want the integration in all projects. See the [official Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

### Claude Desktop or another MCP host

Add this stdio definition, replacing the absolute path:

```json
{
  "mcpServers": {
    "ssh-nexus": {
      "command": "node",
      "args": ["/absolute/path/to/ssh-nexus-mcp/dist/server/mcp-stdio.js"]
    }
  }
}
```

The dashboard's **Connect AI** dialog generates copy-ready commands using the current project path.

### Streamable HTTP

While the dashboard is running, MCP is also available at:

```text
http://127.0.0.1:3100/mcp
```

If `SSH_NEXUS_TOKEN` is set, clients must send `Authorization: Bearer <token>`. Do not expose this endpoint publicly without TLS and a proper identity-aware proxy.

## MCP capabilities

| Capability | Purpose | Default safety |
| --- | --- | --- |
| `list_ssh_hosts` | List configured aliases | Read-only |
| `check_ssh_host` | Test reachability | Read-only/network |
| `get_host_metrics` | Run a fixed metrics probe | Read-only/network |
| `get_project_index` | Read or initialize the project index | Writes only generated index |
| `refresh_project_index` | Rebuild project metadata | Writes only generated index |
| `search_project` | Search bounded indexed source | Read-only |
| `run_ssh_command` | Run an arbitrary remote command | **Disabled by default** |
| `ssh-nexus://hosts` | SSH inventory resource | Read-only |
| `ssh-nexus://project-index` | Project index resource | Read-only |
| `server_health_review` | Safe health-review prompt | Read-only workflow |

To deliberately enable arbitrary MCP remote commands:

```bash
ALLOW_REMOTE_COMMANDS=true npm start
```

This changes the trust boundary. Keep agent approval enabled and review commands before execution.

## Project indexing

Press **Build index** in the dashboard or call `refresh_project_index`. The generated `.ssh-nexus/index.json` contains paths, sizes, line counts, modification times, SHA-256 hashes, and language counts. It does not copy file content into the index.

The indexer skips `.git`, dependencies, build output, its own generated directory, symlinks, `.env*`, private-key-style names, and common certificate/keystore extensions. Allowed roots are controlled by `PROJECT_ROOTS`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `SSH_NEXUS_CONFIG` | `~/.ssh/config` | OpenSSH config path |
| `DASHBOARD_HOST` | `127.0.0.1` | Bind address |
| `DASHBOARD_PORT` | `3100` | API/dashboard port |
| `SSH_NEXUS_TOKEN` | unset | Bearer token; required for non-loopback bind |
| `PROJECT_ROOTS` | current directory | Allowed index roots, separated by OS path delimiter |
| `SSH_CHECK_TIMEOUT_MS` | `3500` | Reachability timeout |
| `SSH_COMMAND_TIMEOUT_MS` | `12000` | Fixed metrics/MCP command timeout |
| `METRICS_CACHE_MS` | `10000` | Metrics cache lifetime |
| `MAX_INDEX_FILES` | `5000` | Per-index file limit |
| `ALLOW_REMOTE_COMMANDS` | `false` | Enable dangerous MCP command tool |

The dashboard never reads private-key content. OpenSSH itself resolves identities, agents, proxies, host keys, and authentication.

## Docker

Native installation is recommended because it naturally uses your SSH agent and filesystem permissions. For Docker:

```bash
export SSH_NEXUS_TOKEN="$(openssl rand -hex 32)"
docker compose up --build
```

The browser asks for this token. The Compose file mounts `${HOME}/.ssh` read-only and the repository at `/workspace`. On Linux, make sure the mounted key files are readable by the container's `node` user and that host keys are already present in `known_hosts`.

## Validate before pushing

```bash
npm run check
```

Then create and push your GitHub repository:

```bash
git init
git add .
git commit -m "feat: initial SSH Nexus MCP dashboard"
gh repo create ssh-nexus-mcp --source=. --private --push
```

Change `--private` to `--public` only after reviewing the repository for personal hostnames or local configuration. SSH Nexus does not commit your SSH config or generated index.

## Documentation

- [Installation and operations](docs/INSTALLATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [AI agent integration](docs/AI_AGENTS.md)
- [HTTP and WebSocket API](docs/API.md)
- [Project map](docs/PROJECT_INDEX.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
