import { randomUUID } from 'node:crypto';

export async function inpatientApi({path,method,url,user,db,body,req,send,fail,transaction,audit}) {
  if (!/^\/api\/(locations|wards|beds|admissions|node-status)(\/|$)/.test(path)) return false;
  const text = (d,key,max=200) => {
    if (typeof d[key] !== 'string' || !d[key].trim() || d[key].length>max) fail(400,`Enter ${key.replaceAll('_',' ')} (maximum ${max} characters).`);
    return d[key].trim();
  };
  const admin = () => { if(user.role!=='admin')fail(403,'Administrator access required.'); };
  const clinical = () => {if(!['doctor','nurse'].includes(user.role))fail(403,'Clinical access required.');};
  const access = id => {
    if(!db.prepare('SELECT id FROM locations WHERE id=?').get(id))fail(404,'Location not found.');
    if(user.role!=='admin' && !db.prepare('SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?').get(user.id,id))fail(403,'You are not assigned to this location.');
  };
  const bed = id => db.prepare('SELECT b.*,w.location_id,w.name ward FROM beds b JOIN wards w ON w.id=b.ward_id WHERE b.id=?').get(id) || fail(404,'Bed not found.');
  const admission = id => {
    const a=db.prepare('SELECT * FROM admissions WHERE id=?').get(id)||fail(404,'Admission not found.');
    access(bed(a.bed_id).location_id);return a;
  };
  const event = (id,action,bedId,note) => {
    db.prepare('INSERT INTO admission_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,action,bedId,user.id,note,new Date().toISOString());
    audit(user.id,action,'admissions',id);
  };
  if(path==='/api/node-status' && method==='GET') {
    admin();send({nodeId:db.prepare('SELECT node_id FROM node_identity').get().node_id,queuedChanges:db.prepare('SELECT COUNT(*) n FROM change_queue').get().n,synchronization:'not_configured',schemaVersion:2});return true;
  }
  if(path==='/api/locations') {
    if(method==='GET') {send(user.role==='admin'?db.prepare('SELECT * FROM locations ORDER BY name').all():db.prepare('SELECT l.* FROM locations l JOIN user_locations u ON u.location_id=l.id WHERE u.user_id=? ORDER BY l.name').all(user.id));return true;}
    if(method==='POST') {
      admin();const d=await body(req),id=randomUUID(),code=text(d,'code',20).toUpperCase(),name=text(d,'name',120);
      if(!/^[A-Z0-9-]+$/.test(code))fail(400,'Use letters, numbers and hyphens for the facility code.');
      transaction(()=>{if(db.prepare('SELECT id FROM locations WHERE code=?').get(code))fail(409,'Facility code already exists.');db.prepare('INSERT INTO locations VALUES(?,?,?)').run(id,code,name);audit(user.id,'create','locations',id);});send({id},201);return true;
    }
  }
  const assignment=path.match(/^\/api\/locations\/([^/]+)\/staff$/);
  if(assignment) {
    admin();access(assignment[1]);
    if(method==='GET'){send(db.prepare('SELECT u.id,u.name,u.role FROM users u JOIN user_locations l ON l.user_id=u.id WHERE l.location_id=?').all(assignment[1]));return true;}
    if(method==='POST') {
      const d=await body(req);if(!Number.isSafeInteger(Number(d.user_id)))fail(400,'Select a staff member.');
      if(!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(Number(d.user_id)))fail(404,'Active staff member not found.');
      if(typeof d.assigned!=='boolean')fail(400,'Assigned must be true or false.');
      transaction(()=>{if(d.assigned)db.prepare('INSERT OR IGNORE INTO user_locations VALUES(?,?)').run(Number(d.user_id),assignment[1]);else db.prepare('DELETE FROM user_locations WHERE user_id=? AND location_id=?').run(Number(d.user_id),assignment[1]);audit(user.id,d.assigned?'assign_staff':'remove_staff','locations',assignment[1]);});send({ok:true});return true;
    }
  }
  if(path==='/api/wards') {
    if(method==='GET'){const id=url.searchParams.get('location_id')||'';access(id);send(db.prepare('SELECT * FROM wards WHERE location_id=? ORDER BY name').all(id));return true;}
    if(method==='POST'){admin();const d=await body(req),location=text(d,'location_id'),name=text(d,'name',120),id=randomUUID();access(location);transaction(()=>{if(db.prepare('SELECT id FROM wards WHERE location_id=? AND name=?').get(location,name))fail(409,'Ward already exists.');db.prepare('INSERT INTO wards VALUES(?,?,?)').run(id,location,name);audit(user.id,'create','wards',id);});send({id},201);return true;}
  }
  if(path==='/api/beds') {
    if(method==='GET'){const id=url.searchParams.get('location_id')||'';access(id);send(db.prepare("SELECT b.id,b.label,w.name ward,w.id ward_id,w.location_id,EXISTS(SELECT 1 FROM admissions a WHERE a.bed_id=b.id AND a.status='admitted') occupied FROM beds b JOIN wards w ON w.id=b.ward_id WHERE w.location_id=? ORDER BY w.name,b.label").all(id));return true;}
    if(method==='POST'){admin();const d=await body(req),ward=text(d,'ward_id'),label=text(d,'label',50),id=randomUUID();if(!db.prepare('SELECT id FROM wards WHERE id=?').get(ward))fail(404,'Ward not found.');transaction(()=>{if(db.prepare('SELECT id FROM beds WHERE ward_id=? AND label=?').get(ward,label))fail(409,'Bed label already exists in this ward.');db.prepare('INSERT INTO beds VALUES(?,?,?)').run(id,ward,label);audit(user.id,'create','beds',id);});send({id},201);return true;}
  }
  if(path==='/api/admissions') {
    clinical();
    if(method==='GET') {
      const location=url.searchParams.get('location_id')||'';access(location);
      const rows=db.prepare("SELECT a.*,p.first_name || ' ' || p.last_name patient,p.mrn,b.label bed,w.name ward FROM admissions a JOIN patients p ON p.id=a.patient_id JOIN beds b ON b.id=a.bed_id JOIN wards w ON w.id=b.ward_id WHERE w.location_id=? ORDER BY a.admitted_at DESC LIMIT 200").all(location);
      audit(user.id,'list','admissions',location);send(rows);return true;
    }
    if(method==='POST') {
      const d=await body(req),bedId=text(d,'bed_id'),reason=text(d,'reason',2000),id=randomUUID();
      const patient=Number(d.patient_id),doctor=Number(d.clinician_id);
      if(!Number.isSafeInteger(patient)||!Number.isSafeInteger(doctor))fail(400,'Select a patient and doctor.');
      transaction(()=>{
        const b=bed(bedId);access(b.location_id);
        if(!db.prepare('SELECT id FROM patients WHERE id=?').get(patient))fail(404,'Patient not found.');
        if(!db.prepare("SELECT u.id FROM users u JOIN user_locations l ON l.user_id=u.id WHERE u.id=? AND u.role='doctor' AND u.active=1 AND l.location_id=?").get(doctor,b.location_id))fail(400,'Select an active doctor assigned to this location.');
        if(db.prepare("SELECT id FROM admissions WHERE status='admitted' AND (patient_id=? OR bed_id=?)").get(patient,bedId))fail(409,'Patient is already admitted or the bed is occupied.');
        const encounter=Number(db.prepare('INSERT INTO encounters(patient_id,clinician_id,department,reason) VALUES(?,?,?,?)').run(patient,doctor,b.ward,reason).lastInsertRowid);
        db.prepare('INSERT INTO admissions(id,patient_id,encounter_id,bed_id,admitted_by,admitted_at) VALUES(?,?,?,?,?,?)').run(id,patient,encounter,bedId,user.id,new Date().toISOString());event(id,'admit',bedId,reason);
      });send({id},201);return true;
    }
  }
  const change=path.match(/^\/api\/admissions\/([^/]+)\/(transfer|discharge|events)$/);
  if(change) {
    clinical();
    if(change[2]==='events'&&method==='GET'){admission(change[1]);audit(user.id,'view','admissions',change[1]);send(db.prepare('SELECT e.*,u.name author,b.label bed,w.name ward FROM admission_events e JOIN users u ON u.id=e.actor_id JOIN beds b ON b.id=e.bed_id JOIN wards w ON w.id=b.ward_id WHERE admission_id=? ORDER BY e.created_at,e.rowid').all(change[1]));return true;}
    if(method==='POST'&&change[2]!=='events') {
      const d=await body(req),note=text(d,'note',10000);
      transaction(()=>{
        const a=admission(change[1]);if(a.status!=='admitted')fail(409,'Patient has already been discharged.');
        if(change[2]==='transfer') {
          const b=bed(text(d,'bed_id'));access(b.location_id);
          if(b.location_id!==bed(a.bed_id).location_id)fail(409,'Cross-location transfers require receiving-facility acceptance and are not enabled yet.');
          if(db.prepare("SELECT id FROM admissions WHERE bed_id=? AND status='admitted'").get(b.id))fail(409,'The destination bed is occupied.');
          db.prepare('UPDATE admissions SET bed_id=? WHERE id=?').run(b.id,a.id);
          db.prepare('UPDATE encounters SET department=? WHERE id=?').run(b.ward,a.encounter_id);event(a.id,'transfer',b.id,note);
        } else {
          if(user.role!=='doctor')fail(403,'Only a doctor can discharge a patient.');
          if(db.prepare("SELECT id FROM orders WHERE encounter_id=? AND status='pending'").get(a.encounter_id))fail(409,'Complete pending orders before discharge.');
          db.prepare('INSERT INTO notes(encounter_id,author_id,kind,content) VALUES(?,?,?,?)').run(a.encounter_id,user.id,'clinical',`Discharge summary: ${note}`);
          db.prepare("UPDATE admissions SET status='discharged',discharged_by=?,discharged_at=?,discharge_summary=? WHERE id=?").run(user.id,new Date().toISOString(),note,a.id);
          db.prepare("UPDATE encounters SET status='closed',closed_at=? WHERE id=?").run(new Date().toISOString(),a.encounter_id);event(a.id,'discharge',a.bed_id,note);
        }
      });send({ok:true});return true;
    }
  }
  fail(405,'Method not allowed.');
}
