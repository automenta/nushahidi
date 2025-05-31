import L from 'leaflet';
import { generatePrivateKey as genSk, getPublicKey as getPk, nip19, getEventHash as getEvH, signEvent as signEvNostr, relayInit,nip11 } from 'nostr-tools';
import { appStore } from './store.js';
import { C, $, encrypt, decrypt, sha256, npubToHex, geohashEncode, parseReport, getGhPrefixes, nsecToHex, isNostrId } from './utils.js';

let _db; /* db instance */
const getDbStore=async(sN,m='readonly')=>{if(!_db){_db=await new Promise((rs,rj)=>{const rq=indexedDB.open(C.DB_NAME,C.DB_VERSION);rq.onerror=e=>rj(e.target.error);rq.onsuccess=e=>rs(e.target.result);rq.onupgradeneeded=e=>{const s=e.target.result;if(!s.objectStoreNames.contains(C.STORE_REPORTS))s.createObjectStore(C.STORE_REPORTS,{keyPath:'id'});if(!s.objectStoreNames.contains(C.STORE_PROFILES))s.createObjectStore(C.STORE_PROFILES,{keyPath:'pk'});if(!s.objectStoreNames.contains(C.STORE_SETTINGS))s.createObjectStore(C.STORE_SETTINGS,{keyPath:'id'});if(!s.objectStoreNames.contains(C.STORE_OFFLINE_QUEUE))s.createObjectStore(C.STORE_OFFLINE_QUEUE,{autoIncrement:!0,keyPath:'qid'})}})}return _db.transaction(sN,m).objectStore(sN)};
export const dbSvc={ /* dbSvc: dbService */
  getRep:async id=> (await getDbStore(C.STORE_REPORTS)).get(id),
  getAllReps:async()=> (await getDbStore(C.STORE_REPORTS)).getAll(),
  addRep:async r=> (await getDbStore(C.STORE_REPORTS,'readwrite')).put(r),
  clearReps:async()=> (await getDbStore(C.STORE_REPORTS,'readwrite')).clear(),
  getProf:async pk=> (await getDbStore(C.STORE_PROFILES)).get(pk),
  addProf:async p=> (await getDbStore(C.STORE_PROFILES,'readwrite')).put(p),
  saveSetts:async s=> (await getDbStore(C.STORE_SETTINGS,'readwrite')).put({id:'appSettings',...s}),
  loadSetts:async()=> (await getDbStore(C.STORE_SETTINGS)).get('appSettings'),
  addOfflineQ:async e=> (await getDbStore(C.STORE_OFFLINE_QUEUE,'readwrite')).add(e),
  getOfflineQ:async()=> (await getDbStore(C.STORE_OFFLINE_QUEUE)).getAll(),
  rmOfflineQ:async qid=> (await getDbStore(C.STORE_OFFLINE_QUEUE,'readwrite')).delete(qid),
};

