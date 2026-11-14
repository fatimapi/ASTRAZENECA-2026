// Network and DOM are deliberate test stubs; this suite does not claim browser or model execution.
import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.value='';this.checked=false;this.disabled=false;this.files=[];this.attrs={};this.hidden=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(name,value){this.attrs[name]=value;}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
 removeEventListener(name,fn){this.listeners[name]=(this.listeners[name]||[]).filter(x=>x!==fn);}
 async fire(name){const e={preventDefault(){}};for(const fn of this.listeners[name]||[])await fn(e);}
 click(){}
}
const container=new Node();
const document={createElement:tag=>new Node(tag)};
let calls=[];let mode='success';
const response=data=>({ok:true,json:async()=>data});
const fakeForm=class{constructor(){this.values={}}append(k,v){this.values[k]=v}};
const context=vm.createContext({document,HTMLElement:Node,location:{protocol:'http:',origin:'http://localhost:8000'},URL,Blob,FormData:fakeForm,AbortController,setTimeout,clearTimeout,console,fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('/health'))return response({status:'ok',model:{name:'DenseNet',loaded:false,supported_modalities:['CR','DX']}});if(mode==='auth')return {ok:false,status:401,json:async()=>({detail:'wrong key'})};if(mode==='invalid')return response({status:'completed',findings:[{label:'test',score:NaN}]});return response({status:'completed',analysis_id:'test',model:{name:'DenseNet',weights:'test',version:'1',task:'chest-xray-classification'},image:{modality:'DX',width:100,height:100,preview_png_base64:'iVBORw0KGgoAAA=='},findings:[{label:'<script>unsafe</script>',score:.4}],limitations:['Research only'],report_draft:'Actual test model response',requires_clinician_review:true})}});
let source=await fs.readFile(new URL('../dicom.js', import.meta.url),'utf8');source=source.replace('export function mountDicomPanel','function mountDicomPanel');vm.runInContext(source+'\nglobalThis.mountDicomPanel=mountDicomPanel;',context);
const cleanup=context.mountDicomPanel(container);
function all(node=container){return [node,...node.children.flatMap(all)]}
const byId=id=>all().find(n=>n.id===id);
const button=t=>all().find(n=>n.tagName==='button'&&n.textContent===t);
const statuses=()=>all().filter(n=>n.className?.startsWith('dicom-status')).map(n=>n.textContent);
assert.equal(calls.length,0,'Mount must not make requests');
assert.equal(button('Analyse DICOM').disabled,true);
byId('dicom-backend-url').value='javascript:alert(1)';await button('Check connection').fire('click');assert.equal(calls.length,0);assert(statuses().some(x=>x.includes('HTTP or HTTPS')));
byId('dicom-backend-url').value='http://localhost:8000';await byId('dicom-backend-url').fire('input');await button('Check connection').fire('click');assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');assert(!calls[0].options.headers.Authorization);
byId('dicom-api-key').value='a'.repeat(24);await byId('dicom-api-key').fire('input');
byId('dicom-study').files=[{name:'study.dcm',size:1024}];await byId('dicom-study').fire('change');assert.equal(calls.length,1,'Selecting file must not upload');
byId('dicom-confirm-chest').checked=true;await byId('dicom-confirm-chest').fire('change');byId('dicom-permitted').checked=true;await byId('dicom-permitted').fire('change');assert.equal(button('Analyse DICOM').disabled,false);
const form=all().find(n=>n.tagName==='form');await form.fire('submit');assert.equal(calls.length,2);assert.equal(calls[1].options.headers.Authorization,'Bearer '+'a'.repeat(24));assert.equal(calls[1].options.body.values.confirmed_chest,'true');assert.equal(calls[1].options.body.values.permitted_data,'true');assert(byId('dicom-returned-report'));assert.equal(byId('dicom-returned-report').value,'Actual test model response');assert(all().some(n=>n.textContent==='<script>unsafe</script>'),'Untrusted label must use textContent');
byId('dicom-study').files=[{name:'other.dcm',size:2048}];await byId('dicom-study').fire('change');assert(!byId('dicom-returned-report'),'Changing file must discard prior output');assert.equal(byId('dicom-permitted').checked,false);
byId('dicom-confirm-chest').checked=true;byId('dicom-permitted').checked=true;await byId('dicom-permitted').fire('change');mode='auth';await form.fire('submit');assert(statuses().some(x=>x.includes('API key was not accepted')));assert(!byId('dicom-returned-report'));
byId('dicom-study').files=[{name:'huge.dcm',size:21*1024*1024}];await byId('dicom-study').fire('change');assert(button('Analyse DICOM').disabled);assert(statuses().some(x=>x.includes('20 MiB')));
await button('Forget API key').fire('click');assert.equal(byId('dicom-api-key').value,'');cleanup();assert.equal(all().reduce((n,node)=>n+Object.values(node.listeners).flat().length,0),0,'Cleanup must remove all handlers');
console.log('PASS: initial no-network, URL validation, explicit health, file selection no-upload, API auth, analysis payload, actual results, text escaping, stale reset, auth errors, size limit, key clearing, cleanup');
