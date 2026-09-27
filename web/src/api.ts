// INTEGRATOR-OWNED. The seam between workspaces: scene builds a PalaceRuntime,
// every other feature is a plugin that receives it. Change only by agreement.
import type * as THREE from "three";
import type { Palace, Verdict } from "../../server/schema";
import type { EventStream } from "./events";

export type StationState = "claimed" | Verdict | null;

export interface PalaceRuntime {
  palace: Palace;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  hud: HTMLElement; // DOM overlay root; each plugin appends its own container
  events: EventStream; // live /events or ?demo replay

  /** World position of a memory's orb (top of its pedestal). */
  memoryPosition(id: string): THREE.Vector3 | undefined;
  /** Glow override for a memory orb; null restores freshness-based glow. */
  setMemoryGlow(id: string, intensity: number | null): void;
  /** 1 = normal, 0.3 = dimmed for a cinematic. */
  setPalaceDim(level: number): void;
  setRoomLit(roomId: string, lit: boolean): void;

  /** Player controls. Cinematics call release(), then restore() on Esc. */
  controls: { release(): void; restore(): void; readonly locked: boolean };
  /** Per-frame callback; returns an unsubscribe function. dt in seconds. */
  onFrame(cb: (dt: number) => void): () => void;
}

export type Plugin = (rt: PalaceRuntime) => void | (() => void);

/** DOM events on window, for decoupled UI. */
export const UI_EVENTS = {
  select: "palace:select", // detail: { memoryId }  (scene fires on click)
  flyTo: "palace:flyto", // detail: { memoryId }  (ui fires, scene handles)
  ask: "palace:ask", // detail: { question }  (ask bar fires, walk handles)
} as const;

export function emitUI(name: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
