// FORK OVERLAY (Agent Palace). Copy to <qm>/src/mindpalace/loci-scopes.ts (see qm/FORK.md §1).
//
// Which loci agent a QM scope is. Team agents (legal, finance, eng, ...) are QM project scopes, and a
// commissioned quest agent (quest-<n>) gets its own project scope when it spawns. The map is
// {"<scopeId>": "<agent>"}, merged from:
//   LOCI_SCOPES       JSON in the environment (fixed at boot)
//   LOCI_SCOPES_FILE  a JSON file, re-read when it changes, so a new quest scope binds without a restart
//                     (qm/qm-admin.ts and server/commission/qm.ts write it)
// A channel scope's own ref (channel:legal) is the last fallback.
import { readFileSync, statSync } from "node:fs";

let cache: { mtimeMs: number; map: Record<string, string> } | undefined;

function fileMap(): Record<string, string> {
  const path = process.env.LOCI_SCOPES_FILE;
  if (!path) return {};
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (cache?.mtimeMs !== mtimeMs) cache = { mtimeMs, map: JSON.parse(readFileSync(path, "utf8")) as Record<string, string> };
    return cache.map;
  } catch {
    return cache?.map ?? {};
  }
}

export function lociScopeMap(): Record<string, string> {
  let env: Record<string, string> = {};
  try {
    env = JSON.parse(process.env.LOCI_SCOPES || "{}") as Record<string, string>;
  } catch {}
  return { ...env, ...fileMap() };
}

export function lociScopeAgent(scope: string | undefined): string | undefined {
  if (!scope) return undefined;
  const mapped = lociScopeMap()[scope];
  if (mapped) return mapped;
  if (scope.startsWith("channel:")) return scope.slice("channel:".length) || undefined;
  return undefined;
}

// A loci connector is bound to one agent: loci-<agent>. The shared loci-quest connector serves every
// commissioned quest agent; the adapter resolves which one from the scope the harness passes in _qm.
export function lociConnectorAllowed(serverId: string, scopeAgent: string | undefined): boolean {
  if (!serverId.startsWith("loci-")) return true;
  const connectorAgent = serverId.slice("loci-".length);
  if (!scopeAgent) return false;
  if (connectorAgent === "quest") return /^quest-\d+$/.test(scopeAgent);
  return connectorAgent === scopeAgent;
}
