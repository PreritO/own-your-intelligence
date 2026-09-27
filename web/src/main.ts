// OWNED BY: scene. Boot: load palace.json, build the runtime, mount plugins, start the loop.
import { Palace } from "../../server/schema";
import { createEventStream } from "./events";
import { buildScene } from "./scene";
import { plugins } from "./plugins";

const palace = Palace.parse(await (await fetch("/palace.json")).json());
const rt = buildScene(palace, document.getElementById("app")!, document.getElementById("hud")!, createEventStream());
for (const p of plugins) p(rt);
if (rt.events.mode === "demo") rt.events.restart();
(window as any).rt = rt; // debugging + browser QA
