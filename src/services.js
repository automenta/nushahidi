import L from 'leaflet';
import 'leaflet.markercluster'; // Import the MarkerCluster plugin
import { generatePrivateKey as genSk, getPublicKey as getPk, nip19, getEventHash as getEvH, signEvent as signEvNostr, relayInit,nip11 } from 'nostr-tools';
import { appStore } from './store.js';
import { C, $, encrypt, decrypt, sha256, npubToHex, geohashEncode, parseReport, getGhPrefixes, nsecToHex, isNostrId, showToast } from './utils.js';

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
  // New: Pruning function
  async pruneDb() {
    console.log("Pruning IndexedDB...");
    const now = Date.now();

    // Prune reports (keep only the latest X)
    const allReports = await this.getAllReps();
    if (allReports.length > C.DB_PRUNE_REPORTS_MAX) {
      const sortedReports = allReports.sort((a, b) => b.at - a.at); // Sort by created_at descending
      const toDelete = sortedReports.slice(C.DB_PRUNE_REPORTS_MAX);
      const store = await getDbStore(C.STORE_REPORTS, 'readwrite');
      for (const rep of toDelete) {
        await store.delete(rep.id);
      }
      showToast(`Pruned ${toDelete.length} old reports.`, 'info');
    }

    // Prune profiles (delete older than X days)
    const allProfiles = await this.getDbStore(C.STORE_PROFILES).getAll();
    const profileStore = await getDbStore(C.STORE_PROFILES, 'readwrite');
    let profilesDeleted = 0;
    for (const prof of allProfiles) {
      if (prof.fetchedAt && (now - prof.fetchedAt) > (C.DB_PRUNE_PROFILES_MAX_AGE_DAYS * 24 * 60 * 60 * 1000)) {
        await profileStore.delete(prof.pk);
        profilesDeleted++;
      }
    }
    if (profilesDeleted > 0) {
      showToast(`Pruned ${profilesDeleted} old profiles.`, 'info');
    }
    console.log("IndexedDB pruning complete.");
  }
};

