import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency } from "../src/ui/fleet-refresh";

describe("mapWithConcurrency", () => {
  it("processes every item without exceeding the requested concurrency", async () => {
    let active = 0;
    let maximumActive = 0;

    const results = await mapWithConcurrency([30, 5, 20, 10, 15, 1], 3, async (delay, index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return index * 2;
    });

    expect(results).toEqual([0, 2, 4, 6, 8, 10]);
    expect(maximumActive).toBe(3);
  });

  it("rejects invalid concurrency without starting work", async () => {
    const worker = vi.fn(async () => undefined);

    await expect(mapWithConcurrency([1], 0, worker)).rejects.toThrow("positive integer");
    expect(worker).not.toHaveBeenCalled();
  });
});
