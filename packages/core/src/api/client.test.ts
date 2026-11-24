import { describe, expect, it, vi } from "vitest";
import { BodhiApiError, createBodhiApiClient } from "./client";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("createBodhiApiClient", () => {
  it("attaches Bearer authorization header and normalizes trailing slashes", async () => {
    const fetchFn = vi.fn(async () =>
      mockResponse(200, { sessions: [] })
    );

    const client = createBodhiApiClient({
      baseUrl: "https://bodhi.app/",
      getAccessToken: () => "tok-123",
      fetchFn,
    });

    const result = await client.listSessions();
    expect(result).toEqual({ sessions: [] });
    expect(fetchFn).toHaveBeenCalledWith("https://bodhi.app/api/sessions", {
      method: "GET",
      headers: { Authorization: "Bearer tok-123" },
      body: undefined,
    });
  });

  it("refreshes access token once on 401 and retries the original request", async () => {
    let token = "expired-token";
    const refreshAccessToken = vi.fn(async () => {
      token = "fresh-token";
      return token;
    });

    const fetchFn = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      if (init?.headers?.Authorization === "Bearer expired-token") {
        return mockResponse(401, { error: "Token expired" });
      }
      return mockResponse(200, { tracks: [{ id: "t1" }] });
    });

    const client = createBodhiApiClient({
      baseUrl: "https://bodhi.app",
      getAccessToken: () => token,
      refreshAccessToken,
      fetchFn,
    });

    const res = await client.listTracks();
    expect(res.tracks).toHaveLength(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent 401 refreshes into a single refresh call", async () => {
    let token = "old";
    const refreshAccessToken = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      token = "new";
      return token;
    });

    const fetchFn = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      if (init?.headers?.Authorization === "Bearer old") {
        return mockResponse(401, { error: "Expired" });
      }
      return mockResponse(200, { ok: true });
    });

    const client = createBodhiApiClient({
      baseUrl: "https://bodhi.app",
      getAccessToken: () => token,
      refreshAccessToken,
      fetchFn,
    });

    await Promise.all([client.listTracks(), client.listSessions()]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("throws BodhiApiError with server message on non-OK responses", async () => {
    const fetchFn = vi.fn(async () =>
      mockResponse(400, { error: "Invalid payload" })
    );

    const client = createBodhiApiClient({
      baseUrl: "https://bodhi.app",
      fetchFn,
    });

    await expect(client.resolveTrack("bad")).rejects.toEqual(
      expect.objectContaining({
        name: "BodhiApiError",
        status: 400,
        message: "Invalid payload",
      })
    );

    try {
      await client.resolveTrack("bad");
    } catch (err) {
      expect(err).toBeInstanceOf(BodhiApiError);
    }
  });

  it("builds encoded audio stream URLs", () => {
    const client = createBodhiApiClient({ baseUrl: "https://bodhi.app/" });
    expect(client.getAudioStreamUrl("trk/123")).toBe(
      "https://bodhi.app/api/tracks/trk%2F123/audio"
    );
  });
});
