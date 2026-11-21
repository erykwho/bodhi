export type AmbientSoundId = "silence" | "white-noise";

export type AmbientSoundKind = "none" | "synth" | "file";

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
    description: "Opening and closing bells only",
    kind: "none",
  },
  {
    id: "white-noise",
    name: "White Noise",
    description: "Softly filtered steady ambient sound",
    kind: "synth",
  },
] as const;

export const DEFAULT_AMBIENT_SOUND_ID: AmbientSoundId = "silence";
export const DEFAULT_AMBIENT_VOLUME = 0.35;
