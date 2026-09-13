# Production release plan

The intention is a real hospital product. The current implementation is the first working foundation, not a claim of clinical readiness or legal compliance. Use synthetic records while the following work is completed and validated.

## Decisions needed from the hospital

- Country confirmed: Kenya. See [Kenya deployment requirements](KENYA.md) for regulatory review and integration scope.
- Confirmed: multi-location hospital with inpatient and outpatient services; local work must continue during internet outages. Bed counts, daily visits, concurrent staff and recovery targets remain to be sized.
- Hospital name, departments, staff role assignments, and who may view which patients.
- Local server or cloud; deployment owner, network access, backup destination, and recovery targets.
- Currency defaults to KES. Confirm billing model, insurers, taxes, and payment providers.
- Existing patient records, laboratory instruments, pharmacy formulary, imaging systems, and integrations.

## Required functional expansion

1. Patient identity management: duplicate detection and merge, demographic corrections, consent, verified emergency contacts, structured allergies, next-of-kin, record restrictions.
2. Clinical records: structured observations with units, diagnoses and coding, care plans, note signing and amendments, medication reconciliation, encounter cancellation and controlled reopening.
3. Inpatient care: basic admission, doctor discharge, same-location bed transfers and ward/bed allocation are implemented. Nursing charts, medication administration, theatre, procedures and cross-location transfer acceptance remain.
4. Emergency care: triage, acuity queues, emergency access with review, time-sensitive escalation.
5. Laboratory: specimen collection and accessioning, panels, structured units and ranges, result verification and amendments, critical result notification, instrument interfaces.
6. Pharmacy: medication catalog, structured prescribing, pharmacist validation, stock and batches, expiry dates, controlled-drug handling, administration, returns and procurement.
7. Billing: tariffs, itemized accounts, deposits, partial payments, refunds, insurance claims, reconciliation, fiscal rules and receipts.
8. Scheduling: appointment durations, availability, overlapping-slot checks, rescheduling, reminders and appointment-to-encounter links. The current implementation only prevents identical clinician start times.
9. Imaging, documents, reporting, inventory, and hospital-specific integrations. Adopt an agreed interoperability profile and terminology only after interface requirements are specified.

## Identity and security release gates

- MFA or the hospital's identity provider; secure password recovery, initial-password rotation and staff offboarding.
- Review care-team scoping, least privilege, exceptional access, session inactivity timeout, and workstation lock behavior.
- TLS termination with certificate renewal, secure cookies, trusted host configuration, hardened reverse proxy, and network restrictions.
- Durable shared login throttling, password policy review, request limits and load protection. Current throttling is per-process and resets on restart.
- Encrypted server volumes and backups, managed keys, audit export to protected storage, retention rules and deletion controls.
- Security review of API authorization, dependencies, desktop supply chain, and threat model. Audit data is append-only through the API, not cryptographically tamper-proof against database administrators.

## Operations and validation release gates

- Select and prove a production database topology under expected load; implement versioned migrations and rollback procedures.
- Automated encrypted backups, tested restoration, disaster recovery, monitoring, alerting, service supervision and incident procedures.
- Accessibility, workstation/browser coverage, concurrent workflow and load testing.
- Clinical acceptance testing signed off by representative staff from every department.
- Data migration reconciliation and an agreed cutover and downtime procedure.
- Signed Windows installer, managed configuration and secure update distribution.
- Country-specific legal and privacy review; no HIPAA, GDPR, or other certification is implied by this code.

Release should be tied to evidence for these requirements, not merely successful startup or passing development tests.
