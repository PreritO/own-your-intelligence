"""Summarize a QM run from `bun qm/qm-admin.ts run <id>` on stdin: status, loci tool calls, reply."""
import json
import sys

raw = sys.stdin.read()
j = json.loads(raw[raw.index("{"):])
print("status:", j.get("status"))
for a in j.get("activity", []):
    p = a.get("payload", {})
    if a.get("type") == "tool_call":
        print("  CALL", p.get("tool"), json.dumps(p.get("args"))[:140])
    elif a.get("type") == "tool_result":
        print("    ->", ("ERR " if p.get("isError") else "") + str(p.get("result"))[:170].replace("\n", " "))
r = j.get("result")
if r:
    reply = r.get("reply") if isinstance(r, dict) else r
    print("reply:", str(reply)[:900])
