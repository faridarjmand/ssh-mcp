import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ManagedSshHost } from "../shared.js";
import { isSafeAlias } from "./config-parser.js";

const HEADER = [
  "# Managed by SSH Nexus.",
  "# Use the dashboard to change these structured host entries.",
  "",
].join("\n");
const SAFE_HOSTNAME = /^[A-Za-z0-9:][A-Za-z0-9._:-]{0,254}$/;
const SAFE_USER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value.trim() || undefined;
}

export function validateManagedSshHost(value: unknown): ManagedSshHost {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Managed SSH host must be an object");
  }
  const input = value as Record<string, unknown>;
  const alias = optionalString(input.alias, "Alias");
  const hostname = optionalString(input.hostname, "Hostname");
  const user = optionalString(input.user, "User");
  const proxyJump = optionalString(input.proxyJump, "ProxyJump");
  const port = input.port;

  if (!alias || !isSafeAlias(alias)) {
    throw new Error("Alias must use only letters, numbers, dots, underscores, and hyphens");
  }
  if (!hostname || !SAFE_HOSTNAME.test(hostname)) {
    throw new Error("Hostname must be a DNS name or IP address without spaces");
  }
  if (user && !SAFE_USER.test(user)) {
    throw new Error("User must use only letters, numbers, dots, underscores, and hyphens");
  }
  if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65_535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }
  if (proxyJump && !proxyJump.split(",").every((item) => isSafeAlias(item))) {
    throw new Error("ProxyJump must be a comma-separated list of configured aliases");
  }

  return { alias, hostname, user, port: Number(port), proxyJump };
}

function parseManagedConfig(content: string): ManagedSshHost[] {
  const hosts: ManagedSshHost[] = [];
  const aliases = new Set<string>();
  let current: Record<string, unknown> | undefined;

  const finish = () => {
    if (!current) return;
    const host = validateManagedSshHost(current);
    if (aliases.has(host.alias)) throw new Error(`Duplicate managed SSH alias: ${host.alias}`);
    aliases.add(host.alias);
    hosts.push(host);
    current = undefined;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) throw new Error(`Invalid managed SSH config line: ${line}`);
    const keyword = match[1].toLowerCase();
    const value = match[2].trim();

    if (keyword === "host") {
      finish();
      if (value.split(/\s+/).length !== 1) {
        throw new Error("Managed Host entries must contain exactly one alias");
      }
      current = { alias: value, port: 22 };
      continue;
    }
    if (!current) throw new Error(`Unsupported global directive in managed SSH config: ${match[1]}`);
    if (keyword === "hostname") current.hostname = value;
    else if (keyword === "user") current.user = value;
    else if (keyword === "port") current.port = Number(value);
    else if (keyword === "proxyjump") current.proxyJump = value;
    else throw new Error(`Unsupported managed SSH directive: ${match[1]}`);
  }
  finish();
  return hosts;
}

function serializeManagedConfig(hosts: ManagedSshHost[]): string {
  const blocks = [...hosts]
    .sort((left, right) => left.alias.localeCompare(right.alias))
    .map((host) => [
      `Host ${host.alias}`,
      `    HostName ${host.hostname}`,
      ...(host.user ? [`    User ${host.user}`] : []),
      `    Port ${host.port}`,
      ...(host.proxyJump ? [`    ProxyJump ${host.proxyJump}`] : []),
    ].join("\n"));
  return `${HEADER}${blocks.join("\n\n")}${blocks.length ? "\n" : ""}`;
}

function quoteConfigPath(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error("SSH config paths cannot contain control characters");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export class ManagedHostStore {
  private mutation = Promise.resolve();
  private wrapperPath?: string;

  constructor(
    private readonly sourceConfigPath: string,
    readonly configPath: string,
  ) {}

  private async readFile(): Promise<ManagedSshHost[]> {
    let status;
    try {
      status = await fs.lstat(this.configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new Error("Managed SSH config must be a regular file, not a symlink");
    }
    return parseManagedConfig(await fs.readFile(this.configPath, "utf8"));
  }

  async list(): Promise<ManagedSshHost[]> {
    await this.mutation;
    return this.readFile();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(task, task);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async writeFile(hosts: ManagedSshHost[]): Promise<void> {
    const directory = path.dirname(this.configPath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });

    let exists = false;
    try {
      const status = await fs.lstat(this.configPath);
      if (status.isSymbolicLink() || !status.isFile()) {
        throw new Error("Managed SSH config must be a regular file, not a symlink");
      }
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (exists) {
      const backupTemporary = `${this.configPath}.${randomUUID()}.backup`;
      try {
        await fs.copyFile(this.configPath, backupTemporary, constants.COPYFILE_EXCL);
        await fs.chmod(backupTemporary, 0o600);
        await fs.rename(backupTemporary, `${this.configPath}.bak`);
      } catch (error) {
        await fs.rm(backupTemporary, { force: true });
        throw error;
      }
    }

    const temporary = `${this.configPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, serializeManagedConfig(hosts), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fs.rename(temporary, this.configPath);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  upsert(value: unknown): Promise<ManagedSshHost> {
    const host = validateManagedSshHost(value);
    return this.enqueue(async () => {
      const hosts = await this.readFile();
      const index = hosts.findIndex((item) => item.alias === host.alias);
      if (index === -1) hosts.push(host);
      else hosts[index] = host;
      await this.writeFile(hosts);
      return host;
    });
  }

  async effectiveConfigPath(): Promise<string> {
    if (!(await this.list()).length) return this.sourceConfigPath;
    if (this.wrapperPath) return this.wrapperPath;

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-config-"));
    this.wrapperPath = path.join(directory, "config");
    const content = [
      "# Generated by SSH Nexus for this process.",
      `Include ${quoteConfigPath(this.configPath)}`,
      `Include ${quoteConfigPath(this.sourceConfigPath)}`,
      "",
    ].join("\n");
    await fs.writeFile(this.wrapperPath, content, { encoding: "utf8", mode: 0o600 });
    return this.wrapperPath;
  }
}
