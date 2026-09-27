---
title: On-Call Rotation - Platform Team
type: runbook
team: eng
room: On-Call
updated: 2026-09-01
source: Eng/oncall.txt
---
Platform team on-call rotates weekly with a $400/week stipend and 15-min ack requirement on PagerDuty. Owner: maintained by Dmitri.

Weekly rotation, handoff Mondays 10:00 PT in #eng-oncall.

**Primary rotation order:** Dmitri Solberg -> Felix Arrowood -> Ana Lindqvist -> Jonah Pereira -> (repeat)

**Secondary:** previous week's primary

**Pager:** PagerDuty service "pantry-prod". Ack within 15 min, 24/7.

**Escalation:** after 30 min unacked, escalate to Felix (CTO).

**Stipend:** on-call stipend $400/week, paid via payroll. Comp day if paged after midnight.

**Sev levels:** see incident response runbook (which is out of date, don't trust the sev2 definition).

**Shutdown Dec 24 - Jan 1:** rotation still runs, days given back in January per PTO policy.

## Links
- mentions: [[people/ana-lindqvist]]
- mentions: [[people/felix-arrowood]]
- mentions: [[people/jonah-pereira]]
- owned_by: [[people/dmitri-solberg]]
- references: [[people/pto-and-leave]]
- vendor: [[companies/pagerduty]]
