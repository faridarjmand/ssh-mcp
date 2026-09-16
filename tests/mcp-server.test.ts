import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createMcpServer, createServices } from "../src/mcp/server.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("MCP server", () => {
  it("advertises inventory, metrics, indexing, search, and opt-in command tools", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-mcp-"));
    temporaryDirectories.push(root);
    const sshConfigPath = path.join(root, "config");
    await fs.writeFile(sshConfigPath, "Host test-host\n  HostName 127.0.0.1\n  Port 22\n");
    const config: AppConfig = {
      sshConfigPath,
      managedSshConfigPath: path.join(root, "managed", "hosts.conf"),
      dashboardHost: "127.0.0.1",
      dashboardPort: 3100,
      projectRoots: [root],
      sshCheckTimeoutMs: 250,
      sshCommandTimeoutMs: 1_000,
      metricsCacheMs: 0,
      maxIndexFiles: 100,
      allowRemoteCommands: false,
      allowSshConfigWrites: false,
    };
    const server = createMcpServer(createServices(config));
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "list_ssh_hosts",
      "check_ssh_host",
      "get_host_metrics",
      "get_project_index",
      "refresh_project_index",
      "search_project",
      "run_ssh_command",
    ]));

    const result = await client.callTool({ name: "list_ssh_hosts", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("test-host");

    const commandResult = await client.callTool({
      name: "run_ssh_command",
      arguments: { alias: "test-host", command: "uptime" },
    });
    expect(commandResult.isError).toBe(true);
    expect(JSON.stringify(commandResult.content)).toContain("Remote command execution is disabled");

    await client.close();
    await server.close();
  });
});
