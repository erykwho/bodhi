import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryRawMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

import { GET } from "@/app/api/health/route";

describe("API /api/health", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("returns 200 without querying the database by default", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/bodhi";

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(queryRawMock).not.toHaveBeenCalled();

    const data = (await res.json()) as { status: string; timestamp: string };
    expect(data.status).toBe("ok");
    expect(typeof data.timestamp).toBe("string");
  });

  it("returns 200 with db: ok when ?db=1 succeeds", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/bodhi";
    queryRawMock.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET(new Request("http://localhost/api/health?db=1"));
    expect(res.status).toBe(200);
    expect(queryRawMock).toHaveBeenCalledTimes(1);

    const data = (await res.json()) as { status: string; db: string };
    expect(data.status).toBe("ok");
    expect(data.db).toBe("ok");
  });

  it("returns 503 with status: degraded when ?db=1 fails", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/bodhi";
    queryRawMock.mockRejectedValue(new Error("connection refused"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(new Request("http://localhost/api/health?db=1"));
    expect(res.status).toBe(503);

    const data = (await res.json()) as { status: string; db: string };
    expect(data.status).toBe("degraded");
    expect(data.db).toBe("error");
    errorSpy.mockRestore();
  });

  it("returns 200 with db: unconfigured when DATABASE_URL is absent", async () => {
    delete process.env.DATABASE_URL;

    const res = await GET(new Request("http://localhost/api/health?db=1"));
    expect(res.status).toBe(200);
    expect(queryRawMock).not.toHaveBeenCalled();

    const data = (await res.json()) as { status: string; db: string };
    expect(data.status).toBe("ok");
    expect(data.db).toBe("unconfigured");
  });
});
