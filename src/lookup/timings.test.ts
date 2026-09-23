import { describe, expect, it } from "vitest";
import { stepTimer } from "./timings";

describe("stepTimer", () => {
  it("adds up a step that runs more than once", async () => {
    const { timed, timings } = stepTimer();
    await timed("Judge whichApi", () => new Promise((r) => setTimeout(r, 20)));
    await timed("Judge whichApi", () => new Promise((r) => setTimeout(r, 20)));
    expect(timings()["Judge whichApi"]).toBeGreaterThanOrEqual(35);
  });

  it("records a step that throws, and rethrows", async () => {
    const { timed, timings } = stepTimer();
    await expect(
      timed("APIs.guru", async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    expect(timings()["APIs.guru"]).toBeGreaterThanOrEqual(5);
  });

  it("times a synchronous step and returns its value", async () => {
    const { timed, timings } = stepTimer();
    expect(await timed("umbrella check", () => 7)).toBe(7);
    expect(timings()).toEqual({ "umbrella check": expect.any(Number) });
  });
});
