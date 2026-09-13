import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const roles = ['admin', 'reception', 'doctor', 'nurse', 'laboratory', 'pharmacy', 'billing'];
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password, hash) {
  const [salt, digest] = hash.split(':');
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(digest, 'hex'));
}
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY, mrn TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL,
      last_name TEXT NOT NULL, dob TEXT NOT NULL, sex TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '', emergency_contact TEXT NOT NULL DEFAULT '',
      allergies TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
      clinician_id INTEGER NOT NULL REFERENCES users(id), scheduled_at TEXT NOT NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
      created_by INTEGER NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS encounters (
      id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
      clinician_id INTEGER NOT NULL REFERENCES users(id), department TEXT NOT NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY, encounter_id INTEGER NOT NULL REFERENCES encounters(id),
      author_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY, encounter_id INTEGER NOT NULL REFERENCES encounters(id),
      kind TEXT NOT NULL, description TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT '',
      ordered_by INTEGER NOT NULL REFERENCES users(id), completed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
      description TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unpaid',
      created_by INTEGER NOT NULL REFERENCES users(id), paid_by INTEGER REFERENCES users(id),
      payment_reference TEXT, paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
      entity TEXT NOT NULL, entity_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS encounters_patient ON encounters(patient_id);
    CREATE INDEX IF NOT EXISTS orders_encounter ON orders(encounter_id);
    CREATE INDEX IF NOT EXISTS notes_encounter ON notes(encounter_id);
    CREATE INDEX IF NOT EXISTS appointments_date ON appointments(scheduled_at);
  `);
  // Additive migration: preserve existing patient records and identifiers.
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS node_identity (id INTEGER PRIMARY KEY CHECK(id=1), node_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_locations (user_id INTEGER NOT NULL REFERENCES users(id), location_id TEXT NOT NULL REFERENCES locations(id), PRIMARY KEY(user_id,location_id));
      CREATE TABLE IF NOT EXISTS wards (id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), name TEXT NOT NULL, UNIQUE(location_id,name));
      CREATE TABLE IF NOT EXISTS beds (id TEXT PRIMARY KEY, ward_id TEXT NOT NULL REFERENCES wards(id), label TEXT NOT NULL, UNIQUE(ward_id,label));
      CREATE TABLE IF NOT EXISTS admissions (
        id TEXT PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
        encounter_id INTEGER NOT NULL REFERENCES encounters(id), bed_id TEXT NOT NULL REFERENCES beds(id),
        status TEXT NOT NULL DEFAULT 'admitted' CHECK(status IN ('admitted','discharged')),
        admitted_by INTEGER NOT NULL REFERENCES users(id), admitted_at TEXT NOT NULL,
        discharged_by INTEGER REFERENCES users(id), discharged_at TEXT, discharge_summary TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS occupied_bed ON admissions(bed_id) WHERE status='admitted';
      CREATE UNIQUE INDEX IF NOT EXISTS admitted_patient ON admissions(patient_id) WHERE status='admitted';
      CREATE TABLE IF NOT EXISTS admission_events (
        id TEXT PRIMARY KEY, admission_id TEXT NOT NULL REFERENCES admissions(id),
        action TEXT NOT NULL, bed_id TEXT NOT NULL REFERENCES beds(id), actor_id INTEGER NOT NULL REFERENCES users(id),
        note TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS change_queue (
        sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, node_id TEXT NOT NULL,
        entity TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    db.prepare('INSERT OR IGNORE INTO node_identity VALUES(1,?)').run(randomUUID());
    for (const table of ['patients','encounters','notes','orders','appointments','invoices']) {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='global_id')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN global_id TEXT`);
        for (const row of db.prepare(`SELECT id FROM ${table}`).all()) db.prepare(`UPDATE ${table} SET global_id=? WHERE id=?`).run(randomUUID(),row.id);
        db.exec(`CREATE UNIQUE INDEX ${table}_global_id ON ${table}(global_id)`);
      }
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_identity AFTER INSERT ON ${table} WHEN NEW.global_id IS NULL BEGIN
        UPDATE ${table} SET global_id=lower(hex(randomblob(16))) WHERE id=NEW.id;
      END;`);
    }
    for (const table of ['patients','encounters','notes','orders','appointments','invoices','locations','wards','beds','admissions','admission_events']) {
      for (const operation of ['INSERT','UPDATE']) {
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_queue_${operation} AFTER ${operation} ON ${table} BEGIN
          INSERT INTO change_queue(event_id,node_id,entity,entity_id,operation)
          VALUES(lower(hex(randomblob(16))),(SELECT node_id FROM node_identity WHERE id=1),'${table}',NEW.id,'${operation.toLowerCase()}');
        END;`);
      }
    }
    db.exec('PRAGMA user_version = 2; COMMIT');
  } catch(error) { db.exec('ROLLBACK'); db.close(); throw error; }
  return db;
}
