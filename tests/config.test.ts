import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const original = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original);
});

describe("loadConfig security invariants", () => {
  it("allows the default loopback listener without a token", () => {
    delete process.env.DASHBOARD_HOST;
    delete process.env.SSH_NEXUS_TOKEN;
    expect(loadConfig()).toMatchObject({ dashboardHost: "127.0.0.1", token: undefined });
  });

  it("rejects a non-loopback listener without a token", () => {
    process.env.DASHBOARD_HOST = "0.0.0.0";
    delete process.env.SSH_NEXUS_TOKEN;
    expect(() => loadConfig()).toThrow("SSH_NEXUS_TOKEN is required");
  });
});
