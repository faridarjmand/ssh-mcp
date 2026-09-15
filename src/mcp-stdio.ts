#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer, createServices } from "./mcp/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createMcpServer(createServices(config));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`SSH Nexus MCP is running over stdio with config ${config.sshConfigPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
