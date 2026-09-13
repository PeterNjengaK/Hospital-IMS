# Multi-location and local operation

## Implemented in schema version 2

- Administrator-managed locations, ward and bed inventories, and staff location assignments.
- Inpatient admission opens a clinical encounter and reserves a bed transactionally. Unique database indexes prevent duplicate active admissions and double occupancy.
- Same-location bed transfers, append-only admission history and doctor-led discharge. Discharge records a summary, closes the encounter and releases the bed. Pending orders prevent discharge.
- Inpatient encounter access is checked against location assignments in the inpatient workspace, clinical records, notes, orders and department work queues.
- Persistent server identity, global identifiers for patient and clinical records, and an append-only change journal captured by database triggers in the same transaction as the record mutation.
- Additive migration from the original schema. Existing records and local numeric IDs remain intact.

Administrators configure these through **Locations & wards**. Assign a doctor and the relevant nurses, laboratory staff and pharmacists to the facility. Clinical staff then use **Inpatient ward**. The existing outpatient workflow remains available.

## What local operation means today

The server and database do not depend on an internet service. A running location server can accept registrations and care notes from local browsers during internet loss. Tests exercise registration, care documentation, admission and restart persistence without a central server.

The location server still needs to be deployed on the hospital LAN with appropriate TLS, power protection and backups. The default development server listens only on loopback. A browser disconnected from its local server cannot save care records. There is no browser offline cache for patient data.

## Synchronisation is not implemented yet

The change journal records record references and operations, not immutable replication payloads. It is a foundation for synchronisation, not a functioning outbox transport. The administrative screen explicitly reports central synchronisation as not configured. There is no claim that data is uploaded or available at another site.

Next implementation work:

1. Provision site identity and central trust; bind each local server to its facility. A database must not be cloned as a new site without regenerating its node identity.
2. Define versioned replication payloads using global IDs for every related record, including staff, and capture consistent payloads transactionally.
3. Implement authenticated encrypted push/pull, durable acknowledgements, replay protection, retries and idempotent application.
4. Review conflicting demographics and duplicate identities. Preserve clinical amendments and prohibit silent overwrite.
5. Scope existing outpatient records and all queues to locations. Existing outpatient records currently retain the earlier hospital-wide permissions; global patient demographics are still shared within this server.
6. Implement central-to-local staff provisioning, offline authorization expiry, revocation policies and visible remote-data freshness.
7. Implement cross-location transfer acceptance. Current transfers are deliberately limited to beds in the same location.
8. Test network partitions, interrupted batches, reconciliation, duplicate delivery, concurrent edits, restoration and compromised-node revocation.

Do not deploy separate production databases expecting them to exchange patient data yet.
