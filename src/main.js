import { appStore } from './store.js';
import { confSvc, idSvc, nostrSvc, mapSvc, dbSvc, offSvc } from './services.js';
import { initUI } from './ui.js';
import { $, C } from './utils.js';

async function main(){
if('serviceWorker'in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').then(r=>{r.onupdatefound=()=>{const w=r.installing;w.onstatechange=()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)if(confirm("New version available. Refresh?"))window.location.reload()}}}).catch(e=>console.error("SW Reg Fail:",e))})}
await confSvc.load();
await idSvc.init();
if(!mapSvc.init('map-container'))gE('#map-container').innerHTML='<p style="color:red">Map init failed.</p>';
initUI();
const cReps=await dbSvc.getAllReps();
if(cReps?.length>0){
    const currRepIds=new Set(appStore.get().reports.map(r=>r.id));
    const newUniqReps=cReps.filter(r=>!currRepIds.has(r.id));
    if(newUniqReps.length>0)appStore.set(s=>({reports:[...s.reports,...newUniqReps].sort((a,b)=>b.at-a.at)}));
    else if(appStore.get().reports.length===0&&cReps.length>0)appStore.set({reports:cReps.sort((a,b)=>b.at-a.at)});
} else if(appStore.get().reports.length===0){appStore.set({reports:[]})}
nostrSvc.refreshSubs();
offSvc.setupSyncLs();
console.log("NostrMapper Initialized (vFinal Compact). Focus Tag:", appStore.get().focusTag);
}
document.addEventListener('DOMContentLoaded',main);
