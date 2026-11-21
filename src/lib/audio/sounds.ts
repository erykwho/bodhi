export type BellSoundId =
  | "none"
  | "singing-bowl"
  | "deep-gong"
  | "soft-chime"
  | "crystal-bowl"
  | "wood-block";

export type SoundKind = "none" | "synth" | "file";

export interface BellSoundOption {
  id: BellSoundId;
  name: string;
  description: string;
  kind: SoundKind;
  /** Optional relative audio asset path for future file-backed chimes. */
  src?: string;
}

export const BELL_SOUNDS: readonly BellSoundOption[] = [
  {
    id: "none",
    name: "None",
    description: "Silent — no chime",
    kind: "none",
  },
  {
    id: "singing-bowl",
    name: "Singing Bowl",
    description: "Warm Tibetan harmonic bowl",
    kind: "synth",
  },
  {
    id: "deep-gong",
    name: "Deep Gong",
    description: "Resonant low temple gong",
    kind: "synth",
  },
  {
    id: "soft-chime",
    name: "Soft Chime",
    description: "Delicate metallic shimmer",
    kind: "synth",
  },
  {
    id: "crystal-bowl",
    name: "Crystal Bowl",
    description: "Pure ethereal sustained tone",
    kind: "synth",
  },
  {
    id: "wood-block",
    name: "Wood Block",
    description: "Crisp organic temple tap",
    kind: "synth",
  },
] as const;

export const DEFAULT_START_BELL_ID: BellSoundId = "singing-bowl";
export const DEFAULT_END_BELL_ID: BellSoundId = "deep-gong";
export const DEFAULT_INTERVAL_BELL_ID: BellSoundId = "soft-chime";

export type AmbientSoundId =
  | "silence"
  | "white-noise"
  | "pink-noise"
  | "brown-noise"
  | "gentle-rain"
  | "ocean-waves"
  | "warm-drone";

export type AmbientSoundKind = SoundKind;

export interface AmbientSoundOption {
  id: AmbientSoundId;
  name: string;
  description: string;
  kind: AmbientSoundKind;
  /** Optional relative audio asset path for future file-backed soundscapes. */
  src?: string;
}

export const AMBIENT_SOUNDS: readonly AmbientSoundOption[] = [
  {
    id: "silence",
    name: "Silence",
    description: "Bells only, no background",
    kind: "none",
  },
  {
    id: "white-noise",
    name: "White Noise",
    description: "Softly filtered steady air",
    kind: "synth",
  },
  {
    id: "pink-noise",
    name: "Pink Noise",
    description: "Warm balanced breeze texture",
    kind: "synth",
  },
  {
    id: "brown-noise",
    name: "Brown Noise",
    description: "Deep cozy low-frequency rumble",
    kind: "synth",
  },
  {
    id: "gentle-rain",
    name: "Gentle Rain",
    description: "Soft layered rainfall ambiance",
    kind: "synth",
  },
  {
    id: "ocean-waves",
    name: "Ocean Waves",
    description: "Slow rhythmic surf swell",
    kind: "synth",
  },
  {
    id: "warm-drone",
    name: "Warm Drone",
    description: "Subtle meditative harmonic pad",
    kind: "synth",
  },
] as const;

export const DEFAULT_AMBIENT_SOUND_ID: AmbientSoundId = "silence";
export const DEFAULT_AMBIENT_VOLUME = 0.35;

export function isBellSoundId(value: unknown): value is BellSoundId {
  return (
    typeof value === "string" && BELL_SOUNDS.some((sound) => sound.id === value)
  );
}

export function isAmbientSoundId(value: unknown): value is AmbientSoundId {
  return (
    typeof value === "string" &&
    AMBIENT_SOUNDS.some((sound) => sound.id === value)
  );
}

export function getBellSoundOption(id: BellSoundId): BellSoundOption {
  return BELL_SOUNDS.find((sound) => sound.id === id) ?? BELL_SOUNDS[0];
}

export function getAmbientSoundOption(id: AmbientSoundId): AmbientSoundOption {
  return AMBIENT_SOUNDS.find((sound) => sound.id === id) ?? AMBIENT_SOUNDS[0];
}
