import { expect, test, type Page } from "@playwright/test";

function trackRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  return errors;
}

test.describe("Bodhi E2E Smoke Suite (Mobile PWA)", () => {
  test("public timer runs without sign-in, supports pause/resume, Zen Dim, and reset", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    await page.goto("/");
    await expect(page.getByText("Bodhi", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Begin Session" })
    ).toBeVisible();

    // Select 5m preset and start session
    await page.getByRole("button", { name: "5m", exact: true }).click();
    await page.getByRole("button", { name: "Begin Session" }).click();

    // Wait for running or warmup phase controls
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    // Activate and wake Zen Dim Mode
    await page.getByRole("button", { name: "Dim screen" }).click();
    const wakeOverlay = page.getByRole("button", {
      name: "Wake dimmed screen",
    });
    await expect(wakeOverlay).toBeVisible();
    await expect(page.getByText("Tap anywhere to wake")).toBeVisible();
    await wakeOverlay.click();
    await expect(wakeOverlay).toBeHidden();

    // Pause, resume, and finish
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused")).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await page.getByRole("button", { name: "Finish" }).click();
    await expect(
      page.getByRole("button", { name: "Begin Session" })
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("V9 Open-Ended mode, Guided Breathing flow, and 3x closing bell persist cleanly", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    await page.goto("/");

    // Capture Timer dial Y-position for vertical alignment consistency
    const timerDial = page.locator("section > div.rounded-full").first();
    const timerBox = await timerDial.boundingBox();
    expect(timerBox).not.toBeNull();

    // Switch to Open-Ended mode and verify dial stays vertically aligned
    await page.getByRole("tab", { name: "Open", exact: true }).click();
    await expect(page.getByText("Open session")).toBeVisible();
    const openBox = await timerDial.boundingBox();
    expect(openBox).not.toBeNull();
    expect(Math.abs((openBox?.y ?? 0) - (timerBox?.y ?? 0))).toBeLessThanOrEqual(2);

    await page.getByRole("button", { name: "Begin Session" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(
      page.getByRole("button", { name: "Begin Session" })
    ).toBeVisible();

    // Configure 3x closing bell strikes in End sound picker
    await page.getByRole("button", { name: /^End/ }).click();
    await page.getByRole("button", { name: "3×", exact: true }).click();
    await page.getByRole("button", { name: "Close sound picker" }).click();
    await expect(page.getByRole("button", { name: /3×/ })).toBeVisible();

    // Switch to Guided Breathing sub-mode and verify dial alignment + single-line Box rhythm
    await page.getByRole("tab", { name: "Breathe", exact: true }).click();
    const rhythmEl = page.getByLabel("4 · 4 · 4 · 4");
    await expect(rhythmEl).toBeVisible();
    const breatheBox = await timerDial.boundingBox();
    const rhythmBox = await rhythmEl.boundingBox();
    expect(breatheBox).not.toBeNull();
    expect(rhythmBox).not.toBeNull();
    expect(Math.abs((breatheBox?.y ?? 0) - (timerBox?.y ?? 0))).toBeLessThanOrEqual(2);
    expect(rhythmBox!.height).toBeLessThan(38);
    expect(rhythmBox!.width).toBeLessThan(breatheBox!.width - 24);

    await page.getByRole("button", { name: "4-7-8", exact: true }).click();
    await expect(page.getByLabel("4 · 7 · 8")).toBeVisible();

    await page.getByRole("button", { name: "Begin Breathing" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await page.getByRole("button", { name: "Dim screen" }).click();
    const wakeOverlay = page.getByRole("button", {
      name: "Wake dimmed screen",
    });
    await expect(wakeOverlay).toBeVisible();
    await wakeOverlay.click();
    await expect(wakeOverlay).toBeHidden();

    await page.getByRole("button", { name: "Finish" }).click();
    await expect(
      page.getByRole("button", { name: "Begin Breathing" })
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("sound picker updates background sound and local practice presets persist across reload", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    await page.goto("/");

    // Open Background sound picker sheet and select Gentle Rain
    await page.getByRole("button", { name: /Background/ }).click();
    await expect(page.getByText("Background Sound")).toBeVisible();
    await page.getByRole("button", { name: "Gentle Rain", exact: true }).click();
    await page.getByRole("button", { name: "Close sound picker" }).click();
    await expect(page.getByRole("button", { name: /Gentle Rain/ })).toBeVisible();

    // Save a local practice preset
    await page.getByRole("button", { name: "Save preset" }).click();
    await page
      .getByPlaceholder("Preset name (e.g. Morning, Deep Focus)")
      .fill("Morning Calm");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Morning Calm/ })
    ).toBeVisible();

    // Reload and verify persistence in localStorage
    await page.reload();
    await expect(
      page.getByRole("button", { name: /^Morning Calm/ })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Gentle Rain/ })).toBeVisible();

    // Enter edit mode and delete the preset cleanly
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("button", { name: "Delete preset Morning Calm" })
      .click();
    await expect(
      page.getByRole("button", { name: /^Morning Calm/ })
    ).toBeHidden();

    expect(errors).toEqual([]);
  });

  test("global language switcher (EN <-> PT-BR) and theme toggle persist across reload", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // Switch language to pt-BR
    await page.getByRole("button", { name: "Switch language" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(
      page.getByRole("button", { name: "Iniciar Sessão" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Guiadas" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Histórico" })).toBeVisible();

    // Toggle theme (default light -> dark)
    const initialIsDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    await page
      .getByRole("button", {
        name: initialIsDark
          ? "Mudar para tema claro"
          : "Mudar para tema escuro",
      })
      .click();
    await expect
      .poll(() =>
        page.locator("html").evaluate((el) => el.classList.contains("dark"))
      )
      .toBe(!initialIsDark);

    // Reload and verify both locale and theme persist
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(
      page.getByRole("button", { name: "Iniciar Sessão" })
    ).toBeVisible();
    const afterReloadIsDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    expect(afterReloadIsDark).toBe(!initialIsDark);

    expect(errors).toEqual([]);
  });

  test("navigation tabs render signed-out states cleanly and /api/health responds 200", async ({
    page,
    request,
  }) => {
    const errors = trackRuntimeErrors(page);

    const healthRes = await request.get("/api/health");
    expect(healthRes.status()).toBe(200);
    const healthBody = (await healthRes.json()) as { status: string };
    expect(healthBody.status).toBe("ok");

    // Verify all 14 bundled CC0 audio samples (breath, bells, nature loops) serve cleanly for offline caching
    const expectedAudioAssets: Array<{ path: string; minBytes: number }> = [
      { path: "/audio/breath-inhale-short.mp3", minBytes: 10_000 },
      { path: "/audio/breath-exhale-short.mp3", minBytes: 10_000 },
      { path: "/audio/breath-inhale-medium.mp3", minBytes: 10_000 },
      { path: "/audio/breath-exhale-medium.mp3", minBytes: 10_000 },
      { path: "/audio/breath-inhale-long.mp3", minBytes: 10_000 },
      { path: "/audio/breath-exhale-long.mp3", minBytes: 10_000 },
      { path: "/audio/bells/singing-bowl.mp3", minBytes: 10_000 },
      { path: "/audio/bells/tibetan-healing-bowl.mp3", minBytes: 10_000 },
      { path: "/audio/bells/deep-gong.mp3", minBytes: 10_000 },
      { path: "/audio/bells/soft-chime.mp3", minBytes: 10_000 },
      { path: "/audio/bells/crystal-bowl.mp3", minBytes: 10_000 },
      { path: "/audio/bells/wood-block.mp3", minBytes: 4_000 },
      { path: "/audio/ambient/gentle-rain.mp3", minBytes: 50_000 },
      { path: "/audio/ambient/ocean-waves.mp3", minBytes: 50_000 },
    ];
    for (const asset of expectedAudioAssets) {
      const audioRes = await request.get(asset.path);
      expect(audioRes.status()).toBe(200);
      expect(audioRes.headers()["content-type"]).toContain("audio/mpeg");
      const bytes = await audioRes.body();
      expect(bytes.byteLength).toBeGreaterThan(asset.minBytes);
    }

    await page.goto("/");

    await page.getByRole("button", { name: "Guided" }).click();
    await expect(
      page.getByRole("heading", { name: "Favorite Guided Tracks" })
    ).toBeVisible();

    await page.getByRole("button", { name: "History" }).click();
    await expect(
      page.getByRole("heading", { name: "Meditation History" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Timer", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Begin Session" })
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("timer remains 100% usable in simulated offline mode", async ({
    context,
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Begin Session" })
    ).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });

    await expect(page.getByText("Offline · Timer ready")).toBeVisible();

    await page.getByRole("button", { name: "Begin Session" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(
      page.getByRole("button", { name: "Begin Session" })
    ).toBeVisible();
  });
});
