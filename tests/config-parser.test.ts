import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSshHosts } from "../src/ssh/config-parser.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("loadSshHosts", () => {
  it("loads explicit aliases and Include files while excluding patterns", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-config-"));
    temporaryDirectories.push(directory);
    const includeDirectory = path.join(directory, "config.d");
    await fs.mkdir(includeDirectory);
    await fs.writeFile(path.join(includeDirectory, "team.conf"), "Host team-api\n  HostName 192.0.2.20\n  User deploy\n");
    const configPath = path.join(directory, "config");
    await fs.writeFile(configPath, [
      `Include ${includeDirectory}/*`,
      "Host prod-web",
      "  HostName 192.0.2.10",
      "  User ubuntu",
      "  Port 2222",
      "Host *.internal !blocked",
      "  User ignored",
      "Host *",
      "  ConnectTimeout 5",
      "",
    ].join("\n"));

    const hosts = await loadSshHosts(configPath);

    expect(hosts.map((host) => host.alias)).toEqual(["team-api", "prod-web"]);
    expect(hosts.find((host) => host.alias === "prod-web")).toMatchObject({
      hostname: "192.0.2.10",
      user: "ubuntu",
      port: 2222,
      source: "config",
    });
    expect(hosts.find((host) => host.alias === "team-api")?.source).toBe("team.conf");
  });

  it("returns an empty inventory for a missing config", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-config-"));
    temporaryDirectories.push(directory);
    await expect(loadSshHosts(path.join(directory, "missing"))).resolves.toEqual([]);
  });

  it("accepts OpenSSH keyword=value syntax", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-nexus-config-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config");
    await fs.writeFile(configPath, "Host=equals-style\n  HostName=192.0.2.90\n");
    const hosts = await loadSshHosts(configPath);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ alias: "equals-style", hostname: "192.0.2.90" });
  });
});
