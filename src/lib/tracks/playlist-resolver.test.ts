import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSoundCloudHydrationPlaylist,
  extractYouTubeInitialDataPlaylist,
  parseYouTubeRssPlaylist,
  resolveExternalPlaylist,
} from "./playlist-resolver";

describe("external playlist resolver", () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.YOUTUBE_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = originalApiKey;
    }
  });

  it("extracts YouTube tracks from ytInitialData, skips private/deleted videos, and truncates at limit", () => {
    const videos = Array.from({ length: 5 }, (_, i) => ({
      playlistVideoRenderer: {
        videoId: `vid0000000${i}`,
        title: { runs: [{ text: `Day ${i + 1} Meditation` }] },
        shortBylineText: { runs: [{ text: "Calm Guide" }] },
        thumbnail: {
          thumbnails: [{ url: `https://i.ytimg.com/vi/vid0000000${i}/hqdefault.jpg` }],
        },
        isPlayable: true,
      },
    }));

    const payload = {
      metadata: {
        playlistMetadataRenderer: { title: "21-Day Meditation Course" },
      },
      header: {
        playlistHeaderRenderer: {
          ownerText: { runs: [{ text: "Calm Guide" }] },
          numVideosText: { runs: [{ text: "65" }, { text: " videos" }] },
        },
      },
      contents: {
        items: [
          ...videos,
          {
            playlistVideoRenderer: {
              videoId: "priv0000001",
              title: { simpleText: "[Private video]" },
              isPlayable: false,
            },
          },
          { continuationItemRenderer: { trigger: "CONTINUATION" } },
        ],
      },
    };

    const html = `<html><script>var ytInitialData = ${JSON.stringify(payload)};</script></html>`;
    const result = extractYouTubeInitialDataPlaylist(
      html,
      "PL1234567890",
      "https://www.youtube.com/playlist?list=PL1234567890",
      3
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe("21-Day Meditation Course");
    expect(result!.author).toBe("Calm Guide");
    expect(result!.totalCount).toBe(65);
    expect(result!.truncated).toBe(true);
    expect(result!.limit).toBe(3);
    expect(result!.tracks).toHaveLength(3);
    expect(result!.tracks[0]).toEqual({
      provider: "YOUTUBE",
      externalId: "vid00000000",
      url: "https://www.youtube.com/watch?v=vid00000000",
      title: "Day 1 Meditation",
      author: "Calm Guide",
      thumbnailUrl: "https://i.ytimg.com/vi/vid00000000/hqdefault.jpg",
    });
  });

  it("parses YouTube XML RSS fallback cleanly with XML entity decoding", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
        <title>Breath &amp; Calm</title>
        <author><name>Zen Channel</name></author>
        <entry>
          <yt:videoId>abcDEF12345</yt:videoId>
          <title>Session 1 &amp; Focus</title>
          <author><name>Zen Channel</name></author>
          <media:group><media:thumbnail url="https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg" /></media:group>
        </entry>
      </feed>`;

    const result = parseYouTubeRssPlaylist(
      xml,
      "PL1234567890",
      "https://www.youtube.com/playlist?list=PL1234567890",
      50
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Breath & Calm");
    expect(result!.tracks).toHaveLength(1);
    expect(result!.tracks[0].title).toBe("Session 1 & Focus");
    expect(result!.truncated).toBe(false);
  });

  it("extracts SoundCloud sets from window.__sc_hydration including hydrated tracks and unhydrated stubs", () => {
    const hydration = [
      {
        hydratable: "playlist",
        data: {
          title: "Deep Sleep Set",
          track_count: 12,
          user: { username: "SleepTeacher" },
          tracks: [
            {
              id: 101,
              permalink_url: "https://soundcloud.com/sleepteacher/night-breath",
              title: "Night Breath",
              artwork_url: "https://i1.sndcdn.com/art-large.jpg",
              user: { username: "SleepTeacher" },
            },
            { id: 102 },
          ],
        },
      },
    ];

    const html = `<html><script>window.__sc_hydration = ${JSON.stringify(hydration)};</script></html>`;
    const extracted = extractSoundCloudHydrationPlaylist(
      html,
      "sleepteacher/sets/deep-sleep",
      "https://soundcloud.com/sleepteacher/sets/deep-sleep",
      10
    );

    expect(extracted).not.toBeNull();
    expect(extracted!.playlist.title).toBe("Deep Sleep Set");
    expect(extracted!.playlist.totalCount).toBe(12);
    expect(extracted!.playlist.truncated).toBe(true);
    expect(extracted!.playlist.tracks).toHaveLength(1);
    expect(extracted!.playlist.tracks[0].thumbnailUrl).toBe(
      "https://i1.sndcdn.com/art-t500x500.jpg"
    );
    expect(extracted!.missingTrackIds).toEqual([102]);
  });

  it("uses optional YOUTUBE_API_KEY when configured and caps results at limit", async () => {
    process.env.YOUTUBE_API_KEY = "test-yt-key";
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/youtube/v3/playlists")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                snippet: { title: "API Meditation Series", channelTitle: "Host" },
                contentDetails: { itemCount: 75 },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          pageInfo: { totalResults: 75 },
          nextPageToken: "NEXT",
          items: [
            {
              snippet: {
                title: "Part 1",
                videoOwnerChannelTitle: "Host",
                resourceId: { videoId: "abcdefghijk" },
                thumbnails: { high: { url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" } },
              },
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await resolveExternalPlaylist(
      "https://www.youtube.com/playlist?list=PL1234567890",
      50
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe("API Meditation Series");
    expect(result!.totalCount).toBe(75);
    expect(result!.truncated).toBe(true);
    expect(result!.tracks).toHaveLength(1);
  });
});
