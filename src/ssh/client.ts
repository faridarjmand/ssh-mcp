import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import type { HostMetrics, HostStatus, PublicSshHost } from "../shared.js";
import { isSafeAlias, loadSshHosts } from "./config-parser.js";
import { ManagedHostStore } from "./managed-hosts.js";

const execFileAsync = promisify(execFile);

const METRICS_COMMAND = String.raw`
LC_ALL=C
printf 'os=%s\n' "$(uname -s 2>/dev/null || printf unknown)"
if [ -r /proc/uptime ]; then awk '{printf "uptime=%s\n", $1}' /proc/uptime; else printf 'uptime=\n'; fi
if [ -r /proc/loadavg ]; then awk '{printf "load1=%s\n", $1}' /proc/loadavg; else printf 'load1=\n'; fi
if [ -r /proc/meminfo ]; then awk '/^MemTotal:/ {t=$2*1024} /^MemAvailable:/ {a=$2*1024} END {printf "memory_total=%.0f\nmemory_used=%.0f\n",t,t-a}' /proc/meminfo; else printf 'memory_total=\nmemory_used=\n'; fi
df -Pk / 2>/dev/null | awk 'NR==2 {printf "disk_total=%.0f\ndisk_used=%.0f\n",$2*1024,$3*1024}'
if [ -r /proc/stat ]; then
  c1=$(awk '/^cpu / {t=0; for(i=2;i<=NF;i++)t+=$i; printf "%.0f %.0f",t,$5+$6; exit}' /proc/stat)
  i1=$(awk '$3 !~ /^(loop|ram|fd|sr)/ {r+=$6; w+=$10} END {printf "%.0f %.0f",r,w}' /proc/diskstats 2>/dev/null)
  sleep 0.25
  c2=$(awk '/^cpu / {t=0; for(i=2;i<=NF;i++)t+=$i; printf "%.0f %.0f",t,$5+$6; exit}' /proc/stat)
  i2=$(awk '$3 !~ /^(loop|ram|fd|sr)/ {r+=$6; w+=$10} END {printf "%.0f %.0f",r,w}' /proc/diskstats 2>/dev/null)
  awk -v a="$c1" -v b="$c2" 'BEGIN {split(a,x);split(b,y);dt=y[1]-x[1];di=y[2]-x[2];if(dt>0)printf "cpu=%.1f\n",100*(dt-di)/dt;else print "cpu="}'
  awk -v a="$i1" -v b="$i2" 'BEGIN {split(a,x);split(b,y);printf "read_bps=%.0f\nwrite_bps=%.0f\n",(y[1]-x[1])*2048,(y[2]-x[2])*2048}'
else
  printf 'cpu=\nread_bps=\nwrite_bps=\n'
fi
`;

function numberOrNull(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMetrics(alias: string, output: string): HostMetrics {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return {
    alias,
    collectedAt: new Date().toISOString(),
    os: values.get("os") || "unknown",
    cpuPercent: numberOrNull(values.get("cpu")),
    memoryUsedBytes: numberOrNull(values.get("memory_used")),
    memoryTotalBytes: numberOrNull(values.get("memory_total")),
    diskUsedBytes: numberOrNull(values.get("disk_used")),
    diskTotalBytes: numberOrNull(values.get("disk_total")),
    readBytesPerSecond: numberOrNull(values.get("read_bps")),
    writeBytesPerSecond: numberOrNull(values.get("write_bps")),
    load1: numberOrNull(values.get("load1")),
    uptimeSeconds: numberOrNull(values.get("uptime")),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function tcpCheck(host: PublicSshHost, timeoutMs: number): Promise<HostStatus> {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: host.hostname, port: host.port });
    let settled = false;
    const finish = (state: "online" | "offline", message?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        alias: host.alias,
        state,
        latencyMs: state === "online" ? Math.max(1, Math.round(performance.now() - started)) : undefined,
        checkedAt: new Date().toISOString(),
        message,
      });
    };
    socket.setTimeout(timeoutMs, () => finish("offline", "Connection timed out"));
    socket.once("connect", () => finish("online"));
    socket.once("error", (error) => finish("offline", (error as NodeJS.ErrnoException).code || "Connection failed"));
  });
}

export class SshService {
  private hostCache?: { expiresAt: number; hosts: PublicSshHost[] };
  private readonly metricsCache = new Map<string, { expiresAt: number; metrics: HostMetrics }>();

  constructor(
    private readonly config: AppConfig,
    private readonly managedHosts: ManagedHostStore,
  ) {}

