import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ProjectFileEntry, ProjectIndex, SearchMatch } from "../shared.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".ssh-nexus",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "vendor",
]);

const SENSITIVE_NAMES = [
  /^\.env(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i,
  /^(?:authorized_keys|known_hosts)$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
];

const TEXT_EXTENSIONS = new Set([
  "",
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".css",
  ".dockerfile",
  ".go",
  ".graphql",
  ".h",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".php",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSensitive(fileName: string): boolean {
  return SENSITIVE_NAMES.some((pattern) => pattern.test(fileName));
}

function isTextFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return basename === "dockerfile" || basename === "makefile" || TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function languageName(filePath: string): string {
  const basename = path.basename(filePath).toLowerCase();
  if (basename === "dockerfile") return "Dockerfile";
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return extension || "other";
}

async function sha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export class ProjectIndexer {
  constructor(private readonly config: AppConfig) {}

  private async resolveRoot(requested?: string): Promise<string> {
    const candidate = path.resolve(requested || this.config.projectRoots[0]);
    const realCandidate = await fs.realpath(candidate);
    const realAllowedRoots = await Promise.all(this.config.projectRoots.map((root) => fs.realpath(path.resolve(root))));
    const realAllowed = realAllowedRoots.find((root) => isInside(realCandidate, root));
    if (!realAllowed) throw new Error("Project path is outside PROJECT_ROOTS");
    return realCandidate;
  }

  async index(requested?: string): Promise<ProjectIndex> {
    const root = await this.resolveRoot(requested);
    const files: ProjectFileEntry[] = [];
    const languages: Record<string, number> = {};
    let totalBytes = 0;
    let truncated = false;

    const visit = async (directory: string): Promise<void> => {
      if (files.length >= this.config.maxIndexFiles) {
        truncated = true;
        return;
      }
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= this.config.maxIndexFiles) {
          truncated = true;
          return;
        }
        if (entry.isSymbolicLink() || isSensitive(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        const stat = await fs.stat(absolute);
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        let lines: number | null = null;
        if (isTextFile(absolute) && stat.size <= 512 * 1024) {
          const content = await fs.readFile(absolute, "utf8");
          if (!content.includes("\0")) lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
        }
        files.push({
          path: relative,
          bytes: stat.size,
          lines,
          modifiedAt: stat.mtime.toISOString(),
          sha256: await sha256(absolute),
        });
        totalBytes += stat.size;
        const language = languageName(absolute);
        languages[language] = (languages[language] ?? 0) + 1;
      }
    };

    await visit(root);
    const index: ProjectIndex = {
      version: 1,
      root,
      generatedAt: new Date().toISOString(),
      fileCount: files.length,
      totalBytes,
      languages,
      files,
      truncated,
    };
    const outputDirectory = path.join(root, ".ssh-nexus");
    await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(outputDirectory, "index.json"), `${JSON.stringify(index, null, 2)}\n`, {
      mode: 0o600,
    });
    return index;
  }

  async read(requested?: string): Promise<ProjectIndex | null> {
    const root = await this.resolveRoot(requested);
    try {
      return JSON.parse(await fs.readFile(path.join(root, ".ssh-nexus", "index.json"), "utf8")) as ProjectIndex;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async search(query: string, requested?: string, limit = 25): Promise<SearchMatch[]> {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 200) throw new Error("Search query must contain 1 to 200 characters");
    const root = await this.resolveRoot(requested);
    const index = (await this.read(root)) ?? (await this.index(root));
    const needle = trimmed.toLocaleLowerCase();
    const matches: SearchMatch[] = [];
    for (const file of index.files) {
      if (matches.length >= Math.min(Math.max(limit, 1), 100)) break;
      if (file.lines === null || file.bytes > 512 * 1024 || isSensitive(path.basename(file.path))) continue;
      const absolute = path.resolve(root, file.path);
      if (!isInside(absolute, root)) continue;
      const content = await fs.readFile(absolute, "utf8");
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLocaleLowerCase().includes(needle)) continue;
        matches.push({ path: file.path, line: index + 1, preview: lines[index].trim().slice(0, 240) });
        if (matches.length >= Math.min(Math.max(limit, 1), 100)) break;
      }
    }
    return matches;
  }
}
