# OWNED BY: flow. Synthetic replays for testing the task-flow view (quest with subtasks + evidence,
# and a deliberately wrong run). Run: python3 web/src/flow/samples/make_samples.py
# View: /?demo=../src/flow/samples/quest-sample  (fetch normalises /replays/../src/... in dev)
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ev = []
t = [0.0]
R = ["quest-sample"]


def e(dt, agent, typ, **kw):
    t[0] = round(t[0] + dt, 2)
    ev.append({"t": t[0], "agent": agent, "type": typ, **kw, "run": R[0]})


def write(name):
    with open(os.path.join(HERE, name), "w") as fh:
        fh.write("\n".join(json.dumps(x) for x in ev) + "\n")


A = "scout-1"
TASK = "Onboard Gripworks as a new gripper supplier"
e(0, A, "spawn", label="Quest: Onboarding", color="#7dcfff", home="room-workshop", task=TASK, harness="protocol")
e(0.1, A, "task", text=TASK)
subs = [
    {"id": "s1", "title": "Vendor profile", "department": "people", "stations": ["companies/gripworks"]},
    {"id": "s2", "title": "Onboarding steps & contract", "department": "legal", "stations": ["legal/vendor-onboarding", "legal/gripworks-msa"]},
    {"id": "s3", "title": "Budget & PO", "department": "finance", "stations": ["finance/budget-2026-q4", "finance/purchase-order-policy"]},
    {"id": "s4", "title": "Security review", "department": "eng", "stations": ["eng/vendor-risk-reviews", "eng/security-policy"]},
    {"id": "s5", "title": "Sign-off", "department": "people", "stations": ["people/signatories"]},
]
e(0.4, A, "phase", phase="plan", note="5 subtasks across 4 departments", subtasks=subs)
e(0.6, A, "phase", phase="explore")
e(0.2, A, "route", routeId="explore-onboarding", source="explore", stations=[
    "companies/gripworks", "companies/voltcell", "legal/vendor-onboarding", "legal/gripworks-msa",
    "finance/purchase-order-policy", "finance/budget-2026-q4", "eng/vendor-risk-reviews", "eng/security-policy", "people/signatories"])


def own(mid, room, verdict, sub, evidence=None, note=None):
    e(0.4, A, "move", to=room)
    e(0.4, A, "claim", memoryId=mid)
    kw = {"memoryId": mid, "verdict": verdict, "subtask": sub}
    if evidence:
        kw["evidence"] = evidence
    if note:
        kw["note"] = note
    e(0.5, A, "visit", **kw)


hid = [0]


def ho(team, mid, room, q, verdict, sub, evidence, reply, note=None):
    hid[0] += 1
    h = f"{R[0]}-h{hid[0]}"
    e(0.4, A, "move", to=room)
    e(0.3, A, "handoff", id=h, toAgent=team, memoryId=mid, question=q)
    e(0.3, team, "move", to=room)
    e(0.3, team, "claim", memoryId=mid)
    kw = {"memoryId": mid, "verdict": verdict, "subtask": sub, "evidence": evidence}
    if note:
        kw["note"] = note
    e(0.5, team, "visit", **kw)
    e(0.3, team, "reply", id=h, answer=reply)


own("companies/gripworks", "room-people-0", "verified", "s1", evidence="Supplier of soft robotic grippers. Proposed a 12-month supply agreement at $40k.")
own("companies/voltcell", "room-people-1", "verified", "s1", evidence="Battery pack supplier for the arm's mobile base.", note="wrong vendor, dead end")
ho("legal", "legal/vendor-onboarding", "room-legal-0", "What are the steps to onboard a new supplier?", "verified", "s2",
   "Steps to onboard a new supplier: NDA, vendor risk review, contract per playbook, PO.", "NDA, then an Eng vendor risk review, then the MSA, then a PO.")
ho("legal", "legal/gripworks-msa", "room-legal-0", "Is the Gripworks MSA ready to sign?", "verified", "s2",
   "Master services agreement draft v3. Net-45 payment, 12-month term.", "MSA v3 is approved by Legal, pending budget confirmation.")
ho("finance", "finance/purchase-order-policy", "room-finance-1", "Does a $40k supplier need PO approval?", "stale", "s3",
   "POs over $25k need the VP Finance.", "Over $25k needs Raj Patel, but the policy page is stale.", note="freshness 0.33 is borderline")
