import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';

let server, db, base;
const staff = {};
const password = 'Test-only-password-739!';
async function request(path, { actor, method='GET', data, headers={} }={}) {
  const response = await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(actor ? {Cookie:actor.cookie,'X-CSRF-Token':actor.csrf} : {}),...headers},...(data !== undefined ? {body:JSON.stringify(data)} : {})});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function ok(path, options, status=200) {const result=await request(path,options);assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
before(async()=> {
  ({server,db}=createApp({dbPath:':memory:'}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});

test('first-run setup, sessions, and seven individual staff roles',async()=>{
  assert.equal((await ok('/setup')).setupRequired,true);
  assert.equal((await request('/patients')).status,401);
  await ok('/setup',{method:'POST',data:{name:'Hospital Admin',email:'admin@example.test',password}},201);
  assert.equal((await ok('/setup')).setupRequired,false);
  assert.equal((await request('/setup',{method:'POST',data:{name:'Other Admin',email:'other@example.test',password}})).status,409);
  const admin=await request('/login',{method:'POST',data:{email:'admin@example.test',password}});
  assert.equal(admin.status,200);assert.match(admin.cookie,/hims_session=/);
  staff.admin={cookie:admin.cookie,...admin.body};
  for(const role of ['reception','doctor','nurse','laboratory','pharmacy','billing']) {
    await ok('/users',{actor:staff.admin,method:'POST',data:{name:`Staff ${role}`,email:`${role}@example.test`,password,role}},201);
    const login=await request('/login',{method:'POST',data:{email:`${role}@example.test`,password}});
    assert.equal(login.status,200);staff[role]={cookie:login.cookie,...login.body};
    assert.equal((await ok('/me',{actor:staff[role]})).user.role,role);
  }
  assert.equal((await ok('/users',{actor:staff.admin})).length,7);
  assert.equal((await request('/users',{actor:staff.doctor})).status,403);
  assert.equal((await request('/patients',{actor:staff.admin})).status,403);
});
let patientId, encounterId, labId, pharmacyId;
test('patient registration validates data and limits demographic access',async()=>{
  const patient={first_name:'Alex',last_name:'Example',dob:'1990-05-14',sex:'female',phone:'555-0100',address:'Test address',emergency_contact:'Test contact'};
  assert.equal((await request('/patients',{actor:staff.doctor,method:'POST',data:patient})).status,403);
  assert.equal((await request('/patients',{actor:staff.reception,method:'POST',data:{...patient,dob:'2025-02-30'}})).status,400);
  patientId=(await ok('/patients',{actor:staff.reception,method:'POST',data:patient},201)).id;
  const rows=await ok('/patients?q=Alex',{actor:staff.reception});assert.equal(rows.length,1);assert.match(rows[0].mrn,/^H-/);
  const limited=await ok(`/patients/${patientId}`,{actor:staff.billing});assert.equal(limited.patient.address,undefined);assert.deepEqual(limited.encounters,[]);
});
test('appointments enforce clinician validity, slot collisions, and status transitions',async()=>{
  const data={patient_id:patientId,clinician_id:staff.doctor.user.id,scheduled_at:new Date(Date.now()+86400000).toISOString(),reason:'Scheduled review'};
  const {id}=await ok('/appointments',{actor:staff.reception,method:'POST',data},201);
  assert.equal((await request('/appointments',{actor:staff.reception,method:'POST',data})).status,409);
  assert.equal((await request('/appointments',{actor:staff.reception,method:'POST',data:{...data,clinician_id:staff.nurse.user.id}})).status,400);
  await ok(`/appointments/${id}`,{actor:staff.reception,method:'PATCH',data:{status:'arrived'}});
  assert.equal((await request(`/appointments/${id}`,{actor:staff.reception,method:'PATCH',data:{status:'cancelled'}})).status,409);
});
test('clinical documentation and orders hand off across departments',async()=>{
  encounterId=(await ok('/encounters',{actor:staff.doctor,method:'POST',data:{patient_id:patientId,clinician_id:staff.doctor.user.id,department:'Outpatient',reason:'Test encounter'}},201)).id;
  await ok(`/encounters/${encounterId}/notes`,{actor:staff.nurse,method:'POST',data:{kind:'vitals',content:'Test observation with units recorded.'}},201);
  assert.equal((await request(`/encounters/${encounterId}/notes`,{actor:staff.nurse,method:'POST',data:{kind:'clinical',content:'Not permitted'}})).status,400);
  await ok(`/encounters/${encounterId}/notes`,{actor:staff.doctor,method:'POST',data:{kind:'clinical',content:'Synthetic clinical assessment. Allergies reviewed.'}},201);
  const order={kind:'laboratory',description:'Test laboratory request',instructions:'Synthetic request for workflow validation'};
  assert.equal((await request(`/encounters/${encounterId}/orders`,{actor:staff.nurse,method:'POST',data:order})).status,403);
  labId=(await ok(`/encounters/${encounterId}/orders`,{actor:staff.doctor,method:'POST',data:order},201)).id;
  pharmacyId=(await ok(`/encounters/${encounterId}/orders`,{actor:staff.doctor,method:'POST',data:{...order,kind:'pharmacy',description:'Synthetic prescription'}},201)).id;
  assert.equal((await ok('/orders?kind=laboratory',{actor:staff.laboratory}))[0].patient_id,patientId);
  assert.equal((await request('/orders?kind=pharmacy',{actor:staff.laboratory})).status,403);
  assert.equal((await request(`/encounters/${encounterId}/close`,{actor:staff.doctor,method:'POST',data:{}})).status,409);
  assert.equal((await request(`/orders/${labId}/complete`,{actor:staff.doctor,method:'POST',data:{result:'Not permitted'}})).status,403);
  await ok(`/orders/${labId}/complete`,{actor:staff.laboratory,method:'POST',data:{result:'Synthetic result returned with units and reference range.'}});
  await ok(`/orders/${pharmacyId}/complete`,{actor:staff.pharmacy,method:'POST',data:{result:'Synthetic dispensing record.'}});
  assert.equal((await request(`/orders/${labId}/complete`,{actor:staff.laboratory,method:'POST',data:{result:'Duplicate'}})).status,409);
  const record=await ok(`/patients/${patientId}`,{actor:staff.doctor});
  assert.equal(record.encounters[0].notes.length,2);assert.equal(record.encounters[0].orders.filter(o=>o.status==='completed').length,2);
  const receptionRecord=await ok(`/patients/${patientId}`,{actor:staff.reception});assert.deepEqual(receptionRecord.encounters,[]);
  await ok(`/encounters/${encounterId}/close`,{actor:staff.doctor,method:'POST',data:{}},201);
  assert.equal((await request(`/encounters/${encounterId}/notes`,{actor:staff.doctor,method:'POST',data:{kind:'clinical',content:'Late note'}})).status,409);
});
test('billing records integer amounts and prevents duplicate payment',async()=>{
  const invoice={patient_id:patientId,description:'Test consultation',amount_minor:12550,currency:'USD'};
  assert.equal((await request('/invoices',{actor:staff.doctor,method:'POST',data:invoice})).status,403);
  assert.equal((await request('/invoices',{actor:staff.billing,method:'POST',data:{...invoice,amount_minor:12.5}})).status,400);
  const {id}=await ok('/invoices',{actor:staff.billing,method:'POST',data:invoice},201);
  await ok(`/invoices/${id}/pay`,{actor:staff.billing,method:'POST',data:{payment_reference:'TEST-RECEIPT-1'}});
  assert.equal((await request(`/invoices/${id}/pay`,{actor:staff.billing,method:'POST',data:{payment_reference:'TEST-RECEIPT-2'}})).status,409);
  const rows=await ok('/invoices',{actor:staff.billing});assert.equal(rows[0].amount_minor,12550);assert.equal(rows[0].payment_reference,'TEST-RECEIPT-1');
});
test('CSRF, cross-origin requests, and unapproved static paths are blocked',async()=>{
  assert.equal((await request('/logout',{actor:staff.doctor,method:'POST',data:{},headers:{'X-CSRF-Token':'bad'}})).status,403);
  assert.equal((await request('/logout',{actor:staff.doctor,method:'POST',data:{},headers:{Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await fetch(base+'/server/store.js')).status,404);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await ok('/me',{actor:staff.doctor})).user.role,'doctor');
});
test('audit records mutations and views without copying clinical narrative',async()=>{
  const audit=await ok('/audit',{actor:staff.admin});
  assert.ok(audit.some(a=>a.action==='view'&&a.entity==='patients'));
  assert.ok(audit.some(a=>a.action==='complete'&&a.entity==='orders'));
  assert.ok(audit.some(a=>a.action==='record_payment'));
  assert.ok(!JSON.stringify(audit).includes('Synthetic clinical assessment'));
  assert.equal((await request('/audit',{actor:staff.nurse})).status,403);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
test('password changes verify current credentials and revoke other sessions',async()=>{
  const second=await request('/login',{method:'POST',data:{email:'billing@example.test',password}});
  const other={cookie:second.cookie,...second.body};
  assert.equal((await request('/password',{actor:staff.billing,method:'POST',data:{current_password:'wrong-current-password',new_password:'New-test-password-739!'}})).status,400);
  await ok('/password',{actor:staff.billing,method:'POST',data:{current_password:password,new_password:'New-test-password-739!'}});
  assert.equal((await request('/me',{actor:other})).status,401);
  assert.equal((await request('/me',{actor:staff.billing})).status,200);
  assert.equal((await request('/login',{method:'POST',data:{email:'billing@example.test',password}})).status,401);
});
test('staff deactivation revokes sessions and logout invalidates credentials',async()=>{
  assert.equal((await request(`/users/${staff.admin.user.id}`,{actor:staff.admin,method:'PATCH',data:{active:false}})).status,409);
  await ok(`/users/${staff.nurse.user.id}`,{actor:staff.admin,method:'PATCH',data:{active:false}});
  assert.equal((await request('/me',{actor:staff.nurse})).status,401);
  assert.equal((await request('/login',{method:'POST',data:{email:'nurse@example.test',password}})).status,401);
  await ok('/logout',{actor:staff.doctor,method:'POST',data:{}});
  assert.equal((await request('/me',{actor:staff.doctor})).status,401);
});
test('repeated authentication failures are throttled',async()=>{
  for(let i=0;i<10;i++) await request('/login',{method:'POST',data:{email:'missing@example.test',password:'incorrect-password'}});
  assert.equal((await request('/login',{method:'POST',data:{email:'missing@example.test',password:'incorrect-password'}})).status,429);
});
