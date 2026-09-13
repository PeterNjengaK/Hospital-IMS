import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { openStore, roles, passwordHash, passwordMatches } from './store.js';
import { hospitalToday, currency as defaultCurrency } from '../public/region.js';
import { inpatientApi } from './inpatient.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const permission = {
  patients: roles, clinical: ['doctor', 'nurse'], facilities: ['admin'], inpatient: ['doctor','nurse'],
  registration: ['reception'], appointments: ['reception', 'doctor', 'nurse'],
  encounters: ['doctor', 'nurse'], prescribe: ['doctor'],
  laboratory: ['laboratory', 'doctor', 'nurse'], pharmacy: ['pharmacy', 'doctor', 'nurse'],
  billing: ['billing'], users: ['admin'], audit: ['admin']
};
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const allowed = (user, key) => permission[key]?.includes(user.role);
function required(data, key, max = 500) {
  if (typeof data[key] !== 'string' || !data[key].trim() || data[key].trim().length > max) fail(400, `${key.replaceAll('_', ' ')} is required (maximum ${max} characters).`);
  return data[key].trim();
}
function optional(data, key, max = 2000) {
  if (data[key] == null || data[key] === '') return '';
  return required(data, key, max);
}
function integer(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) fail(400, 'A valid positive integer is required.');
  return n;
}
function choice(value, options) { if (!options.includes(value)) fail(400, 'Invalid selection.'); return value; }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Send application/json.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 65536) fail(413, 'Request too large.'); chunks.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString()); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data; }
  catch { fail(400, 'Invalid JSON object.'); }
}

