"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { BodhiLogo } from "@/components/bodhi-logo";
import { MeditationAudioEngine } from "@/lib/audio/engine";
import {
  AMBIENT_SOUNDS,
  DEFAULT_AMBIENT_SOUND_ID,
  DEFAULT_AMBIENT_VOLUME,
  type AmbientSoundId,
} from "@/lib/audio/sounds";
import {
  clampDurationMinutes,
  computeProgress,
  computeRemainingMs,
  formatDurationLabel,
  formatTimerDisplay,
} from "@/lib/timer/engine";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_WARMUP_SECONDS,
  DURATION_PRESETS_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  WARMUP_OPTIONS_SECONDS,
  type TimerPhase,
  type WarmupSeconds,
} from "@/lib/timer/types";
import { useWakeLock } from "@/lib/wake-lock";

const RING_SIZE = 264;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE * 2) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface MeditationTimerProps {
  onSessionActiveChange?: (active: boolean) => void;
}

export function MeditationTimer({
  onSessionActiveChange,
}: MeditationTimerProps) {
  // Setup state
  const [durationMinutes, setDurationMinutes] = useState<number>(
    DEFAULT_DURATION_MINUTES
  );
  const [warmupSeconds, setWarmupSeconds] = useState<WarmupSeconds>(
    DEFAULT_WARMUP_SECONDS
  );
  const [selectedSound, setSelectedSound] = useState<AmbientSoundId>(
    DEFAULT_AMBIENT_SOUND_ID
  );
  const [ambientVolume, setAmbientVolume] = useState<number>(
    DEFAULT_AMBIENT_VOLUME
  );
  const [isAmbientMuted, setIsAmbientMuted] = useState<boolean>(false);
  const [previewingSoundId, setPreviewingSoundId] =
    useState<AmbientSoundId | null>(null);

  // Active session state
  const [phase, setPhase] = useState<TimerPhase>("idle");
  const [pausedFromPhase, setPausedFromPhase] = useState<"warmup" | "running">(
    "running"
  );
  const [remainingMs, setRemainingMs] = useState<number>(
    DEFAULT_DURATION_MINUTES * 60 * 1000
  );

  const endTimeRef = useRef<number | null>(null);
  const audioRef = useRef<MeditationAudioEngine | null>(null);

  const getAudioEngine = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new MeditationAudioEngine();
    }
    return audioRef.current;
  }, []);

  useEffect(() => {
    onSessionActiveChange?.(phase !== "idle");
  }, [onSessionActiveChange, phase]);

  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  const isSessionActive = phase === "warmup" || phase === "running";
  const { isActive: isWakeLockActive } = useWakeLock(isSessionActive);

  const totalSessionMs = durationMinutes * 60 * 1000;
  const totalWarmupMs = warmupSeconds * 1000;

  // Drift-free timestamp tick loop during warmup and running phases
  useEffect(() => {
    if (phase !== "warmup" && phase !== "running") {
      return;
    }

    const tick = () => {
      const target = endTimeRef.current;
      if (target === null) return;

      const nextRemaining = computeRemainingMs(target, Date.now());

      if (nextRemaining <= 0) {
        const audio = getAudioEngine();
        if (phase === "warmup") {
          const nextEnd = Date.now() + totalSessionMs;
          endTimeRef.current = nextEnd;
          setRemainingMs(totalSessionMs);
          setPhase("running");
          audio.playBell("start");
          if (selectedSound !== "silence" && !isAmbientMuted) {
            audio.startAmbient(selectedSound, ambientVolume);
          }
        } else {
          endTimeRef.current = null;
          setRemainingMs(0);
          setPhase("completed");
          audio.stopAmbient(1.2);
          audio.playBell("end");
        }
        return;
      }

      setRemainingMs(nextRemaining);
    };

    const intervalId = window.setInterval(tick, 120);
    return () => window.clearInterval(intervalId);
  }, [
    ambientVolume,
    getAudioEngine,
    isAmbientMuted,
    phase,
    selectedSound,
    totalSessionMs,
  ]);

  const stopPreview = useCallback(() => {
    audioRef.current?.stopPreview();
    setPreviewingSoundId(null);
  }, []);

  const handleDurationChange = useCallback((nextMinutes: number) => {
    const clamped = clampDurationMinutes(nextMinutes);
    setDurationMinutes(clamped);
    setRemainingMs(clamped * 60 * 1000);
  }, []);

  const handleTogglePreview = useCallback(
    (soundId: AmbientSoundId) => {
      const audio = getAudioEngine();
      audio.unlock();

      if (previewingSoundId === soundId) {
        audio.stopPreview();
        setPreviewingSoundId(null);
        return;
      }

      setPreviewingSoundId(soundId);
      audio.startPreview(soundId, ambientVolume, () => {
        setPreviewingSoundId(null);
      });
    },
    [ambientVolume, getAudioEngine, previewingSoundId]
  );

  const handleSelectSound = useCallback(
    (soundId: AmbientSoundId) => {
      setSelectedSound(soundId);
      if (previewingSoundId && previewingSoundId !== soundId) {
        stopPreview();
      }
      if (soundId === "silence") {
        stopPreview();
      }
    },
    [previewingSoundId, stopPreview]
  );

  const handleVolumeChange = useCallback(
    (nextVolume: number) => {
      setAmbientVolume(nextVolume);
      setIsAmbientMuted(nextVolume === 0);
      if (previewingSoundId || phase === "running") {
        audioRef.current?.setAmbientVolume(nextVolume);
      }
    },
    [phase, previewingSoundId]
  );

  const handleToggleSessionMute = useCallback(() => {
    const audio = getAudioEngine();
    if (selectedSound === "silence") return;

    if (isAmbientMuted) {
      setIsAmbientMuted(false);
      if (phase === "running") {
        audio.startAmbient(selectedSound, ambientVolume, 0.5);
      }
    } else {
      setIsAmbientMuted(true);
      audio.stopAmbient(0.4);
    }
  }, [ambientVolume, getAudioEngine, isAmbientMuted, phase, selectedSound]);

  const handleTestBell = useCallback(() => {
    const audio = getAudioEngine();
    audio.unlock();
    audio.playBell("start");
  }, [getAudioEngine]);

  const handleStart = useCallback(() => {
    const audio = getAudioEngine();
    audio.unlock();
    stopPreview();
    setIsAmbientMuted(false);

    if (warmupSeconds > 0) {
      const warmupMs = warmupSeconds * 1000;
      endTimeRef.current = Date.now() + warmupMs;
      setRemainingMs(warmupMs);
      setPhase("warmup");
    } else {
      endTimeRef.current = Date.now() + totalSessionMs;
      setRemainingMs(totalSessionMs);
      setPhase("running");
      audio.playBell("start");
      if (selectedSound !== "silence") {
        audio.startAmbient(selectedSound, ambientVolume);
      }
    }
  }, [
    ambientVolume,
    getAudioEngine,
    selectedSound,
    stopPreview,
    totalSessionMs,
    warmupSeconds,
  ]);

  const handlePause = useCallback(() => {
    if (phase !== "warmup" && phase !== "running") return;

    const currentRemaining =
      endTimeRef.current !== null
        ? computeRemainingMs(endTimeRef.current, Date.now())
        : remainingMs;

    endTimeRef.current = null;
    setRemainingMs(currentRemaining);
    setPausedFromPhase(phase);
    setPhase("paused");
    audioRef.current?.stopAmbient(0.5);
  }, [phase, remainingMs]);

  const handleResume = useCallback(() => {
    if (phase !== "paused") return;
    const audio = getAudioEngine();
    audio.unlock();

    endTimeRef.current = Date.now() + remainingMs;
    setPhase(pausedFromPhase);

    if (
      pausedFromPhase === "running" &&
      selectedSound !== "silence" &&
      !isAmbientMuted
    ) {
      audio.startAmbient(selectedSound, ambientVolume, 0.8);
    }
  }, [
    ambientVolume,
    getAudioEngine,
    isAmbientMuted,
    pausedFromPhase,
    phase,
    remainingMs,
    selectedSound,
  ]);

  const handleReset = useCallback(() => {
    endTimeRef.current = null;
    audioRef.current?.stopAmbient(0.4);
    stopPreview();
    setIsAmbientMuted(false);
    setRemainingMs(totalSessionMs);
    setPhase("idle");
  }, [stopPreview, totalSessionMs]);

  // Compute progress ring geometry
  const activeTotalMs =
    phase === "warmup" || (phase === "paused" && pausedFromPhase === "warmup")
      ? totalWarmupMs
      : totalSessionMs;
  const progress =
    phase === "idle"
      ? 0
      : phase === "completed"
        ? 1
        : computeProgress(activeTotalMs, remainingMs);
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);

  const selectedSoundMeta = AMBIENT_SOUNDS.find((s) => s.id === selectedSound);

  return (
    <>
      {phase === "idle" && (
          <>
            {/* Duration Preview & Fine Adjustment */}
            <section className="flex flex-col items-center pt-1">
              <div className="relative flex h-44 w-44 flex-col items-center justify-center rounded-full border border-black/6 bg-[var(--surface)] shadow-xs dark:border-white/10">
                <span className="text-[11px] font-medium tracking-[0.18em] text-[var(--foreground-muted)] uppercase">
                  Duration
                </span>
                <span className="mt-1 font-mono text-4xl font-medium tracking-tight text-[var(--foreground)] tabular-nums">
                  {formatTimerDisplay(totalSessionMs)}
                </span>
                <div className="mt-2.5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleDurationChange(durationMinutes - 1)}
                    disabled={durationMinutes <= MIN_DURATION_MINUTES}
                    aria-label="Decrease duration by 1 minute"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[3.5rem] text-center text-xs font-medium text-[var(--foreground-muted)] tabular-nums">
                    {formatDurationLabel(durationMinutes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDurationChange(durationMinutes + 1)}
                    disabled={durationMinutes >= MAX_DURATION_MINUTES}
                    aria-label="Increase duration by 1 minute"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Single-row Duration Presets */}
              <div className="mt-5 grid w-full grid-cols-5 gap-2">
                {DURATION_PRESETS_MINUTES.map((preset) => {
                  const isSelected = durationMinutes === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleDurationChange(preset)}
                      className={`h-10 rounded-xl text-sm font-medium whitespace-nowrap tabular-nums transition-colors ${
                        isSelected
                          ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                          : "border border-black/6 bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] dark:border-white/10"
                      }`}
                    >
                      {preset}m
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Warm-up & Sound Controls */}
            <section className="flex flex-col gap-3.5">
              {/* Warm-up Selector */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] px-4 py-3 dark:border-white/10">
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    Warm-up
                  </p>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Preparation before opening bell
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-muted)] p-1">
                  {WARMUP_OPTIONS_SECONDS.map((seconds) => {
                    const isSelected = warmupSeconds === seconds;
                    return (
                      <button
                        key={seconds}
                        type="button"
                        onClick={() => setWarmupSeconds(seconds)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap tabular-nums transition-colors ${
                          isSelected
                            ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs"
                            : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        {seconds === 0 ? "Off" : `${seconds}s`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Background Sound Card */}
              <div className="rounded-2xl border border-black/6 bg-[var(--surface)] p-4 dark:border-white/10">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    Background Sound
                  </p>
                  <button
                    type="button"
                    onClick={handleTestBell}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
                  >
                    <Bell className="h-3 w-3" />
                    Test bell
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  {AMBIENT_SOUNDS.map((sound) => {
                    const isSelected = selectedSound === sound.id;
                    const isPreviewing = previewingSoundId === sound.id;

                    return (
                      <div
                        key={sound.id}
                        className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                          isSelected
                            ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                            : "border-black/5 bg-[var(--background)]/60 dark:border-white/8"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectSound(sound.id)}
                          className="flex flex-1 items-center gap-2.5 text-left"
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                              isSelected
                                ? "border-[var(--accent)] bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                                : "border-black/20 dark:border-white/25"
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[var(--foreground)]">
                              {sound.name}
                            </span>
                            <span className="block truncate text-xs text-[var(--foreground-muted)]">
                              {sound.description}
                            </span>
                          </span>
                        </button>

                        {sound.kind !== "none" && (
                          <button
                            type="button"
                            onClick={() => handleTogglePreview(sound.id)}
                            aria-label={
                              isPreviewing
                                ? `Stop ${sound.name} preview`
                                : `Preview ${sound.name}`
                            }
                            className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                              isPreviewing
                                ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                                : "bg-[var(--surface)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                            }`}
                          >
                            {isPreviewing ? (
                              <>
                                <Square className="h-3 w-3 fill-current" />
                                Stop
                              </>
                            ) : (
                              <>
                                <Play className="h-3 w-3 fill-current" />
                                Preview
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Volume Slider when an ambient sound is selected */}
                {selectedSound !== "silence" && (
                  <div className="mt-3 flex items-center gap-3 pt-1">
                    <Volume2 className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={ambientVolume}
                      onChange={(event) =>
                        handleVolumeChange(Number(event.target.value))
                      }
                      aria-label="Background sound volume"
                      className="h-1.5 w-full cursor-pointer accent-[var(--accent)]"
                    />
                    <span className="w-9 text-right text-xs font-medium text-[var(--foreground-muted)] tabular-nums">
                      {Math.round(ambientVolume * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </section>

            {/* Primary CTA */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleStart}
                className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-base font-semibold text-[#fcfaf6] shadow-xs transition-colors hover:bg-[var(--accent-strong)] active:scale-[0.99] dark:text-[#151917]"
              >
                <Play className="h-4 w-4 fill-current" />
                Begin Session
              </button>
            </div>
          </>
        )}

        {(phase === "warmup" || phase === "running" || phase === "paused") && (
          <div className="flex flex-1 flex-col items-center justify-between py-4">
            {/* Phase Status Pill */}
            <div className="flex flex-col items-center gap-1.5">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3.5 py-1 text-xs font-medium tracking-wide text-[var(--accent)] uppercase">
                <span
                  className={`h-1.5 w-1.5 rounded-full bg-[var(--accent)] ${
                    phase === "running" || phase === "warmup"
                      ? "animate-pulse"
                      : "opacity-50"
                  }`}
                />
                {phase === "warmup"
                  ? "Prepare"
                  : phase === "paused"
                    ? "Paused"
                    : "Meditating"}
              </span>
              {isWakeLockActive && (
                <span className="text-[11px] text-[var(--foreground-muted)]">
                  Screen awake
                </span>
              )}
            </div>

            {/* Serene Circular Progress Dial */}
            <div className="relative flex items-center justify-center">
              {phase === "running" && (
                <div
                  aria-hidden="true"
                  className="animate-breathe pointer-events-none absolute h-64 w-64 rounded-full bg-[var(--accent)]/12 blur-2xl"
                />
              )}

              <svg
                width={RING_SIZE}
                height={RING_SIZE}
                viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                className="-rotate-90"
              >
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={RING_STROKE}
                  className="text-black/8 dark:text-white/10"
                />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={strokeDashoffset}
                  className={
                    phase === "warmup"
                      ? "text-[var(--warm-amber)] transition-[stroke-dashoffset] duration-150 ease-linear"
                      : "text-[var(--accent)] transition-[stroke-dashoffset] duration-150 ease-linear"
                  }
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <span className="font-mono text-5xl font-medium tracking-tight text-[var(--foreground)] tabular-nums">
                  {formatTimerDisplay(remainingMs)}
                </span>
                <span className="mt-2 text-xs text-[var(--foreground-muted)]">
                  {phase === "warmup"
                    ? "Take a comfortable seat"
                    : selectedSoundMeta && selectedSound !== "silence"
                      ? selectedSoundMeta.name
                      : formatDurationLabel(durationMinutes)}
                </span>
              </div>
            </div>

            {/* Active Session Controls */}
            <div className="flex w-full flex-col items-center gap-3">
              {selectedSound !== "silence" && (
                <button
                  type="button"
                  onClick={handleToggleSessionMute}
                  className="inline-flex items-center gap-2 rounded-full border border-black/6 bg-[var(--surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
                >
                  {isAmbientMuted ? (
                    <>
                      <VolumeX className="h-3.5 w-3.5" />
                      Sound muted
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-3.5 w-3.5" />
                      {selectedSoundMeta?.name} on
                    </>
                  )}
                </button>
              )}

              <div className="grid w-full grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>

                {phase === "paused" ? (
                  <button
                    type="button"
                    onClick={handleResume}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePause}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
                  >
                    <Pause className="h-4 w-4 fill-current" />
                    Pause
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {phase === "completed" && (
          <div className="flex flex-1 flex-col items-center justify-between py-6 text-center">
            <div />

            <div className="flex flex-col items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--accent-soft)]">
                <BodhiLogo className="h-11 w-11" />
              </div>

              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                  Session Complete
                </h1>
                <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
                  {formatDurationLabel(durationMinutes)} of mindful stillness.
                </p>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
              >
                Configure
              </button>
              <button
                type="button"
                onClick={handleStart}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
              >
                <RotateCcw className="h-4 w-4" />
                Repeat
              </button>
            </div>
          </div>
        )}
    </>
  );
}
