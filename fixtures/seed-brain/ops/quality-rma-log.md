---
title: Quality and RMA Log
type: log
team: ops
room: Manufacturing
updated: 2026-09-24
---
Q3 returns: 17 RMAs. 11 controller boards (9 from Castellan lot CB-2607, all fault E-47), 4 Gripper v1 pad tears inside 90 days, 2 battery packs. Controller RMA rate is 3x Q2.

| RMA | Part | Lot | Customer | Fault | Disposition |
| --- | --- | --- | --- | --- | --- |
| R-0931 to R-0939 | controller board | CB-2607 | [[sales/kestrel-foods|Kestrel Foods]] (7), Orbital Parcel (2) | E-47 watchdog reset | failure analysis |
| R-0922, R-0927 | controller board | CB-2604 | various | E-12 encoder timeout | repaired |
| R-0918 to R-0921 | Gripper v1 pads | GP-0611 | various | tear < 90 days | replaced |
| R-0925, R-0930 | battery pack | VC-2605 | Orbital Parcel | cell imbalance | returned to Voltcell |

Failure analysis of CB-2607 points at an undersized bulk capacitor that lets supply voltage dip under load; the board design is on [[eng/arm-controller|Arm Controller]], and [[eng/firmware-release-4-2|Firmware 4.2]] changes the brown-out threshold. Boards were assembled by [[ops/castellan-circuits|Castellan Circuits]]. Customer impact is tracked in [[support/arm-controller-escalation|Arm Controller Escalation]]. Scrap and rework also hit [[eng/manufacturing-yield|Manufacturing Yield]].

## Links
- customer: [[sales/kestrel-foods]]
- part: [[eng/arm-controller]]
- mitigation: [[eng/firmware-release-4-2]]
- supplier: [[ops/castellan-circuits]]
- escalation: [[support/arm-controller-escalation]]
- affects: [[eng/manufacturing-yield]]
