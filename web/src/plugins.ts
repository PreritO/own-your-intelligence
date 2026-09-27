// INTEGRATOR-OWNED. Order matters: later plugins draw over earlier ones.
import type { Plugin } from "./api";
import { mountUI } from "./ui";
import { mountWalk } from "./walk";
import { mountPresence } from "./agents";
import { mountRooms } from "./rooms";

export const plugins: Plugin[] = [mountUI, mountWalk, mountPresence, mountRooms];
