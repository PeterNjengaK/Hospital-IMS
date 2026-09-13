# Carepoint Hospital IMS

A working hospital management application with a shared Node.js server, SQLite database, responsive browser interface, and Electron desktop client. Built in this repository from an empty workspace.

**Status:** implemented outpatient workflow foundation, not a completed or approved hospital production release. There are no sample patient records or default credentials. See [the release plan](docs/PRODUCTION.md) for missing modules and deployment gates.

The application now also includes **Locations & wards** for administrators and **Inpatient ward** for assigned doctors and nurses: admissions, bed allocation, local transfers and discharge. See [multi-location implementation status](docs/OFFLINE-LOCATIONS.md). Local persistence and a change journal are implemented; exchange of data between site servers is not yet implemented.

## Run the web application

On Windows, double-click **Start-Hospital.cmd** to start the server in the background and open the application. Run it again after restarting the computer. Startup logs are in `data/server-output.log` and `data/server-error.log`.

Requires Node.js 24 or later. The web server has no third-party runtime dependencies.

```powershell
cd D:\Hospital-IMS
npm.cmd start
```

Open **http://127.0.0.1:3000**. On the server computer, create the first administrator with a unique password of at least 12 characters. Create staff accounts in **Staff & access**, then sign in as the appropriate staff member. Administrators cannot read clinical records.

Patient data persists in `data/hospital.sqlite`. Tests use separate databases and do not add data to your working hospital database. Stop the server with Ctrl+C.

Deployment country is **Kenya**. New invoices default to **KES**. Hospital timestamps and appointment entry use **East Africa Time (Africa/Nairobi)** regardless of the workstation timezone. See [Kenya requirements](docs/KENYA.md) for ODPC/DHA review and planned SHA and M-Pesa work.

## Run the desktop application

Start the same web server first. In another PowerShell terminal:

```powershell
npm.cmd ci
npx.cmd install-electron
npm.cmd run desktop
```

For a deployed hospital server:

```powershell
$env:HIMS_SERVER_URL = 'https://hospital.example.org'
npm.cmd run desktop
```

The desktop client shares the server's records. It does not create an offline database. It requires HTTPS except for localhost. A signed Windows installer and managed update channel are still to be built.

## Implemented workflows

| Role | Workspace |
|---|---|
| Administrator | Create and deactivate/reactivate staff accounts, inspect audit trail |
| Reception | Register and search patients, schedule visits, record arrivals or cancellations |
| Doctor | Open encounters, append clinical notes, order lab tests and medicines, review responses, close encounters |
| Nurse | Open encounters, append nursing notes and observations, review clinical records and orders |
| Laboratory | Review laboratory orders and return results to the encounter |
| Pharmacy | Review prescriptions and return dispensing records to the encounter |
| Billing | Create invoices, record full payments with transaction references |

Every staff member has an individual login. Permissions are enforced by the server, not just hidden menu items. Clinical records are visible to doctors and nurses; receiving departments see their own orders. Nonclinical staff see a limited patient identity record.

Suggested first workflow:

1. Administrator creates reception, doctor, nurse, laboratory, pharmacy, and billing accounts.
2. Reception registers a patient and schedules a visit with the doctor.
3. Doctor or nurse opens the patient encounter. Nurses record observations; doctors document assessment.
4. Doctor sends an order to laboratory or pharmacy.
5. The receiving department completes the order. Its response appears in the clinical encounter.
6. Billing creates an invoice and records confirmed payment.
7. Doctor closes the encounter after recording a clinical note and completing outstanding orders.

## Verification

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:desktop
```

Integration tests cover all roles, patient validation, appointment collisions, cross-department handoffs, record restrictions, invoice amounts, duplicate completion/payment protection, CSRF, session revocation, and audit events.

The browser workflow test uses installed Microsoft Edge in headless mode by default. Set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome. Screenshots are saved under `artifacts/`. Electron's binary installer is explicit for the pinned Electron release.

## Configuration and operations

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Server listen address |
| `PORT` | `3000` | Server port |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `HIMS_SERVER_URL` | `http://127.0.0.1:3000` | Desktop server address |

Local execution uses HTTP on loopback. Hospital deployment requires HTTPS, secure cookies, restricted server access, and a configured reverse proxy that preserves the original Host header. Complete initial account setup locally before exposing the server. Do not expose the initial setup route through the proxy.

Passwords are salted with scrypt. Session tokens are stored hashed; cookies are HttpOnly and SameSite=Strict, with an eight-hour expiry. Write requests require CSRF tokens. Reads and writes of patient records are audited. Clinical notes are append-only in the application. Changes and their audit events are committed transactionally.

SQLite files are **not encrypted by the application**. Use appropriate encrypted storage and filesystem access controls. For an initial consistent backup, stop the service and copy the entire `data` directory to protected storage; restore only with the service stopped. An automated, encrypted backup system and a measured restore drill remain release work.

No external fonts, trackers, analytics, CDNs, or patient-data services are used by the frontend. See [architecture](docs/ARCHITECTURE.md) and [production requirements](docs/PRODUCTION.md).