export const confSvc={ /* confSvc: configService */
  async load(){let s=await dbSvc.loadSetts();if(!s)s={rls:C.RELAYS_DEFAULT.map(u=>({url:u,read:!0,write:!0,status:'?',nip11:null})),tile:C.TILE_SERVER_DEFAULT,focus:C.FOCUS_TAG_DEFAULT,cats:['Incident','Observation','Aid'],mute:[],id:null,imgH:C.IMG_UPLOAD_NOSTR_BUILD,nip96H:'',nip96T:''};s.rls=s.rls||C.RELAYS_DEFAULT.map(u=>({url:u,read:!0,write:!0,status:'?',nip11:null}));s.rls.forEach(r=>{if(r.status===undefined)r.status='?';if(r.nip11===undefined)r.nip11=null});appStore.set({relays:s.rls,focusTag:s.focus,settings:{...appStore.get().settings,tile:s.tile,cats:s.cats,mute:s.mute,imgHost:s.imgH,nip96Host:s.nip96H,nip96Token:s.nip96T},user:s.id?{pk:s.id.pk,authM:s.id.authM}:null});return s},
  async save(p){const cS=await dbSvc.loadSetts()||{};const uS={...cS,...p};await dbSvc.saveSetts(uS);appStore.set(s=>({relays:uS.rls||s.relays,focusTag:uS.focus||s.focusTag,settings:{...s.settings,tile:uS.tile||s.settings.tile,cats:uS.cats||s.settings.cats,mute:uS.mute||s.settings.mute,imgHost:uS.imgH||s.settings.imgHost,nip96Host:uS.nip96H||s.settings.nip96Host,nip96Token:uS.nip96T||s.settings.nip96Token},user:uS.id?{pk:uS.id.pk,authM:uS.id.authM}:s.user}))},
  setRlys:rls=>confSvc.save({rls}),setFocus:f=>confSvc.save({focus:f}),setTile:t=>confSvc.save({tile:t}),setCats:c=>confSvc.save({cats:c}),addMute:pk=>{const m=appStore.get().settings.mute;if(!m.includes(pk))confSvc.save({mute:[...m,pk]})},rmMute:pk=>confSvc.save({mute:appStore.get().settings.mute.filter(p=>p!==pk)}),saveId:id=>confSvc.save({id}),getId:async()=>(await dbSvc.loadSetts())?.id,clearId:()=>{appStore.set({user:null});confSvc.save({id:null})},
  setImgHost:(h,isNip96=false,token='')=>confSvc.save(isNip96?{nip96H:h,nip96T:token,imgH:''}:{imgH:h,nip96H:'',nip96T:''}),
};

let _locSk=null; /* locSk: local SecretKey */
export const idSvc={ /* idSvc: identityService */
  async init(){const i=await confSvc.getId();if(i)appStore.set({user:{pk:i.pk,authM:i.authM}})},
  async nip07(){if(!window.nostr?.getPublicKey)return alert("NIP-07 not found"),null;try{const p=await window.nostr.getPublicKey();if(p){const i={pk:p,authM:'nip07'};await confSvc.saveId(i);appStore.set({user:i});return p}}catch(e){alert("NIP-07 Error: "+e.message)}return null},
  async newProf(pass){if(!pass||pass.length<8)return alert("Passphrase too short"),null;const sk=genSk(),pk=getPk(sk);try{const eSk=await encrypt(sk,pass),i={pk,authM:'local',eSk};await confSvc.saveId(i);appStore.set({user:{pk,authM:'local'}});_locSk=sk;alert(`Profile created! Pubkey: ${nip19.npubEncode(pk)}. CRITICAL: Backup this private key (nsec1...): ${nip19.nsecEncode(sk)}`);return{pk,sk}}catch(e){alert("Creation error: "+e.message);return null}},
  async impSk(skIn,pass){if(!pass||pass.length<8)return alert("Passphrase too short"),null;let skHex;try{skHex=nsecToHex(skIn);if(!isNostrId(skHex))throw new Error("Invalid SK format")}catch(e){return alert(e.message),null}const pk=getPk(skHex);try{const eSk=await encrypt(skHex,pass),i={pk,authM:'import',eSk};await confSvc.saveId(i);appStore.set({user:{pk,authM:'import'}});_locSk=skHex;alert("Private key imported.");return{pk,sk:skHex}}catch(e){alert("Import error: "+e.message);return null}},
  async getSk(promptP=true){const u=appStore.get().user;if(!u||u.authM==='nip07')return null;if(_locSk)return _locSk;const i=await confSvc.getId();if(!i?.eSk)return null;if(!promptP)return null;const ps=prompt("Enter passphrase:");if(!ps)return null;try{const dSk=await decrypt(i.eSk,ps);_locSk=dSk;return dSk}catch(e){alert("Decryption failed.");return null}},
  async chgPass(oP,nP){const i=await confSvc.getId();if(!i?.eSk||(i.authM!=='local'&&i.authM!=='import'))throw new Error("No local key.");let dSk;try{dSk=await decrypt(i.eSk,oP)}catch(e){throw new Error("Old pass incorrect.")}if(!dSk)throw new Error("Decryption failed.");const nESk=await encrypt(dSk,nP);await confSvc.saveId({...i,eSk:nESk});_locSk=dSk;alert("Passphrase changed.")},
  logout(){_locSk=null;confSvc.clearId();alert("Logged out.")},
  currU:()=>appStore.get().user,
};

