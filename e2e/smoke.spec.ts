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
      page.getByRole("button", { name: "Iniciar Sessão" })
    ).toBeVisible();

    // Select 5m preset and start session
    await page.getByRole("button", { name: "5m", exact: true }).click();
    await page.getByRole("button", { name: "Iniciar Sessão" }).click();

    // Wait for running or warmup phase controls
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();

    // Activate and wake Zen Dim Mode
    await page.getByRole("button", { name: "Escurecer tela" }).click();
    const wakeOverlay = page.getByRole("button", {
      name: "Despertar tela escurecida",
    });
    await expect(wakeOverlay).toBeVisible();
    await expect(
      page.getByText("Toque em qualquer lugar para despertar")
    ).toBeVisible();
    await wakeOverlay.click();
    await expect(wakeOverlay).toBeHidden();

    // Pause, resume, and finish
    await page.getByRole("button", { name: "Pausar" }).click();
    await expect(page.getByText("Pausado")).toBeVisible();
    await page.getByRole("button", { name: "Retomar" }).click();
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();

    await page.getByRole("button", { name: "Encerrar" }).click();
    await expect(
      page.getByRole("button", { name: "Iniciar Sessão" })
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("timer duration supports inline click-to-edit with clamping, Escape cancel, and commit on start", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    await page.goto("/");

    const editDurationTrigger = page
      .getByRole("button", { name: "Editar duração em minutos" })
      .first();
    await expect(editDurationTrigger).toBeVisible();

    // Edit to 25 minutes and confirm with Enter
    await editDurationTrigger.click();
    const durationInput = page.getByRole("textbox", {
      name: "Duração em minutos",
    });
    await expect(durationInput).toBeFocused();
    await durationInput.fill("25");
    await durationInput.press("Enter");
    await expect(page.getByText("25:00", { exact: true })).toBeVisible();
    await expect(page.getByText("25 min", { exact: true })).toBeVisible();

    // Out-of-range value clamps silently to 180 minutes (3:00:00)
    await editDurationTrigger.click();
    await durationInput.fill("999");
    await durationInput.press("Enter");
    await expect(page.getByText("3:00:00", { exact: true })).toBeVisible();

    // Escape cancels and restores previous duration
    await editDurationTrigger.click();
    await durationInput.fill("7");
    await durationInput.press("Escape");
    await expect(page.getByText("3:00:00", { exact: true })).toBeVisible();

    // Clicking Begin Session while editing commits and starts immediately
    await editDurationTrigger.click();
    await durationInput.fill("12");
    await page.getByRole("button", { name: "Iniciar Sessão" }).click();
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();
    await page.getByRole("button", { name: "Encerrar" }).click();
    await expect(page.getByText("12:00", { exact: true })).toBeVisible();

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
    await page.getByRole("tab", { name: "Livre", exact: true }).click();
    await expect(page.getByText("Sessão livre")).toBeVisible();
    const openBox = await timerDial.boundingBox();
    expect(openBox).not.toBeNull();
    expect(Math.abs((openBox?.y ?? 0) - (timerBox?.y ?? 0))).toBeLessThanOrEqual(2);

    await page.getByRole("button", { name: "Iniciar Sessão" }).click();
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();
    await page.getByRole("button", { name: "Encerrar" }).click();
    await expect(
      page.getByRole("button", { name: "Iniciar Sessão" })
    ).toBeVisible();

    // Configure 3x closing bell strikes in End sound picker
    await page.getByRole("button", { name: /^Fim/ }).click();
    await page.getByRole("button", { name: "3×", exact: true }).click();
    await page.getByRole("button", { name: "Fechar seletor de som" }).click();
    await expect(page.getByRole("button", { name: /3×/ })).toBeVisible();

    // Switch to Guided Breathing sub-mode and verify dial alignment + single-line Box rhythm
    await page.getByRole("tab", { name: "Respiração", exact: true }).click();
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

    await page.getByRole("button", { name: "Iniciar Respiração" }).click();
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();

    await page.getByRole("button", { name: "Escurecer tela" }).click();
    const wakeOverlay = page.getByRole("button", {
      name: "Despertar tela escurecida",
    });
    await expect(wakeOverlay).toBeVisible();
    await wakeOverlay.click();
    await expect(wakeOverlay).toBeHidden();

    await page.getByRole("button", { name: "Encerrar" }).click();
    await expect(
      page.getByRole("button", { name: "Iniciar Respiração" })
    ).toBeVisible();

    // Switch to Retention breathing mode and verify dial alignment + protocol flow
    await page.getByRole("tab", { name: "Retenção", exact: true }).click();
    await expect(page.getByLabel("3 × 30")).toBeVisible();
    const retentionBox = await timerDial.boundingBox();
    expect(retentionBox).not.toBeNull();
    expect(
      Math.abs((retentionBox?.y ?? 0) - (timerBox?.y ?? 0))
    ).toBeLessThanOrEqual(2);

    // Customize rounds, pace, and protocol sheet
    await page.getByRole("button", { name: "Aumentar 1 round" }).click();
    await expect(page.getByLabel("4 × 30")).toBeVisible();
    await page.getByRole("button", { name: "Rápido", exact: true }).click();
    await page.getByRole("button", { name: /^Protocolo/ }).click();
    await page.getByRole("button", { name: "20", exact: true }).click();
    await page.getByRole("button", { name: "Concluir", exact: true }).click();
    await expect(page.getByLabel("4 × 20")).toBeVisible();

    // Start Retention session -> skip to empty-lung hold -> trigger recovery -> Zen Dim -> finish
    await page.getByRole("button", { name: "Iniciar Retenção" }).click();
    await expect(page.getByRole("button", { name: "Segurar agora" })).toBeVisible();

    await page.getByRole("button", { name: "Segurar agora" }).click();
    await expect(
      page.getByRole("button", { name: "Inspirar e Recuperar" }).first()
    ).toBeVisible();
    const holdHint = page.getByText("Toque quando quiser inspirar");
    const holdRing = page.locator('svg[width="152"]');
    await expect(holdHint).toBeVisible();
    const [hintBox, ringBox] = await Promise.all([
      holdHint.boundingBox(),
      holdRing.boundingBox(),
    ]);
    expect(hintBox).not.toBeNull();
    expect(ringBox).not.toBeNull();
    expect(hintBox!.y).toBeGreaterThanOrEqual(ringBox!.y + ringBox!.height);

    await page.getByRole("button", { name: "Inspirar e Recuperar" }).last().click();
    await expect(page.getByText("Inspire fundo")).toBeVisible();

    await page.getByRole("button", { name: "Escurecer tela" }).click();
    await expect(wakeOverlay).toBeVisible();
    await wakeOverlay.click();
    await expect(wakeOverlay).toBeHidden();

    await page.getByRole("button", { name: "Encerrar" }).click();
    await expect(
      page.getByRole("button", { name: "Iniciar Retenção" })
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("sound picker updates background sound and local practice presets persist across reload", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    await page.goto("/");

    // Open Background sound picker sheet and select Gentle Rain (Chuva Suave)
    await page.getByRole("button", { name: /Fundo/ }).click();
    await expect(page.getByText("Som de Fundo")).toBeVisible();
    await page.getByRole("button", { name: "Chuva Suave", exact: true }).click();
    await page.getByRole("button", { name: "Fechar seletor de som" }).click();
    await expect(page.getByRole("button", { name: /Chuva Suave/ })).toBeVisible();

    // Save a local practice preset
    await page.getByRole("button", { name: "Salvar preset" }).click();
    await page
      .getByPlaceholder("Nome do preset (ex.: Manhã, Foco)")
      .fill("Morning Calm");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Morning Calm/ })
    ).toBeVisible();

    // Reload and verify persistence in localStorage
    await page.reload();
    await expect(
      page.getByRole("button", { name: /^Morning Calm/ })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Chuva Suave/ })).toBeVisible();

    // Enter edit mode and delete the preset cleanly
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page
      .getByRole("button", { name: "Excluir preset Morning Calm" })
      .click();
    await expect(
      page.getByRole("button", { name: /^Morning Calm/ })
    ).toBeHidden();

    expect(errors).toEqual([]);
  });

  test("global language switcher (PT-BR default, EN, ES) with SVG flags and theme toggle persist across reload", async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");

    const ptSwitcher = page.getByRole("button", { name: "Trocar idioma" });
    await expect(ptSwitcher).toHaveAttribute("data-locale", "pt-BR");
    await expect(ptSwitcher.locator('[data-flag="pt-BR"]')).toBeVisible();

    // Open language popover and verify all 3 options are listed
    await ptSwitcher.click();
    const menu = page.getByRole("menu", { name: "Trocar idioma" });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitemradio", { name: "Português" })
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      menu.getByRole("menuitemradio", { name: "English" })
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitemradio", { name: "Español" })
    ).toBeVisible();

    // Switch to English (US flag)
    await menu.getByRole("menuitemradio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("button", { name: "Begin Session" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Guided" })).toBeVisible();
    await expect(page.getByRole("button", { name: "History" })).toBeVisible();
    const enSwitcher = page.getByRole("button", { name: "Switch language" });
    await expect(enSwitcher.locator('[data-flag="en"]')).toBeVisible();

    // Switch to Spanish (Spain flag)
    await enSwitcher.click();
    await page.getByRole("menuitemradio", { name: "Español" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(
      page.getByRole("button", { name: "Iniciar Sesión" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Guiadas" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Historial" })).toBeVisible();
    const esSwitcher = page.getByRole("button", { name: "Cambiar idioma" });
    await expect(esSwitcher.locator('[data-flag="es"]')).toBeVisible();

    // Toggle theme (default light -> dark)
    const initialIsDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    await page
      .getByRole("button", {
        name: initialIsDark
          ? "Cambiar a tema claro"
          : "Cambiar a tema oscuro",
      })
      .click();
    await expect
      .poll(() =>
        page.locator("html").evaluate((el) => el.classList.contains("dark"))
      )
      .toBe(!initialIsDark);

    // Reload and verify both Spanish locale and theme persist
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(
      page.getByRole("button", { name: "Iniciar Sesión" })
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

    // Verify all 13 bundled acoustic audio samples (breath, bells, nature loops) serve cleanly for offline caching
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

    await page.getByRole("button", { name: "Guiadas" }).click();
    await expect(
      page.getByRole("heading", { name: "Meditações Guiadas" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Histórico" }).click();
    await expect(
      page.getByRole("heading", { name: "Histórico de Meditação" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Timer", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Iniciar Sessão" })
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("timer remains 100% usable in simulated offline mode", async ({
    context,
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Iniciar Sessão" })
    ).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });

    await expect(page.getByText("Offline · Timer pronto")).toBeVisible();

    await page.getByRole("button", { name: "Iniciar Sessão" }).click();
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();
    await page.getByRole("button", { name: "Encerrar" }).click();
    await expect(
      page.getByRole("button", { name: "Iniciar Sessão" })
    ).toBeVisible();
  });
});
