export type HostState = "unknown" | "checking" | "online" | "offline";

export interface ManagedSshHost {
  alias: string;
  hostname: string;
  user?: string;
  port: number;
  proxyJump?: string;
}

export interface PublicSshHost extends ManagedSshHost {
  source: string;
  managed: boolean;
}

export interface HostStatus {
  alias: string;
  state: HostState;
  latencyMs?: number;
  checkedAt?: string;
  message?: string;
}

export interface HostMetrics {
  alias: string;
  collectedAt: string;
  os: string;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  readBytesPerSecond: number | null;
  writeBytesPerSecond: number | null;
  load1: number | null;
  uptimeSeconds: number | null;
}

export interface ProjectFileEntry {
  path: string;
  bytes: number;
  lines: number | null;
  modifiedAt: string;
  sha256: string;
}

export interface ProjectIndex {
  version: 1;
  root: string;
  generatedAt: string;
  fileCount: number;
  totalBytes: number;
  languages: Record<string, number>;
  files: ProjectFileEntry[];
  truncated: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}
