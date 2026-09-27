---
title: Arm Controller Escalation
type: escalation
team: support
room: Escalations
updated: 2026-09-25
---
ESC-212, Sev-2, opened Sep 16: Kestrel Foods reports 7 arms at the Fresno plant stopping with controller fault E-47 (watchdog reset), 2 to 5 times per shift. All 7 run firmware 4.1.3 on controller boards from lot CB-2607.

Timeline:

1. Sep 16: first report; support followed [[support/runbook-arm-controller-faults|Arm Controller Fault Runbook]], swapped one board, fault moved with the board.
2. Sep 19: escalated to eng on-call. Telemetry on [[eng/cloud-infra|Cloud Infrastructure]] shows supply-voltage dips before each reset.
3. Sep 23: ops confirmed 9 of 11 Q3 controller RMAs are lot CB-2607 in the [[ops/quality-rma-log|Quality and RMA Log]]; lot supplier is [[ops/castellan-circuits|Castellan Circuits]].
4. Sep 25: eng says [[eng/firmware-release-4-2|Firmware 4.2]] raises the brown-out threshold and may mask the fault; root cause still under test on the [[eng/arm-controller|Arm Controller]].

Open questions: replace all CB-2607 boards in the field (22 more on hand are quarantined per [[ops/inventory-2026-09|Inventory]]), and whether this is a warranty replacement under [[support/warranty-terms|Warranty Terms]]. Customer: [[sales/kestrel-foods|Kestrel Foods]], Premium tier under the [[support/sla-policy|SLA Policy]].

## Links
- runbook: [[support/runbook-arm-controller-faults]]
- telemetry: [[eng/cloud-infra]]
- rma_data: [[ops/quality-rma-log]]
- supplier: [[ops/castellan-circuits]]
- fix_candidate: [[eng/firmware-release-4-2]]
- affects: [[eng/arm-controller]]
- spares: [[ops/inventory-2026-09]]
- warranty: [[support/warranty-terms]]
- customer: [[sales/kestrel-foods]]
- sla: [[support/sla-policy]]
