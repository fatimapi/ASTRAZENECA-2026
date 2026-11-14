// Browser-local retrieval agent. It selects reviewed platform content; no clinical reasoning.
export const topics = [
 {title:'Prepare for your appointment',text:'appointment consultation prepare questions video phone nurse speak doctor booking',answer:'Write down your questions and any changes you want to discuss. The care pathway shows the example appointment and your coordinator. This prototype does not book appointments.',view:'pathway',role:'patient'},
 {title:'Compare previous imaging',text:'scan image chest xray CT prior previous comparison annotation nodule review radiology',answer:'The doctor’s imaging workspace lets you switch between current and prior lung illustrations and turn annotations on or off. Measurements are examples, not AI results.',view:'scan',role:'care'},
 {title:'Understand research participation',text:'research consent data sharing privacy permission withdraw records collection register',answer:'Research participation is optional in the concept. The records page demonstrates the preference and explains proposed data use. Nothing is shared by this website.',view:'records',role:'patient'},
 {title:'Understand regional differences',text:'region equity inequality analytics quality KPI metrics delay waiting diagnosis statistics demographic sensitivity',answer:'The quality and equity dashboard illustrates eight measures, including regional waiting times and demographic performance. All displayed figures are invented examples.',view:'analytics',role:'care'},
 {title:'Start a health check',text:'health check symptoms history family smoking risk screening patient information questionnaire concern',answer:'The health check organises concerns, health history and access preferences into a session-only summary. It does not calculate cancer risk or diagnose. A clinician would review the information in a connected service.',view:'health',role:'patient'},
 {title:'Get help with access to care',text:'rural remote distance travel money cost financial language translation disability accessibility video technology support',answer:'Record your preferred contact method and ask for help with travel, language, technology or cost barriers in the health check. The accessibility menu offers larger text, higher contrast and reduced motion.',view:'health',role:'patient'},
 {title:'Prepare a clinical report',text:'report draft generate findings structured recommendation clinical notes download export document',answer:'The report tool creates an editable, downloadable draft from your sample findings and proposed next step. It is template-based and requires clinician review. It is not a medical-agent result.',view:'reports',role:'care'},
 {title:'Learn about the specialist agents',text:'AI agent MedRAX maistro radiomics swarm open source model service integration artificial intelligence medical tools',answer:'MedRAX supports chest X-ray research, mAIstro supports radiomics/research workflows, and Radiology Swarm provides a multi-role review framework. These Python/model services are not connected. The Candex guide runs locally with Transformers.js.',view:'agents',role:'care'},
 {title:'Follow your care pathway',text:'pathway journey followup follow up next steps referral specialist biopsy tests results team coordinator status',answer:'The pathway shows how information review, tests if needed and ongoing support fit together. A real clinician would decide the next action; this is a fictional example.',view:'pathway',role:'patient'},
 {title:'Contact your care team',text:'message chat contact question nurse doctor communication send write ask',answer:'Use the messages page to prepare a question. Drafts stay in this session and are not sent to a doctor. This website is not a monitored care channel.',view:'messages',role:'patient'},
 {title:'Candex covers the whole care journey',text:'Candex idea platform all cancer breast colorectal prostate skin lung Finland mission no patient left behind features',answer:'Candex is an all-cancer concept with a detailed lung pilot, combining accessible patient support, clinician tools, follow-up and quality/equity analytics. Cancer-specific AI would require separate validation.',view:'platform',role:'patient'}
];
let extractor,topicVectors,initializing;
export async function initializeGuide(onProgress=()=>{}){
 if(extractor)return;
 if(initializing)return initializing;
 initializing=(async()=>{
  const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
  env.allowLocalModels=false;
  env.backends.onnx.wasm.numThreads=1;
  extractor=await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{dtype:'q8',device:'wasm',progress_callback:p=>{if(p.status==='progress'&&p.progress)onProgress(`Downloading model assets · ${Math.round(p.progress)}% of current file`);}});
  const output=await extractor(topics.map(t=>t.title+' '+t.text),{pooling:'mean',normalize:true});
  topicVectors=output.tolist();
  window.candexGuide={ready:true};
 })();
 try{await initializing;}catch(e){extractor=null;topicVectors=null;initializing=null;throw e;}
}
export async function findGuidance(question){
 const platformMetricQuestion=/\b(time to diagnos|diagnostic delay|metrics?|analytics|statistics|sensitivity|false.positive)\b/i.test(question);
 if(!platformMetricQuestion&&/\b(diagnos\w*|treat\w*|medicine|medication|am i|do i have|my symptoms|blood|pain|dying|survive|emergency)\b/i.test(question))return {title:'A clinician is the right person to ask',answer:'This guide explains Candex features and cannot assess symptoms, interpret results or recommend care. Contact your healthcare professional for a medical question. In Finland, call 112 for an emergency or 116117 for urgent medical advice. Demo messages are not sent.',view:'health',role:'patient',mode:'safety'};
 let best=0,score=-Infinity;
 if(extractor&&topicVectors){const embedding=(await extractor(question,{pooling:'mean',normalize:true})).tolist()[0];topicVectors.forEach((v,i)=>{const s=v.reduce((sum,x,j)=>sum+x*embedding[j],0);if(s>score){score=s;best=i;}});if(score<.21)return {title:'Explore Candex',answer:'I could not confidently match that question. You can browse the platform features or ask about appointments, imaging, records, reports or research consent.',view:'platform',role:'patient',mode:'ai'};return {...topics[best],mode:'ai'};}
 const words=question.toLowerCase().match(/[a-z]{3,}/g)||[];topics.forEach((t,i)=>{const text=(t.title+' '+t.text).toLowerCase();const s=words.filter(w=>text.includes(w)).length;if(s>score){score=s;best=i;}});return {...topics[score>0?best:topics.length-1],mode:'topics'};
}
