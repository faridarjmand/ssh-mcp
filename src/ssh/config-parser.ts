import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PublicSshHost } from "../shared.js";

const execFileAsync = promisify(execFile);
const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface AliasSource {
  alias: string;
  source: string;
}

function removeComment(line: string): string {
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "'" && !double) single = !single;
    if (char === '"' && !single && line[i - 1] !== "\\") double = !double;
    if (char === "#" && !single && !double) return line.slice(0, i);
  }
  return line;
}

function splitWords(value: string): string[] {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((word) =>
    word.replace(/^(["'])(.*)\1$/, "$2"),
  ) ?? [];
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

async function flattenConfig(
  configPath: string,
  rootDirectory: string,
  visited = new Set<string>(),
): Promise<Array<{ line: string; source: string }>> {
  const resolved = path.resolve(configPath);
  if (visited.has(resolved)) return [];
  visited.add(resolved);

  let content: string;
  try {
    content = await fs.readFile(resolved, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const output: Array<{ line: string; source: string }> = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = removeComment(rawLine).trim();
    if (!line) continue;
    const match = line.match(/^include(?:\s+|\s*=\s*)(.+)$/i);
    if (!match) {
      output.push({ line, source: resolved });
      continue;
    }

    for (const includePattern of splitWords(match[1])) {
      const expanded = expandHome(includePattern);
      const absolutePattern = path.isAbsolute(expanded)
        ? expanded
        : path.resolve(rootDirectory, expanded);
      const matches: string[] = [];
      for await (const includedPath of fs.glob(absolutePattern)) {
        if ((await fs.stat(includedPath)).isFile()) matches.push(includedPath);
      }
      for (const includedPath of matches.sort()) {
        output.push(...(await flattenConfig(includedPath, rootDirectory, visited)));
      }
    }
  }
  return output;
}

function parseAliases(lines: Array<{ line: string; source: string }>): AliasSource[] {
  const seen = new Set<string>();
  const aliases: AliasSource[] = [];
  for (const { line, source } of lines) {
    const match = line.match(/^host(?:\s+|\s*=\s*)(.+)$/i);
    if (!match) continue;
    for (const alias of splitWords(match[1])) {
      if (!SAFE_ALIAS.test(alias) || seen.has(alias)) continue;
      seen.add(alias);
      aliases.push({ alias, source });
    }
  }
  return aliases;
}

function parseSshG(stdout: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf(" ");
    if (separator < 1) continue;
    const key = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    const current = values.get(key) ?? [];
    current.push(value);
    values.set(key, current);
  }
  return values;
}

async function effectiveHost(configPath: string, item: AliasSource): Promise<PublicSshHost> {
  let values = new Map<string, string[]>();
  try {
    const result = await execFileAsync("ssh", ["-G", "-F", configPath, "--", item.alias], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    values = parseSshG(result.stdout);
  } catch {
    // The alias is still useful when ssh -G is unavailable; use safe defaults.
  }

  const first = (key: string): string | undefined => values.get(key)?.[0];
  const parsedPort = Number.parseInt(first("port") ?? "22", 10);
  const proxyJump = first("proxyjump");
  return {
    alias: item.alias,
    hostname: first("hostname") ?? item.alias,
    user: first("user"),
    port: Number.isInteger(parsedPort) ? parsedPort : 22,
    proxyJump: proxyJump && proxyJump !== "none" ? proxyJump : undefined,
    source: path.basename(item.source),
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      result[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return result;
}

export async function loadSshHosts(configPath: string): Promise<PublicSshHost[]> {
  const rootDirectory = path.dirname(configPath);
  const lines = await flattenConfig(configPath, rootDirectory);
  const aliases = parseAliases(lines);
  return mapLimit(aliases, 8, (item) => effectiveHost(configPath, item));
}

export function isSafeAlias(alias: string): boolean {
  return SAFE_ALIAS.test(alias);
}
