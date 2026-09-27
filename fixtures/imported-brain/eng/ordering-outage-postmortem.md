---
title: "Postmortem: ordering outage, 2026-08-14"
type: postmortem
team: eng
room: Incidents
updated: 2026-09-02
source: Eng/postmortem-2026-08-14-ordering-outage.md
---
From 11:05 to 17:10 Pacific on Aug 14, 2026, 214 restaurant groups could not submit supplier orders due to a locked table from an untested migration.

**Status:** complete · **Author:** Dmitri Solberg · **Reviewed:** Sep 2, 2026

## Summary
From 11:05 to 17:10 Pacific on August 14, 2026, restaurants could not submit supplier orders from Kitewing Pantry. 214 restaurant groups were affected. Counts and recipe costing kept working.

## Root cause
A migration added a NOT NULL column to `supplier_orders` without a default. The migration ran during peak ordering (the Thursday deploy window), locked the table, and the order service's connection pool was exhausted. Rollback took 6 hours because the down-migration had never been tested.

## What went well
- On-call (Felix Arrowood that week) declared the incident 12 minutes after the first alert.
- Customer Success posted status updates every 30 minutes.

## What went wrong
- No migration review checklist.
- The status page was updated manually and lagged by 40 minutes.
- Nobody owns the incident-response runbook since the security lead left, so the severity levels in it are out of date.

## Action items
| Action | Owner | Due | State |
| --- | --- | --- | --- |
| Migration checklist (defaults, lock timeouts, tested down-migration) | Dmitri Solberg | Sep 15 | done |
| Move deploy window off Thursday 11:00 to 13:00 peak | Felix Arrowood | Sep 30 | open |
| Automate status page from PagerDuty | Dmitri Solberg | Oct 15 | open |
| Update incident-response runbook severity levels | (unassigned) | – | open |
| Credit affected customers 1 day of subscription | Keiko Ferrante | Aug 31 | done |

## Links
- depends_on: [[companies/pagerduty]]
- mentions: [[people/dmitri-solberg]]
- mentions: [[people/felix-arrowood]]
- mentions: [[people/keiko-ferrante]]
- references: [[eng/information-security-policy]]
- references: [[eng/oncall-rotation]]
- references: [[people/team-directory]]
- references: [[support/support-sla]]
