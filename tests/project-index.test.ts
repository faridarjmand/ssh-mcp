import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { ProjectIndexer } from "../src/indexer/project-index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function config(root: string): AppConfig {
  return {
    sshConfigPath: path.join(root, "ssh-config"),
    managedSshConfigPath: path.join(root, "managed", "hosts.conf"),
    dashboardHost: "127.0.0.1",
    dashboardPort: 3100,
    projectRoots: [root],
    sshCheckTimeoutMs: 500,
    sshCommandTimeoutMs: 1_000,
    metricsCacheMs: 0,
    maxIndexFiles: 100,
    allowRemoteCommands: false,
    allowSshConfigWrites: false,
  };
}

describe("ProjectIndexer", () => {
  it("indexes safe source files and excludes secret-like and generated paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-index-"));
    temporaryDirectories.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.mkdir(path.join(root, "node_modules"));
    await fs.writeFile(path.join(root, "src", "service.ts"), "export function healthCheck() { return 'ok'; }\n");
    await fs.writeFile(path.join(root, "README.md"), "# Example\n");
    await fs.writeFile(path.join(root, ".env"), "SECRET=do-not-index\n");
    await fs.writeFile(path.join(root, "id_ed25519"), "private key material\n");
    await fs.writeFile(path.join(root, "node_modules", "ignored.js"), "ignored\n");

    const indexer = new ProjectIndexer(config(root));
    const index = await indexer.index();

    expect(index.files.map((file) => file.path)).toEqual(["README.md", "src/service.ts"]);
    expect(index.fileCount).toBe(2);
    expect(await fs.stat(path.join(root, ".ssh-nexus", "index.json"))).toBeTruthy();

    const matches = await indexer.search("healthCheck");
    expect(matches).toEqual([{ path: "src/service.ts", line: 1, preview: "export function healthCheck() { return 'ok'; }" }]);
  });

  it("rejects a project outside configured roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-index-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-outside-"));
    temporaryDirectories.push(root, outside);
    const indexer = new ProjectIndexer(config(root));
    await expect(indexer.index(outside)).rejects.toThrow("outside PROJECT_ROOTS");
  });
});