export const confSvc={ /* confSvc: configService */
  async load(){
    let s=await dbSvc.loadSetts();
    if(!s)s={
      rls:C.RELAYS_DEFAULT.map(u=>({url:u,read:!0,write:!0,status:'?',nip11:null})),
      tileUrl:C.TILE_SERVER_DEFAULT,
      tilePreset:'OpenStreetMap',
      focusTags:[{tag:C.FOCUS_TAG_DEFAULT,active:true}], // New structure
      cats:['Incident','Observation','Aid'],
      mute:[],
      id:null,
      imgH:C.IMG_UPLOAD_NOSTR_BUILD,
      nip96H:'',
      nip96T:''
    };
    // Ensure backward compatibility and proper initialization
    s.rls = s.rls || C.RELAYS_DEFAULT.map(u=>({url:u,read:!0,write:!0,status:'?',nip11:null}));
    s.rls.forEach(r=>{if(r.status===undefined)r.status='?';if(r.nip11===undefined)r.nip11=null});

    // Handle focus tag migration from string to array of objects
    if (typeof s.focus === 'string') {
      s.focusTags = [{tag: s.focus, active: true}];
      delete s.focus; // Remove old property
    } else if (!s.focusTags || s.focusTags.length === 0) {
      s.focusTags = [{tag: C.FOCUS_TAG_DEFAULT, active: true}];
    }
    const currentFocusTag = s.focusTags.find(t => t.active)?.tag || C.FOCUS_TAG_DEFAULT;

    // Handle tile server migration
    s.tileUrl = s.tileUrl || s.tile || C.TILE_SERVER_DEFAULT;
    s.tilePreset = s.tilePreset || (s.tile === C.TILE_SERVER_DEFAULT ? 'OpenStreetMap' : 'Custom');
    delete s.tile; // Remove old property

    appStore.set({
      relays:s.rls,
      focusTags:s.focusTags, // New
      currentFocusTag:currentFocusTag, // New
      settings:{
        ...appStore.get().settings,
        tileUrl:s.tileUrl, // New
        tilePreset:s.tilePreset, // New
        cats:s.cats,
        mute:s.mute,
        imgHost:s.imgH,
        nip96Host:s.nip96H,
        nip96Token:s.nip96T
      },
      user:s.id?{pk:s.id.pk,authM:s.id.authM}:null
    });
    return s
  },
  async save(p){
    const cS=await dbSvc.loadSetts()||{};
    const uS={...cS,...p};
    await dbSvc.saveSetts(uS);
    appStore.set(s=>({
      relays:uS.rls||s.relays,
      focusTags:uS.focusTags||s.focusTags, // New
      currentFocusTag:uS.currentFocusTag||s.currentFocusTag, // New
      settings:{
        ...s.settings,
        tileUrl:uS.tileUrl||s.settings.tileUrl, // New
        tilePreset:uS.tilePreset||s.settings.tilePreset, // New
        cats:uS.cats||s.settings.cats,
        mute:uS.mute||s.settings.mute,
        imgHost:uS.imgH||s.settings.imgHost,
        nip96Host:uS.nip96H||s.settings.nip96Host,
        nip96Token:uS.nip96T||s.settings.nip96Token
      },
      user:uS.id?{pk:uS.id.pk,authM:uS.id.authM}:s.user
    }))
  },
  setRlys:rls=>confSvc.save({rls}),
  setFocusTags:tags=>confSvc.save({focusTags:tags}), // New
  setCurrentFocusTag:tag=>confSvc.save({currentFocusTag:tag}), // New
  setCats:c=>confSvc.save({cats:c}),
  addMute:pk=>{const m=appStore.get().settings.mute;if(!m.includes(pk))confSvc.save({mute:[...m,pk]})},
  rmMute:pk=>confSvc.save({mute:appStore.get().settings.mute.filter(p=>p!==pk)}),
  saveId:id=>confSvc.save({id}),
  getId:async()=>(await dbSvc.loadSetts())?.id,
  clearId:()=>{appStore.set({user:null});confSvc.save({id:null})},
  setTileUrl:u=>confSvc.save({tileUrl:u, tilePreset:'Custom'}), // New
  setTilePreset:(p,u)=>confSvc.save({tilePreset:p, tileUrl:u}), // New
  getTileServer:()=>appStore.get().settings.tileUrl, // Updated to use tileUrl
  getCurrentFocusTag:()=>appStore.get().currentFocusTag, // Updated to use currentFocusTag
  setImgHost:(h,isNip96=false,token='')=>confSvc.save(isNip96?{nip96H:h,nip96T:token,imgH:''}:{imgH:h,nip96H:'',nip96T:''}),
};

