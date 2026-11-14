// Synthetic, browser-local workflow only. Role arguments are workflow guards,
// not authentication; a production service needs server-side identity/access.
(()=>{
 'use strict';
 const KEY='candex-referrals-v1';
 const PATIENT={id:'CX-1042',name:'Aino Lehtinen'};
 const METHODS=['Video consultation','Phone consultation','In-person consultation'];
 const listeners=new Set();
 const clone=value=>JSON.parse(JSON.stringify(value));
 const blank=()=>({schema:1,patientId:PATIENT.id,reports:[],appointments:[],followUps:[],decisions:[],events:[]});
 const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{4,100}$/.test(value);
 const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
 const str=(value,max)=>typeof value==='string'&&value.length<=max;
 function validate(state){
  if(!state||state.schema!==1||state.patientId!==PATIENT.id)throw new Error('The saved demo journey has an unsupported format. Reset the demo to continue.');
  for(const key of ['reports','appointments','followUps','decisions','events'])if(!Array.isArray(state[key])||state[key].length>200)throw new Error('The saved demo journey is invalid. Reset the demo to continue.');
  const ids=new Set();
  for(const report of state.reports){
   if(!validId(report.id)||ids.has(report.id)||report.patientId!==PATIENT.id||report.version!==ids.size+1||!str(report.type,100)||!str(report.findings,6000)||!report.findings.trim()||!str(report.plan,6000)||!report.plan.trim()||!validDate(report.approvedAt)||report.approvedBy!=='Dr. Emilia Koski')throw new Error('The saved report history is invalid. Reset the demo to continue.');
   ids.add(report.id);
  }
  const appointmentIds=new Set();
  for(const a of state.appointments){
   if(!validId(a.id)||appointmentIds.has(a.id)||!ids.has(a.reportId)||!validDate(a.startsAt)||!validDate(a.bookedAt)||!METHODS.includes(a.method)||!['booked','completed'].includes(a.status)||!str(a.slotId,50))throw new Error('The saved appointment history is invalid. Reset the demo to continue.');
   appointmentIds.add(a.id);
  }
  const followupIds=new Set();
  for(const f of state.followUps){
   if(!validId(f.id)||followupIds.has(f.id)||!ids.has(f.reportId)||!appointmentIds.has(f.appointmentId)||!validDate(f.completedAt)||f.simulated!==true||f.actor!=='Dr. Emilia Koski')throw new Error('The saved follow-up history is invalid. Reset the demo to continue.');
   followupIds.add(f.id);
  }
  for(const d of state.decisions){
   const f=state.followUps.find(x=>x.id===d.followUpId);
   if(!validId(d.id)||!f||f.reportId!==d.reportId||!['issued','pending','not-needed'].includes(d.outcome)||!str(d.destination,200)||!str(d.reason,3000)||!d.reason.trim()||(d.outcome==='issued'&&!d.destination.trim())||!validDate(d.recordedAt)||d.actor!=='Dr. Emilia Koski')throw new Error('The saved referral decision is invalid. Reset the demo to continue.');
  }
  for(const e of state.events)if(!validId(e.id)||!validDate(e.at)||!str(e.title,200)||!str(e.actor,100))throw new Error('The saved activity history is invalid. Reset the demo to continue.');
  return state;
 }
 function read(){
  let raw;
  try{raw=localStorage.getItem(KEY);}catch{throw new Error('Browser storage is unavailable. Allow local storage to use this demo; nothing has been sent.');}
  if(!raw)return blank();
  if(raw.length>650000)throw new Error('The saved demo is too large. Reset it to continue.');
  try{return validate(JSON.parse(raw));}catch(error){throw new Error(error.message?.startsWith('The saved')?error.message:'The saved demo could not be read. Reset it to continue.');}
 }
 function notify(){for(const listener of listeners){try{listener();}catch{}}}
 function save(state){
  validate(state);const raw=JSON.stringify(state);
  if(raw.length>650000)throw new Error('The demo history is full. Export any needed example reports and reset the demo.');
  try{localStorage.setItem(KEY,raw);}catch{throw new Error('The demo could not be saved in this browser. Nothing was released or booked. Check storage permissions and try again.');}
  notify();return clone(state);
 }
 const uid=()=>globalThis.crypto?.randomUUID?.()||'demo_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
 const now=()=>new Date().toISOString();
 const needRole=(actual,expected)=>{if(actual!==expected)throw new Error('Use the appropriate patient or doctor interface for this action.');};
 function addEvent(state,title,actor){state.events.push({id:uid(),at:now(),title,actor});}
 function snapshot(state=read()){
  const report=state.reports.at(-1)||null;
  const appointment=[...state.appointments].reverse().find(a=>a.status==='booked')||null;
  const followUp=report?[...state.followUps].reverse().find(f=>f.reportId===report.id)||null:null;
  const decision=followUp?[...state.decisions].reverse().find(d=>d.reportId===report.id&&d.followUpId===followUp.id)||null:null;
  return clone({...state,currentReport:report,activeAppointment:appointment,currentFollowUp:followUp,currentDecision:decision});
 }
 function releaseReport(draft,options={}){
  needRole(options.role,'care');
  if(options.approved!==true)throw new Error('Review the complete report and tick the clinician approval box before releasing it.');
  if(!draft||!/^CX-1042(?:\s|·|$)/.test(String(draft.patient||'').trim()))throw new Error('This demo portal belongs to CX-1042 (Aino Lehtinen). Set that patient reference before releasing the report.');
  const findings=String(draft.findings||'').trim(),plan=String(draft.plan||'').trim(),type=String(draft.type||'').trim();
  if(!findings||!plan||!type)throw new Error('Complete the care pathway, findings and proposed next step before review.');
  if(findings.length>6000||plan.length>6000||type.length>100)throw new Error('The report text exceeds the demo length limit.');
  const state=read();
  if(state.reports.length>=50)throw new Error('The demo report history is full. Reset the demo to start a new journey.');
  const previous=state.reports.at(-1);
  if(previous&&previous.findings===findings&&previous.plan===plan&&previous.type===type)throw new Error('This reviewed report has already been released. Open the referrals page to see its progress.');
  const report={id:uid(),version:state.reports.length+1,patientId:PATIENT.id,type,findings,plan,approvedAt:now(),approvedBy:'Dr. Emilia Koski'};
  state.reports.push(report);
  addEvent(state,`Reviewed report v${report.version} released to the demo patient portal`,'Dr. Emilia Koski');
  save(state);return clone(report);
 }
 function helsinkiParts(date){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Helsinki',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
 function zonedStart(day,hour){
  const [y,m,d]=day.split('-').map(Number);const desired=Date.UTC(y,m-1,d,hour);let candidate=desired;
  for(let i=0;i<3;i++){const p=helsinkiParts(new Date(candidate));const actual=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);candidate+=desired-actual;}
  return new Date(candidate).toISOString();
 }
 function offeredSlots(reference=new Date()){
  const p=helsinkiParts(reference);const first=Date.UTC(+p.year,+p.month-1,+p.day);
  const slots=[];let days=0;
  for(let i=1;days<5&&i<15;i++){
   const date=new Date(first+i*86400000);if([0,6].includes(date.getUTCDay()))continue;
   const day=date.toISOString().slice(0,10);days++;
   for(const hour of [9,11,14]){const startsAt=zonedStart(day,hour);if(Date.parse(startsAt)>reference.getTime())slots.push({id:`${day}T${String(hour).padStart(2,'0')}:00`,startsAt,durationMinutes:30});}
  }
  return slots;
 }
 function bookAppointment(slotId,method,options={}){
  needRole(options.role,'patient');const state=read(),current=snapshot(state);
  if(!current.currentReport)throw new Error('A clinician must release a reviewed report before you can choose a follow-up.');
  if(current.activeAppointment)throw new Error('You already have a booked demo appointment. Your care team can review it with you.');
  if(current.currentFollowUp)throw new Error('This report’s follow-up is already recorded. Check the referral decision below.');
  if(!METHODS.includes(method))throw new Error('Choose a supported consultation method.');
  const slot=offeredSlots().find(s=>s.id===slotId);
  if(!slot||Date.parse(slot.startsAt)<=Date.now())throw new Error('That slot is no longer offered. Refresh the available dates and choose a future appointment.');
  const appointment={id:uid(),reportId:current.currentReport.id,reportVersion:current.currentReport.version,slotId:slot.id,startsAt:slot.startsAt,durationMinutes:slot.durationMinutes,method,status:'booked',bookedAt:now()};
  state.appointments.push(appointment);addEvent(state,'Patient selected a demo follow-up appointment','Aino Lehtinen');save(state);return clone(appointment);
 }
 function completeFollowUp(options={}){
  needRole(options.role,'care');
  if(options.confirm!==true)throw new Error('Confirm that you are simulating the follow-up taking place in this demo.');
  const state=read(),current=snapshot(state);
  if(!current.currentReport||!current.activeAppointment)throw new Error('A patient-selected appointment is needed before the follow-up can be recorded.');
  if(current.currentFollowUp)throw new Error('This report’s follow-up has already been recorded.');
  const appt=state.appointments.find(a=>a.id===current.activeAppointment.id);appt.status='completed';
  const followUp={id:uid(),reportId:current.currentReport.id,appointmentId:appt.id,completedAt:now(),actor:'Dr. Emilia Koski',simulated:true};
  state.followUps.push(followUp);addEvent(state,'Demo follow-up simulated as completed','Dr. Emilia Koski');save(state);return clone(followUp);
 }
 function recordReferral(input,options={}){
  needRole(options.role,'care');const state=read(),current=snapshot(state);
  if(!current.currentReport||!current.currentFollowUp)throw new Error('Complete the current report’s demo follow-up before recording a referral decision.');
  const outcome=String(input?.outcome||''),destination=String(input?.destination||'').trim(),reason=String(input?.reason||'').trim();
  if(!['issued','pending','not-needed'].includes(outcome))throw new Error('Choose a referral outcome.');
  if(!reason||reason.length>3000||destination.length>200||(outcome==='issued'&&!destination))throw new Error('Add a reason for the decision, and a receiving service when issuing a referral.');
  const decision={id:uid(),reportId:current.currentReport.id,followUpId:current.currentFollowUp.id,outcome,destination:outcome==='issued'?destination:'',reason,recordedAt:now(),actor:'Dr. Emilia Koski'};
  state.decisions.push(decision);addEvent(state,`Referral decision: ${outcome==='issued'?'issued to demo portal':outcome==='pending'?'pending':'not required'}`,'Dr. Emilia Koski');save(state);return clone(decision);
 }
 function reset(){try{localStorage.removeItem(KEY);}catch{throw new Error('This browser could not clear the saved demo.');}notify();}
 window.addEventListener('storage',e=>{if(e.key===KEY||e.key===null)notify();});
 window.CandexReferralStore={key:KEY,patient:clone(PATIENT),methods:[...METHODS],get:()=>snapshot(),releaseReport,offeredSlots,bookAppointment,completeFollowUp,recordReferral,reset,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},validate:state=>clone(validate(clone(state)))};
})();
