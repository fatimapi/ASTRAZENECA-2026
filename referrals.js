// In-app demonstration only: no email, hospital referral or real appointment is sent.
(()=>{
 'use strict';
 const S=()=>window.CandexReferralStore;
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
 const button=(text,primary=false)=>{const n=node('button',primary?'button':'button secondary',text);n.type='button';return n;};
 const field=(label,control,hint)=>{const n=node('div','field');const l=node('label','',label);l.htmlFor=control.id;n.append(l,control);if(hint){const h=node('small','',hint);h.id=control.id+'-help';control.setAttribute('aria-describedby',h.id);n.append(h);}return n;};
 const locale=()=>window.candexI18n?.lang==='fi'?'fi-FI':'en-GB';
 const date=(value,withTime=true)=>new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Helsinki',weekday:'short',day:'numeric',month:'short',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(value));
 const card=title=>{const n=node('section','card');n.append(node('h2','referrals-card-title',title));return n;};
 const note=text=>node('p','referrals-note',text);
 const status=(text,kind='')=>node('span','referrals-status'+(kind?' is-'+kind:''),text);
 // The reviewed report as a PDF in the Candex document style (referral-report.js makeKit: wordmark, header,
 // footer, page numbers). Falls back to a text file if the PDF library cannot load (e.g. offline).
 function downloadText(report){
  const text=`CANDEX — REVIEWED DEMO REPORT\nNot a signed clinical document or real referral.\n\nPatient: ${S().patient.name} / ${report.patientId}\nVersion: ${report.version}\nReviewed by: ${report.approvedBy}\nReleased: ${date(report.approvedAt)} (Finland time)\nCare pathway: ${report.type}\n\nFINDINGS\n${report.findings}\n\nNEXT STEP\n${report.plan}\n`;
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=node('a');a.href=url;a.download=`candex-reviewed-demo-report-v${report.version}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function reportPdf(jsPDF,report){
  const R=window.candexReport,fi=window.candexI18n?.lang==='fi',t=(en,f)=>fi?f:en;
  const k=R.makeKit(jsPDF,{base:11}),doc=k.doc,name=S().patient.name;
  doc.setLanguage?.(fi?'fi':'en-GB');
  doc.setProperties({title:`${t('Your reviewed report','Tarkastettu raporttisi')} · ${report.patientId}`,subject:t('Reviewed demo report','Tarkastettu demoraportti'),author:'Candex (demonstration)',creator:'Candex'});
  k.title(t('Your reviewed report','Tarkastettu raporttisi'),`${name} · ${report.patientId} · ${t('Version','Versio')} ${report.version}`,t('Demonstration: fictional patient. Not a signed clinical document or a real referral.','Demo: kuvitteellinen potilas. Ei allekirjoitettu potilasasiakirja eikä oikea lähete.'));
  k.callout(t('Reviewed by your care team','Hoitotiimisi tarkastama'),`${report.approvedBy} · ${date(report.approvedAt)} (${t('Finland time','Suomen aikaa')})`);
  let n=1;
  k.section(n++,t('About this report','Tietoa raportista'));
  k.kv([[t('Patient','Potilas'),name],[t('Patient ID','Potilastunnus'),report.patientId],[t('Care pathway','Hoitopolku'),report.type],[t('Version','Versio'),String(report.version)],[t('Reviewed by','Tarkastaja'),report.approvedBy],[t('Released','Julkaistu'),`${date(report.approvedAt)} (${t('Finland time','Suomen aikaa')})`]],52);
  k.section(n++,t('Findings','Löydökset'));
  for(const part of String(report.findings||'').split(/\n\s*\n|\n/).map(x=>x.trim()).filter(Boolean))k.para(part);
  k.section(n++,t('Proposed next step','Ehdotettu seuraava vaihe'));
  for(const part of String(report.plan||'').split(/\n\s*\n|\n/).map(x=>x.trim()).filter(Boolean))k.para(part);
  k.section(n++,t('Please note','Huomioitavaa'));
  k.list([t('This report was reviewed by a clinician in the Candex demonstration. It uses fictional information.','Raportin on tarkastanut lääkäri Candex-demossa. Se sisältää kuvitteellisia tietoja.'),
   t('Choose a follow-up time on the Reports & appointments page. No real appointment or referral is made.','Valitse seuranta-aika Raportit ja ajanvaraus -sivulla. Oikeaa aikaa tai lähetettä ei tehdä.'),
   t('If your symptoms get worse, contact your health centre or call 116 117.','Jos oireesi pahenevat, ota yhteyttä terveysasemaasi tai soita 116 117.')]);
  k.frame(`Candex · ${t('Reviewed report','Tarkastettu raportti')} · ${report.patientId}`,t('Demonstration only. Fictional patient. Not a signed clinical document.','Vain demo. Kuvitteellinen potilas. Ei allekirjoitettu potilasasiakirja.'),t('Page','Sivu'),t('of','/'));
  return doc;
 }
 async function download(report){
  const R=window.candexReport;
  try{
   if(!R?.makeKit||!R?.loadJsPDF)throw new Error('PDF tools not loaded');
   const lib=await R.loadJsPDF();
   reportPdf(lib.jsPDF,report).save(`candex-reviewed-report-v${report.version}.pdf`);
  }catch{
   (typeof toast==='function'?toast:()=>{})(window.candexI18n?.lang==='fi'?'PDF-kirjasto ei latautunut; ladataan tekstitiedostona.':'The PDF library could not load; downloading a text file instead.');
   downloadText(report);
  }
 }
 function reportBody(report){const pre=node('pre','referrals-report',`FINDINGS\n${report.findings}\n\nPROPOSED NEXT STEP\n${report.plan}`);return pre;}
 function demoBanner(){const n=node('div','referrals-demo');n.append(status('Browser-local demonstration'),node('p','','Reviewed reports, appointment selections and referral decisions are shared between the demo roles on this browser only. No patient message, health-service booking or hospital referral is sent. Use fictional information.'));return n;}
 function resetControls(on,onReset){
  const detail=node('details','referrals-reset');detail.append(node('summary','','Demo data controls'),note('This journey persists in this browser. Resetting removes its report, booking and referral history from this device.'));
  const label=node('label','check-row'),check=node('input');check.type='checkbox';label.append(check,node('span','','I want to reset this synthetic patient journey.'));const reset=button('Reset demo journey');reset.disabled=true;on(check,'change',()=>{reset.disabled=!check.checked;});on(reset,'click',()=>{if(check.checked)onReset();});detail.append(label,reset);return detail;
 }
 function render(){return '<div class="referrals-loading" role="status">Loading the shared demo care journey…</div>';}
 function mount(container,options={}){
  const role=options.role||'patient';let alive=true,disposers=[],message='',messageKind='';
  const on=(target,name,fn)=>{target.addEventListener(name,fn);disposers.push(()=>target.removeEventListener(name,fn));};
  function perform(fn,success){try{fn();message=success;messageKind='success';draw();options.onChange?.();}catch(error){message=error.message||'The demo could not save that action.';messageKind='error';draw();}}
  function draw(){
   if(!alive)return;for(const d of disposers)d();disposers=[];
   const root=node('div','referrals-workspace');root.append(demoBanner());
   if(message){const m=node('div','referrals-feedback is-'+messageKind,message);m.setAttribute('role',messageKind==='error'?'alert':'status');root.append(m);}
   let saved;try{saved=S().get();}catch(error){root.append(node('div','referrals-feedback is-error',error.message),resetControls(on,()=>perform(()=>S().reset(),'The local demo journey has been reset.')));container.replaceChildren(root);return;}
   if(role==='quality'){const c=card('Shared journey status');c.append(note('One synthetic journey. This role shows workflow status rather than clinical report content.'));for(const [title,value] of [['Reviewed reports',saved.reports.length],['Booked follow-ups',saved.appointments.filter(a=>a.status==='booked').length],['Demo follow-ups completed',saved.followUps.length],['Current referral outcome',saved.currentDecision?.outcome||'Not recorded']]){const row=node('div','data-line');row.append(node('span','',title),node('strong','',value));c.append(row);}root.append(c);container.replaceChildren(root);return;}
   const report=saved.currentReport,appt=saved.activeAppointment,followUp=saved.currentFollowUp,decision=saved.currentDecision;
   const steps=node('ol','referrals-steps');for(const [label,complete,current] of [['Report reviewed',!!report,!report],['Follow-up booked',!!appt||!!followUp,!!report&&!appt&&!followUp],['Follow-up completed',!!followUp,!!appt&&!followUp],['Referral decision',!!decision&&decision.outcome!=='pending',!!followUp&&(!decision||decision.outcome==='pending')]]){const li=node('li',(complete?'is-complete':current?'is-current':''));li.append(node('span','referrals-step-mark',complete?'✓':String(steps.children.length+1)),node('span','',label));steps.append(li);}root.append(steps);
   const layout=node('div','referrals-layout');const main=node('div','referrals-column'),aside=node('div','referrals-column');
   const reportCard=card(role==='care'?'Reviewed report in the patient portal':'Your reviewed report');
   if(!report){reportCard.append(note(role==='care'?'Review a report draft, then release its approved version to the demo patient portal.':'Your care team has not released a reviewed report yet. Appointment selection will appear here after release.'));const go=button(role==='care'?'Review a report draft':'Explore the doctor demonstration');go.dataset.go='care/reports';reportCard.append(go);}
   else{
    reportCard.append(status(`Reviewed · Version ${report.version}`),node('p','referrals-meta',`${report.approvedBy} · ${date(report.approvedAt)} · Finland time`));const identity=node('p','referrals-meta',`${S().patient.name} · ${report.patientId} · ${report.type}`);reportCard.append(identity,reportBody(report));const dl=button('Download reviewed demo report');on(dl,'click',()=>download(report));reportCard.append(dl);
    if(report.version>1)reportCard.append(note('This is the latest reviewed version. Any booked appointment is preserved. A previous report’s follow-up or referral outcome does not automatically apply to this version.'));
   }main.append(reportCard);
   const booking=card(role==='care'?'Patient-selected follow-up':'Choose a suitable follow-up');
   if(appt){booking.append(status('Booked in the demo'),node('h3','referrals-appointment-date',date(appt.startsAt)),node('p','',`${appt.method} · ${appt.durationMinutes} minutes · Finland time`),note(`Selected by the patient for report v${appt.reportVersion}. This is a browser-local booking example, not an appointment with a health service.`));}
   else if(followUp){booking.append(status('Demo follow-up completed'),node('p','',`Recorded by ${followUp.actor} · ${date(followUp.completedAt)}`),note('The consultation was explicitly simulated for this prototype. No real clinical attendance is being asserted.'));}
   else if(!report)booking.append(note('A reviewed report must be released before appointment selection is enabled.'));
   else if(role==='care')booking.append(note('The patient can choose an offered date, time and contact method in their Referrals & follow-up view.'));
   else{
    const form=node('form','referrals-booking-form');const slots=S().offeredSlots();const days=[...new Set(slots.map(s=>s.id.slice(0,10)))];
    const day=node('select');day.id='referral-appointment-day';day.name='day';day.required=true;
    for(const d of days){const option=node('option','',date(slots.find(s=>s.id.startsWith(d)).startsAt,false));option.value=d;day.append(option);}
    const time=node('select');time.id='referral-appointment-time';time.name='slot';time.required=true;
    function fillTimes(){time.replaceChildren();for(const s of slots.filter(s=>s.id.startsWith(day.value))){const option=node('option','',new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Helsinki',hour:'2-digit',minute:'2-digit'}).format(new Date(s.startsAt)));option.value=s.id;time.append(option);}}
    fillTimes();on(day,'change',fillTimes);const method=node('select');method.id='referral-appointment-method';method.name='method';for(const name of S().methods){const option=node('option','',name);option.value=name;method.append(option);}
    const confirmLabel=node('label','check-row'),confirm=node('input');confirm.type='checkbox';confirm.required=true;confirmLabel.append(confirm,node('span','','I understand this selects an appointment in the demonstration only.'));
    const book=button('Confirm demo appointment',true);book.type='submit';form.append(field('Date',day),field('Time',time,'All appointment times use Europe/Helsinki.'),field('Preferred consultation',method),confirmLabel,book);on(form,'submit',e=>{e.preventDefault();e.stopPropagation();if(!confirm.checked){message='Confirm the demo appointment statement before continuing.';messageKind='error';draw();return;}perform(()=>S().bookAppointment(time.value,method.value,{role:'patient'}),'Your appointment selection is saved in this browser. Your demo care team can now see it.');});booking.append(form);
   }main.append(booking);
   if(role==='care'&&report&&appt&&!followUp){const complete=card('Record the follow-up');complete.append(note('Use this explicit simulation to demonstrate what happens after the patient’s future appointment. It does not record real clinical attendance.'));const label=node('label','check-row'),confirm=node('input');confirm.type='checkbox';label.append(confirm,node('span','','Simulate this patient’s follow-up as having taken place.'));const done=button('Simulate demo follow-up completion',true);done.disabled=true;on(confirm,'change',()=>{done.disabled=!confirm.checked;});on(done,'click',()=>perform(()=>S().completeFollowUp({role:'care',confirm:confirm.checked}),'Demo follow-up completed. A referral decision can now be recorded.'));complete.append(label,done);main.append(complete);}
   const referral=card(role==='care'?'Record the referral outcome':'Have I received a referral?');
   if(!followUp)referral.append(status('Awaiting follow-up','neutral'),note('A referral outcome is recorded after the current report’s follow-up. No referral has been issued for this report in the demo.'));
   else{
    if(decision){const titles={issued:'Referral received in your demo portal',pending:'Referral decision pending','not-needed':'No new referral recorded as needed'};referral.append(status(titles[decision.outcome],decision.outcome==='issued'?'success':decision.outcome==='pending'?'review':'neutral'));
     if(decision.destination){const dest=node('p','referrals-destination',decision.destination);dest.setAttribute('translate','no');referral.append(dest);}const reason=node('p','referrals-clinical-copy',decision.reason);reason.setAttribute('translate','no');referral.append(reason,node('p','referrals-meta',`${decision.actor} · ${date(decision.recordedAt)} · Report v${report.version}`),note('This is a recorded demonstration outcome. No receiving hospital has been contacted.'));
    }else referral.append(status('Awaiting clinician decision','review'),note('Your demo follow-up is complete. Your clinician has not yet recorded whether a referral is required.'));
    if(role==='care'){
     const form=node('form','referrals-decision-form'),outcome=node('select');outcome.id='referral-outcome';outcome.name='outcome';for(const [value,label] of [['','Choose an outcome'],['pending','Decision pending'],['issued','Issue a demo referral'],['not-needed','No new referral needed']]){const option=node('option','',label);option.value=value;outcome.append(option);}outcome.value=decision?.outcome||'';outcome.required=true;
     const destination=node('input');destination.id='referral-destination';destination.name='destination';destination.maxLength=200;destination.placeholder='e.g. Specialist respiratory service';destination.value=decision?.destination||'';destination.setAttribute('translate','no');
     const reason=node('textarea');reason.id='referral-reason';reason.name='reason';reason.maxLength=3000;reason.required=true;reason.rows=4;reason.value=decision?.reason||'';reason.setAttribute('translate','no');
     const update=()=>{destination.required=outcome.value==='issued';destination.disabled=outcome.value!=='issued';};update();on(outcome,'change',update);const save=button('Save decision to demo patient portal',true);save.type='submit';form.append(field('Decision',outcome),field('Receiving service',destination,'Required when issuing a demo referral.'),field('Reason / explanation for the patient',reason),save);on(form,'submit',e=>{e.preventDefault();e.stopPropagation();perform(()=>S().recordReferral({outcome:outcome.value,destination:destination.value,reason:reason.value},{role:'care'}),'The referral decision is saved to the demo patient portal.');});referral.append(form);
    }
   }aside.append(referral);
   const activity=card('Your journey, recorded');const timeline=node('ol','referrals-activity');if(!saved.events.length)activity.append(note('Reviewed reports and agreed next steps will appear here.'));for(const e of [...saved.events].reverse().slice(0,10)){const li=node('li');li.append(node('strong','',e.title),node('small','',`${e.actor} · ${date(e.at)}`));timeline.append(li);}activity.append(timeline);aside.append(activity);
   if(saved.reports.length>1){const history=node('details','referrals-history');history.append(node('summary','',`Reviewed report history · ${saved.reports.length} versions`));for(const r of [...saved.reports].reverse()){const entry=node('div','referrals-history-entry');entry.append(node('strong','',`Version ${r.version} · ${date(r.approvedAt)}`));const prior=saved.decisions.filter(d=>d.reportId===r.id).at(-1);if(prior)entry.append(note(`Recorded outcome for this version: ${prior.outcome}.`));history.append(entry);}aside.append(history);}
   layout.append(main,aside);root.append(layout,resetControls(on,()=>perform(()=>S().reset(),'The local demo journey has been reset.')));container.replaceChildren(root);
  }
  const unsubscribe=S().subscribe(draw);draw();return()=>{alive=false;unsubscribe();for(const d of disposers)d();disposers=[];};
 }
 function mountReportReview(container,options={}){
  let alive=true,approvedSnapshot='',message='';const cleanups=[];
  const on=(target,name,fn)=>{target.addEventListener(name,fn);cleanups.push(()=>target.removeEventListener(name,fn));};
  const root=node('section','referrals-review-panel');root.append(node('h3','','Review, then release to the patient'),note('This releases a reviewed copy to Aino Lehtinen’s demo portal on this browser. It does not send a clinical message. The report’s patient reference must be CX-1042.'));
  const preview=node('pre','referrals-report');
  const previewButton=button('Preview current draft');const label=node('label','check-row'),approved=node('input');approved.type='checkbox';approved.id='referral-report-approved';label.append(approved,node('span','','I have reviewed this complete demo report and approve this exact version for the patient portal.'));
  const send=button('Approve & release reviewed demo report',true);send.disabled=true;
  const feedback=node('div','referrals-feedback');feedback.setAttribute('role','status');
  function getDraft(){return options.getDraft?.()||{};}
  const signature=draft=>JSON.stringify({patient:draft.patient,type:draft.type,findings:draft.findings,plan:draft.plan});
  function updatePreview(){const d=getDraft();preview.textContent=`Patient: ${d.patient||'Not selected'}\nCare pathway: ${d.type||'Not selected'}\n\nFINDINGS\n${d.findings||'Not completed'}\n\nPROPOSED NEXT STEP\n${d.plan||'Not completed'}`;}
  function changed(){approved.checked=false;approvedSnapshot='';send.disabled=true;updatePreview();}
  on(previewButton,'click',()=>{changed();feedback.textContent='Review the preview, then confirm approval of this version.';});
  on(approved,'change',()=>{updatePreview();approvedSnapshot=approved.checked?signature(getDraft()):'';send.disabled=!approved.checked;});
  on(send,'click',()=>{try{const draft=getDraft();if(!approved.checked||signature(draft)!==approvedSnapshot){changed();throw new Error('The draft changed after approval. Review and approve the current version again.');}const result=S().releaseReport(draft,{role:'care',approved:true});changed();message=`Reviewed version ${result.version} released to CX-1042’s demo portal. The patient can now choose a follow-up.`;feedback.className='referrals-feedback is-success';feedback.textContent=message;options.onChange?.();}catch(error){feedback.className='referrals-feedback is-error';feedback.textContent=error.message||'The report could not be released.';}});
  const existing=document.querySelector('#report-form');if(existing){on(existing,'input',changed);on(existing,'change',changed);}
  const open=button('Open referrals & follow-up');open.dataset.go='care/referrals';root.append(previewButton,preview,label,send,feedback,open);container.replaceChildren(root);updatePreview();
  return()=>{alive=false;for(const remove of cleanups)remove();};
 }
 window.CandexReferrals={render,mount,mountReportReview,_reportPdf:reportPdf};
})();
