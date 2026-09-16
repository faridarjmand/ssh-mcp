import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebSocket, WebSocketServer } from "ws";
import { isLoopbackHost, loadConfig } from "./config.js";
import { createMcpServer, createServices } from "./mcp/server.js";
import { validateManagedSshHost } from "./ssh/managed-hosts.js";

const config = loadConfig();
const services = createServices(config);
const app = express();
const httpServer = createServer(app);
const terminalServer = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const uiDirectory = path.resolve(moduleDirectory, "../ui");

function sameToken(candidate: string | undefined): boolean {
  if (!config.token) return true;
  if (!candidate) return false;
  const expected = Buffer.from(config.token);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.header("authorization");
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (sameToken(bearerToken(request))) return next();
  response.status(401).json({ error: "A valid SSH Nexus bearer token is required" });
}

function requireSshConfigWrites(_request: Request, response: Response, next: NextFunction): void {
  if (config.allowSshConfigWrites) return next();
  response.status(403).json({ error: "SSH config editing is disabled; set ALLOW_SSH_CONFIG_WRITES=true and configure a bearer token" });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0];
  return "Unexpected error";
}

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (host && parsed.host === host) return true;
    return isLoopbackHost(config.dashboardHost) && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function clientConfigurations() {
  const entry = path.resolve(process.cwd(), "dist/server/mcp-stdio.js");
  const quotedEntry = shellQuote(entry);
  const url = `http://${config.dashboardHost}:${config.dashboardPort}/mcp`;
  const tokenToml = config.token ? '\nbearer_token_env_var = "SSH_NEXUS_TOKEN"' : "";
  return {
    entry,
    codex: {
      command: `codex mcp add ssh-nexus -- node ${quotedEntry}`,
      verify: "codex mcp list",
      config: `[mcp_servers.ssh_nexus]\ncommand = "node"\nargs = [${JSON.stringify(entry)}]\ndefault_tools_approval_mode = "writes"`,
      httpConfig: `[mcp_servers.ssh_nexus]\nurl = ${JSON.stringify(url)}${tokenToml}`,
    },
    claudeCode: {
      command: `claude mcp add ssh-nexus -- node ${quotedEntry}`,
      verify: "claude mcp get ssh-nexus",
    },
    claudeDesktop: {
      config: JSON.stringify({ mcpServers: { "ssh-nexus": { command: "node", args: [entry] } } }, null, 2),
    },
    generic: {
      stdio: { command: "node", args: [entry] },
      streamableHttp: { url, authorization: config.token ? "Bearer $SSH_NEXUS_TOKEN" : null },
    },
  };
}

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  next();
});
app.use(express.json({ limit: "128kb" }));
app.use((request, response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !isAllowedOrigin(request.headers.origin, request.headers.host)) {
    response.status(403).json({ error: "Cross-origin state-changing requests are not allowed" });
    return;
  }
  next();
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    name: "ssh-nexus",
    authRequired: Boolean(config.token),
    remoteCommandsEnabled: config.allowRemoteCommands,
    sshConfigWritesEnabled: config.allowSshConfigWrites,
  });
});

app.use("/api", requireAuth);

app.get("/api/hosts", asyncRoute(async (_request, response) => {
  const hosts = await services.ssh.hosts(true);
  response.json({ hosts });
}));

app.get("/api/managed-hosts", asyncRoute(async (_request, response) => {
  response.json({
    enabled: config.allowSshConfigWrites,
    hosts: await services.managedHosts.list(),
  });
}));

app.put("/api/managed-hosts/:alias", requireSshConfigWrites, asyncRoute(async (request, response) => {
  const alias = String(request.params.alias);
  const input = validateManagedSshHost({ ...request.body, alias });
  if (input.proxyJump) {
    const allowedAliases = new Set((await services.ssh.hosts(true)).map((host) => host.alias));
    for (const jumpAlias of input.proxyJump.split(",")) {
      if (jumpAlias === alias || !allowedAliases.has(jumpAlias)) {
        throw new Error(`ProxyJump alias must reference another configured SSH host: ${jumpAlias}`);
      }
    }
  }
  const managedHost = await services.managedHosts.upsert(input);
  services.ssh.invalidateHosts(alias);
  const hosts = await services.ssh.hosts(true);
  response.json({ managedHost, host: hosts.find((item) => item.alias === alias), hosts });
}));

