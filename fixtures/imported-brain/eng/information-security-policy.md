---
title: Information Security Policy
type: policy
team: eng
room: Policy
updated: 2026-03-01
source: Security/Information Security Policy.docx
---
Kitewing's security policy covers access control, devices, data retention, incident response, vendors and training, effective March 1, 2026. Owner: not recorded.

Version 1.3. Effective March 1, 2026.

Review cadence: annually, or after any security incident.

## 1. Scope
This policy applies to all Kitewing employees, contractors and systems that store or process customer data, including restaurant inventory data, supplier price lists and customer staff contact details.

## 2. Access control
- All employees use Okta SSO with hardware-key or push MFA. SMS MFA is not allowed.
- Production database access requires an approved request in the #prod-access channel and expires after 8 hours.
- Access reviews are run quarterly. The last completed access review was for Q1 2026.

## 3. Devices
Laptops are managed with Kandji, disk encryption is required, and screens lock after 5 minutes. Lost devices must be reported within 4 hours.

## 4. Data
Customer data is stored in AWS us-west-2 only. Backups are kept for 35 days. Customer data is deleted within 60 days after contract termination.

## 5. Incidents
Suspected security incidents are reported in #security-incidents and to the on-call engineer. Customers affected by a confirmed breach are notified within 72 hours.

## 6. Vendors
Vendors that process customer data need a security review before contract signature. The vendor list is kept by Ops.

## 7. Training
Security awareness training is required at onboarding and annually.

## Links
- conflicts_with: [[finance/q3-2026-board-deck-outline]]
- conflicts_with: [[people/all-hands-2026-09-02]]
- conflicts_with: [[people/team-directory]]
- references: [[eng/oncall-rotation]]
- references: [[ops/vendor-list]]
- vendor: [[companies/aws]]
- vendor: [[companies/kandji]]
