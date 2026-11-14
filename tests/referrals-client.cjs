// DOM/storage are deliberate stubs; no browser or real delivery is claimed.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.attrs={};this.dataset={};this.checked=false;this.disabled=false;this._value=null;this._text='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
 removeEventListener(k,fn){this.listeners[k]=(this.listeners[k]||[]).filter(f=>f!==fn);}
 fire(k){for(const fn of [...(this.listeners[k]||[])])fn({preventDefault(){},stopPropagation(){}});}
 get value(){return this._value??(this.tagName==='select'?this.children[0]?.value??'':'');}
 set value(v){this._value=v;}
 get textContent(){return this._text+this.children.map(n=>n.textContent||'').join(' ');}
 set textContent(v){this._text=String(v);this.children=[];}
 click(){this.fire('click');}
}
const storage=new Map(),form=new Element('form');
const context={window:{addEventListener(){}},document:{createElement:t=>new Element(t),querySelector:()=>form},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},Date,Intl,URL,Blob,setTimeout,console,crypto:require('node:crypto').webcrypto};
vm.createContext(context);
for(const file of ['referral-store.js','referrals.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
const api=context.window.CandexReferrals,store=context.window.CandexReferralStore,root=new Element();
const all=(n=root)=>[n,...n.children.flatMap(all)];
const findText=s=>all().find(n=>n.tagName==='button'&&n.textContent===s);
const id=s=>all().find(n=>n.id===s);
let draft={patient:'CX-1042 · Fictional lung pilot',type:'Lung',findings:'<script>test-only</script>',plan:'Discuss the next step'};
let dispose=api.mountReportReview(root,{getDraft:()=>draft});
const approval=id('referral-report-approved');approval.checked=true;approval.fire('change');
draft={...draft,plan:'Changed after approval'};
findText('Approve & release reviewed demo report').click();
assert.equal(store.get().reports.length,0,'Stale approval must not release an edited report');
approval.checked=true;approval.fire('change');findText('Approve & release reviewed demo report').click();
assert.equal(store.get().reports.length,1);dispose();
dispose=api.mount(root,{role:'patient'});
assert(root.textContent.includes('<script>test-only</script>'),'Clinical text must be represented as text');
assert(!all().some(n=>n.tagName==='script'));
assert(id('referral-appointment-day').value);
assert(id('referral-appointment-time').value);
all().find(n=>n.tagName==='input'&&n.type==='checkbox').checked=true;
all().find(n=>n.tagName==='form').fire('submit');
assert(store.get().activeAppointment);dispose();
dispose=api.mount(root,{role:'care'});
const confirm=all().find(n=>n.tagName==='input'&&n.type==='checkbox');confirm.checked=true;confirm.fire('change');
findText('Simulate demo follow-up completion').click();
assert(store.get().currentFollowUp);
id('referral-outcome').value='issued';id('referral-outcome').fire('change');
id('referral-destination').value='Synthetic specialist service';id('referral-reason').value='Demonstration follow-up decision';
all().find(n=>n.className==='referrals-decision-form').fire('submit');
assert.equal(store.get().currentDecision.outcome,'issued');dispose();
dispose=api.mount(root,{role:'patient'});assert(root.textContent.includes('Referral received in your demo portal'));dispose();
dispose=api.mount(root,{role:'quality'});assert(!root.textContent.includes('<script>test-only</script>'));dispose();
console.log('PASS: reviewed-report approval, edited-draft rejection, patient slot booking, clinician follow-up/referral decision and safe patient display.');