  async hosts(force = false): Promise<PublicSshHost[]> {
    if (!force && this.hostCache && this.hostCache.expiresAt > Date.now()) return this.hostCache.hosts;
    const managed = await this.managedHosts.list();
    const effectiveConfigPath = managed.length
      ? await this.managedHosts.effectiveConfigPath()
      : this.config.sshConfigPath;
    const hosts = await loadSshHosts(this.config.sshConfigPath, {
      prependConfigPaths: managed.length ? [this.managedHosts.configPath] : [],
      effectiveConfigPath,
      managedConfigPath: this.managedHosts.configPath,
    });
    this.hostCache = { hosts, expiresAt: Date.now() + 5_000 };
    return hosts;
  }

  invalidateHosts(alias?: string): void {
    this.hostCache = undefined;
    if (alias) this.metricsCache.delete(alias);
    else this.metricsCache.clear();
  }

  async host(alias: string): Promise<PublicSshHost> {
    if (!isSafeAlias(alias)) throw new Error("Invalid SSH host alias");
    const host = (await this.hosts()).find((item) => item.alias === alias);
    if (!host) throw new Error(`SSH host alias not found: ${alias}`);
    return host;
  }

  async check(alias: string): Promise<HostStatus> {
    const host = await this.host(alias);
    if (!host.proxyJump) return tcpCheck(host, this.config.sshCheckTimeoutMs);

    const configPath = await this.managedHosts.effectiveConfigPath();
    const started = performance.now();
    try {
      await execFileAsync(
        "ssh",
        [
          "-F",
            configPath,
          "-o",
          "BatchMode=yes",
          "-o",
          `ConnectTimeout=${Math.max(1, Math.ceil(this.config.sshCheckTimeoutMs / 1_000))}`,
          "--",
          alias,
          "true",
        ],
        { timeout: this.config.sshCheckTimeoutMs + 1_000, maxBuffer: 64 * 1024 },
      );
      return {
        alias,
        state: "online",
        latencyMs: Math.max(1, Math.round(performance.now() - started)),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return { alias, state: "offline", checkedAt: new Date().toISOString(), message: "ProxyJump SSH check failed" };
    }
  }

  async metrics(alias: string, force = false): Promise<HostMetrics> {
    await this.host(alias);
    const configPath = await this.managedHosts.effectiveConfigPath();
    const cached = this.metricsCache.get(alias);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.metrics;
    const remoteCommand = `sh -lc ${shellQuote(METRICS_COMMAND)}`;
    let result: Awaited<ReturnType<typeof execFileAsync>>;
    try {
      result = await execFileAsync(
        "ssh",
        [
          "-F",
            configPath,
          "-o",
          "BatchMode=yes",
          "-o",
          `ConnectTimeout=${Math.max(1, Math.ceil(this.config.sshCheckTimeoutMs / 1_000))}`,
          "--",
          alias,
          remoteCommand,
        ],
        {
          timeout: this.config.sshCommandTimeoutMs,
          maxBuffer: 1024 * 1024,
          encoding: "utf8",
        },
      );
    } catch {
      throw new Error(`Unable to collect metrics for ${alias}; check non-interactive SSH access and remote Linux tools`);
    }
    const metrics = parseMetrics(alias, String(result.stdout));
    this.metricsCache.set(alias, { metrics, expiresAt: Date.now() + this.config.metricsCacheMs });
    return metrics;
  }

  async runCommand(alias: string, command: string): Promise<{ stdout: string; stderr: string }> {
    if (!this.config.allowRemoteCommands) {
      throw new Error("Remote command execution is disabled; set ALLOW_REMOTE_COMMANDS=true to opt in");
    }
    await this.host(alias);
    const configPath = await this.managedHosts.effectiveConfigPath();
    if (!command.trim() || command.length > 8_000 || command.includes("\0")) {
      throw new Error("Command must contain 1 to 8000 characters and no NUL bytes");
    }
    try {
      const result = await execFileAsync(
        "ssh",
        ["-F", configPath, "-o", "BatchMode=yes", "--", alias, command],
        { timeout: this.config.sshCommandTimeoutMs, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" },
      );
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new Error(`Remote command failed${code ? ` (${code})` : ""}`);
    }
  }

  async openTerminal(alias: string): Promise<ChildProcessWithoutNullStreams> {
    await this.host(alias);
    const configPath = await this.managedHosts.effectiveConfigPath();
    return spawn("ssh", ["-tt", "-F", configPath, "--", alias], {
      env: { ...process.env, TERM: "xterm-256color", LC_ALL: process.env.LC_ALL ?? "C.UTF-8" },
      stdio: "pipe",
    });
  }
}