let _nostrRlys=new Map(), _nostrSubs=new Map(); /* nostrRlys: nostrRelays, nostrSubs: nostrSubscriptions */
const updRlyStore=(url,st,nip11Doc=null)=>{const r=appStore.get().relays.map(r=>r.url===url?{...r,status:st,nip11:nip11Doc||r.nip11}:r);appStore.set({relays:r})};
export const nostrSvc={ /* nostrSvc: nostrService */
  async connRlys(){appStore.get().relays.forEach(async rConf=>{if(_nostrRlys.has(rConf.url)&&_nostrRlys.get(rConf.url).status===1)return;try{const r=relayInit(rConf.url);r.on('connect',async()=>{_nostrRlys.set(r.url,r);const nip11Doc=await nip11.fetchRelayInformation(r.url).catch(()=>null);updRlyStore(r.url,'connected',nip11Doc);this.subToReps(r)});r.on('disconnect',()=>{updRlyStore(r.url,'disconnected')});r.on('error',()=>{updRlyStore(r.url,'error')});await r.connect()}catch(e){updRlyStore(rConf.url,'error')}})},
  discAllRlys(){_nostrRlys.forEach(r=>r.close());_nostrRlys.clear();_nostrSubs.forEach(s=>s.sub.unsub());_nostrSubs.clear();appStore.set(s=>({relays:s.relays.map(r=>({...r,status:'disconnected'}))}))},
  async subToReps(specRly=null){this.unsubAllReps();const fTag=appStore.get().focusTag,mapGhs=appStore.get().mapGhs,filt={kinds:[C.NOSTR_KIND_REPORT]};if(fTag&&fTag!==C.FOCUS_TAG_DEFAULT)filt['#t']=[fTag.substring(1)];const rlysToQ=specRly?[specRly]:Array.from(_nostrRlys.values());rlysToQ.forEach(r=>{const rC=appStore.get().relays.find(rc=>rc.url===r.url);if(r.status!==1||!rC?.read)return;let cFilt={...filt};if(rC.nip11?.supported_nips?.includes(52)&&mapGhs?.length>0)cFilt['#g']=mapGhs;const sId=`reps-${r.url}-${Date.now()}`;try{const sub=r.sub([cFilt]);sub.on('event',async ev=>{const rep=parseReport(ev);if(appStore.get().settings.mute.includes(rep.pk))return;await dbSvc.addRep(rep);const existingInteractions = (await dbSvc.getRep(rep.id))?.interactions || []; rep.interactions = existingInteractions;appStore.set(s=>{const i=s.reports.findIndex(rp=>rp.id===rep.id);return{reports: (i>-1?[...s.reports.slice(0,i),rep,...s.reports.slice(i+1)]:[...s.reports,rep]).sort((a,b)=>b.at-a.at)}})});sub.on('eose',()=>{});_nostrSubs.set(sId,{sub,rU:r.url,filt:cFilt,type:'reports'})}catch(e){console.error(`SubErr ${r.url}:`,e)}})},
  unsubAllReps(){_nostrSubs.forEach((s,id)=>{if(s.type==='reports'){try{s.sub.unsub()}catch{};_nostrSubs.delete(id)}})},
  refreshSubs(){this.unsubAllReps();const cCnt=Array.from(_nostrRlys.values()).filter(r=>r.status===1).length;if(cCnt===0)this.connRlys();else this.subToReps()},
  async pubEv(evD){const sEv=await idSvc.signEv(evD);if(appStore.get().online){try{const rsp=await fetch('/api/publishNostrEvent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sEv)});if(!rsp.ok&&rsp.status!==503)console.error("PubErr SWP:",rsp.statusText);else if(rsp.status===503){console.log("Pub deferred by SW");if(sEv.kind===C.NOSTR_KIND_REPORT){const r=parseReport(sEv);await dbSvc.addRep(r);appStore.set(s=>({reports:[...s.reports,r].sort((a,b)=>b.at-a.at)}))}}}catch(e){console.warn("PubNetErr, SW handles:",e);if(sEv.kind===C.NOSTR_KIND_REPORT){const r=parseReport(sEv);await dbSvc.addRep(r);appStore.set(s=>({reports:[...s.reports,r].sort((a,b)=>b.at-a.at)}))}}}else{await dbSvc.addOfflineQ({event:sEv,ts:Date.now()});if(sEv.kind===C.NOSTR_KIND_REPORT){const r=parseReport(sEv);await dbSvc.addRep(r);appStore.set(s=>({reports:[...s.reports,r].sort((a,b)=>b.at-a.at)}))}}return sEv},
  async fetchProf(pk){let p=await dbSvc.getProf(pk);if(p&&(Date.now()-(p.fetchedAt||0))<864e5)return p;const f={kinds:[C.NOSTR_KIND_PROFILE],authors:[pk],limit:1},r2q=Array.from(_nostrRlys.values()).filter(r=>r.status===1);if(r2q.length===0)return p;try{const es=await r2q[0].list([f]);if(es?.length>0){const pe=es.sort((a,b)=>b.at-a.at)[0];try{p=JSON.parse(pe.content);p.pk=pk;p.fetchedAt=Date.now();await dbSvc.addProf(p);return p}catch{}}}catch(e){}return p},
  async fetchInteractions(reportId, reportPk) {
    const filters = [
        { kinds: [C.NOSTR_KIND_REACTION], "#e": [reportId] }, // Reactions to the report
        { kinds: [C.NOSTR_KIND_NOTE], "#e": [reportId] }      // Text notes (comments) referencing the report
    ];
    let allInteractions = [];
    const relaysToQuery = Array.from(_nostrRlys.values()).filter(r => r.status === 1);
    if (relaysToQuery.length === 0) return [];

    try {
        // Query multiple relays and combine results (simplified: query first connected)
        const events = await relaysToQuery[0].list(filters);
        allInteractions = events.map(ev => ({
            id: ev.id, kind: ev.kind, content: ev.content, pubkey: ev.pubkey, created_at: ev.created_at,
            tags: ev.tags, reportId: reportId
        }));
    } catch (e) { console.error("Error fetching interactions:", e); }
    return allInteractions.sort((a,b) => a.created_at - b.created_at); // Oldest first for display
  },
};

export const offSvc={ /* offSvc: offlineService */
  async procQ(){if(!appStore.get().online){return}const itms=await dbSvc.getOfflineQ();if(itms.length===0){return}for(const itm of itms){try{const rsp=await fetch('/api/publishNostrEvent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(itm.event)});if(rsp.ok||rsp.status===503)await dbSvc.rmOfflineQ(itm.qid)}catch(e){console.error("Err procQ item:",e)}}},
  setupSyncLs(){window.addEventListener('online',()=>{this.procQ()});window.addEventListener('offline',()=>{});if('serviceWorker'in navigator&&navigator.serviceWorker.ready){navigator.serviceWorker.ready.then(reg=>{if('sync'in reg){reg.addEventListener('sync',ev=>{if(ev.tag==='nostrPublishQueue')ev.waitUntil(this.procQ())})}})}this.procQ()},
};

let _map, _mapRepsLyr=L.layerGroup(), _mapTileLyr; /* map: mapInstance, mapRepsLyr: mapReportsLayer, mapTileLyr: mapTileLayer */
export const mapSvc={ /* mapSvc: mapService */
  init(id='map-container'){const tU=confSvc.getTileServer();_map=L.map(id).setView([20,0],3);_mapTileLyr=L.tileLayer(tU,{attribution:'&copy; OSM & NM',maxZoom:19}).addTo(_map);_map.addLayer(_mapRepsLyr);appStore.set({map:_map});_map.on('moveend zoomend',()=>{const b=_map.getBounds(),g=getGhPrefixes(b);appStore.set({mapBnds:b,mapGhs:g})});return _map},
  updTile(url){if(_mapTileLyr)_mapTileLyr.setUrl(url)},
  updReps(reps){if(!_map)return;_mapRepsLyr.clearLayers();reps.forEach(r=>{if(r.lat&&r.lon){const m=L.marker([r.lat,r.lon]);m.bindPopup(`<b>${r.title||'Report'}</b><br>${r.sum||r.ct.substring(0,50)+'...'}`,{maxWidth:250});m.on('click',()=>{appStore.set(s=>({...s,ui:{...s.ui,viewingReport:r.id}}))});_mapRepsLyr.addLayer(m)}})},
  ctrUser(){if(!_map||!navigator.geolocation)return;navigator.geolocation.getCurrentPosition(p=>{const ll=[p.coords.latitude,p.coords.longitude];_map.setView(ll,13);L.marker(ll).addTo(_map).bindPopup("You").openPopup()},e=>alert("GPS Err:"+e.message))},
  searchLoc:async q=>{if(!_map)return;try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`),d=await r.json();if(d?.length>0){const{lat,lon,display_name}=d[0];_map.setView([parseFloat(lat),parseFloat(lon)],12);L.popup().setLatLng([parseFloat(lat),parseFloat(lon)]).setContent(display_name).openOn(_map)}else alert("Not found.")}catch(e){alert("Search err.")}},
  enPickLoc:cb=>{if(!_map)return;const mc=$('#map-container');mc.style.cursor='crosshair';_map.once('click',e=>{mc.style.cursor='';cb(e.latlng)})},
  disPickLoc:()=>{if($('#map-container'))$('#map-container').style.cursor='';if(_map)_map.off('click')},
  get:()=>_map,
};

export const imgSvc={ /* imgSvc: imageUploadService */
  async upload(file){
    const {imgHost,nip96Host,nip96Token}=appStore.get().settings;
    if(!file.type.startsWith('image/'))throw new Error('Invalid file type.');
    if(file.size>C.IMG_SIZE_LIMIT_BYTES)throw new Error(`File too large (max ${C.IMG_SIZE_LIMIT_BYTES/1024/1024}MB).`);
    const fd=new FormData();fd.append('file',file);
    let uploadUrl=imgHost, headers={};

    if(nip96Host){ // NIP-96
        uploadUrl = nip96Host; // NIP-96 server URL itself is the upload endpoint
        if(nip96Token) headers['Authorization'] = `Bearer ${nip96Token}`;
        // NIP-96 might not use 'file' as form field name, often just raw body.
        // This simple FormData approach might not work for all NIP-96.
        // For raw body: body: file, headers: {'Content-Type': file.type, ...auth}
    } else if (!imgHost || imgHost === C.IMG_UPLOAD_NOSTR_BUILD) { // Default to nostr.build
        uploadUrl = C.IMG_UPLOAD_NOSTR_BUILD;
        // nostr.build specific: it might expect 'fileToUpload' or similar, check its API.
        // For simplicity, using 'file'.
    }
    // If imgHost is set to something else, assume it's a simple FormData endpoint.

    try{const r=await fetch(uploadUrl,{method:'POST',body:fd,headers});if(!r.ok)throw new Error(`Upload failed: ${r.status} ${await r.text()}`);const d=await r.json();
        // nostr.build returns data[0].url or data.url. NIP-96 returns direct URL or JSON with URL.
        // Standardize: look for a URL in common places.
        let finalUrl = d.url || d.uri || d.link || (Array.isArray(d.data) && d.data[0]?.url) || (d.data?.url);
        if (!finalUrl && typeof d === 'string' && d.startsWith('http')) finalUrl = d; // Some NIP-96 return plain URL
        if (!finalUrl) throw new Error('URL not found in response: '+JSON.stringify(d));
        return finalUrl;
    }catch(e){console.error("Upload err:",e);throw e}
  }
};
