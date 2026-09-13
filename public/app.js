import { locale, timeZone, currency, hospitalToday, appointmentToUtc } from './region.js';
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let user, csrf, route = 'overview', activePatient, currentDetail, selectedLocation;
const labels = { admin:'Administrator', reception:'Reception', doctor:'Doctor', nurse:'Nurse', laboratory:'Laboratory', pharmacy:'Pharmacy', billing:'Billing' };
const icons = { facilities:'+', inpatient:'+', overview:'◫', patients:'♧', appointments:'▦', encounters:'♡', laboratory:'⚗', pharmacy:'✚', billing:'▤', users:'♙', audit:'☷' };
const navigation = [['overview','Overview'],['facilities','Locations & wards'],['inpatient','Inpatient ward'],['patients','Patient directory'],['appointments','Appointments'],['encounters','Clinical workspace'],['laboratory','Laboratory'],['pharmacy','Pharmacy'],['billing','Billing & payments'],['users','Staff & access'],['audit','Audit trail']];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const can = key => user.permissions.includes(key);
const date = value => value ? new Intl.DateTimeFormat(locale,{dateStyle:'medium',...(value.includes('T') ? {timeStyle:'short',timeZone} : {timeZone:'UTC'})}).format(new Date(value)) + (value.includes('T') ? ' EAT' : '') : '—';
const badge = value => `<span class="badge ${['open','scheduled','pending','unpaid'].includes(value) ? 'amber' : ['cancelled','inactive'].includes(value) ? 'gray' : 'green'}">${escape(value)}</span>`;
function toast(message, error = false) {
  const el = document.querySelector('#toast'); el.textContent = message; el.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className = '', 5000);
}
async function api(path, method = 'GET', data) {
  const response = await fetch(`/api${path}`, {method, headers:{'Content-Type':'application/json', ...(csrf ? {'X-CSRF-Token':csrf} : {})}, ...(data !== undefined ? {body:JSON.stringify(data)} : {})});
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && user) { user = null; csrf = null; modal.close(); await boot(); }
    throw Error(result.error || 'The request failed.');
  }
  return result;
}
const field = (name,label,type='text',value='',extra='') => `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra} required></label>`;
const textArea = (name,label,extra='') => `<label class="full">${label}<textarea name="${name}" rows="4" required ${extra}></textarea></label>`;
const select = (name,label,options) => `<label>${label}<select name="${name}" aria-label="${escape(label)}" required><option value="">Select ${label.toLowerCase()}</option>${options.map(([value,text]) => `<option value="${escape(value)}">${escape(text)}</option>`).join('')}</select></label>`;
function formDialog(title, fields, submit, action='Save', description='') {
  modal.innerHTML = `<form class="dialog-form"><div class="dialog-heading"><div><span class="eyebrow">CAREPOINT WORKSPACE</span><h2>${escape(title)}</h2></div><button type="button" class="icon-button" data-close aria-label="Close dialog">×</button></div>${description ? `<p class="muted">${escape(description)}</p>` : ''}<div class="fields">${fields}</div><p class="form-error" role="alert"></p><div class="dialog-footer"><button type="button" class="button secondary" data-close>Cancel</button><button class="button" type="submit">${escape(action)}</button></div></form>`;
  modal.querySelectorAll('[data-close]').forEach(b => b.onclick = () => modal.close());
  modal.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try { await submit(Object.fromEntries(new FormData(event.target))); modal.close(); toast('Saved successfully'); await render(); }
    catch(error) { modal.querySelector('.form-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  modal.showModal();
}
function empty(title, description) { return `<div class="empty"><span class="empty-icon">✧</span><h3>${title}</h3><p>${description}</p></div>`; }
function table(headers, rows) { return `<div class="table-scroll"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`; }
const person = (name, sub='') => `<div class="person"><span class="avatar small">${escape(name.split(' ').map(s=>s[0]).slice(0,2).join(''))}</span><div><strong>${escape(name)}</strong><small>${escape(sub)}</small></div></div>`;
const button = (text,action,id='',secondary=false) => `<button class="button ${secondary ? 'secondary' : ''}" data-action="${action}" data-id="${id}">${text}</button>`;
function shell() {
  const nav = navigation.filter(([key]) => key === 'overview' || (key === 'patients' ? user.role !== 'admin' : can(key)));
  app.innerHTML = `<div class="layout"><aside class="sidebar"><a class="brand" href="/" aria-label="Carepoint home"><span class="brand-icon">✚</span><span>carepoint<span class="brand-sub">HOSPITAL MANAGEMENT</span></span></a><div class="workspace-label">MODULES</div><nav aria-label="Main navigation">${nav.map(([key,label])=>`<button data-route="${key}" class="nav-item ${route === key ? 'active' : ''}"><span aria-hidden="true">${icons[key]}</span>${label}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="connection"><i></i> Shared hospital workspace</div><div class="profile"><span class="avatar">${escape(user.name.split(' ').map(s=>s[0]).slice(0,2).join(''))}</span><div><strong>${escape(user.name)}</strong><small>${labels[user.role]}</small></div><button class="icon-button" id="logout" title="Sign out" aria-label="Sign out">↪</button></div></div></aside><main><header class="topbar"><div><span class="hospital-dot">✚</span> Carepoint Hospital <span class="divider">/</span> <span class="muted">${labels[user.role]} workspace</span></div><span class="today">${new Intl.DateTimeFormat(locale,{timeZone,weekday:'short',month:'short',day:'numeric'}).format(new Date())}</span></header><div class="module-bar"><span>Module: ${navigation.find(([key]) => key === route)?.[1] || 'Overview'}</span><button class="button secondary" data-action="refresh">Refresh</button></div><div class="page" id="page"><div class="loading">Loading workspace…</div></div><footer>Carepoint Hospital IMS <button class="text-button footer-password" data-action="password">Change password</button><span>Kenya | EAT | KES</span></footer></main></div>`;
  app.querySelectorAll('[data-route]').forEach(el => el.onclick = () => { route = el.dataset.route; activePatient = null; render().catch(e=>toast(e.message,true)); });
  app.querySelector('#logout').onclick = async () => { try { await api('/logout','POST',{}); user = null; csrf = null; route = 'overview'; await boot(); } catch(e) { toast(e.message,true); } };
}
const heading = (eyebrow,title,description,action='') => `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
async function overview() {
  const {stats} = await api('/dashboard');
  const statLabels = {patients:'Registered patients',encounters:'Open encounters',appointments:'Scheduled appointments',laboratory:'Pending lab orders',pharmacy:'Pending prescriptions',invoices:'Unpaid invoices',users:'Active staff'};
  const statRoutes = {invoices:'billing',...Object.fromEntries(Object.keys(stats).map(k=>[k,k]))}; statRoutes.invoices='billing';
  const modules = navigation.filter(([key]) => key !== 'overview' && (key === 'patients' ? user.role !== 'admin' : can(key)));
  return heading('HOSPITAL INFORMATION MANAGEMENT SYSTEM',`Welcome, ${escape(user.name.split(' ')[0])}.`,'Department work summary and module access.') +
    `<section class="panel"><div class="panel-toolbar"><h2>Department work summary</h2><span class="muted">Current hospital totals</span></div>${table(['Work list','Records','Action'],Object.entries(stats).map(([key,value])=>`<tr><td>${statLabels[key]}</td><td class="numeric">${value.toLocaleString(locale)}</td><td><button class="button secondary" data-route="${statRoutes[key]}">Open work list</button></td></tr>`))}</section><section class="panel"><div class="panel-toolbar"><h2>Available modules</h2><span class="muted">${labels[user.role]}</span></div><div class="module-menu">${modules.map(([key,label])=>`<button data-route="${key}" aria-label="Open ${label} module"><span aria-hidden="true">&rsaquo;</span> ${label}</button>`).join('')}</div></section><div class="notice">Hospital time: East Africa Time (EAT) | Default billing currency: KES. Select a module to view or update records.</div>`;
}

async function patients() {
  if (activePatient) return patientDetail();
  const rows = await api('/patients');
  return heading('PATIENT SERVICES','Patient directory','Find the right person. Keep their care connected.',can('registration') ? button('＋ Register patient','new-patient') : '') + `<section class="panel"><div class="panel-toolbar"><h2>All patients <span class="count">${rows.length}</span></h2><form id="search-form" class="search"><input name="q" aria-label="Search patients" placeholder="Search name or medical record number"><button class="button secondary">Search</button></form></div><div id="patient-results">${patientRows(rows)}</div><div class="panel-foot">Showing up to 100 matches. Search to narrow results.</div></section>`;
}
function patientRows(rows) { return rows.length ? table(['Patient','Medical record','Date of birth','Sex','Phone',''],rows.map(p=>`<tr><td>${person(`${p.first_name} ${p.last_name}`)}</td><td><span class="mono">${escape(p.mrn)}</span></td><td>${date(p.dob)}</td><td class="capitalize">${escape(p.sex)}</td><td>${escape(p.phone)||'—'}</td><td>${button('Open →','patient',p.id,true)}</td></tr>`)) : empty('No patients found','Register your first patient or try a different search.'); }
async function patientDetail() {
  const {patient:p, encounters} = await api(`/patients/${activePatient}`); currentDetail = {patient:p,encounters};
  return `<button class="text-button" data-action="back-patients">← Patient directory</button>` + heading('PATIENT RECORD',`${escape(p.first_name)} ${escape(p.last_name)}`,`Medical record ${escape(p.mrn)}`,can('encounters') ? button('＋ Open encounter','new-encounter',p.id) : '') + `<section class="panel patient-summary"><div><span>Date of birth</span><strong>${date(p.dob)}</strong></div><div><span>Sex</span><strong class="capitalize">${escape(p.sex)}</strong></div><div><span>Phone</span><strong>${escape(p.phone)||'Not recorded'}</strong></div>${can('clinical') ? `<div><span>Emergency contact</span><strong>${escape(p.emergency_contact)||'Not recorded'}</strong></div>` : ''}</section>${can('clinical') ? `<div class="notice">Confirm allergies and current medicines with the patient and record them in the clinical assessment before prescribing.</div><div class="section-heading"><h2>Encounter history</h2><span class="muted">${encounters.length} encounters</span></div>${encounters.length ? encounters.map(e=>`<section class="panel encounter"><div class="panel-toolbar"><div><h2>${escape(e.department)} ${badge(e.status)}</h2><p>${date(e.created_at)} · ${escape(e.clinician)}</p></div>${e.status === 'open' && can('prescribe') ? button('Close encounter','close-encounter',e.id,true) : ''}</div><div class="encounter-body"><span class="eyebrow">REASON FOR VISIT</span><p>${escape(e.reason)}</p><div class="section-heading"><h3>Care notes</h3>${e.status === 'open' ? button('＋ Add note','new-note',e.id,true) : ''}</div>${e.notes.length ? e.notes.map(n=>`<article class="note"><div><strong>${escape(n.author)}</strong><span>${escape(n.kind)} · ${date(n.created_at)}</span></div><p class="preserve">${escape(n.content)}</p></article>`).join('') : '<p class="muted">No care notes recorded.</p>'}<div class="section-heading"><h3>Department orders</h3>${e.status === 'open' && can('prescribe') ? button('＋ Place order','new-order',e.id,true) : ''}</div>${e.orders.length ? e.orders.map(o=>`<article class="order-card"><div><strong>${escape(o.description)}</strong>${badge(o.status)}</div><small>${labels[o.kind]} · ${date(o.created_at)}</small><p class="preserve">${escape(o.instructions)}</p>${o.result ? `<div class="result"><strong>Department response</strong><p class="preserve">${escape(o.result)}</p></div>` : ''}</article>`).join('') : '<p class="muted">No departmental orders.</p>'}</div></section>`).join('') : empty('No encounters yet','Open an encounter to record this patient’s care.')} ` : '<section class="panel">'+empty('Patient identity verified','Clinical information is available to the care team through their workspace.')+'</section>'}`;
}
async function appointments() {
  const rows = await api('/appointments');
  return heading('PATIENT FLOW','Appointments','Schedule visits and coordinate arrivals.',button('＋ Schedule visit','new-appointment')) + `<section class="panel">${rows.length ? table(['Patient','Scheduled for','Clinician','Reason','Status','Actions'],rows.map(a=>`<tr><td>${person(a.patient,a.mrn)}</td><td>${date(a.scheduled_at)}</td><td>${escape(a.clinician)}</td><td>${escape(a.reason)}</td><td>${badge(a.status)}</td><td><div class="row-actions">${a.status === 'scheduled' ? button('Arrived','arrive',a.id,true)+button('Cancel','cancel-appointment',a.id,true) : '—'}</div></td></tr>`)) : empty('Your schedule is clear','Schedule the first visit after adding a doctor and registering a patient.')}</section>`;
}
async function encounters() {
  const rows = await api('/encounters');
  return heading('CARE DELIVERY','Clinical workspace','Shared encounters, care notes, and department handoffs.',button('＋ Open encounter','new-encounter')) + `<section class="panel">${rows.length ? table(['Patient','Department','Clinician','Opened','Status',''],rows.map(e=>`<tr><td>${person(e.patient,e.mrn)}</td><td>${escape(e.department)}</td><td>${escape(e.clinician)}</td><td>${date(e.created_at)}</td><td>${badge(e.status)}</td><td>${button('View record →','patient',e.patient_id,true)}</td></tr>`)) : empty('Ready for your first encounter','Open an encounter for a registered patient to start documenting care.')}</section>`;
}
async function orders(kind) {
  const rows = await api(`/orders?kind=${kind}`), isLab = kind === 'laboratory';
  return heading('DEPARTMENT WORKSPACE',isLab ? 'Laboratory' : 'Pharmacy',isLab ? 'Receive test requests and return results to the clinical record.' : 'Review prescriptions and record dispensing completion.') + `<div class="queue-summary"><span class="queue-dot"></span><strong>${rows.filter(r=>r.status==='pending').length} pending</strong><span class="muted">· ${rows.length} recent orders</span></div><section class="panel">${rows.length ? table(['Patient',isLab ? 'Test request' : 'Prescription','Requested by','Status',''],rows.map(o=>`<tr><td>${person(o.patient,o.mrn)}</td><td><strong>${escape(o.description)}</strong><small>${date(o.created_at)}</small></td><td>${escape(o.clinician)}</td><td>${badge(o.status)}</td><td>${button('Review →','review-order',o.id,true)}</td></tr>`)) : empty(isLab ? 'No laboratory orders yet' : 'No prescriptions yet','Orders placed by doctors appear here and remain linked to the patient encounter.')}</section>`;
}
async function billing() {
  const rows = await api('/invoices');
  return heading('FINANCE','Billing & payments','Create charges and record payments against the right patient.',button('＋ Create invoice','new-invoice')) + `<section class="panel">${rows.length ? table(['Invoice','Patient','Description','Amount','Status',''],rows.map(i=>`<tr><td class="mono">INV-${String(i.id).padStart(5,'0')}</td><td>${person(i.patient,i.mrn)}</td><td>${escape(i.description)}</td><td>${escape(i.currency)} ${(i.amount_minor/100).toFixed(2)}</td><td>${badge(i.status)}</td><td>${i.status === 'unpaid' ? button('Record payment','pay',i.id,true) : `<small>${escape(i.payment_reference)}</small>`}</td></tr>`)) : empty('No invoices yet','Create a patient invoice to start recording charges and payments.')}</section>`;
}
async function users() {
  const rows = await api('/users');
  return heading('ADMINISTRATION','Staff & access','Individual accounts. Clear responsibilities. Controlled access.',button('＋ Add staff member','new-user')) + `<div class="notice">Clinical access belongs to clinical roles. Administrator accounts manage staff and audit records.</div><section class="panel">${rows.length ? table(['Staff member','Email','Role','Status',''],rows.map(u=>`<tr><td>${person(u.name)}</td><td>${escape(u.email)}</td><td>${labels[u.role]}</td><td>${badge(u.active ? 'active':'inactive')}</td><td>${u.id !== user.id ? button(u.active ? 'Deactivate':'Reactivate',u.active ? 'deactivate':'activate',u.id,true) : '<span class="muted">Your account</span>'}</td></tr>`)) : ''}</section>`;
}
async function audit() {
  const rows = await api('/audit');
  return heading('ACCOUNTABILITY','Audit trail','Recent access and changes recorded by the server.') + `<section class="panel">${table(['Time','Staff member','Action','Record type','Record ID'],rows.map(a=>`<tr><td>${date(a.created_at)}</td><td>${escape(a.actor)||'Unauthenticated'}</td><td>${escape(a.action.replaceAll('_',' '))}</td><td>${escape(a.entity)}</td><td class="mono">${escape(a.entity_id)||'—'}</td></tr>`))}<div class="panel-foot">Most recent 200 events. Audit records cannot be edited through this application.</div></section>`;
}
let renderVersion = 0;
async function render() {
  const version = ++renderVersion;
  shell();
  try {
    const html = await ({overview,facilities,inpatient,patients,appointments,encounters,laboratory:()=>orders('laboratory'),pharmacy:()=>orders('pharmacy'),billing,users,audit}[route])();
    if (version !== renderVersion || !user) return;
    document.querySelector('#page').innerHTML = html;
    document.querySelector('#page').querySelectorAll('[data-route]').forEach(el => el.onclick = () => { route=el.dataset.route; activePatient=null; render(); });
    const locationPicker=document.querySelector('#location-picker');
    if(locationPicker)locationPicker.onchange=()=>{selectedLocation=locationPicker.value;render();};
    const search = document.querySelector('#search-form');
    if (search) search.onsubmit = async e => { e.preventDefault(); try { const rows = await api(`/patients?q=${encodeURIComponent(new FormData(search).get('q'))}`); document.querySelector('#patient-results').innerHTML=patientRows(rows); } catch(e) { toast(e.message,true); } };
  } catch(e) { if (user && document.querySelector('#page')) document.querySelector('#page').innerHTML = empty('Unable to load workspace',escape(e.message)); }
}
async function patientSelector(selected) {
  if (selected) { const {patient:p}=await api(`/patients/${selected}`); return select('patient_id','Patient',[[p.id,`${p.first_name} ${p.last_name} · ${p.mrn}`]]).replace('<option value="">Select patient</option>','').replace('<option value=', '<option selected value='); }
  return `<label class="full">Find patient by name or medical record number<input id="patient-lookup" type="search" placeholder="Type a name or MRN" autocomplete="off"></label><label class="full">Patient<select name="patient_id" id="patient-options" aria-label="Patient" required><option value="">Search and select a patient</option></select></label>`;
}
function wirePatientSearch() {
  const input = modal.querySelector('#patient-lookup'); if (!input) return;
  let timer, version=0;
  input.oninput = () => { clearTimeout(timer); const v=++version; timer=setTimeout(async()=> { try {const rows=await api(`/patients?q=${encodeURIComponent(input.value)}`); if(v!==version || !modal.open) return; modal.querySelector('#patient-options').innerHTML='<option value="">Select a patient</option>'+rows.map(p=>`<option value="${p.id}">${escape(p.first_name+' '+p.last_name+' · '+p.mrn+' · '+p.dob)}</option>`).join('');} catch(e){toast(e.message,true);} },250); };
}
async function action(name,id) {
  if (await inpatientAction(name,id)) return;
  if (name==='refresh') return render();
  if (name==='password') return formDialog('Change password',field('current_password','Current password','password','','autocomplete="current-password" maxlength="128"')+field('new_password','New password','password','','autocomplete="new-password" minlength="12" maxlength="128"'),d=>api('/password','POST',d),'Change password','Use at least 12 characters. Your other sessions will be signed out.');
  if (name==='patient') {activePatient=id;route='patients';return render();}
  if (name==='back-patients') {activePatient=null;return render();}
  if (name==='new-user') return formDialog('Add staff member',field('name','Full name','text','','maxlength="120"')+field('email','Email address','email')+select('role','Role',Object.entries(labels))+field('password','Initial password','password','','minlength="12" maxlength="128" autocomplete="new-password"'),d=>api('/users','POST',d),'Create account','Use a unique password of at least 12 characters and share it securely with the staff member.');
  if (name==='deactivate' || name==='activate') return formDialog(name==='deactivate' ? 'Deactivate account':'Reactivate account','',()=>api(`/users/${id}`,'PATCH',{active:name==='activate'}),'Confirm',name==='deactivate' ? 'This staff member will be signed out and will no longer be able to log in.' : 'This staff member will be able to log in again.');
  if (name==='new-patient') return formDialog('Register patient',field('first_name','First name','text','','maxlength="100"')+field('last_name','Last name','text','','maxlength="100"')+field('dob','Date of birth','date','','max="'+hospitalToday()+'"')+select('sex','Sex',[['female','Female'],['male','Male'],['other','Other'],['unknown','Unknown']])+field('phone','Phone (optional)','tel').replace(' required','')+field('emergency_contact','Emergency contact (optional)').replace(' required','')+textArea('address','Address (optional)').replace(' required',''),async d=>{ const result=await api('/patients','POST',d);activePatient=result.id; },'Register patient');
  if (name==='new-appointment' || name==='new-encounter') {
    const clinicians=await api('/clinicians');
    if (!clinicians.length) return toast('An administrator must add a doctor before you can continue.',true);
    const fields=await patientSelector(id)+select('clinician_id','Doctor',clinicians.map(c=>[c.id,c.name]))+(name==='new-appointment' ? field('scheduled_at','Appointment time (EAT)','datetime-local') : field('department','Department','text','Outpatient'))+textArea('reason','Reason for visit');
    formDialog(name==='new-appointment' ? 'Schedule a visit':'Open encounter',fields,async d=>{ if(d.scheduled_at)d.scheduled_at=appointmentToUtc(d.scheduled_at);await api(name==='new-appointment'?'/appointments':'/encounters','POST',d); },name==='new-appointment' ? 'Schedule visit':'Open encounter');wirePatientSearch();return;
  }
  if (name==='arrive' || name==='cancel-appointment') { await api(`/appointments/${id}`,'PATCH',{status:name==='arrive'?'arrived':'cancelled'});toast('Appointment updated');return render(); }
  if (name==='new-note') return formDialog('Add care note',select('kind','Note type',user.role==='nurse' ? [['nursing','Nursing note'],['vitals','Vitals']] : [['clinical','Clinical assessment'],['vitals','Vitals']])+textArea('content','Care note','maxlength="10000"'),d=>api(`/encounters/${id}/notes`,'POST',d),'Save note','Include units for observations and document allergies and medicines in your assessment. Saved notes are append-only; add a new note for corrections.');
  if (name==='new-order') return formDialog('Place department order',select('kind','Department',[['laboratory','Laboratory'],['pharmacy','Pharmacy']])+field('description','Test or medicine','text','','maxlength="500"')+textArea('instructions','Clinical instructions','maxlength="2000"'),d=>api(`/encounters/${id}/orders`,'POST',d),'Place order','For medicines, include strength, dose, route, frequency, and duration. Verify patient identity and allergies before placing an order.');
  if (name==='close-encounter') return formDialog('Close encounter','',()=>api(`/encounters/${id}/close`,'POST',{}),'Close encounter','The clinical note and all departmental orders must be complete. Closing prevents further notes and orders in this encounter.');
  if (name==='review-order') {
    const rows=await api(`/orders?kind=${route}`),o=rows.find(r=>r.id===Number(id));
    const summary=`<div class="full order-summary"><h3>${escape(o.patient)}</h3><p>${escape(o.mrn)} · Born ${date(o.dob)}</p><h3>${escape(o.description)}</h3><p class="preserve">${escape(o.instructions)}</p>${o.result ? `<div class="result"><strong>Department response</strong><p class="preserve">${escape(o.result)}</p></div>` : ''}</div>`;
    if(o.status==='pending' && user.role===route) return formDialog(route==='laboratory'?'Record laboratory result':'Record dispensing',summary+textArea('result',route==='laboratory'?'Result, units, reference range, and comments':'Dispensed quantity and pharmacist notes','maxlength="10000"'),d=>api(`/orders/${id}/complete`,'POST',d),'Complete order','Verify patient identity and the order before completing. The response will be visible to the clinical team.');
    formDialog('Order details',summary,async()=>{},'Done');return;
  }
  if (name==='new-invoice') { formDialog('Create invoice',await patientSelector()+field('description','Charge description')+field('amount','Amount','number','','min="0.01" max="10000000" step="0.01"')+field('currency','Currency code','text',currency,'minlength="3" maxlength="3"'),d=>api('/invoices','POST',{...d,amount_minor:Math.round(Number(d.amount)*100)}),'Create invoice','This billing implementation supports currencies with two decimal places.');wirePatientSearch();return; }
  if (name==='pay') return formDialog('Record payment',field('payment_reference','Receipt or transaction reference','text','','maxlength="200"'),d=>api(`/invoices/${id}/pay`,'POST',d),'Record payment','Only record payment after confirming receipt of the full invoice amount. This does not process a bank or card transaction.');
}
app.addEventListener('click',e=>{const target=e.target.closest('[data-action]');if(target) action(target.dataset.action,target.dataset.id).catch(e=>toast(e.message,true));});
async function boot() {
  try { const result=await api('/me');user=result.user;csrf=result.csrf;return render(); } catch {}
  let setup;
  try { setup=(await api('/setup')).setupRequired; } catch {app.innerHTML=empty('Unable to connect','Start the hospital server and reload this window.');return;}
  app.innerHTML=`<div class="auth-layout"><section class="auth-story"><a class="brand" href="/"><span class="brand-icon">✚</span><span>carepoint<span class="brand-sub">HOSPITAL MANAGEMENT</span></span></a><div><span class="banner-tag">CAREPOINT HOSPITAL</span><h1>Hospital Information<br>Management System</h1><p>Staff access to patient administration, clinical records and departmental services.</p><div class="auth-features"><span>01 <strong>One patient record</strong></span><span>02 <strong>Role-based workspaces</strong></span><span>03 <strong>Connected departments</strong></span></div></div><small>Carepoint · Hospital Information Management System</small></section><section class="auth-main"><form id="auth-form"><span class="eyebrow">${setup?'LET’S GET STARTED':'WELCOME BACK'}</span><h2>${setup?'Set up your hospital':'Sign in to your workspace'}</h2><p class="muted">${setup?'Create the first administrator account on this server.':'Use the individual account provided by your administrator.'}</p>${setup?field('name','Full name'):''}${field('email','Email address','email','','autocomplete="username"')}${field('password','Password','password','',`autocomplete="${setup?'new-password':'current-password'}" ${setup?'minlength="12"':''} maxlength="128"`)}<p class="form-error" role="alert"></p><button class="button" type="submit">${setup?'Create administrator account':'Sign in'} <span>→</span></button><div class="auth-help">${setup?'Choose a unique password of at least 12 characters. You’ll create staff accounts after signing in.':'Access is assigned by your hospital role. Contact your administrator if you need an account.'}</div></form></section></div>`;
  document.querySelector('#auth-form').onsubmit=async e=>{
    e.preventDefault();const btn=e.submitter;btn.disabled=true;
    try {const data=Object.fromEntries(new FormData(e.target));if(setup)await api('/setup','POST',data);const result=await api('/login','POST',data);user=result.user;csrf=result.csrf;route='overview';await render();}
    catch(error){const el=document.querySelector('.form-error');if(el)el.textContent=error.message;}
    finally{btn.disabled=false;}
  };
}
boot();

async function locationHeader() {
  const locations=await api('/locations');
  if(!locations.some(l=>l.id===selectedLocation))selectedLocation=locations[0]?.id;
  return {locations,html:locations.length ? `<div class="panel-toolbar"><label>Working location<select id="location-picker" aria-label="Working location">${locations.map(l=>`<option value="${l.id}" ${l.id===selectedLocation?'selected':''}>${escape(l.code)} - ${escape(l.name)}</option>`).join('')}</select></label><span class="muted">Records stored on this server</span></div>` : ''};
}
async function facilities() {
  const {locations,html}=await locationHeader();
  const status=await api('/node-status');
  let content=heading('ADMINISTRATION','Locations & wards','Configure facilities, staff access, wards and beds.',button('Add location','new-location'));
  content+=`<div class="notice">This server has ${status.queuedChanges} recorded changes. Central synchronisation is not configured. Node: ${escape(status.nodeId)}</div>`;
  if(!locations.length)return content+empty('No locations configured','Add a location to start configuring wards and staff access.');
  const [wards,beds,staff]=await Promise.all([api(`/wards?location_id=${selectedLocation}`),api(`/beds?location_id=${selectedLocation}`),api(`/locations/${selectedLocation}/staff`)]);
  return content+html+`<div class="section-heading"><h2>Wards and beds</h2><div class="row-actions">${button('Add ward','new-ward')}${button('Add bed','new-bed')}</div></div><section class="panel">${beds.length?table(['Ward','Bed','Occupancy'],beds.map(b=>`<tr><td>${escape(b.ward)}</td><td>${escape(b.label)}</td><td>${badge(b.occupied?'occupied':'available')}</td></tr>`)):empty('No beds configured',`${wards.length} wards. Add a ward, then add beds.`)}</section><div class="section-heading"><h2>Assigned staff</h2>${button('Assign staff','assign-staff')}</div><section class="panel">${staff.length?table(['Staff member','Role',''],staff.map(u=>`<tr><td>${escape(u.name)}</td><td>${labels[u.role]}</td><td>${button('Remove access','unassign-staff',u.id,true)}</td></tr>`)):empty('No staff assigned','Assign clinical and receiving-department staff to this location.')}</section>`;
}
async function inpatient() {
  const {locations,html}=await locationHeader();
  let content=heading('INPATIENT SERVICES','Inpatient ward','Admissions, bed allocation, ward transfers and discharge.',locations.length?button('Admit patient','admit-patient'):'');
  if(!locations.length)return content+empty('No assigned locations','Ask an administrator to assign you to a location.');
  const [rows,beds]=await Promise.all([api(`/admissions?location_id=${selectedLocation}`),api(`/beds?location_id=${selectedLocation}`)]);
  return content+html+`<div class="queue-summary"><strong>${beds.filter(b=>b.occupied).length} occupied</strong><span> / ${beds.length} beds | ${beds.filter(b=>!b.occupied).length} available</span></div><section class="panel">${rows.length?table(['Patient','Ward / bed','Admitted','Status','Actions'],rows.map(a=>`<tr><td>${person(a.patient,a.mrn)}</td><td>${escape(a.ward)} / ${escape(a.bed)}</td><td>${date(a.admitted_at)}</td><td>${badge(a.status)}</td><td><div class="row-actions">${button('Record','patient',a.patient_id,true)}${button('History','admission-history',a.id,true)}${a.status==='admitted'?button('Transfer bed','transfer-bed',a.id,true)+(user.role==='doctor'?button('Discharge','discharge-patient',a.id,true):''):''}</div></td></tr>`)):empty('No admissions','Admit a registered patient to an available bed.')}</section>`;
}
async function inpatientAction(name,id) {
  if(name==='new-location'){formDialog('Add location',field('code','Facility code')+field('name','Location name'),d=>api('/locations','POST',d));return true;}
  if(name==='new-ward'){formDialog('Add ward',field('name','Ward name'),d=>api('/wards','POST',{...d,location_id:selectedLocation}));return true;}
  if(name==='new-bed'){
    const wards=await api(`/wards?location_id=${selectedLocation}`);
    if(!wards.length){toast('Add a ward first.',true);return true;}
    formDialog('Add bed',select('ward_id','Ward',wards.map(w=>[w.id,w.name]))+field('label','Bed label'),d=>api('/beds','POST',d));return true;
  }
  if(name==='assign-staff'){
    const staff=await api('/users');formDialog('Assign staff to location',select('user_id','Staff member',staff.filter(u=>u.active).map(u=>[u.id,`${u.name} (${labels[u.role]})`])),d=>api(`/locations/${selectedLocation}/staff`,'POST',{...d,assigned:true}));return true;
  }
  if(name==='unassign-staff'){formDialog('Remove location access','',()=>api(`/locations/${selectedLocation}/staff`,'POST',{user_id:id,assigned:false}),'Remove access','This removes access to inpatient records at this location.');return true;}
  if(name==='admit-patient'||name==='transfer-bed'){
    const beds=(await api(`/beds?location_id=${selectedLocation}`)).filter(b=>!b.occupied);
    if(!beds.length){toast('No available beds at this location.',true);return true;}
    const bedField=select('bed_id','Bed',beds.map(b=>[b.id,`${b.ward} / ${b.label}`]));
    if(name==='transfer-bed'){formDialog('Transfer to another bed',bedField+textArea('note','Transfer reason'),d=>api(`/admissions/${id}/transfer`,'POST',d));return true;}
    const doctors=await api('/clinicians');
    formDialog('Admit patient',await patientSelector()+select('clinician_id','Admitting doctor',doctors.map(d=>[d.id,d.name]))+bedField+textArea('reason','Reason for admission'),d=>api('/admissions','POST',d),'Admit patient','The admitting doctor must be assigned to this location. An inpatient clinical encounter will be opened.');wirePatientSearch();return true;
  }
  if(name==='discharge-patient'){formDialog('Discharge patient',textArea('note','Discharge summary'),d=>api(`/admissions/${id}/discharge`,'POST',d),'Discharge','Document the outcome, medicines, follow-up and instructions. Pending orders must be complete. Discharge closes the encounter and releases the bed.');return true;}
  if(name==='admission-history'){
    const rows=await api(`/admissions/${id}/events`);formDialog('Admission history',`<div class="full">${rows.map(e=>`<article class="note"><strong>${escape(e.action)} | ${escape(e.ward)} / ${escape(e.bed)}</strong><small>${escape(e.author)} | ${date(e.created_at)}</small><p class="preserve">${escape(e.note)}</p></article>`).join('')}</div>`,async()=>{},'Close');return true;
  }
  return false;
}