app.post("/api/hosts/:alias/check", asyncRoute(async (request, response) => {
  response.json(await services.ssh.check(String(request.params.alias)));
}));

app.get("/api/hosts/:alias/metrics", asyncRoute(async (request, response) => {
  response.json(await services.ssh.metrics(String(request.params.alias), request.query.refresh === "true"));
}));

app.get("/api/project", asyncRoute(async (request, response) => {
  response.json({ index: await services.indexer.read(typeof request.query.root === "string" ? request.query.root : undefined) });
}));

app.post("/api/project/index", asyncRoute(async (request, response) => {
  const root = typeof request.body?.root === "string" ? request.body.root : undefined;
  response.json({ index: await services.indexer.index(root) });
}));

app.get("/api/project/search", asyncRoute(async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q : "";
  const root = typeof request.query.root === "string" ? request.query.root : undefined;
  response.json({ matches: await services.indexer.search(query, root) });
}));

app.get("/api/client-configs", (_request, response) => {
  response.json(clientConfigurations());
});

app.all("/mcp", requireAuth, asyncRoute(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).set("Allow", "POST").json({ error: "Use POST for the stateless Streamable HTTP MCP endpoint" });
    return;
  }
  const server = createMcpServer(services);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
}));

if (existsSync(uiDirectory)) {
  app.use(express.static(uiDirectory, { index: false, maxAge: "1h" }));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(uiDirectory, "index.html")));
} else {
  app.get("/", (_request, response) => {
    response.type("text").send("SSH Nexus API is running. Use `npm run dev` for the dashboard or `npm run build` first.");
  });
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  response.status(400).json({ error: errorMessage(error) });
});

httpServer.on("upgrade", (request, socket, head) => {
  const host = request.headers.host;
  const url = new URL(request.url ?? "/", `http://${host ?? "localhost"}`);
  const authorization = request.headers.authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? url.searchParams.get("token") ?? undefined;
  if (url.pathname !== "/ws/terminal" || !sameToken(token) || !isAllowedOrigin(request.headers.origin, host) || terminalServer.clients.size >= 12) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  terminalServer.handleUpgrade(request, socket, head, (webSocket) => {
    terminalServer.emit("connection", webSocket, request);
  });
});

terminalServer.on("connection", (webSocket: WebSocket, request: IncomingMessage) => {
  const alias = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).searchParams.get("host") ?? "";
  let child: Awaited<ReturnType<typeof services.ssh.openTerminal>> | undefined;
  const send = (payload: unknown) => {
    if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(payload));
  };

  void services.ssh.openTerminal(alias).then((process) => {
    child = process;
    send({ type: "status", data: `Connected to ${alias}` });
    process.stdout.on("data", (data) => send({ type: "output", data: data.toString("utf8") }));
    process.stderr.on("data", (data) => send({ type: "output", data: data.toString("utf8") }));
    process.once("error", (error) => send({ type: "error", data: errorMessage(error) }));
    process.once("exit", (code, signal) => {
      send({ type: "status", data: `Session closed (${signal ?? code ?? "unknown"})` });
      webSocket.close(1000, "SSH session ended");
    });
  }).catch((error) => {
    send({ type: "error", data: errorMessage(error) });
    webSocket.close(1008, "Unable to start SSH");
  });

  webSocket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as { type?: string; data?: string };
      if (message.type === "input" && typeof message.data === "string") child?.stdin.write(message.data);
    } catch {
      send({ type: "error", data: "Invalid terminal message" });
    }
  });
  webSocket.once("close", () => {
    if (!child || child.killed) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child && !child.killed && child.kill("SIGKILL"), 2_000);
    timer.unref();
  });
});

httpServer.listen(config.dashboardPort, config.dashboardHost, () => {
  console.error(`SSH Nexus dashboard: http://${config.dashboardHost}:${config.dashboardPort}`);
  console.error(`SSH config: ${config.sshConfigPath}`);
});