ho("finance", "finance/budget-2026-q4", "room-finance-1", "Is Gripworks within the Q4 budget?", "verified", "s3",
   "Supplier line: $55k allocated, $15k committed. Gripworks ($40k) fits.", "Yes: $40k of the $55k supplier line.")
ho("eng", "eng/vendor-risk-reviews", "room-eng-0", "Has Gripworks passed a vendor risk review?", "gap", "s4",
   "No Gripworks questionnaire on file.", "No review on file for Gripworks. That's a gap.", note="no Gripworks entry")
ho("eng", "eng/security-policy", "room-eng-0", "Does the security policy cover hardware suppliers?", "stale", "s4",
   "Last reviewed March. Lists controls but no supplier section.", "Policy is stale and silent on suppliers.")
own("people/signatories", "room-people-0", "verified", "s5", evidence="Contracts over $30k need the CEO (Mara Okafor) or COO (Dev Lindqvist) to sign.")
e(0.5, A, "phase", phase="gym", note="training on the explore trajectory")
e(0.3, A, "move", to="room-gym")
for i, r in enumerate([0.31, 0.52, 0.68, 0.81]):
    e(0.5, A, "train_step", step=i + 1, reward=r, checkpoint=f"onboarding-ckpt-{i + 1}")
e(0.5, A, "phase", phase="execute")
e(0.2, A, "route", routeId="supplier-onboarding", source="learned", stations=[
    "companies/gripworks", "legal/vendor-onboarding", "finance/budget-2026-q4", "eng/vendor-risk-reviews", "people/signatories"])
own("companies/gripworks", "room-people-0", "verified", "s1", evidence="Proposed a 12-month supply agreement at $40k.")
ho("legal", "legal/vendor-onboarding", "room-legal-0", "Onboarding checklist for Gripworks?", "verified", "s2",
   "NDA, vendor risk review, contract per playbook, PO.", "NDA signed; MSA v3 approved; risk review and PO outstanding.")
ho("finance", "finance/budget-2026-q4", "room-finance-1", "Confirm Gripworks fits Q4?", "verified", "s3",
   "Supplier line: $55k allocated, $15k committed.", "Confirmed: $40k fits the Q4 supplier line.")
ho("eng", "eng/vendor-risk-reviews", "room-eng-0", "Any vendor risk review for Gripworks yet?", "gap", "s4",
   "No Gripworks questionnaire on file.", "Still none on file.")
own("people/signatories", "room-people-0", "verified", "s5", evidence="Contracts over $30k need the CEO or COO to sign.")
e(0.4, A, "move", to="room-workshop")
e(0.5, A, "artifact", memory={
    "id": "workshop/gripworks-onboarding", "title": "Gripworks Onboarding Brief", "type": "brief", "room": "room-workshop",
    "pos": [22, 1.1, -22], "freshness": 1, "path": "workshop/gripworks-onboarding.md",
    "excerpt": "Gripworks onboarding: NDA done, MSA v3 approved, fits Q4 budget. Blocked on an Eng vendor risk review. CEO or COO signs."})
e(0.4, A, "answer", text="Gripworks can be onboarded once Eng completes a vendor risk review (none on file). MSA v3 is approved, "
  "the $40k fits the Q4 supplier line, and the CEO or COO signs.",
  citations=["companies/gripworks", "legal/vendor-onboarding", "finance/budget-2026-q4", "people/signatories"], gaps=["eng/vendor-risk-reviews"])
e(0.3, A, "phase", phase="done")
write("quest-sample.jsonl")

# A deliberately wrong run: direct read of a Finance room, unstated gap and stale, citation to an unvisited station.
ev.clear()
t[0] = 0.0
R[0] = "flow-bad"
e(0, "legal", "task", text="Can we sign the Gripworks contract this week?")
e(0.3, "legal", "route", routeId="contract-signoff", source="fallback", stations=[
    "companies/gripworks", "legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"])
for mid, v, extra in [("companies/gripworks", "verified", {}), ("legal/gripworks-msa", "stale", {"note": "draft v2 only"}),
                      ("finance/budget-2026-q4", "verified", {"evidence": "Supplier line $55k"}), ("legal/approvals", "gap", {"note": "no approval logged"})]:
    e(0.4, "legal", "claim", memoryId=mid)
    e(0.5, "legal", "visit", memoryId=mid, verdict=v, **extra)
e(0.5, "legal", "answer", text="Yes, sign it.", citations=["legal/gripworks-msa", "finance/budget-2026-q4", "people/signatories"], blocked=True)
write("flow-bad.jsonl")
