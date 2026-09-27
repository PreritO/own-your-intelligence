// Offline: replays the recorded Claude responses in server/import/cache/sample.
//   bun test server/import
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGdocs, readSlack } from "./extract";
import { importCompany } from "./index";
import { unsourcedNumbers } from "./pipeline";

test("gdocs cleanup strips escapes, anchors and base64 images", () => {
  const md = "# **1\\. Who** {#1.-who}\n\nadd\\-on\n\n![][image1]\n\n[image1]: <data:image/png;base64,AAAA>";
  const out = cleanGdocs(md);
  expect(out).toStartWith("# 1. Who");
  expect(out).toContain("add-on");
  expect(out).not.toContain("data:");
  expect(out).not.toContain("{#");
});

test("slack export: users resolved, joins dropped, threads indexed", () => {
  const s = readSlack("fixtures/import-sample/slack-export/pricing-decisions.json");
  expect(s.messages.length).toBe(16);
  expect(s.messages[7].user).toBe("Noor Haddad");
  expect(s.messages[7].thread).toBe(1);
});

test("verbatim tripwire flags invented numbers", () => {
  expect(unsourcedNumbers("costs $349 and $999", "moves to $349")).toEqual(["$999"]);
});

test("sample import replays offline into a valid palace with owner gaps", async () => {
  const out = mkdtempSync(join(tmpdir(), "mp-import-"));
  const { result } = await importCompany({
    dir: "fixtures/import-sample", out: join(out, "brain"), slack: [], palace: join(out, "palace.json"), concurrency: 4, quiet: true,
    llm: { model: "claude-sonnet-5", cacheDir: "server/import/cache/sample", offline: true },
  });
  const owner = result.gaps.filter((g) => g.kind === "owner").map((g) => g.page);
  expect(owner).toContain("eng/information-security-policy");
  expect(readFileSync(join(out, "brain/eng/information-security-policy.md"), "utf8")).toContain("Owner: not recorded.");
  expect(result.slack[0].kept.length).toBeLessThan(result.slack[0].messages);
  // Same cache -> same bytes as the committed fixture.
  expect(readFileSync(join(out, "palace.json"), "utf8")).toBe(readFileSync("fixtures/imported-palace.json", "utf8"));
}, 60_000);
