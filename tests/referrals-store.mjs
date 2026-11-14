// Synthetic workflow tests. These verify local demo behaviour, not healthcare delivery.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=await fs.readFile(new URL('../referral-store.js',import.meta.url),'utf8');
let checks=0;
const count=(fn)=>{fn();checks++;};
const throws=(fn,pattern)=>count(()=>assert.throws(fn,pattern));
const copy=value=>JSON.parse(JSON.stringify(value));

function setup(shared=new Map(),initial='2026-11-14T12:00:00Z'){
 let instant=Date.parse(initial),id=0,failRead=false,failWrite=false;
 const events=new Map();
 class ClockDate extends Date{
  constructor(...args){if(args.length)super(...args);else super(instant);}
  static now(){return instant;}
 }
 const storage={
  getItem(key){if(failRead)throw new Error('read denied');return shared.get(key)??null;},
  setItem(key,value){if(failWrite)throw new Error('quota');shared.set(key,value);},
  removeItem(key){if(failWrite)throw new Error('write denied');shared.delete(key);}
 };
 const window={addEventListener(name,fn){events.set(name,fn);}};
 const context=vm.createContext({window,localStorage:storage,Date:ClockDate,Intl,crypto:{randomUUID:()=>`test-id-${++id}`},Set,JSON,console});
 vm.runInContext(source,context);
 return {api:window.CandexReferralStore,shared,setDate:v=>{instant=Date.parse(v);},setReadFail:v=>{failRead=v;},setWriteFail:v=>{failWrite=v;},dispatch:event=>events.get('storage')?.(event)};
}

const care={role:'care',approved:true};
const patient={role:'patient'};
const draft=(revision='one')=>({patient:'CX-1042 · Aino Lehtinen',type:'Lung',findings:`Synthetic reviewed findings ${revision}`,plan:'Discuss the research example at follow-up.'});
const t=setup();
const s=t.api;
count(()=>assert.equal(s.get().reports.length,0));
throws(()=>s.bookAppointment('2026-11-16T09:00','Video consultation',patient),/clinician must release/);
throws(()=>s.releaseReport(draft(),{role:'patient',approved:true}),/appropriate/);
throws(()=>s.releaseReport(draft(),{role:'care',approved:false}),/approval box/);
throws(()=>s.releaseReport({...draft(),patient:'CX-1043'},care),/belongs to CX-1042/);
throws(()=>s.releaseReport({...draft(),patient:'CX-10420'},care),/belongs to CX-1042/);
throws(()=>s.releaseReport({...draft(),findings:''},care),/Complete/);
throws(()=>s.releaseReport({...draft(),findings:'x'.repeat(6001)},care),/length limit/);
const first=s.releaseReport(draft(),care);
count(()=>assert.equal(first.version,1));
count(()=>assert.equal(s.get().currentReport.id,first.id));
count(()=>assert.equal(s.get().currentReport.approvedBy,'Dr. Emilia Koski'));
first.findings='mutated caller copy';
count(()=>assert.equal(s.get().currentReport.findings,draft().findings));
throws(()=>s.releaseReport(draft(),care),/already been released/);

const slots=s.offeredSlots();
count(()=>assert.equal(slots.length,15));
const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Helsinki',weekday:'short',hour:'2-digit',hourCycle:'h23'});
for(const slot of slots){
 count(()=>assert(Date.parse(slot.startsAt)>Date.parse('2026-11-14T12:00:00Z')));
 count(()=>assert(!/Sat|Sun/.test(fmt.format(new Date(slot.startsAt)))));
 count(()=>assert(['09','11','14'].includes(fmt.formatToParts(new Date(slot.startsAt)).find(p=>p.type==='hour').value)));
}
count(()=>assert.equal(slots[0].startsAt,'2026-11-16T07:00:00.000Z'));
const spring=s.offeredSlots(new Date('2026-03-27T12:00:00Z'));
count(()=>assert.equal(spring[0].startsAt,'2026-03-30T06:00:00.000Z'));
const autumn=s.offeredSlots(new Date('2026-10-23T12:00:00Z'));
count(()=>assert.equal(autumn[0].startsAt,'2026-10-26T07:00:00.000Z'));
throws(()=>s.bookAppointment(slots[0].id,'Video consultation',{role:'care'}),/appropriate/);
throws(()=>s.bookAppointment(slots[0].id,'Unsupported method',patient),/supported consultation/);
throws(()=>s.bookAppointment('2000-01-01T09:00','Video consultation',patient),/no longer offered/);
const booked=s.bookAppointment(slots[0].id,'Video consultation',patient);
count(()=>assert.equal(s.get().activeAppointment.id,booked.id));
count(()=>assert.equal(booked.reportVersion,1));
throws(()=>s.bookAppointment(slots[1].id,'Phone consultation',patient),/already have/);
throws(()=>s.recordReferral({outcome:'issued',destination:'Research specialist',reason:'Synthetic'},care),/Complete.*follow-up/);
throws(()=>s.completeFollowUp({role:'patient',confirm:true}),/appropriate/);
throws(()=>s.completeFollowUp({role:'care',confirm:false}),/Confirm/);

