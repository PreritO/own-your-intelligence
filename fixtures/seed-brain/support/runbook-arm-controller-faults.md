---
title: Arm Controller Fault Runbook
type: runbook
team: support
room: Runbooks
updated: 2026-08-06
---
Tier-1 steps for controller faults: read the fault code from telemetry, check firmware version and board lot, power-cycle once, swap the board if the fault repeats within a shift, then open an RMA.

1. Pull the last 24 h of fault codes from the fleet dashboard ([[eng/cloud-infra|Cloud Infrastructure]]). E-47 is a watchdog reset; E-12 is an encoder timeout.
2. Record firmware version and board lot from the controller page. Known firmware notes live with the [[eng/arm-controller|Arm Controller]] and the current [[eng/firmware-release-4-2|Firmware 4.2]] train.
3. Power-cycle once. If the fault repeats within a shift, swap the board from customer-site spares.
4. Log the pulled board in the [[ops/quality-rma-log|Quality and RMA Log]] and ship it back through ops.
5. Three or more arms at one site with the same code: escalate per the [[support/escalation-process|Escalation Process]].

## Links
- telemetry: [[eng/cloud-infra]]
- system: [[eng/arm-controller]]
- firmware: [[eng/firmware-release-4-2]]
- rma: [[ops/quality-rma-log]]
- escalate_via: [[support/escalation-process]]
