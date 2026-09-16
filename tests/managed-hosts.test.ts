import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSshHosts } from "../src/ssh/config-parser.js";
import { ManagedHostStore, validateManagedSshHost } from "../src/ssh/managed-hosts.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-managed-"));
  temporaryDirectories.push(root);
  const sourceConfigPath = path.join(root, "config");
  const managedConfigPath = path.join(root, "managed", "hosts.conf");
  await fs.writeFile(sourceConfigPath, [
    "Host production",
    "  HostName 192.0.2.10",
    "  User original",
    "  Port 22",
    "",
  ].join("\n"));
  return {
    root,
    sourceConfigPath,
    managedConfigPath,
    store: new ManagedHostStore(sourceConfigPath, managedConfigPath),
  };
}

describe("ManagedHostStore", () => {
  it("writes structured entries and applies managed overrides without changing the source config", async () => {
    const { sourceConfigPath, managedConfigPath, store } = await fixture();
    const originalSource = await fs.readFile(sourceConfigPath, "utf8");

    await store.upsert({ alias: "production", hostname: "192.0.2.20", user: "deploy", port: 2222 });
    await store.upsert({ alias: "analytics", hostname: "2001:db8::20", port: 22, proxyJump: "production" });

    expect(await store.list()).toEqual([
      { alias: "analytics", hostname: "2001:db8::20", port: 22, proxyJump: "production", user: undefined },
      { alias: "production", hostname: "192.0.2.20", port: 2222, proxyJump: undefined, user: "deploy" },
    ]);
    expect(await fs.readFile(sourceConfigPath, "utf8")).toBe(originalSource);
    expect((await fs.stat(managedConfigPath)).mode & 0o777).toBe(0o600);
    await expect(fs.stat(`${managedConfigPath}.bak`)).resolves.toBeTruthy();

    const effectiveConfigPath = await store.effectiveConfigPath();
    temporaryDirectories.push(path.dirname(effectiveConfigPath));
    const hosts = await loadSshHosts(sourceConfigPath, {
      prependConfigPaths: [managedConfigPath],
      effectiveConfigPath,
      managedConfigPath,
    });
    expect(hosts.find((host) => host.alias === "production")).toMatchObject({
      hostname: "192.0.2.20",
      user: "deploy",
      port: 2222,
      managed: true,
    });
    expect(hosts.find((host) => host.alias === "analytics")).toMatchObject({
      hostname: "2001:db8::20",
      proxyJump: "production",
      managed: true,
    });
  });

  it("rejects option injection and symlink-backed managed files", async () => {
    expect(() => validateManagedSshHost({
      alias: "unsafe",
      hostname: "server\nProxyCommand bad",
      port: 22,
    })).toThrow("Hostname");
    expect(() => validateManagedSshHost({
      alias: "unsafe",
      hostname: "server.example",
      port: 22,
      proxyJump: "safe,bad alias",
    })).toThrow("ProxyJump");

    const { sourceConfigPath, managedConfigPath, store } = await fixture();
    await fs.mkdir(path.dirname(managedConfigPath), { recursive: true });
    await fs.symlink(sourceConfigPath, managedConfigPath);
    await expect(store.list()).rejects.toThrow("not a symlink");
  });
});