// A revised report preserves an existing booking and supersedes stale decisions.
const second=s.releaseReport(draft('two'),care);
count(()=>assert.equal(s.get().activeAppointment.id,booked.id));
count(()=>assert.equal(s.get().activeAppointment.reportId,booked.reportId));
count(()=>assert.equal(s.get().currentReport.version,2));
count(()=>assert.equal(s.get().reports[0].findings,draft().findings));
const follow=s.completeFollowUp({role:'care',confirm:true});
count(()=>assert.equal(follow.reportId,second.id));
count(()=>assert.equal(follow.simulated,true));
count(()=>assert.equal(s.get().activeAppointment,null));
count(()=>assert.equal(s.get().appointments[0].status,'completed'));
throws(()=>s.bookAppointment(slots[1].id,'Phone consultation',patient),/already recorded/);
throws(()=>s.completeFollowUp({role:'care',confirm:true}),/appointment is needed|already/);
throws(()=>s.recordReferral({outcome:'issued',destination:'Specialist',reason:'Synthetic'},{role:'patient'}),/appropriate/);
throws(()=>s.recordReferral({outcome:'issued',destination:'',reason:'Synthetic'},care),/receiving service/);
throws(()=>s.recordReferral({outcome:'not-needed',reason:''},care),/reason/);
throws(()=>s.recordReferral({outcome:'made-up',reason:'Synthetic'},care),/Choose/);
const pending=s.recordReferral({outcome:'pending',reason:'Awaiting fictional specialist discussion.'},care);
count(()=>assert.equal(s.get().currentDecision.id,pending.id));
const issued=s.recordReferral({outcome:'issued',destination:'Demo respiratory service',reason:'Research example requiring specialist discussion.'},care);
count(()=>assert.equal(s.get().currentDecision.outcome,'issued'));
count(()=>assert.equal(s.get().currentDecision.destination,'Demo respiratory service'));
count(()=>assert.equal(s.get().currentDecision.followUpId,follow.id));
count(()=>assert.equal(s.get().decisions.length,2));
const snapshot=s.get();snapshot.currentDecision.reason='caller corruption';
count(()=>assert.notEqual(s.get().currentDecision.reason,'caller corruption'));
const third=s.releaseReport(draft('three'),care);
count(()=>assert.equal(s.get().currentDecision,null));
count(()=>assert.equal(s.get().currentFollowUp,null));
count(()=>assert.equal(s.get().decisions.at(-1).id,issued.id));
throws(()=>s.recordReferral({outcome:'issued',destination:'Specialist',reason:'Stale followup'},care),/Complete.*follow-up/);
s.bookAppointment(slots[1].id,'Phone consultation',patient);
s.completeFollowUp({role:'care',confirm:true});
s.recordReferral({outcome:'not-needed',reason:'Clinician recorded that a further referral is unnecessary in this fictional scenario.'},care);
count(()=>assert.equal(s.get().currentDecision.outcome,'not-needed'));
count(()=>assert.equal(s.get().currentDecision.reportId,third.id));

// Persistence and cross-tab notification are explicit, not backend delivery.
const tab=setup(t.shared);
count(()=>assert.equal(tab.api.get().currentReport.version,3));
let notified=0;
const unsubscribe=tab.api.subscribe(()=>notified++);
tab.dispatch({key:'unrelated'});count(()=>assert.equal(notified,0));
tab.dispatch({key:s.key});count(()=>assert.equal(notified,1));
tab.dispatch({key:null});count(()=>assert.equal(notified,2));
unsubscribe();tab.dispatch({key:s.key});count(()=>assert.equal(notified,2));

// Storage failure cannot falsely publish a report or emit a success update.
const before=t.shared.get(s.key);let sameTabNotices=0;
const stop=s.subscribe(()=>sameTabNotices++);
t.setWriteFail(true);
throws(()=>s.releaseReport(draft('unsaved'),care),/could not be saved/);
count(()=>assert.equal(t.shared.get(s.key),before));
count(()=>assert.equal(sameTabNotices,0));
throws(()=>s.reset(),/could not clear/);
t.setWriteFail(false);stop();
t.setReadFail(true);throws(()=>s.get(),/storage is unavailable/);t.setReadFail(false);

const invalid=setup();
invalid.shared.set(invalid.api.key,'not json');throws(()=>invalid.api.get(),/could not be read/);
invalid.api.reset();count(()=>assert.equal(invalid.api.get().reports.length,0));
invalid.shared.set(invalid.api.key,JSON.stringify({schema:999}));throws(()=>invalid.api.get(),/unsupported format/);
const raw=JSON.parse(before);raw.followUps[0].reportId='missing-report';
invalid.shared.set(invalid.api.key,JSON.stringify(raw));throws(()=>invalid.api.get(),/follow-up history is invalid/);
const raw2=JSON.parse(before);raw2.decisions[0].followUpId='missing-followup';
invalid.shared.set(invalid.api.key,JSON.stringify(raw2));throws(()=>invalid.api.get(),/referral decision is invalid/);
const raw3=JSON.parse(before);raw3.reports[0].version=5;
invalid.shared.set(invalid.api.key,JSON.stringify(raw3));throws(()=>invalid.api.get(),/report history is invalid/);
invalid.shared.set(invalid.api.key,'x'.repeat(650001));throws(()=>invalid.api.get(),/too large/);
s.reset();count(()=>assert.equal(s.get().reports.length,0));count(()=>assert.equal(s.get().currentDecision,null));
console.log(`PASS: ${checks} referral-store assertions (approval, roles, versioning, Helsinki slots/DST, booking, follow-up, decisions, persistence and failure handling).`);
