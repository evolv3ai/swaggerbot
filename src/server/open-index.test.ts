import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorkers } from "./open-index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startWorkers", () => {
  it("builds the app once", () => {
    const get = vi.fn();
    startWorkers(get);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("logs an app that can't be built and lets the server start", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn(() => {
      throw new Error("TYPESAFE_API_KEY is not set");
    });
    expect(() => startWorkers(get)).not.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/workers didn't start/);
  });
});