let _locSk=null; /* locSk: local SecretKey */
export const idSvc={ /* idSvc: identityService */
  async init(){const i=await confSvc.getId();if(i)appStore.set({user:{pk:i.pk,authM:i.authM}})},
  async nip07(){if(!window.nostr?.getPublicKey)return showToast("NIP-07 extension not found. Please install Alby or nos2x.", 'warning'),null;try{const p=await window.nostr.getPublicKey();if(p){const i={pk:p,authM:'nip07'};await confSvc.saveId(i);appStore.set({user:i});showToast("NIP-07 connected successfully!", 'success');return p}}catch(e){showToast(`NIP-07 connection error: ${e.message}`, 'error')}return null},
  async newProf(pass){if(!pass||pass.length<8)return showToast("Passphrase too short (min 8 chars).", 'warning'),null;const sk=genSk(),pk=getPk(sk);try{const eSk=await encrypt(sk,pass),i={pk,authM:'local',eSk};await confSvc.saveId(i);appStore.set({user:{pk,authM:'local'}});_locSk=sk;showToast(`Profile created! Pubkey: ${nip19.npubEncode(pk)}.`, 'success');prompt("CRITICAL: Backup this private key (nsec1...):", nip19.nsecEncode(sk));return{pk,sk}}catch(e){showToast(`Profile creation error: ${e.message}`, 'error');return null}},
  async impSk(skIn,pass){if(!pass||pass.length<8)return showToast("Passphrase too short (min 8 chars).", 'warning'),null;let skHex;try{skHex=nsecToHex(skIn);if(!isNostrId(skHex))throw new Error("Invalid Nostr private key format.")}catch(e){return showToast(e.message, 'error'),null}const pk=getPk(skHex);try{const eSk=await encrypt(skHex,pass),i={pk,authM:'import',eSk};await confSvc.saveId(i);appStore.set({user:{pk,authM:'import'}});_locSk=skHex;showToast("Private key imported successfully.", 'success');return{pk,sk:skHex}}catch(e){showToast(`Key import error: ${e.message}`, 'error');return null}},
  async getSk(promptP=true){const u=appStore.get().user;if(!u||u.authM==='nip07')return null;if(_locSk)return _locSk;const i=await confSvc.getId();if(!i?.eSk)return null;if(!promptP)return null;const ps=prompt("Enter passphrase to decrypt private key:");if(!ps)return null;try{const dSk=await decrypt(i.eSk,ps);_locSk=dSk;return dSk}catch(e){showToast("Decryption failed. Incorrect passphrase?", 'error');return null}},
  async chgPass(oP,nP){const i=await confSvc.getId();if(!i?.eSk||(i.authM!=='local'&&i.authM!=='import'))throw new Error("No local key to change passphrase for.");let dSk;try{dSk=await decrypt(i.eSk,oP)}catch(e){throw new Error("Old passphrase incorrect.")}if(!dSk)throw new Error("Decryption failed.");const nESk=await encrypt(dSk,nP);await confSvc.saveId({...i,eSk:nESk});_locSk=dSk;showToast("Passphrase changed successfully.", 'success')},
  logout(){_locSk=null;confSvc.clearId();showToast("Logged out successfully.", 'info')},
  currU:()=>appStore.get().user,
  // CRITICAL FIX: Add signEv function
  async signEv(event) {
    const user = appStore.get().user;
    if (!user) throw new Error("No Nostr identity connected. Please connect or create one.");

    if (user.authM === 'nip07') {
      if (!window.nostr?.signEvent) throw new Error("NIP-07 extension not found or not enabled.");
      try {
        return await window.nostr.signEvent(event);
      } catch (e) {
        throw new Error("NIP-07 signing failed: " + e.message);
      }
    } else if (user.authM === 'local' || user.authM === 'import') {
      const sk = await idSvc.getSk(true); // Prompt for passphrase if needed
      if (!sk) throw new Error("Private key not available for signing. Passphrase might be needed.");
      const signedEvent = { ...event, pubkey: user.pk, id: getEvH(event), sig: signEvNostr(event, sk) };
      return signedEvent;
    } else {
      throw new Error("Unsupported authentication method.");
    }
  }
};

