import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.js';

test('multi-location inpatient workflow, access isolation and persistence without a central connection',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'hims-inpatient-'));
  const dbPath=join(directory,'site.sqlite');
  let app=createApp({dbPath}),base;
  async function start(){await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}/api`;}
  async function stop(){app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
  const password='Inpatient-test-password-739!';
  const staff={};
  async function request(path,role='admin',method='GET',data,status=200){
    const actor=staff[role];
    const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const value=await res.json();assert.equal(res.status,status,`${method} ${path}: ${JSON.stringify(value)}`);return {value,cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const call=async(...args)=>(await request(...args)).value;
  try {
    await start();await call('/setup','', 'POST',{name:'Admin',email:'admin@example.test',password},201);
    async function login(role){const {value,cookie}=await request('/login','','POST',{email:`${role}@example.test`,password});staff[role]={...value,cookie};}
    await login('admin');
    for(const role of ['doctor','nurse','reception','laboratory']){await call('/users','admin','POST',{name:role,email:`${role}@example.test`,password,role},201);await login(role);}
    const first=(await call('/locations','admin','POST',{code:'NAI',name:'Nairobi'},201)).id;
    const second=(await call('/locations','admin','POST',{code:'MSA',name:'Mombasa'},201)).id;
    await call('/locations','nurse','POST',{code:'NO',name:'Forbidden'},403);
    await call(`/locations/${first}/staff`,'admin','POST',{user_id:staff.doctor.user.id,assigned:true});
    await call(`/locations/${second}/staff`,'admin','POST',{user_id:staff.nurse.user.id,assigned:true});
    const ward=(await call('/wards','admin','POST',{location_id:first,name:'Medical ward'},201)).id;
    const bed=(await call('/beds','admin','POST',{ward_id:ward,label:'M01'},201)).id;
    const nextBed=(await call('/beds','admin','POST',{ward_id:ward,label:'M02'},201)).id;
    const patient=(await call('/patients','reception','POST',{first_name:'Synthetic',last_name:'Patient',dob:'1990-01-01',sex:'unknown'},201)).id;
    const data={patient_id:patient,clinician_id:staff.doctor.user.id,bed_id:bed,reason:'Synthetic inpatient assessment'};
    await call('/admissions','nurse','POST',data,403);
    const admission=(await call('/admissions','doctor','POST',data,201)).id;
    await call('/admissions','doctor','POST',data,409);
    await call('/admissions','doctor','POST',{...data,bed_id:nextBed},409);
    await call(`/admissions?location_id=${first}`,'nurse','GET',undefined,403);
    const record=await call(`/patients/${patient}`,'doctor');
    const encounter=record.encounters[0].id;
    assert.equal((await call(`/patients/${patient}`,'nurse')).encounters.length,0);
    assert.equal((await call('/encounters','nurse')).length,0);
    await call(`/encounters/${encounter}/notes`,'nurse','POST',{kind:'nursing',content:'Forbidden note'},403);
    await call(`/encounters/${encounter}/close`,'doctor','POST',{},409);
    await call(`/encounters/${encounter}/notes`,'doctor','POST',{kind:'clinical',content:'Local care continues without the central server.'},201);
    const order=(await call(`/encounters/${encounter}/orders`,'doctor','POST',{kind:'laboratory',description:'Synthetic test',instructions:'Synthetic instructions'},201)).id;
    assert.equal((await call('/orders?kind=laboratory','laboratory')).length,0);
    await call(`/orders/${order}/complete`,'laboratory','POST',{result:'Forbidden'},403);
    await call(`/admissions/${admission}/discharge`,'doctor','POST',{note:'Not yet'},409);
    await call(`/locations/${first}/staff`,'admin','POST',{user_id:staff.laboratory.user.id,assigned:true});
    await call(`/orders/${order}/complete`,'laboratory','POST',{result:'Synthetic result'});
    await call(`/admissions/${admission}/transfer`,'doctor','POST',{bed_id:nextBed,note:'Move to another bed'});
    const beds=await call(`/beds?location_id=${first}`,'doctor');
    assert.equal(beds.find(b=>b.id===bed).occupied,0);assert.equal(beds.find(b=>b.id===nextBed).occupied,1);
    const before=await call('/node-status');assert.ok(before.queuedChanges>0);assert.equal(before.synchronization,'not_configured');
    const patientGlobal=app.db.prepare('SELECT global_id FROM patients WHERE id=?').get(patient).global_id;assert.ok(patientGlobal);
    await stop();app=createApp({dbPath});await start();await login('doctor');await login('admin');
    const after=await call('/node-status');assert.equal(after.nodeId,before.nodeId);assert.equal(after.queuedChanges,before.queuedChanges);
    assert.equal(app.db.prepare('SELECT global_id FROM patients WHERE id=?').get(patient).global_id,patientGlobal);
    assert.match((await call(`/patients/${patient}`,'doctor')).encounters[0].notes[0].content,/Local care continues/);
    await call(`/admissions/${admission}/discharge`,'doctor','POST',{note:'Synthetic discharge summary and follow-up'});
    await call(`/admissions/${admission}/discharge`,'doctor','POST',{note:'Duplicate discharge'},409);
    assert.equal((await call(`/beds?location_id=${first}`,'doctor')).filter(b=>b.occupied).length,0);
    assert.deepEqual((await call(`/admissions/${admission}/events`,'doctor')).map(e=>e.action),['admit','transfer','discharge']);
    assert.equal((await call(`/patients/${patient}`,'doctor')).encounters[0].status,'closed');
    assert.equal(app.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally {await stop();rmSync(directory,{recursive:true,force:true});}
});
