// OWNED BY: scene. Boot: load palace.json, build the runtime, mount plugins, start the loop.
// Stage flags (polish): ?demo auto-plays the replay; ?demo&hold waits for T (presence shows the intro
// establishing shot until Enter/click). Without ?speed, replays run at STAGE_SPEED so demo-1 (13.2 s of
// events) lasts ~19 s on stage.
import { Palace } from "../../server/schema";
import { createEventStream } from "./events";
import { buildScene } from "./scene";
import { plugins } from "./plugins";

const STAGE_SPEED = 0.7;
const params = new URLSearchParams(location.search);

const palace = Palace.parse(await (await fetch("/palace.json")).json());
const events = createEventStream();
if (events.mode === "demo" && !params.has("speed")) events.speed = STAGE_SPEED;
const rt = buildScene(palace, document.getElementById("app")!, document.getElementById("hud")!, events);
for (const p of plugins) p(rt);
if (rt.events.mode === "demo" && !params.has("hold")) rt.events.restart();
(window as any).rt = rt; // debugging + browser QA
