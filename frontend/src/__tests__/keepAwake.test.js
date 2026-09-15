/**
 * Tests for the keep-alive scheduled function.
 *
 * The function reads its configuration from the environment when the module
 * loads, so each test sets the environment and then imports it fresh.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MODULE = "../../netlify/functions/keep-awake.mjs";

async function loadFunction(env = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (await import(MODULE)).default;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.API_PROXY_TARGET;
  delete process.env.KEEP_AWAKE;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("the schedule", () => {
  it("fires well inside the sleep window", async () => {
    vi.resetModules();
    const { config } = await import(MODULE);

    // Render sleeps after roughly fifteen minutes. Five gives three chances
    // inside that window, so one late or dropped run does not let it sleep.
    expect(config.schedule).toBe("*/5 * * * *");
  });

  it("is registered in a directory netlify is told to look in", () => {
    // A functions directory that is merely not found deploys a site with no
    // functions and no error, so the config is asserted rather than assumed.
    const toml = readFileSync(
      resolve(process.cwd(), "..", "netlify.toml"),
      "utf8",
    );

    expect(toml).toContain('directory = "netlify/functions"');
  });
});

describe("pinging the backend", () => {
  it("calls the ping endpoint, not the health endpoint", async () => {
    // Health reads the database. Scheduling it every five minutes would hold
    // the Postgres compute awake around the clock as well, spending a free
    // allowance meant for patients on the monitor instead.
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const keepAwake = await loadFunction({
      API_PROXY_TARGET: "https://api.example.com",
    });
    const result = await keepAwake();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/api/ping/");
    expect(result.status).toBe(200);
  });

  it("tolerates a trailing slash on the configured address", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const keepAwake = await loadFunction({
      API_PROXY_TARGET: "https://api.example.com/",
    });
    await keepAwake();

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/api/ping/");
  });

  it("allows long enough for a sleeping service to wake", async () => {
    // This request is the one that wakes it, and that takes the better part of
    // a minute. Giving up early would abandon the wake up it was scheduled to
    // perform.
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const keepAwake = await loadFunction({
      API_PROXY_TARGET: "https://api.example.com",
    });
    await keepAwake();

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("when it cannot do its job", () => {
  it("fails loudly with no backend address configured", async () => {
    // The dangerous case: a scheduled function running every five minutes,
    // reporting success, pinging nothing. The logs would say it works.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const keepAwake = await loadFunction({ API_PROXY_TARGET: undefined });
    const result = await keepAwake();

    expect(result.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("reports an unhealthy upstream rather than claiming success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 502 })),
    );

    const keepAwake = await loadFunction({
      API_PROXY_TARGET: "https://api.example.com",
    });

    expect((await keepAwake()).status).toBe(502);
  });

  it("survives the service being unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const keepAwake = await loadFunction({
      API_PROXY_TARGET: "https://api.example.com",
    });

    expect((await keepAwake()).status).toBe(502);
  });
});

describe("turning it off", () => {
  it("skips the ping when KEEP_AWAKE is off", async () => {
    // Staying awake consumes Render's monthly instance-hours continuously
    // rather than only while the app is used, so stopping it is one dashboard
    // setting rather than a commit and a redeploy.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const keepAwake = await loadFunction({
      API_PROXY_TARGET: "https://api.example.com",
      KEEP_AWAKE: "off",
    });
    const result = await keepAwake();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  it("pings by default when the variable is absent", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const keepAwake = await loadFunction({
      API_PROXY_TARGET: "https://api.example.com",
      KEEP_AWAKE: undefined,
    });
    await keepAwake();

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
