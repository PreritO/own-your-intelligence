// Terminal proof: ask Memorable for a stored workflow and show the palace route it maps to.
//
//   bun server/memorable/demo.ts "Fill out the security review Northwind sent us"
//
// Prints the raw Memorable hit (slug, match tier, score, latency), the stations it maps back to, then
// what the loci protocol would actually walk (pickRoute: Memorable -> local cache -> fallback -> explore).
import { loadPalace, lastMemorableMiss, pickRoute } from "../routes";
import { recallVerbose } from "./client";

const task = process.argv.slice(2).join(" ").trim();
if (!task) {
  console.error('usage: bun server/memorable/demo.ts "<task>"');
  process.exit(1);
}
const palace = loadPalace();
const title = new Map(palace.memories.map((m) => [m.id, m.title]));

console.log(`task: ${task}\n`);
const r = recallVerbose(task, palace);
if ("miss" in r) {
  console.log(`Memorable: no route (${r.miss})${r.hit ? `, best was ${r.hit.slug} [${r.hit.tier} ${r.hit.score}]` : ""}${r.ms ? `, ${r.ms} ms` : ""}`);
} else {
  console.log(`Memorable recall: ${r.slug}`);
  console.log(`  match   ${r.tier} ${r.score}   (${r.ms} ms, exact -> lexical -> semantic)`);
  console.log(`  stored  "${r.title}"${r.routeId ? `  route ${r.routeId}` : ""}`);
  if (r.departments) console.log(`  depts   ${r.departments.join(" > ")}`);
  console.log(`  mapped  ${r.stations.length} palace stations (from ${r.mapped}):`);
  r.stations.forEach((s, i) => console.log(`    ${String(i + 1).padStart(2)}. ${s.padEnd(40)} ${title.get(s) ?? ""}`));
}

const picked = pickRoute(task, palace);
console.log(`\nroute event the agent emits:`);
console.log(JSON.stringify({ type: "route", routeId: picked.routeId, stations: picked.stations, source: picked.source }));
console.log(`  via ${picked.via ?? picked.source}${picked.note ? `: ${picked.note}` : ""}`);
if (picked.via !== "memorable" && lastMemorableMiss) console.log(`  (Memorable: ${lastMemorableMiss})`);