let _nostrRlys=new Map(), _nostrSubs=new Map(); /* nostrRlys: nostrRelays, nostrSubs: nostrSubscriptions */
const updRlyStore=(url,st,nip11Doc=null)=>{const r=appStore.get().relays.map(r=>r.url===url?{...r,status:st,nip11:nip11Doc||r.nip11}:r);appStore.set({relays:r})};
export const nostrSvc={ /* nostrSvc: nostrService */
  async connRlys(){
    appStore.get().relays.forEach(async rConf=>{
      if(_nostrRlys.has(rConf.url)&&_nostrRlys.get(rConf.url).status===1)return; // Already connected
      if (!rConf.read && !rConf.write) return; // Don't connect if neither read nor write is enabled

      const connectRelay = async (url, attempt = 1) => {
        try {
          const r = relayInit(url);
          r.on('connect', async()=>{
            _nostrRlys.set(r.url,r);
            const nip11Doc=await nip11.fetchRelayInformation(r.url).catch(()=>null);
            updRlyStore(r.url,'connected',nip11Doc);
            showToast(`Connected to ${url}`, 'success', 2000);
            this.subToReps(r); // Subscribe to reports on new connection
          });
          r.on('disconnect',()=>{
            updRlyStore(r.url,'disconnected');
            showToast(`Disconnected from ${url}`, 'warning', 2000);
            // Optional: try to reconnect after a delay
            setTimeout(() => connectRelay(url, 1), 5000);
          });
          r.on('error',()=>{
            updRlyStore(r.url,'error');
            showToast(`Error connecting to ${url}`, 'error', 2000);
            // Optional: retry with backoff
            if (attempt < 3) { // Max 3 retries
              setTimeout(() => connectRelay(url, attempt + 1), attempt * 5000);
            }
          });
          await r.connect();
        } catch(e) {
          updRlyStore(url,'error');
          showToast(`Failed to connect to ${url}: ${e.message}`, 'error', 2000);
          if (attempt < 3) {
            setTimeout(() => connectRelay(url, attempt + 1), attempt * 5000);
          }
        }
      };
      connectRelay(rConf.url);
    })
  },
  discAllRlys(){_nostrRlys.forEach(r=>r.close());_nostrRlys.clear();_nostrSubs.forEach(s=>s.sub.unsub());_nostrSubs.clear();appStore.set(s=>({relays:s.relays.map(r=>({...r,status:'disconnected'}))}));showToast("All relays disconnected.", 'info')},
  async subToReps(specRly=null){this.unsubAllReps();const fTag=appStore.get().currentFocusTag,mapGhs=appStore.get().mapGhs,filt={kinds:[C.NOSTR_KIND_REPORT]};if(fTag&&fTag!==C.FOCUS_TAG_DEFAULT)filt['#t']=[fTag.substring(1)];const rlysToQ=specRly?[specRly]:Array.from(_nostrRlys.values());rlysToQ.forEach(r=>{const rC=appStore.get().relays.find(rc=>rc.url===r.url);if(r.status!==1||!rC?.read)return;let cFilt={...filt};if(rC.nip11?.supported_nips?.includes(52)&&mapGhs?.length>0)cFilt['#g']=mapGhs;const sId=`reps-${r.url}-${Date.now()}`;try{const sub=r.sub([cFilt]);sub.on('event',async ev=>{const rep=parseReport(ev);if(appStore.get().settings.mute.includes(rep.pk))return;await dbSvc.addRep(rep);const existingInteractions = (await dbSvc.getRep(rep.id))?.interactions || []; rep.interactions = existingInteractions;appStore.set(s=>{const i=s.reports.findIndex(rp=>rp.id===rep.id);return{reports: (i>-1?[...s.reports.slice(0,i),rep,...s.reports.slice(i+1)]:[...s.reports,rep]).sort((a,b)=>b.at-a.at)}})});sub.on('eose',()=>{});_nostrSubs.set(sId,{sub,rU:r.url,filt:cFilt,type:'reports'})}catch(e){console.error(`SubErr ${r.url}:`,e);showToast(`Subscription error for ${r.url}: ${e.message}`, 'error')}})},
  unsubAllReps(){_nostrSubs.forEach((s,id)=>{if(s.type==='reports'){try{s.sub.unsub()}catch{};_nostrSubs.delete(id)}})},
  refreshSubs(){this.unsubAllReps();const cCnt=Array.from(_nostrRlys.values()).filter(r=>r.status===1).length;if(cCnt===0)this.connRlys();else this.subToReps()},
  async pubEv(evD){const sEv=await idSvc.signEv(evD);if(appStore.get().online){try{const rsp=await fetch('/api/publishNostrEvent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sEv)});if(!rsp.ok&&rsp.status!==503)console.error("PubErr SWP:",rsp.statusText);else if(rsp.status===503){console.log("Pub deferred by SW");if(sEv.kind===C.NOSTR_KIND_REPORT){const r=parseReport(sEv);await dbSvc.addRep(r);appStore.set(s=>({reports:[...s.reports,r].sort((a,b)=>b.at-a.at)}))}}}catch(e){console.warn("PubNetErr, SW handles:",e);if(sEv.kind===C.NOSTR_KIND_REPORT){const r=parseReport(sEv);await dbSvc.addRep(r);appStore.set(s=>({reports:[...s.reports,r].sort((a,b)=>b.at-a.at)}))}}}else{await dbSvc.addOfflineQ({event:sEv,ts:Date.now()});if(sEv.kind===C.NOSTR_KIND_REPORT){const r=parseReport(sEv);await dbSvc.addRep(r);appStore.set(s=>({reports:[...s.reports,r].sort((a,b)=>b.at-a.at)}))}}return sEv},
  async fetchProf(pk){let p=await dbSvc.getProf(pk);if(p&&(Date.now()-(p.fetchedAt||0))<864e5)return p;const f={kinds:[C.NOSTR_KIND_PROFILE],authors:[pk],limit:1},r2q=Array.from(_nostrRlys.values()).filter(r=>r.status===1);if(r2q.length===0)return p;try{const es=await r2q[0].list([f]);if(es?.length>0){const pe=es.sort((a,b)=>b.at-a.at)[0];try{p=JSON.parse(pe.content);p.pk=pk;p.fetchedAt=Date.now();await dbSvc.addProf(p);return p}catch{}}}catch(e){showToast(`Error fetching profile for ${formatNpubShort(pk)}: ${e.message}`, 'error')}return p},
  async fetchInteractions(reportId, reportPk) {
    const filters = [
        { kinds: [C.NOSTR_KIND_REACTION], "#e": [reportId] }, // Reactions to the report
        { kinds: [C.NOSTR_KIND_NOTE], "#e": [reportId] }      // Text notes (comments) referencing the report
    ];
    let allInteractions = [];
    const relaysToQuery = Array.from(_nostrRlys.values()).filter(r => r.status === 1 && r.read);
    if (relaysToQuery.length === 0) {
      showToast("No connected relays to fetch interactions from.", 'warning');
      return [];
    }

    const fetchPromises = relaysToQuery.map(r =>
      r.list(filters).catch(e => {
        console.warn(`Error fetching interactions from ${r.url}: ${e.message}`);
        return []; // Return empty array on error to allow Promise.allSettled to continue
      })
    );

    const results = await Promise.allSettled(fetchPromises);
    const uniqueEvents = new Map(); // Use a Map to deduplicate by event ID

    results.forEach(result => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        result.value.forEach(ev => {
          if (!uniqueEvents.has(ev.id)) {
            uniqueEvents.set(ev.id, ev);
          }
        });
      }
    });

    allInteractions = Array.from(uniqueEvents.values()).map(ev => ({
        id: ev.id, kind: ev.kind, content: ev.content, pubkey: ev.pubkey, created_at: ev.created_at,
        tags: ev.tags, reportId: reportId
    }));
    
    return allInteractions.sort((a,b) => a.created_at - b.created_at); // Oldest first for display
  },
};

export const offSvc={ /* offSvc: offlineService */
  async procQ(){if(!appStore.get().online){return}const itms=await dbSvc.getOfflineQ();if(itms.length===0){return}for(const itm of itms){try{const rsp=await fetch('/api/publishNostrEvent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(itm.event)});if(rsp.ok||rsp.status===503)await dbSvc.rmOfflineQ(itm.qid)}catch(e){console.error("Err procQ item:",e);showToast(`Failed to sync offline event: ${e.message}`, 'error')}}},
  setupSyncLs(){window.addEventListener('online',()=>{this.procQ()});window.addEventListener('offline',()=>{});if('serviceWorker'in navigator&&navigator.serviceWorker.ready){navigator.serviceWorker.ready.then(reg=>{if('sync'in reg){reg.addEventListener('sync',ev=>{if(ev.tag==='nostrPublishQueue')ev.waitUntil(this.procQ())})}})}this.procQ()},
};

let _map, _mapRepsLyr=L.layerGroup(), _mapTileLyr; /* map: mapInstance, mapRepsLyr: mapReportsLayer, mapTileLyr: mapTileLayer */
export const mapSvc={ /* mapSvc: mapService */
  init(id='map-container'){const tU=confSvc.getTileServer();_map=L.map(id).setView([20,0],3);_mapTileLyr=L.tileLayer(tU,{attribution:'&copy; OSM & NM',maxZoom:19}).addTo(_map);
  _mapRepsLyr = L.markerClusterGroup(); // Changed to MarkerClusterGroup
  _map.addLayer(_mapRepsLyr);appStore.set({map:_map});_map.on('moveend zoomend',()=>{const b=_map.getBounds(),g=getGhPrefixes(b);appStore.set({mapBnds:b,mapGhs:g})});return _map},
  updTile(url){if(_mapTileLyr)_mapTileLyr.setUrl(url)},
  updReps(reps){if(!_map)return;_mapRepsLyr.clearLayers();reps.forEach(r=>{if(r.lat&&r.lon){const m=L.marker([r.lat,r.lon]);m.bindPopup(`<b>${r.title||'Report'}</b><br>${r.sum||r.ct.substring(0,50)+'...'}`,{maxWidth:250});m.on('click',()=>{appStore.set(s=>({...s,ui:{...s.ui,viewingReport:r.id}}))});_mapRepsLyr.addLayer(m)}})},
  ctrUser(){if(!_map||!navigator.geolocation)return showToast("Geolocation not supported by your browser.", 'warning');navigator.geolocation.getCurrentPosition(p=>{const ll=[p.coords.latitude,p.coords.longitude];_map.setView(ll,13);L.marker(ll).addTo(_map).bindPopup("You").openPopup()},e=>showToast(`GPS Error: ${e.message}`, 'error'))},
  searchLoc:async q=>{if(!_map)return;try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`),d=await r.json();if(d?.length>0){const{lat,lon,display_name}=d[0];_map.setView([parseFloat(lat),parseFloat(lon)],12);L.popup().setLatLng([parseFloat(lat),parseFloat(lon)]).setContent(display_name).openOn(_map);showToast(`Location found: ${display_name}`, 'success')}else showToast("Location not found.", 'info')}catch(e){showToast(`Location search error: ${e.message}`, 'error')}},
  enPickLoc:cb=>{if(!_map)return;const mc=$('#map-container');mc.style.cursor='crosshair';showToast("Click on the map to pick a location.", 'info');_map.once('click',e=>{mc.style.cursor='';cb(e.latlng)})},
  disPickLoc:()=>{if($('#map-container'))$('#map-container').style.cursor='';if(_map)_map.off('click')},
  get:()=>_map,
};

export const imgSvc={ /* imgSvc: imageUploadService */
  async upload(file){
    const {imgHost,nip96Host,nip96Token}=appStore.get().settings;
    if(!file.type.startsWith('image/'))throw new Error('Invalid file type. Only images are allowed.');
    if(file.size>C.IMG_SIZE_LIMIT_BYTES)throw new Error(`File too large (max ${C.IMG_SIZE_LIMIT_BYTES/1024/1024}MB).`);
    
    let uploadUrl = imgHost;
    let headers = {};
    let body;

    if(nip96Host){ // NIP-96
        uploadUrl = nip96Host;
        if(nip96Token) headers['Authorization'] = `Bearer ${nip96Token}`;
        body = file; // NIP-96 often expects raw file data
        headers['Content-Type'] = file.type; // Set content type for raw body
    } else if (!imgHost || imgHost === C.IMG_UPLOAD_NOSTR_BUILD) { // Default to nostr.build
        uploadUrl = C.IMG_UPLOAD_NOSTR_BUILD;
        const fd = new FormData();
        fd.append('file', file); // nostr.build expects 'file' in FormData
        body = fd;
    } else { // Custom host, assume FormData
        const fd = new FormData();
        fd.append('file', file);
        body = fd;
    }

    try{
        const r=await fetch(uploadUrl,{method:'POST',body:body,headers});
        if(!r.ok)throw new Error(`Upload failed: ${r.status} ${await r.text()}`);
        const d=await r.json();
        
        let finalUrl = d.url || d.uri || d.link || (Array.isArray(d.data) && d.data[0]?.url) || (d.data?.url);
        if (!finalUrl && typeof d === 'string' && d.startsWith('http')) finalUrl = d; // Some NIP-96 return plain URL
        if (!finalUrl) throw new Error('Image URL not found in response from host.');
        
        return finalUrl;
    }catch(e){
        console.error("Image upload error:",e);
        throw new Error(`Image upload failed: ${e.message}`);
    }
  }
};