export function createApp({ dbPath = resolve(root, 'data/hospital.sqlite'), secure = process.env.COOKIE_SECURE === 'true' } = {}) {
  const db = openStore(dbPath);
  const attempts = new Map();
  const dummyHash = passwordHash(randomBytes(32).toString('hex'));
  const audit = (actor, action, entity, id = '') => db.prepare('INSERT INTO audit(actor_id,action,entity,entity_id) VALUES(?,?,?,?)').run(actor, action, entity, String(id));
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const canEncounter = (user,id) => {
    const location = db.prepare('SELECT w.location_id FROM admissions a JOIN beds b ON b.id=a.bed_id JOIN wards w ON w.id=b.ward_id WHERE a.encounter_id=?').get(id);
    return !location || !!db.prepare('SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?').get(user.id,location.location_id);
  };
  const getPatient = id => db.prepare('SELECT * FROM patients WHERE id=?').get(integer(id)) || fail(404, 'Patient not found.');
  const getEncounter = id => db.prepare('SELECT * FROM encounters WHERE id=?').get(integer(id)) || fail(404, 'Encounter not found.');
  const openEncounter = id => { const e = getEncounter(id); if (e.status !== 'open') fail(409, 'This encounter is closed.'); return e; };
  const clinician = id => db.prepare("SELECT id FROM users WHERE id=? AND role='doctor' AND active=1").get(integer(id)) || fail(400, 'Select an active doctor.');
  const requirePermission = (user, key) => { if (!allowed(user, key)) fail(403, 'Your role does not have access to this action.'); };
  const userView = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, permissions: Object.keys(permission).filter(k => allowed(u, k)) });
  const cookie = value => `hims_session=${value}; HttpOnly; SameSite=Strict; Path=/; ${secure ? 'Secure; ' : ''}Max-Age=${value ? 28800 : 0}`;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const method = req.method;
      if (!path.startsWith('/api/')) {
        if (method !== 'GET') fail(405, 'Method not allowed.');
        const files = { '/': 'index.html', '/app.js': 'app.js', '/region.js': 'region.js', '/style.css': 'style.css' };
        if (!files[path]) fail(404, 'Not found.');
        const content = await readFile(resolve(root, 'public', files[path]));
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(files[path])] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(content);
      }
      if (!['GET', 'POST', 'PATCH'].includes(method)) fail(405, 'Method not allowed.');
      if (method !== 'GET') {
        const origin = req.headers.origin;
        if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== req.headers.host)) fail(403, 'Cross-origin requests are not allowed.');
      }
      if (path === '/api/health' && method === 'GET') return send({ status: 'ok' });
      if (path === '/api/setup' && method === 'GET') return send({ setupRequired: !db.prepare('SELECT id FROM users LIMIT 1').get() });
      if (path === '/api/setup' && method === 'POST') {
        const remote = req.socket.remoteAddress;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) fail(403, 'Initial setup must be completed on the server computer.');
        const data = await body(req);
        const name = required(data, 'name', 120), email = required(data, 'email', 254).toLowerCase(), password = required(data, 'password', 128);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) fail(400, 'Use a valid email and a password of at least 12 characters.');
        transaction(() => {
          if (db.prepare('SELECT id FROM users LIMIT 1').get()) fail(409, 'Setup is already complete.');
          const id = db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(name, email, passwordHash(password)).lastInsertRowid;
          audit(Number(id), 'setup', 'users', id);
        });
        return send({ ok: true }, 201);
      }
      if (path === '/api/login' && method === 'POST') {
        const data = await body(req), email = required(data, 'email', 254).toLowerCase(), password = required(data, 'password', 128);
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const keys = [`ip:${req.socket.remoteAddress}`, `account:${email}`];
        if (keys.some(key => (attempts.get(key)?.count || 0) >= 10)) fail(429, 'Too many attempts. Try again in 15 minutes.');
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const validPassword = passwordMatches(password, user?.password_hash || dummyHash);
        if (!user || !validPassword || !user.active) {
          for (const key of keys) { const record = attempts.get(key) || { count: 0, until: now + 900000 }; record.count++; attempts.set(key, record); }
          audit(null, 'login_failed', 'authentication');
          fail(401, 'Email or password is incorrect.');
        }
        keys.forEach(key => attempts.delete(key));
        const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
        transaction(() => {
          db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);
          db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token), user.id, csrf, now + 28800000);
          audit(user.id, 'login', 'authentication');
        });
        res.setHeader('Set-Cookie', cookie(token));
        return send({ user: userView(user), csrf });
      }
      const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('hims_session='))?.slice(13);
      const session = token && db.prepare('SELECT s.*,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>? AND u.active=1').get(digest(token), Date.now());
      if (!session) fail(401, 'Please sign in to continue.');
      const user = { ...session, id: session.user_id };
      if (method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) fail(403, 'Session verification failed. Reload and try again.');
      if(await inpatientApi({path,method,url,user,db,body,req,send,fail,transaction,audit}))return;
      if (path === '/api/me' && method === 'GET') return send({ user: userView(user), csrf: session.csrf });
      if (path === '/api/password' && method === 'POST') {
        const d = await body(req), current = required(d,'current_password',128), next = required(d,'new_password',128);
        if (next.length < 12 || next === current) fail(400,'Choose a different password of at least 12 characters.');
        const account = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
        if (!passwordMatches(current,account.password_hash)) fail(400,'Current password is incorrect.');
        transaction(() => { db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(next),user.id); db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id,session.token_hash); audit(user.id,'change_password','users',user.id); });
        return send({ok:true});
      }
      if (path === '/api/logout' && method === 'POST') {
        transaction(() => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash); audit(user.id, 'logout', 'authentication'); });
        res.setHeader('Set-Cookie', cookie('')); return send({ ok: true });
      }
      if (path === '/api/dashboard' && method === 'GET') {
        const count = sql => db.prepare(sql).get().n;
        const stats = {};
        if (user.role !== 'admin') stats.patients = count('SELECT COUNT(*) n FROM patients');
        if (allowed(user, 'encounters')) stats.encounters = count("SELECT COUNT(*) n FROM encounters WHERE status='open'");
        if (allowed(user, 'appointments')) stats.appointments = count("SELECT COUNT(*) n FROM appointments WHERE status='scheduled'");
        if (allowed(user, 'laboratory')) stats.laboratory = count("SELECT COUNT(*) n FROM orders WHERE kind='laboratory' AND status='pending'");
        if (allowed(user, 'pharmacy')) stats.pharmacy = count("SELECT COUNT(*) n FROM orders WHERE kind='pharmacy' AND status='pending'");
        if (allowed(user, 'billing')) stats.invoices = count("SELECT COUNT(*) n FROM invoices WHERE status='unpaid'");
        if (user.role === 'admin') stats.users = count('SELECT COUNT(*) n FROM users WHERE active=1');
        return send({ stats });
      }
      if (path === '/api/clinicians' && method === 'GET') return send(db.prepare("SELECT id,name FROM users WHERE role='doctor' AND active=1 ORDER BY name").all());
      if (path === '/api/users') {
        requirePermission(user, 'users');
        if (method === 'GET') return send(db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY name').all());
        if (method === 'POST') {
          const data = await body(req), name = required(data, 'name', 120), email = required(data, 'email', 254).toLowerCase(), password = required(data, 'password', 128), role = choice(data.role, roles);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) fail(400, 'Use a valid email and a password of at least 12 characters.');
          const id = transaction(() => {
            if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'This email is already registered.');
            const id = Number(db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name, email, passwordHash(password), role).lastInsertRowid);
            audit(user.id, 'create', 'users', id); return id;
          }); return send({ id }, 201);
        }
      }
      const userMatch = path.match(/^\/api\/users\/(\d+)$/);
      if (userMatch && method === 'PATCH') {
        requirePermission(user, 'users'); const id = integer(userMatch[1]), data = await body(req);
        if (id === user.id) fail(409, 'You cannot deactivate your own account.');
        if (typeof data.active !== 'boolean') fail(400, 'Active must be true or false.');
        transaction(() => { if (!db.prepare('UPDATE users SET active=? WHERE id=?').run(Number(data.active), id).changes) fail(404, 'User not found.'); db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); audit(user.id, data.active ? 'activate' : 'deactivate', 'users', id); });
        return send({ ok: true });
      }
      if (path === '/api/audit' && method === 'GET') {
        requirePermission(user, 'audit'); return send(db.prepare('SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200').all());
      }
      if (path === '/api/patients') {
        if (user.role === 'admin') fail(403, 'Administrative accounts do not have access to patient records.');
        if (method === 'GET') {
          const q = `%${(url.searchParams.get('q') || '').slice(0, 100)}%`;
          const rows = db.prepare("SELECT id,mrn,first_name,last_name,dob,sex,phone FROM patients WHERE first_name || ' ' || last_name LIKE ? OR mrn LIKE ? ORDER BY id DESC LIMIT 100").all(q, q);
          audit(user.id, 'search', 'patients'); return send(rows);
        }
        if (method === 'POST') {
          requirePermission(user, 'registration'); const d = await body(req);
          const first = required(d, 'first_name', 100), last = required(d, 'last_name', 100), dob = required(d, 'dob', 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob)) || new Date(dob).toISOString().slice(0,10) !== dob || dob > hospitalToday() || dob < '1850-01-01') fail(400, 'Enter a valid date of birth.');
          const sex = choice(d.sex, ['female', 'male', 'other', 'unknown']);
          const id = transaction(() => {
            const mrn = `H-${randomBytes(5).toString('hex').toUpperCase()}`;
            const id = Number(db.prepare('INSERT INTO patients(mrn,first_name,last_name,dob,sex,phone,address,emergency_contact,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run(mrn, first, last, dob, sex, optional(d,'phone',40), optional(d,'address'), optional(d,'emergency_contact',300), user.id).lastInsertRowid);
            audit(user.id, 'create', 'patients', id); return id;
          }); return send({ id }, 201);
        }
      }
      const patientMatch = path.match(/^\/api\/patients\/(\d+)$/);
      if (patientMatch && method === 'GET') {
        if (user.role === 'admin') fail(403, 'Administrative accounts do not have access to patient records.');
        const p = getPatient(patientMatch[1]);
        const clinical = allowed(user, 'clinical');
        const patient = clinical ? p : { id:p.id,mrn:p.mrn,first_name:p.first_name,last_name:p.last_name,dob:p.dob,sex:p.sex,phone:p.phone };
        const encounters = clinical ? db.prepare('SELECT e.*,u.name clinician FROM encounters e JOIN users u ON u.id=e.clinician_id WHERE patient_id=? ORDER BY e.id DESC').all(p.id).filter(e=>canEncounter(user,e.id)).map(e => ({ ...e, notes: db.prepare('SELECT n.*,u.name author FROM notes n JOIN users u ON u.id=n.author_id WHERE encounter_id=? ORDER BY n.id').all(e.id), orders: db.prepare('SELECT * FROM orders WHERE encounter_id=? ORDER BY id DESC').all(e.id) })) : [];
        audit(user.id, 'view', 'patients', p.id); return send({ patient, encounters });
      }
      if (path === '/api/appointments') {
        requirePermission(user, 'appointments');
        if (method === 'GET') { audit(user.id, 'list', 'appointments'); return send(db.prepare("SELECT a.*,p.first_name || ' ' || p.last_name patient,p.mrn,u.name clinician FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.clinician_id ORDER BY scheduled_at DESC LIMIT 200").all()); }
        if (method === 'POST') {
          const d = await body(req), p = getPatient(d.patient_id), c = clinician(d.clinician_id), reason = required(d,'reason');
          const date = new Date(required(d,'scheduled_at',40)); if (!Number.isFinite(date.getTime()) || date < new Date()) fail(400, 'Choose a future appointment time.');
          const id = transaction(() => {
            if (db.prepare("SELECT id FROM appointments WHERE clinician_id=? AND scheduled_at=? AND status='scheduled'").get(c.id,date.toISOString())) fail(409, 'This clinician already has an appointment at that time.');
            const id = Number(db.prepare('INSERT INTO appointments(patient_id,clinician_id,scheduled_at,reason,created_by) VALUES(?,?,?,?,?)').run(p.id,c.id,date.toISOString(),reason,user.id).lastInsertRowid); audit(user.id,'create','appointments',id); return id;
          }); return send({ id },201);
        }
      }
      const appointmentMatch = path.match(/^\/api\/appointments\/(\d+)$/);
      if (appointmentMatch && method === 'PATCH') {
        requirePermission(user,'appointments'); const d = await body(req), status = choice(d.status,['arrived','cancelled']);
        transaction(() => { if (!db.prepare("UPDATE appointments SET status=? WHERE id=? AND status='scheduled'").run(status,integer(appointmentMatch[1])).changes) fail(409,'Appointment is no longer scheduled.'); audit(user.id,status,'appointments',appointmentMatch[1]); }); return send({ok:true});
      }
      if (path === '/api/encounters') {
        requirePermission(user,'encounters');
        if (method === 'GET') { audit(user.id,'list','encounters'); return send(db.prepare("SELECT e.*,p.first_name || ' ' || p.last_name patient,p.mrn,u.name clinician FROM encounters e JOIN patients p ON p.id=e.patient_id JOIN users u ON u.id=e.clinician_id ORDER BY e.id DESC LIMIT 200").all().filter(e=>canEncounter(user,e.id))); }
        if (method === 'POST') {
          const d = await body(req), p = getPatient(d.patient_id), c = clinician(d.clinician_id), department = required(d,'department',100), reason = required(d,'reason');
          const id = transaction(() => { const id = Number(db.prepare('INSERT INTO encounters(patient_id,clinician_id,department,reason) VALUES(?,?,?,?)').run(p.id,c.id,department,reason).lastInsertRowid); audit(user.id,'create','encounters',id); return id; }); return send({id},201);
        }
      }
      const encounterMatch = path.match(/^\/api\/encounters\/(\d+)\/(notes|orders|close)$/);
      if (encounterMatch && method === 'POST') {
        const action = encounterMatch[2]; requirePermission(user, action === 'orders' || action === 'close' ? 'prescribe' : 'clinical');
        const d = await body(req);
        const id = transaction(() => {
          const e = openEncounter(encounterMatch[1]); if(!canEncounter(user,e.id))fail(403,'You are not assigned to this inpatient location.'); let id = e.id;
          if (action === 'notes') {
            const kind = choice(d.kind, user.role === 'nurse' ? ['nursing','vitals'] : ['clinical','vitals']);
            id = Number(db.prepare('INSERT INTO notes(encounter_id,author_id,kind,content) VALUES(?,?,?,?)').run(e.id,user.id,kind,required(d,'content',10000)).lastInsertRowid);
          } else if (action === 'orders') {
            id = Number(db.prepare('INSERT INTO orders(encounter_id,kind,description,instructions,ordered_by) VALUES(?,?,?,?,?)').run(e.id,choice(d.kind,['laboratory','pharmacy']),required(d,'description',500),required(d,'instructions',2000),user.id).lastInsertRowid);
          } else {
            if(db.prepare("SELECT id FROM admissions WHERE encounter_id=? AND status='admitted'").get(e.id))fail(409,'Discharge the patient through the inpatient workspace.');
            if (db.prepare("SELECT id FROM orders WHERE encounter_id=? AND status='pending'").get(e.id)) fail(409,'Complete pending orders before closing the encounter.');
            if (!db.prepare("SELECT id FROM notes WHERE encounter_id=? AND kind='clinical'").get(e.id)) fail(409,'Add a clinical note before closing the encounter.');
            db.prepare("UPDATE encounters SET status='closed',closed_at=? WHERE id=?").run(new Date().toISOString(),e.id);
          }
          audit(user.id,action,'encounters',e.id); return id;
        }); return send({id},201);
      }
      if (path === '/api/orders' && method === 'GET') {
        const kind = choice(url.searchParams.get('kind'),['laboratory','pharmacy']); requirePermission(user,kind);
        audit(user.id,'list',kind);
        return send(db.prepare("SELECT o.*,p.id patient_id,p.first_name || ' ' || p.last_name patient,p.mrn,p.dob,u.name clinician FROM orders o JOIN encounters e ON e.id=o.encounter_id JOIN patients p ON p.id=e.patient_id JOIN users u ON u.id=o.ordered_by WHERE o.kind=? ORDER BY o.id DESC LIMIT 200").all(kind).filter(o=>canEncounter(user,o.encounter_id)));
      }
      const orderMatch = path.match(/^\/api\/orders\/(\d+)\/complete$/);
      if (orderMatch && method === 'POST') {
        const d = await body(req);
        transaction(() => {
          const o = db.prepare('SELECT * FROM orders WHERE id=?').get(integer(orderMatch[1])) || fail(404,'Order not found.');
          if(!canEncounter(user,o.encounter_id))fail(403,'You are not assigned to this inpatient location.');
          if (user.role !== o.kind) fail(403,'Only the receiving department can complete this order.');
          if (o.status !== 'pending') fail(409,'This order has already been completed.');
          db.prepare("UPDATE orders SET status='completed',result=?,completed_by=?,completed_at=? WHERE id=?").run(required(d,'result',10000),user.id,new Date().toISOString(),o.id);
          audit(user.id,'complete','orders',o.id);
        }); return send({ok:true});
      }
      if (path === '/api/invoices') {
        requirePermission(user,'billing');
        if (method === 'GET') { audit(user.id,'list','invoices'); return send(db.prepare("SELECT i.*,p.first_name || ' ' || p.last_name patient,p.mrn FROM invoices i JOIN patients p ON p.id=i.patient_id ORDER BY i.id DESC LIMIT 200").all()); }
        if (method === 'POST') {
          const d = await body(req), p = getPatient(d.patient_id), description = required(d,'description'), amount = integer(d.amount_minor), currency = required({...d,currency:d.currency ?? defaultCurrency},'currency',3).toUpperCase();
          if (!/^[A-Z]{3}$/.test(currency) || amount > 1000000000) fail(400,'Invalid currency or amount.');
          const id = transaction(() => { const id = Number(db.prepare('INSERT INTO invoices(patient_id,description,amount_minor,currency,created_by) VALUES(?,?,?,?,?)').run(p.id,description,amount,currency,user.id).lastInsertRowid); audit(user.id,'create','invoices',id); return id; }); return send({id},201);
        }
      }
      const invoiceMatch = path.match(/^\/api\/invoices\/(\d+)\/pay$/);
      if (invoiceMatch && method === 'POST') {
        requirePermission(user,'billing'); const d = await body(req), reference = required(d,'payment_reference',200);
        transaction(() => { if (!db.prepare("UPDATE invoices SET status='paid',payment_reference=?,paid_by=?,paid_at=? WHERE id=? AND status='unpaid'").run(reference,user.id,new Date().toISOString(),integer(invoiceMatch[1])).changes) fail(409,'Invoice is already paid or does not exist.'); audit(user.id,'record_payment','invoices',invoiceMatch[1]); }); return send({ok:true});
      }
      fail(404,'Endpoint not found.');
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.code || error.name);
      if (!res.headersSent) send({ error: error.status ? error.message : 'An unexpected server error occurred.' },error.status || 500);
      else res.end();
    }
  });
  server.on('close', () => db.close());
  return { server, db };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
  server.listen(port, host, () => console.log(`Hospital IMS is running at http://${host}:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
