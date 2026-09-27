---
title: SLA Policy
type: policy
team: support
room: Policies
updated: 2026-08-12
---
Customer SLA: Standard tier 99.5% monthly dashboard uptime, Sev-1 response in 1 hour, onsite within 3 business days. Premium tier 99.9% uptime, Sev-1 response in 30 minutes, onsite within 48 hours. Service credits cap at 10% of monthly fees.

| Tier | Uptime | Sev-1 response | Sev-2 response | Onsite | Credit per breach |
| --- | --- | --- | --- | --- | --- |
| Standard | 99.5% | 1 h | 8 h | 3 business days | 5% |
| Premium | 99.9% | 30 min | 4 h | 48 h | 10% |

Uptime covers the fleet dashboards on [[eng/cloud-infra|Cloud Infrastructure]]; arm hardware faults are covered by response and onsite times, not uptime. Sev-1 paging and customer notice follow the [[eng/incident-response|Incident Response Plan]] and the [[eng/oncall-rotation|On-call Rotation]]. Hardware repair and replacement terms live on [[support/warranty-terms|Warranty Terms]].

## Links
- measures: [[eng/cloud-infra]]
- paging: [[eng/incident-response]]
- paging: [[eng/oncall-rotation]]
- hardware_terms: [[support/warranty-terms]]
