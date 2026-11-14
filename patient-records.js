// Internal-ID lookup over synthetic worklist data only. Role checks are UI
// workflow guards, not authentication or authorisation for real patient data.
(() => {
  'use strict';
  window.candexI18n?.extend?.({"Patient records": "Potilastiedot", "The right record. The right person.": "Oikeat tiedot. Oikea henkilö.", "Doctor · Patient records": "Lääkäri · Potilastiedot", "Find a patient by internal ID": "Etsi potilas sisäisellä tunnisteella", "Patient identification number": "Potilaan tunnistenumero", "Find record": "Etsi tiedot", "Clear record": "Tyhjennä tiedot", "Patient record": "Potilastiedot", "Internal ID": "Sisäinen tunniste", "Record source": "Tietojen lähde", "Health-check information": "Terveyskyselyn tiedot", "Not recorded": "Ei kirjattu", "Linked imaging": "Liitetty kuvantamistutkimus", "Research study": "Tutkimusaineiston kuvaus", "Image type": "Kuvantamistyyppi", "Reviewed reports & follow-up": "Tarkastetut raportit ja seuranta", "Medicines": "Lääkkeet", "Allergies": "Allergiat", "Patient notes": "Potilaan muistiinpanot", "Reviewed report version": "Tarkastetun raportin versio", "Reviewed by": "Tarkastaja", "Findings": "Löydökset", "Plan": "Suunnitelma", "Booked follow-up": "Varattu seurantakäynti", "Follow-up completed": "Seuranta toteutunut", "Referral outcome": "Lähetepäätös", "Receiving service": "Vastaanottava palvelu", "Care-team context": "Hoitotiimin tiedot", "Review priority": "Arvioinnin kiireellisyys", "Reason shown in worklist": "Työlistan peruste", "Open reports & follow-up": "Avaa raportit ja seuranta", "Open imaging review": "Avaa kuvantamisen arvio", "Find patient record": "Etsi potilastiedot", "Find a patient record by ID": "Etsi potilastiedot tunnisteella", "No record found for that exact internal ID. Check the ID in the patient worklist.": "Tällä sisäisellä tunnisteella ei löytynyt tietoja. Tarkista tunniste potilastyölistalta.", "Open the Doctor workspace to use this demonstration.": "Käytä tätä esittelyä lääkärin näkymässä.", "Demo record found. Confirm the patient name and ID before reviewing the information.": "Demotiedot löytyivät. Varmista potilaan nimi ja tunniste ennen tarkastelua.", "No submitted health check is linked to this internal ID. Missing information is not treated as a negative clinical finding.": "Tähän sisäiseen tunnisteeseen ei ole liitetty terveyskyselyä. Puuttuva tieto ei tarkoita kielteistä kliinistä löydöstä."});
  const T=value=>window.candexI18n?.tr(value)||value;
  function normaliseId(value){
    if(typeof value!=='string')return null;
    const id=value.trim().toUpperCase();
    return /^(?:CX|HC)-\d{3,8}$/.test(id)?id:null;
  }
  function lookup(query,options={}){
    if(options.role!=='care')throw new Error('Open the Doctor workspace to use this demonstration.');
    const id=normaliseId(query);
    if(!id)return null;
    const patient=options.patients?.find(p=>p.id===id);
    if(!patient)return null;
    const candidateHealth=options.healthFor?.(id);
    const health=candidateHealth?.id===id?candidateHealth:null;
    // A journey belongs to one explicit patient. Never reuse Aino's history
    // when a different ID is selected, even if a caller supplies it by mistake.
    const candidate=options.journeyFor?.(id);
    const journey=candidate?.patientId===id?candidate:null;
    const imaging=options.imagingFor?.(id)||null;
    return {patient:{id:patient.id,name:patient.name,age:patient.age,type:patient.type,region:patient.region,priority:patient.priority,reason:patient.reason,status:patient.status,source:patient.source||'fictional-worklist'},health,journey,imaging};
  }
  function node(tag,cls,content){const n=document.createElement(tag);if(cls)n.className=cls;if(content!==undefined)n.textContent=String(content);return n;}
  function panel(title){const n=node('section','card');n.append(node('h2','',T(title)));return n;}
  function row(parent,label,value){const n=node('div','data-line');const v=node('strong','',value===null||value===undefined||value===''?T('Not recorded'):String(value));v.setAttribute('translate','no');n.append(node('span','',T(label)),v);parent.append(n);}
  function clinical(content){const n=node('p','patient-record-copy',content);n.setAttribute('translate','no');return n;}
  function mount(container,options={}){
    let alive=true;const removers=[],resultRemovers=[];
    const listen=(n,type,fn)=>{n.addEventListener(type,fn);removers.push(()=>n.removeEventListener(type,fn));};
    const listenResult=(n,type,fn)=>{n.addEventListener(type,fn);resultRemovers.push(()=>n.removeEventListener(type,fn));};
    container.replaceChildren();
    if(options.role!=='care'){container.append(node('p','notice',T('Open the Doctor workspace to use this demonstration.')));return()=>{alive=false;};}
    const root=node('div','patient-record-workspace');
    const intro=node('div','demo-banner');intro.append(node('span','',T('Synthetic records only. Internal IDs are not passwords. The role switch is not staff authentication; this page is not connected to Kanta or a real patient registry.')));root.append(intro);
    const search=panel('Find a patient by internal ID');
    const form=node('form','patient-record-search');form.id='patient-record-lookup-form';
    const field=node('div','field'),label=node('label','',T('Patient identification number'));
    const input=node('input');input.id='patient-record-id';input.name='patientId';input.type='text';input.maxLength=16;input.required=true;input.autocomplete='off';input.spellcheck=false;input.placeholder='CX-1042';input.setAttribute('translate','no');input.setAttribute('aria-describedby','patient-record-help');label.htmlFor=input.id;
    const help=node('small','',T('Enter a complete internal ID, such as CX-1042 or an HC ID from the worklist. Do not enter a Finnish personal identity code.'));help.id='patient-record-help';field.append(label,input,help);
    const submit=node('button','button',T('Find record'));submit.type='submit';
    const clear=node('button','button secondary',T('Clear record'));clear.type='button';
    form.append(field,submit,clear);search.append(form);root.append(search);
    const status=node('p','patient-record-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
    const result=node('div','patient-record-result');root.append(result);container.append(root);
    function reset(){for(const remove of resultRemovers)remove();resultRemovers.length=0;result.replaceChildren();status.textContent='';}
    function renderRecord(record){
      const p=record.patient;
      const header=panel('Patient record');const name=node('h3','patient-record-name',p.name);name.setAttribute('translate','no');header.append(name);
      for(const [k,v]of [['Internal ID',p.id],['Age',p.age],['Region',p.region],['Care pathway',p.type],['Worklist status',p.status]])row(header,k,v);
      row(header,'Record source',p.source==='health-check'?T('Health check submitted in this demo'):T('Fictional worklist record'));
      const summary=node('div','patient-record-grid');const health=panel('Health-check information');
      if(record.health){for(const [key,title]of [['sex','Sex as provided'],['smoking','Smoking history'],['pack_years','Pack-years as provided'],['family','Family history'],['symptoms','Reason / symptoms as provided'],['language','Preferred language'],['travel','Travel to care'],['contact','Contact preference']])row(health,title,record.health[key]);if(record.health.notes){health.append(node('h3','',T('Patient notes')),clinical(record.health.notes));}health.append(node('p','patient-record-note',T('Self-reported demonstration information; it is not a confirmed diagnosis.')));}
      else health.append(node('p','patient-record-note',T('No submitted health check is linked to this internal ID. Missing information is not treated as a negative clinical finding.')));
      row(health,'Medicines',null);row(health,'Allergies',null);
      const images=panel('Linked imaging');
      if(record.imaging){row(images,'Research study',record.imaging.id);row(images,'Image type',record.imaging.modality||'CT');images.append(node('p','patient-record-note',T('A public research study is linked for this demonstration. It is not this fictional patient’s own scan, and no CT imaging AI has run.')));}
      else images.append(node('p','patient-record-note',T('No imaging study is linked to this patient.')));
      if(options.onImaging){const b=node('button','button secondary',T('Open imaging review'));b.type='button';listenResult(b,'click',()=>options.onImaging(p.id));images.append(b);}
      const reports=panel('Reviewed reports & follow-up');
      if(record.journey?.currentReport){const j=record.journey,r=j.currentReport;row(reports,'Reviewed report version',r.version);row(reports,'Reviewed by',r.approvedBy);reports.append(node('h3','',T('Findings')),clinical(r.findings),node('h3','',T('Plan')),clinical(r.plan));row(reports,'Booked follow-up',j.activeAppointment?new Intl.DateTimeFormat(window.candexI18n?.lang==='fi'?'fi-FI':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Helsinki'}).format(new Date(j.activeAppointment.startsAt))+' · Europe/Helsinki':null);row(reports,'Follow-up completed',j.currentFollowUp?T('Simulated in the demo'):T('Not recorded'));row(reports,'Referral outcome',j.currentDecision?.outcome||null);if(j.currentDecision){row(reports,'Receiving service',j.currentDecision.destination);reports.append(clinical(j.currentDecision.reason));}reports.append(node('p','patient-record-note',T('Report and referral history belongs to this ID only and is stored on this browser. No hospital has been contacted.')));if(options.onReferrals){const b=node('button','button secondary',T('Open reports & follow-up'));b.type='button';listenResult(b,'click',()=>options.onReferrals(p.id));reports.append(b);}}
      else reports.append(node('p','patient-record-note',T('No reviewed report or browser-local referral journey is linked to this patient. A worklist status alone does not confirm a referral or appointment.')));
      const context=panel('Care-team context');row(context,'Review priority',p.priority);row(context,'Reason shown in worklist',p.reason);context.append(node('p','patient-record-note',T('This page brings existing demo information together; it does not calculate a new risk score or recommend treatment.')));
      summary.append(health,images,reports,context);result.append(header,summary);
      status.textContent=T('Demo record found. Confirm the patient name and ID before reviewing the information.');
    }
    function searchNow(){reset();try{const record=lookup(input.value,{...options,role:options.getRole?.()||options.role,patients:options.getPatients?.()||options.patients});if(!record){status.textContent=T('No record found for that exact internal ID. Check the ID in the patient worklist.');return;}renderRecord(record);}catch{status.textContent=T('The record could not be opened. Check the workspace and refresh the page.');}}
    listen(form,'submit',e=>{e.preventDefault();e.stopPropagation();if(alive)searchNow();});
    listen(input,'input',reset);listen(clear,'click',()=>{input.value='';reset();input.focus();});
    if(options.initialId){input.value=options.initialId;searchNow();}
    const unsubscribe=window.CandexReferralStore?.subscribe(()=>{if(alive&&input.value&&result.children.length)searchNow();});
    return()=>{alive=false;unsubscribe?.();for(const fn of removers)fn();reset();input.value='';};
  }
  window.CandexPatientRecords={normaliseId,lookup,mount};
})();
