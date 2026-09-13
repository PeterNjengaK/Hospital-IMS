# Kenya deployment requirements

Deployment country confirmed by the hospital owner: Kenya. Requirements reviewed against official sources on 13 September 2026. This document records release work, not a claim of approval or legal compliance.

## Implemented regional behavior

- New invoices default to Kenyan shillings (`KES`) in the interface and API when currency is omitted. Existing invoice currencies are preserved.
- Hospital event timestamps display in `Africa/Nairobi` (East Africa Time). Appointment entry explicitly uses EAT, independent of workstation timezone; timestamps remain stored in UTC.
- Date-of-birth validation uses the Kenyan calendar date. Birth dates remain calendar dates rather than timezone-shifted timestamps.
- Interface language remains English, using the `en-KE` locale. Kiswahili translation is not implemented.

## Privacy and health-data governance

Review the hospital's controller responsibilities and the software/hosting provider's processor responsibilities, ODPC registration, lawful processing grounds, patient notices, access rights, retention, breach handling, and transfer safeguards. Do not assume one blanket consent covers all processing or that choosing a Kenyan server alone establishes compliance.

Official references: [ODPC health-data guidance](https://www.odpc.go.ke/wp-content/uploads/2024/02/ODPC-Guidance-Note-on-Processing-of-Health-Data.pdf), [registration guidance and FAQs](https://www.odpc.go.ke/faqs/), and [Kenya data-protection legislation](https://www.odpc.go.ke/data-protection-laws-kenya/).

Before real patient use, complete a documented data protection impact assessment and professional review of the applicable obligations. Implement agreed care-team restrictions, retention controls, privacy workflows, security operations and contractual safeguards. These remain release tasks.

## Digital health certification and interoperability

Review the system against the [Digital Health Agency certification programme](https://certification.dha.go.ke/) and obtain the applicable assessment and approval before the production release. DHA identifies hospital information systems within its [system categories](https://certification.dha.go.ke/systems). Confirm the current standards, integration specifications and legal requirements directly with the agency; draft regulations are not used here as proof of an enacted requirement.

There is no DHA certification, national health information exchange connection, or national reporting integration in the current implementation.

## Payers and payments

- SHA: plan facility onboarding, eligibility, authorization, claims, remittance and reconciliation based on the hospital's contract and authorized interface specifications. The official [SHA eligibility service](https://eligibility.sha.go.ke/) and [facility e-contracting portal](https://econtracting.sha.go.ke/) are references for scope, not APIs this application currently connects to.
- M-Pesa: confirm the hospital's merchant account and approved payment integration. Implement verified callbacks, idempotency, receipt matching and reconciliation before marking mobile payments automatically paid.
- Confirm private insurers, cash/card collection, refunds, itemized receipts, and applicable fiscal requirements. Current billing records full payments manually; it does not submit claims or initiate or verify payments.

## Remaining hospital decisions

Single facility or multiple sites; hospital name and facility identifiers; county and location; departments and beds; local-server or cloud deployment; connectivity and downtime needs; SHA/private-insurer participation; payment accounts; preferred languages; existing records and external systems.

Collect additional identifiers only when justified by the workflow. National ID must not be treated as the only patient identity option: children and other patients may need alternative identifiers.
