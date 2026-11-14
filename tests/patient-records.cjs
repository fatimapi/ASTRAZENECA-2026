// DOM/worklist/health data are test stubs. No real records are queried.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.attrs={};this._text='';this.value='';}
 append(...n){this.children.push(...n);}
 replaceChildren(...n){this.children=[...n];}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(k,f){(this.listeners[k]??=[]).push(f);}
 removeEventListener(k,f){this.listeners[k]=(this.listeners[k]||[]).filter(x=>x!==f);}
 fire(k){for(const f of [...this.listeners[k]||[]])f({preventDefault(){},stopPropagation(){}});}
 focus(){}
 get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}
 set textContent(v){this._text=String(v);this.children=[];}
}
const c={window:{},document:{createElement:t=>new Element(t)},Date,Intl};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../patient-records.js'),'utf8'),c);
const api=c.window.CandexPatientRecords;
const patients=[{id:'CX-1042',name:'Aino <img src=x>',age:58,type:'Lung',region:'Pirkanmaa',status:'Awaiting review'},{id:'CX-1043',name:'Mika',type:'Colorectal'},{id:'HC-2001',name:'New demo patient',source:'health-check'}];
const options={role:'care',patients,healthFor:id=>({id,notes:'<script>not HTML</script>',smoking:'Never smoked'}),journeyFor:()=>({patientId:'CX-1042',currentReport:{version:1,approvedBy:'Demo clinician',findings:'Aino-only finding',plan:'Demo discussion'}})};
assert.equal(api.normaliseId(' cx-1042 '),'CX-1042');
for(const id of ['Aino','1042','CX-104','010101-123N','CX-1042-extra','<script>','',null])assert.equal(api.lookup(id,options),null);
assert.throws(()=>api.lookup('CX-1042',{...options,role:'patient'}));
assert.throws(()=>api.lookup('CX-1042',{...options,role:'quality'}));
assert.equal(api.lookup('CX-1042',options).patient.name,patients[0].name);
assert.equal(api.lookup('HC-2001',options).health.id,'HC-2001');
assert.equal(api.lookup('CX-1043',options).journey,null,'Never expose a different patient’s report');
assert.equal(api.lookup('CX-1043',{...options,healthFor:()=>({id:'CX-1042',notes:'Private test'})}).health,null);
const root=new Element();let role='care';
const cleanup=api.mount(root,{...options,getRole:()=>role});
const all=(n=root)=>[n,...n.children.flatMap(all)];
const input=all().find(n=>n.id==='patient-record-id');
const form=all().find(n=>n.tagName==='form');
input.value='CX-1042';form.fire('submit');
assert(root.textContent.includes('Aino-only finding'));
assert(root.textContent.includes('<script>not HTML</script>'));
assert(!all().some(n=>['script','img'].includes(n.tagName)));
input.value='CX-1043';input.fire('input');
assert(!root.textContent.includes('Aino-only finding'),'Changing the ID clears the previous result immediately');
form.fire('submit');assert(root.textContent.includes('Mika'));assert(!root.textContent.includes('Aino-only finding'));
input.value='CX-9999';form.fire('submit');assert(root.textContent.includes('No record found'));assert(!root.textContent.includes('Mika'));
role='patient';input.value='CX-1042';form.fire('submit');assert(!root.textContent.includes('Aino-only finding'));
cleanup();assert.equal(input.value,'');
const denied=new Element();api.mount(denied,{...options,role:'quality',initialId:'CX-1042'});assert(!denied.textContent.includes('Aino-only finding'));assert(!denied.children.some(n=>n.tagName==='form'));
console.log('PASS: exact internal-ID lookup, role guards, dynamic health IDs, cross-patient isolation, safe text rendering, stale-result clearing and cleanup.');
