import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { ProjectIndexer } from "../indexer/project-index.js";
import { SshService } from "../ssh/client.js";
import { ManagedHostStore } from "../ssh/managed-hosts.js";

export interface Services {
  config: AppConfig;
  ssh: SshService;
  managedHosts: ManagedHostStore;
  indexer: ProjectIndexer;
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined,
  };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Unknown error" }],
    isError: true,
  };
}

export function createServices(config: AppConfig): Services {
  const managedHosts = new ManagedHostStore(config.sshConfigPath, config.managedSshConfigPath);
  return {
    config,
    ssh: new SshService(config, managedHosts),
    managedHosts,
    indexer: new ProjectIndexer(config),
  };
}

export function createMcpServer(services: Services): McpServer {
  const server = new McpServer(
    { name: "ssh-nexus", version: "0.1.0" },
    {
      instructions:
        "SSH Nexus provides an inventory from the user's read-only SSH config plus dashboard-managed entries, safe reachability checks, fixed read-only Linux metrics, and a bounded project index. Prefer read-only tools. The run_ssh_command tool is disabled unless the operator explicitly opts in with ALLOW_REMOTE_COMMANDS=true; ask the user before commands that change remote state. Never request, print, or store private-key material.",
    },
  );

  server.registerTool(
    "list_ssh_hosts",
    {
      title: "List SSH hosts",
      description: "List explicit, non-wildcard aliases from the configured OpenSSH source and managed overlay.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const hosts = await services.ssh.hosts(true);
        return textResult({ hosts, count: hosts.length });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "check_ssh_host",
    {
      title: "Check SSH host",
      description: "Check whether an SSH host is reachable. Direct hosts use a TCP check; ProxyJump hosts use BatchMode SSH.",
      inputSchema: { alias: z.string().min(1).max(255).describe("Exact SSH Host alias") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ alias }) => {
      try {
        return textResult(await services.ssh.check(alias));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_host_metrics",
    {
      title: "Get host metrics",
      description: "Collect CPU, memory, root disk, load, uptime, and disk I/O metrics using a fixed read-only command over SSH.",
      inputSchema: {
        alias: z.string().min(1).max(255).describe("Exact SSH Host alias"),
        refresh: z.boolean().optional().describe("Bypass the short metrics cache"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ alias, refresh }) => {
      try {
        return textResult(await services.ssh.metrics(alias, refresh));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_project_index",
    {
      title: "Get project index",
      description: "Read the latest metadata-only project index, creating it when it does not exist.",
      inputSchema: { root: z.string().optional().describe("Path under an allowed PROJECT_ROOTS entry") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ root }) => {
      try {
        const index = (await services.indexer.read(root)) ?? (await services.indexer.index(root));
        return textResult(index);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "refresh_project_index",
    {
      title: "Refresh project index",
      description: "Rebuild .ssh-nexus/index.json for a project under PROJECT_ROOTS. Secret-like files and build directories are excluded.",
      inputSchema: { root: z.string().optional().describe("Path under an allowed PROJECT_ROOTS entry") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ root }) => {
      try {
        return textResult(await services.indexer.index(root));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_project",
    {
      title: "Search indexed project",
      description: "Search text files in the bounded project index and return matching line previews.",
      inputSchema: {
        query: z.string().min(1).max(200),
        root: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ query, root, limit }) => {
      try {
        return textResult({ matches: await services.indexer.search(query, root, limit) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "run_ssh_command",
    {
      title: "Run SSH command (opt-in)",
      description: "Run a command on a configured host. Disabled by default and only available when ALLOW_REMOTE_COMMANDS=true.",
      inputSchema: {
        alias: z.string().min(1).max(255),
        command: z.string().min(1).max(8_000),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ alias, command }) => {
      try {
        return textResult(await services.ssh.runCommand(alias, command));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerResource(
    "ssh-host-inventory",
    "ssh-nexus://hosts",
    {
      title: "SSH host inventory",
      description: "Current explicit SSH aliases and effective connection destinations.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await services.ssh.hosts(), null, 2) }],
    }),
  );

  server.registerResource(
    "project-index",
    "ssh-nexus://project-index",
    {
      title: "Project index",
      description: "Latest bounded project metadata index.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify((await services.indexer.read()) ?? { status: "not_indexed" }, null, 2),
      }],
    }),
  );

  server.registerPrompt(
    "server_health_review",
    {
      title: "Server health review",
      description: "Guide an agent through a read-only reachability and resource review.",
      argsSchema: { alias: z.string().min(1).max(255) },
    },
    ({ alias }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Review SSH host ${alias}. First check reachability, then collect metrics if online. Summarize CPU, memory, disk, I/O, load, and any missing data. Do not run arbitrary commands or change remote state.`,
        },
      }],
    }),
  );

  return server;
}
