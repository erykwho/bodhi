export type TimerPhase = "idle" | "warmup" | "running" | "paused" | "completed";

export const DURATION_PRESETS_MINUTES = [5, 10, 15, 20, 30] as const;

export const WARMUP_OPTIONS_SECONDS = [0, 5, 10] as const;
export type WarmupSeconds = (typeof WARMUP_OPTIONS_SECONDS)[number];

export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 180;
export const DEFAULT_DURATION_MINUTES = 10;
export const DEFAULT_WARMUP_SECONDS: WarmupSeconds = 5;
