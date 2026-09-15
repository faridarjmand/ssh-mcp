import os from "node:os";
import path from "node:path";

export interface AppConfig {
  sshConfigPath: string;
  dashboardHost: string;
  dashboardPort: number;
  token?: string;
  projectRoots: string[];
  sshCheckTimeoutMs: number;
  sshCommandTimeoutMs: number;
  metricsCacheMs: number;
  maxIndexFiles: number;
  allowRemoteCommands: boolean;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function booleanEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function isLoopbackHost(host: string): boolean {
  return ["127.0.0.1", "::1", "localhost"].includes(host.toLowerCase());
}

export function loadConfig(): AppConfig {
  const dashboardHost = process.env.DASHBOARD_HOST ?? "127.0.0.1";
  const token = process.env.SSH_NEXUS_TOKEN?.trim() || undefined;
  if (!isLoopbackHost(dashboardHost) && !token) {
    throw new Error("SSH_NEXUS_TOKEN is required when DASHBOARD_HOST is not loopback");
  }

  const rootsRaw = process.env.PROJECT_ROOTS ?? process.cwd();
  const projectRoots = rootsRaw
    .split(path.delimiter)
    .map((root) => path.resolve(expandHome(root.trim())))
    .filter(Boolean);

  return {
    sshConfigPath: path.resolve(expandHome(process.env.SSH_NEXUS_CONFIG ?? "~/.ssh/config")),
    dashboardHost,
    dashboardPort: integerEnv("DASHBOARD_PORT", 3100, 1, 65_535),
    token,
    projectRoots: projectRoots.length ? projectRoots : [process.cwd()],
    sshCheckTimeoutMs: integerEnv("SSH_CHECK_TIMEOUT_MS", 3_500, 250, 60_000),
    sshCommandTimeoutMs: integerEnv("SSH_COMMAND_TIMEOUT_MS", 12_000, 1_000, 300_000),
    metricsCacheMs: integerEnv("METRICS_CACHE_MS", 10_000, 0, 300_000),
    maxIndexFiles: integerEnv("MAX_INDEX_FILES", 5_000, 1, 100_000),
    allowRemoteCommands: booleanEnv("ALLOW_REMOTE_COMMANDS"),
  };
}
