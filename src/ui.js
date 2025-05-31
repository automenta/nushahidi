import { marked } from 'marked';
import { appStore } from './store.js';
import { mapSvc, idSvc, confSvc, nostrSvc, imgSvc, dbSvc } from './services.js';
import { C, $, $$, createEl, showModal, hideModal, sanitizeHTML, debounce, geohashEncode, sha256, getImgDims, formatNpubShort, npubToHex, showToast } from './utils.js';

const gE=(id,p=document)=>$(id,p); /* gE: getElement */
const cE=(t,a,c)=>createEl(t,a,c); /* cE: createElement */
const sH=s=>sanitizeHTML(s); /* sH: sanitizeHTML */

// --- UI State & General Updates ---
const updAuthDisp=pk=>{const b=gE('#auth-button'),s=gE('#user-pubkey');if(pk){b.textContent='Logout';s.textContent=`User: ${formatNpubShort(pk)}`;s.style.display='inline'}else{b.textContent='Connect Nostr';s.style.display='none'}};
const updConnDisp=isOnline=>{const e=gE('#connection-status');if(e){e.textContent=isOnline?'Online':'Offline';e.style.color=isOnline?'lightgreen':'lightcoral'}};
const updSyncDisp=async()=>{const e=gE('#sync-status');if(!e)return;try{const q=await dbSvc.getOfflineQ();if(q.length>0){e.textContent=`Syncing (${q.length})...`;e.style.color='orange'}else{e.textContent=appStore.get().online?'Synced':'Offline';e.style.color='lightgreen'}}catch{e.textContent='Sync status err';e.style.color='red'}};

// --- Generic Confirmation Modal ---
let _confirmModalRoot;
function showConfirmModal(title, message, onConfirm, onCancel) {
    if (!_confirmModalRoot) {
        _confirmModalRoot = cE('div', { class: 'modal-content' });
        gE('#confirm-modal').appendChild(_confirmModalRoot);
    }
    _confirmModalRoot.innerHTML = ''; // Clear previous content

    const closeBtn = cE('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => { hideModal('confirm-modal'); if (onCancel) onCancel(); } });
    const heading = cE('h2', { id: 'confirm-modal-heading', textContent: title });
    const msgPara = cE('p', { innerHTML: message });
    const buttonContainer = cE('div', { class: 'confirm-modal-buttons' });

    const confirmBtn = cE('button', {
        class: 'confirm-button',
        textContent: 'Confirm',
        onclick: () => { hideModal('confirm-modal'); onConfirm(); }
    });
    const cancelBtn = cE('button', {
        class: 'cancel-button',
        textContent: 'Cancel',
        onclick: () => { hideModal('confirm-modal'); if (onCancel) onCancel(); }
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);

    _confirmModalRoot.appendChild(closeBtn);
    _confirmModalRoot.appendChild(heading);
    _confirmModalRoot.appendChild(msgPara);
    _confirmModalRoot.appendChild(buttonContainer);

    showModal('confirm-modal', 'confirm-modal-heading');
}


// --- Report Detail Interactions ---
async function loadAndDisplayInteractions(reportId, reportPk, container) {
    container.innerHTML = '<h4>Interactions</h4><div class="spinner"></div>';
    appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading for interactions
    try {
        const interactions = await nostrSvc.fetchInteractions(reportId, reportPk);
        let html = '<h4>Interactions</h4>';
        if (interactions.length === 0) {
            html += '<p>No interactions yet.</p>';
        } else {
            interactions.forEach(i => {
                const interactionUser = formatNpubShort(i.pubkey);
                const interactionTime = new Date(i.created_at * 1000).toLocaleString();
                if (i.kind === C.NOSTR_KIND_REACTION) { // Simple reaction
                    html += `<div class="interaction-item"><strong>${sH(interactionUser)}</strong> reacted: ${sH(i.content)} <small>(${interactionTime})</small></div>`;
                } else if (i.kind === C.NOSTR_KIND_NOTE) { // Text note comment
                    html += `<div class="interaction-item"><strong>${sH(interactionUser)}</strong> commented: <div class="markdown-content">${marked.parse(sH(i.content))}</div> <small>(${interactionTime})</small></div>`;
                }
            });
        }
        // Add reaction buttons and comment form
        html += `<div class="reaction-buttons" style="margin-top:0.5rem;">
            <button data-report-id="${sH(reportId)}" data-report-pk="${sH(reportPk)}" data-reaction="+">👍 Like</button>
            <button data-report-id="${sH(reportId)}" data-report-pk="${sH(reportPk)}" data-reaction="-">👎 Dislike</button>
        </div>`;
        html += `<form id="comment-form" data-report-id="${sH(reportId)}" data-report-pk="${sH(reportPk)}" style="margin-top:0.5rem;">
            <textarea name="comment" placeholder="Add a public comment..." rows="2" required></textarea>
            <button type="submit">Post Comment</button>
        </form>`;
        container.innerHTML = html;

        // Add event listeners for new buttons/forms
        $$('.reaction-buttons button', container).forEach(btn => btn.onclick = handleReactionSubmit);
        $('#comment-form', container)?.addEventListener('submit', handleCommentSubmit);

        // Update local report with fetched interactions (if needed for caching)
        appStore.set(s => {
            const reportIndex = s.reports.findIndex(rep => rep.id === reportId);
            if (reportIndex > -1) {
                const updatedReports = [...s.reports];
                updatedReports[reportIndex] = { ...updatedReports[reportIndex], interactions: interactions };
                return { reports: updatedReports };
            }
            return {};
        });
    } catch (e) {
        showToast(`Error loading interactions: ${e.message}`, 'error');
        container.innerHTML = `<h4>Interactions</h4><p style="color:red;">Failed to load interactions: ${sH(e.message)}</p>`;
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
}

async function handleReactionSubmit(event) {
    const btn = event.target;
    const reportId = btn.dataset.reportId;
    const reportPk = btn.dataset.reportPk;
    const reactionContent = btn.dataset.reaction;
    if (!appStore.get().user) return showToast("Please connect your Nostr identity to react.", 'warning');
    try {
        btn.disabled = true;
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        await nostrSvc.pubEv({
            kind: C.NOSTR_KIND_REACTION,
            content: reactionContent,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
        showToast("Reaction sent!", 'success');
        // Refresh interactions, or wait for subscription update
        const report = appStore.get().reports.find(r => r.id === reportId);
        if (report) showReportDetails(report); // Re-render detail view which calls loadAndDisplayInteractions
    } catch (e) { showToast(`Error sending reaction: ${e.message}`, 'error'); }
    finally { 
        btn.disabled = false; 
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
}

async function handleCommentSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const reportId = form.dataset.reportId;
    const reportPk = form.dataset.reportPk;
    const commentText = form.elements.comment.value.trim();
    if (!commentText) return showToast("Comment cannot be empty.", 'warning');
    if (!appStore.get().user) return showToast("Please connect your Nostr identity to comment.", 'warning');
    try {
        submitBtn.disabled = true;
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        await nostrSvc.pubEv({
            kind: C.NOSTR_KIND_NOTE,
            content: commentText,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
        showToast("Comment sent!", 'success');
        form.reset();
        // Refresh interactions for this report
        const report = appStore.get().reports.find(r => r.id === reportId);
        if (report) showReportDetails(report); // Re-render detail view which calls loadAndDisplayInteractions
    } catch (e) { showToast(`Error sending comment: ${e.message}`, 'error'); }
    finally { 
        submitBtn.disabled = false; 
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
}


// --- MODAL COMPONENTS (Implementations) ---
// ReportForm
let _repFormRoot,_pFLoc,_uIMeta=[]; /* pFLoc: pickedFileLocation, uIMeta: uploadedImageMetadata */
function RepFormComp(){_repFormRoot=cE('div',{class:'modal-content'});const cats=appStore.get().settings.cats;const fEs=[cE('span',{class:'close-btn',innerHTML:'&times;','data-modal-id':'report-form-modal',onclick:()=>hideModal('report-form-modal')}),cE('h2',{id:'report-form-heading',textContent:'New Report'}),cE('form',{id:'nstr-rep-form'},[cE('label',{for:'rep-title',textContent:'Title:'}),cE('input',{type:'text',id:'rep-title',name:'title'}),cE('label',{for:'rep-sum',textContent:'Summary:'}),cE('input',{type:'text',id:'rep-sum',name:'summary',required:!0}),cE('label',{for:'rep-desc',textContent:'Description (MD):'}),cE('textarea',{id:'rep-desc',name:'description',required:!0,rows:3}),cE('label',{textContent:'Location:'}),cE('div',{id:'map-pick-area'},['Selected: ',cE('span',{id:'pFLoc-coords',textContent:'None'})]),cE('button',{type:'button',id:'pick-loc-map-btn',textContent:'Pick Location'}),cE('button',{type:'button',id:'use-gps-loc-btn',textContent:'Use GPS'}),cE('label',{for:'rep-address',textContent:'Or Enter Address:'}),cE('input',{type:'text',id:'rep-address',name:'address',placeholder:'e.g., 1600 Amphitheatre Pkwy'}),cE('button',{type:'button',id:'geocode-address-btn',textContent:'Geocode Address'}),cE('label',{textContent:'Categories:'}),cE('div',{id:'cats-cont-form'},cats.map(c=>cE('label',{},[cE('input',{type:'checkbox',name:'category',value:c}),` ${sH(c)}`]))),cE('label',{for:'rep-ftags',textContent:'Add. Tags (comma-sep):'}),cE('input',{type:'text',id:'rep-ftags',name:'freeTags'}),cE('label',{for:'rep-evType',textContent:'Event Type:'}),cE('select',{id:'rep-evType',name:'eventType'},['Observation','Incident','Request','Offer','Other'].map(t=>cE('option',{value:t.toLowerCase(),textContent:t}))),cE('label',{for:'rep-stat',textContent:'Status:'}),cE('select',{id:'rep-stat',name:'status'},['New','Active','Needs Verification'].map(t=>cE('option',{value:t.toLowerCase().replace(' ','_'),textContent:t}))),cE('label',{for:'rep-photos',textContent:'Photos (max 5MB each):'}),cE('input',{type:'file',id:'rep-photos',multiple:!0,accept:'image/*'}),cE('div',{id:'upld-photos-preview'}),cE('p',{class:'warning',textContent:'Reports are public on Nostr.'}),cE('button',{type:'submit',textContent:'Submit'}),cE('button',{type:'button',class:'secondary',textContent:'Cancel',onclick:()=>hideModal('report-form-modal')})])];fEs.forEach(e=>_repFormRoot.appendChild(e));
gE('#pick-loc-map-btn',_repFormRoot).onclick=()=>{hideModal('report-form-modal');mapSvc.enPickLoc(ll=>{_pFLoc=ll;gE('#pFLoc-coords',_repFormRoot).textContent=`${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}`;showModal('report-form-modal','rep-title')})};
gE('#use-gps-loc-btn',_repFormRoot).onclick=()=>{if(!navigator.geolocation)return showToast("GPS not supported by your browser.", 'warning');navigator.geolocation.getCurrentPosition(p=>{_pFLoc={lat:p.coords.latitude,lng:p.coords.longitude};gE('#pFLoc-coords',_repFormRoot).textContent=`${_pFLoc.lat.toFixed(5)},${_pFLoc.lng.toFixed(5)}`},e=>showToast(`GPS Error: ${e.message}`, 'error'))};
gE('#geocode-address-btn',_repFormRoot).onclick=async()=>{
    const address = gE('#rep-address',_repFormRoot).value.trim();
    if (!address) return showToast("Please enter an address to geocode.", 'warning');
    appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
        const d = await r.json();
        if (d?.length > 0) {
            const {lat, lon, display_name} = d[0];
            _pFLoc = {lat: parseFloat(lat), lng: parseFloat(lon)};
            gE('#pFLoc-coords',_repFormRoot).textContent=`${_pFLoc.lat.toFixed(5)},${_pFLoc.lng.toFixed(5)} (${sH(display_name)})`;
            showToast(`Address found: ${display_name}`, 'success');
        } else {
            showToast("Address not found.", 'info');
        }
    } catch (e) {
        showToast(`Geocoding error: ${e.message}`, 'error');
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
};
gE('#rep-photos',_repFormRoot).onchange=async e=>{
    const fs=e.target.files,pEl=gE('#upld-photos-preview',_repFormRoot);
    pEl.innerHTML='Processing...';
    _uIMeta=[];
    appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading for image upload
    try {
        for(const f of fs){
            try{
                if(f.size>C.IMG_SIZE_LIMIT_BYTES)throw new Error(`Max ${C.IMG_SIZE_LIMIT_BYTES/1024/1024}MB`);
                const b=await f.arrayBuffer(),h=await sha256(b),d=await getImgDims(f),uR=await imgSvc.upload(f);
                _uIMeta.push({url:uR,type:f.type,dim:`${d.w}x${d.h}`,hHex:h});
                pEl.innerHTML+=`<p>${sH(f.name)} ready</p>`;
                showToast(`Image ${f.name} uploaded.`, 'success', 1500);
            }catch(er){
                pEl.innerHTML+=`<p style="color:red;">${sH(f.name)} Err: ${er.message}</p>`;
                showToast(`Failed to upload ${f.name}: ${er.message}`, 'error');
            }
        }
        if(_uIMeta.length>0&&pEl.innerHTML.startsWith('Processing...'))pEl.innerHTML=pEl.innerHTML.substring(13);
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
};
gE('form',_repFormRoot).onsubmit=async e=>{
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type=submit]');
    const fD=new FormData(e.target),d=Object.fromEntries(fD.entries());
    if(!_pFLoc)return showToast("Location missing. Please pick or geocode a location.", 'warning');
    
    submitBtn.disabled=!0;
    appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading for report submission
    try{
        const lat=_pFLoc.lat,lon=_pFLoc.lng,gh=geohashEncode(lat,lon),fT=appStore.get().currentFocusTag.substring(1),tags=[['g',gh]];
        if(d.title)tags.push(['title',d.title]);
        if(d.summary)tags.push(['summary',d.summary]);
        if(fT&&fT!=='NostrMapper_Global')tags.push(['t',fT]);
        if(d.freeTags)d.freeTags.split(',').forEach(t=>{const tr=t.trim();if(tr)tags.push(['t',tr.replace(/^#/,'')])});
        $$('input[name="category"]:checked',e.target).forEach(cb=>{tags.push(['L','report-category']);tags.push(['l',cb.value,'report-category'])});
        if(d.eventType)tags.push(['event_type',d.eventType]);
        if(d.status)tags.push(['status',d.status]);
        _uIMeta.forEach(i=>tags.push(['image',i.url,i.type,i.dim,`ox${i.hHex}`]));
        const evD={kind:C.NOSTR_KIND_REPORT,content:d.description,tags};
        
        await nostrSvc.pubEv(evD);
        showToast('Report sent!', 'success');
        e.target.reset();
        gE('#pFLoc-coords',_repFormRoot).textContent='None';
        gE('#upld-photos-preview',_repFormRoot).innerHTML='';
        _pFLoc=null;_uIMeta=[];
        hideModal('report-form-modal');
    }catch(er){
        showToast(`Report submission error: ${er.message}`, 'error');
    }finally{
        submitBtn.disabled=!1;
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
};
_pFLoc=null;_uIMeta=[];if(gE('#pFLoc-coords',_repFormRoot))gE('#pFLoc-coords',_repFormRoot).textContent='None';if(gE('#upld-photos-preview',_repFormRoot))gE('#upld-photos-preview',_repFormRoot).innerHTML='';if(gE('form',_repFormRoot))gE('form',_repFormRoot).reset();return _repFormRoot}

// AuthModal
function AuthModalComp(){const r=cE('div',{class:'modal-content'});const c=[cE('span',{class:'close-btn',innerHTML:'&times;',onclick:()=>hideModal('auth-modal')}),cE('h2',{id:'auth-modal-heading',textContent:'Nostr Identity'}),cE('p',{},[cE('strong',{textContent:'Recommended: '}),'Use NIP-07 (Alby, etc.)']),cE('button',{id:'conn-nip07-btn',textContent:'Connect NIP-07'}),cE('hr'),cE('h4',{textContent:'Local Keys (Advanced/Risky)'}),cE('div',{class:'critical-warning',innerHTML:'<p><strong>SECURITY WARNING:</strong> Storing keys in browser is risky. Backup private key (nsec)!</p>'}),cE('label',{for:'auth-pass',textContent:'Passphrase (min 8 chars):'}),cE('input',{type:'password',id:'auth-pass',autocomplete:'new-password'}),cE('button',{id:'create-prof-btn',textContent:'Create New Profile'}),cE('hr'),cE('label',{for:'auth-sk',textContent:'Import Private Key (nsec/hex):'}),cE('input',{type:'text',id:'auth-sk'}),cE('button',{id:'import-sk-btn',textContent:'Import Key'}),cE('button',{type:'button',class:'secondary',textContent:'Cancel',onclick:()=>hideModal('auth-modal'),style:'margin-top:1rem'})];c.forEach(e=>r.appendChild(e));
gE('#conn-nip07-btn',r).onclick=async()=>{
    appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
    try {
        await idSvc.nip07();
        if(appStore.get().user)hideModal('auth-modal');
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
};
gE('#create-prof-btn',r).onclick=async()=>{
    const p=gE('#auth-pass',r).value;
    if (!p || p.length < 8) {
        showToast("Passphrase too short (min 8 chars).", 'warning');
        return;
    }
    showConfirmModal(
        "Backup Private Key?",
        "<strong>CRITICAL:</strong> You are about to create a new Nostr identity. Your private key (nsec) will be generated and displayed. You MUST copy and securely back it up. If you lose it, your identity and associated data will be unrecoverable. Do you understand and wish to proceed?",
        async () => {
            appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
            try {
                const res=await idSvc.newProf(p);
                if(res)hideModal('auth-modal');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
            }
        },
        () => showToast("New profile creation cancelled.", 'info')
    );
};
gE('#import-sk-btn',r).onclick=async()=>{
    const sk=gE('#auth-sk',r).value,p=gE('#auth-pass',r).value;
    if (!sk || !p || p.length < 8) {
        showToast("Private key and passphrase (min 8 chars) are required.", 'warning');
        return;
    }
    showConfirmModal(
        "Import Private Key?",
        "<strong>HIGH RISK:</strong> Importing a private key directly into the browser is generally discouraged due to security risks. Ensure you understand the implications. It is highly recommended to use a NIP-07 browser extension instead. Do you wish to proceed?",
        async () => {
            appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
            try {
                const res=await idSvc.impSk(sk,p);
                if(res)hideModal('auth-modal');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
            }
        },
        () => showToast("Private key import cancelled.", 'info')
    );
};return r}

// SettingsPanel
function SettPanComp(){
    const r=cE('div',{class:'modal-content',style:'max-width:700px'});
    const s=appStore.get();
    const c=[
        cE('span',{class:'close-btn',innerHTML:'&times;',onclick:()=>hideModal('settings-modal')}),
        cE('h2',{id:'settings-modal-heading',textContent:'Settings'}),
        cE('section',{},[
            cE('h3',{textContent:'Relays'}),
            cE('div',{id:'rly-list'}),
            cE('input',{type:'url',id:'new-rly-url',placeholder:'wss://new.relay.com'}),
            cE('button',{id:'add-rly-btn',textContent:'Add Relay'}),
            cE('button',{id:'save-rlys-btn',textContent:'Save & Reconnect Relays'})
        ]),
        cE('hr'),
        s.user&&(s.user.authM==='local'||s.user.authM==='import')?cE('section',{},[
            cE('h3',{textContent:'Local Key Mgt'}),
            cE('button',{id:'exp-sk-btn',textContent:'Export Private Key'}),
            cE('br'),
            cE('label',{for:'chg-pass-old',textContent:'Old Pass:'}),
            cE('input',{type:'password',id:'chg-pass-old'}),
            cE('label',{for:'chg-pass-new',textContent:'New Pass:'}),
            cE('input',{type:'password',id:'chg-pass-new'}),
            cE('button',{id:'chg-pass-btn',textContent:'Change Passphrase'})
        ]):cE('div'),
        cE('hr'),
        cE('section',{},[ // Focus Tags Section
            cE('h3',{textContent:'Focus Tags'}),
            cE('div',{id:'focus-tag-list'}),
            cE('input',{type:'text',id:'new-focus-tag-input',placeholder:'#NewFocusTag'}),
            cE('button',{id:'add-focus-tag-btn',textContent:'Add Focus Tag'}),
            cE('button',{id:'save-focus-tags-btn',textContent:'Save Focus Tags'})
        ]),
        cE('hr'),
        cE('section',{},[
            cE('h3',{textContent:'Categories'}),
            cE('div',{id:'cat-list'}),
            cE('input',{type:'text',id:'new-cat-name',placeholder:'New Category'}),
            cE('button',{id:'add-cat-btn',textContent:'Add Category'}),
            cE('button',{id:'save-cats-btn',textContent:'Save Categories'})
        ]),
        cE('hr'),
        cE('section',{},[ // Map Tiles Section
            cE('h3',{textContent:'Map Tiles'}),
            cE('label',{for:'tile-preset-sel',textContent:'Tile Server Preset:'}),
            cE('select',{id:'tile-preset-sel'},
                C.TILE_SERVERS_PREDEFINED.map(p => cE('option',{value:p.name,textContent:p.name}))
            ),
            cE('label',{for:'tile-url-in',textContent:'Custom Tile URL Template:'}),
            cE('input',{type:'url',id:'tile-url-in',value:s.settings.tileUrl}),
            cE('button',{id:'save-tile-btn',textContent:'Save Tiles'})
        ]),
        cE('hr'),
        cE('section',{},[
            cE('h3',{textContent:'Image Host'}),
            cE('label',{for:'img-host-sel',textContent:'Provider:'}),
            cE('select',{id:'img-host-sel'},[cE('option',{value:C.IMG_UPLOAD_NOSTR_BUILD,textContent:'nostr.build (Default)'}),cE('option',{value:'nip96',textContent:'NIP-96 Server'})]),
            cE('div',{id:'nip96-fields',style:s.settings.nip96Host?'':'display:none'},[cE('label',{for:'nip96-url-in',textContent:'NIP-96 Server URL:'}),cE('input',{type:'url',id:'nip96-url-in',value:s.settings.nip96Host,placeholder:'https://your.nip96.server'}),cE('label',{for:'nip96-token-in',textContent:'NIP-96 Auth Token (Optional):'}),cE('input',{type:'text',id:'nip96-token-in',value:s.settings.nip96Token})]),
            cE('button',{id:'save-img-host-btn',textContent:'Save Image Host'})
        ]),
        cE('hr'),
        cE('section',{},[ // Mute List Section
            cE('h3',{textContent:'Mute List'}),
            cE('div',{id:'mute-list'}),
            cE('input',{type:'text',id:'new-mute-pk-input',placeholder:'npub... or hex pubkey'}),
            cE('button',{id:'add-mute-btn',textContent:'Add to Mute List'}),
            cE('button',{id:'save-mute-list-btn',textContent:'Save Mute List'})
        ]),
        cE('hr'),
        cE('section',{},[
            cE('h3',{textContent:'Data Mgt'}),
            cE('button',{id:'clr-reps-btn',textContent:'Clear Cached Reports'}),
            cE('button',{id:'exp-setts-btn',textContent:'Export Settings'}),
            cE('label',{for:'imp-setts-file',textContent:'Import Settings:'}),
            cE('input',{type:'file',id:'imp-setts-file',accept:'.json'})
        ]),
        cE('button',{type:'button',class:'secondary',textContent:'Close',onclick:()=>hideModal('settings-modal'),style:'margin-top:1rem'})
    ];
    c.forEach(e=>r.appendChild(e));

    // Render functions for lists
    const rendRlys=()=>{const l=gE('#rly-list',r);l.innerHTML='';appStore.get().relays.forEach((rly,i)=>{l.appendChild(cE('div',{class:'relay-entry'},[cE('input',{type:'url',class:'rly-url-in',value:rly.url,readOnly:!0}),cE('label',{},[cE('input',{type:'checkbox',class:'rly-read-cb',checked:rly.read,'data-idx':i}),'R']),cE('label',{},[cE('input',{type:'checkbox',class:'rly-write-cb',checked:rly.write,'data-idx':i}),'W']),cE('label',{},[cE('input',{type:'checkbox',class:'rly-nip52-cb',checked:rly.nip11?.supported_nips?.includes(52)||rly.supportsNip52,'data-idx':i}),'N52?']),cE('span',{class:'rly-stat',textContent:`(${rly.status})${rly.nip11?" NIPs:"+ (rly.nip11.supported_nips || []).join(',').substring(0,20)+'...':''}`}),cE('button',{class:'remove-relay-btn','data-idx':i,textContent:'X'})]))})};rendRlys();
    const rendCats=()=>{const l=gE('#cat-list',r);l.innerHTML='';appStore.get().settings.cats.forEach((cat,i)=>{l.appendChild(cE('div',{class:'category-entry'},[cE('input',{type:'text',class:'cat-name-in',value:cat,readOnly:!0}),cE('button',{class:'remove-category-btn','data-idx':i,textContent:'X'})]))})};rendCats();
    const rendFocusTags=()=>{const l=gE('#focus-tag-list',r);l.innerHTML='';appStore.get().focusTags.forEach((ft,i)=>{l.appendChild(cE('div',{class:'focus-tag-entry'},[cE('label',{},[cE('input',{type:'radio',name:'active-focus-tag',value:ft.tag,checked:ft.active,'data-idx':i}),` ${sH(ft.tag)}`]),cE('button',{class:'remove-focus-tag-btn','data-idx':i,textContent:'X'})]))})};rendFocusTags();
    const rendMuteList=()=>{const l=gE('#mute-list',r);l.innerHTML='';appStore.get().settings.mute.forEach((pk,i)=>{l.appendChild(cE('div',{class:'mute-entry'},[cE('span',{textContent:formatNpubShort(pk)}),cE('button',{class:'remove-mute-btn','data-idx':i,textContent:'X'})]))})};rendMuteList();

    // Event Listeners
    gE('#rly-list',r).onclick=e=>{const t=e.target;const idx=parseInt(t.dataset.idx);let rlys=[...appStore.get().relays];if(t.classList.contains('remove-relay-btn')){rlys.splice(idx,1)}else if(t.classList.contains('rly-read-cb')){rlys[idx].read=t.checked}else if(t.classList.contains('rly-write-cb')){rlys[idx].write=t.checked}else if(t.classList.contains('rly-nip52-cb')){rlys[idx].supportsNip52=t.checked}appStore.set({relays:rlys});rendRlys()};
    gE('#add-rly-btn',r).onclick=()=>{const u=gE('#new-rly-url',r).value.trim();if(u){appStore.set(s=>({relays:[...s.relays,{url:u,read:!0,write:!0,status:'?',nip11:null,supportsNip52:false}]}));gE('#new-rly-url',r).value='';rendRlys()}};
    gE('#save-rlys-btn',r).onclick=()=>{confSvc.setRlys(appStore.get().relays);nostrSvc.discAllRlys();nostrSvc.connRlys();showToast("Relays saved and reconnected.", 'success')};

    if(gE('#exp-sk-btn',r))gE('#exp-sk-btn',r).onclick=async()=>{
        const sk=await idSvc.getSk();
        if(sk) {
            showToast(
                `Your private key (nsec) has been copied to clipboard.`,
                'warning',
                5000, // Show for 5 seconds
                nip19.nsecEncode(sk) // Pass the value to be copied
            );
        } else {
            showToast("Could not retrieve private key. Passphrase might be needed.", 'error');
        }
    };
    if(gE('#chg-pass-btn',r))gE('#chg-pass-btn',r).onclick=async()=>{
        const o=gE('#chg-pass-old',r).value,n=gE('#chg-pass-new',r).value;
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        try{
            await idSvc.chgPass(o,n);
            gE('#chg-pass-old',r).value = '';
            gE('#chg-pass-new',r).value = '';
        }catch(e){
            showToast(e.message, 'error');
        } finally {
            appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
        }
    };

    gE('#focus-tag-list',r).onclick=e=>{
        const t=e.target;
        const idx=parseInt(t.dataset.idx);
        let focusTags=[...appStore.get().focusTags];
        if(t.classList.contains('remove-focus-tag-btn')){
            if(focusTags.length === 1) return showToast("Cannot remove the last focus tag.", 'warning');
            const removedTag = focusTags[idx].tag;
            focusTags.splice(idx,1);
            if(removedTag === appStore.get().currentFocusTag){ // If removed active tag, set first as active
                focusTags[0].active = true;
                confSvc.setCurrentFocusTag(focusTags[0].tag);
            }
            confSvc.setFocusTags(focusTags);
        } else if(t.name === 'active-focus-tag'){
            focusTags.forEach((ft,i)=>ft.active=(i===idx));
            confSvc.setFocusTags(focusTags);
            confSvc.setCurrentFocusTag(focusTags[idx].tag);
        }
        rendFocusTags();
    };
    gE('#add-focus-tag-btn',r).onclick=()=>{
        let newTag = gE('#new-focus-tag-input',r).value.trim();
        if (!newTag) return showToast("Focus tag cannot be empty.", 'warning');
        if (!newTag.startsWith('#')) newTag = `#${newTag}`;
        const focusTags = [...appStore.get().focusTags];
        if (focusTags.some(ft => ft.tag === newTag)) return showToast("Tag already exists.", 'warning');
        focusTags.push({tag:newTag, active:false});
        confSvc.setFocusTags(focusTags);
        gE('#new-focus-tag-input',r).value='';
        rendFocusTags();
    };
    gE('#save-focus-tags-btn',r).onclick=()=>{
        confSvc.setFocusTags(appStore.get().focusTags); // Ensure saved
        nostrSvc.refreshSubs(); // Resubscribe with potentially new active tag
        showToast("Focus tags saved.", 'success');
    };

    gE('#cat-list',r).onclick=e=>{if(e.target.classList.contains('remove-category-btn')){const idx=parseInt(e.target.dataset.idx),cats=[...appStore.get().settings.cats];cats.splice(idx,1);appStore.set(s=>({...s,settings:{...s.settings,cats}}));rendCats()}};
    gE('#add-cat-btn',r).onclick=()=>{const n=gE('#new-cat-name',r).value.trim();if(n){appStore.set(s=>({...s,settings:{...s.settings,cats:[...s.settings.cats,n]}}));gE('#new-cat-name',r).value='';rendCats()}};
    gE('#save-cats-btn',r).onclick=()=>{confSvc.setCats(appStore.get().settings.cats);showToast("Categories saved.", 'success')};

    gE('#tile-preset-sel',r).onchange=e=>{
        const selectedPresetName = e.target.value;
        const selectedPreset = C.TILE_SERVERS_PREDEFINED.find(p => p.name === selectedPresetName);
        if (selectedPreset) {
            gE('#tile-url-in',r).value = selectedPreset.url;
            confSvc.setTilePreset(selectedPreset.name, selectedPreset.url);
            mapSvc.updTile(selectedPreset.url);
        } else { // Should not happen if options are from predefined list
            gE('#tile-url-in',r).value = '';
            confSvc.setTilePreset('Custom', '');
        }
    };
    // Set initial value for preset selector
    gE('#tile-preset-sel',r).value = s.settings.tilePreset;
    if (gE('#tile-preset-sel',r).value !== s.settings.tilePreset) { // If current URL is custom, set preset to Custom
        gE('#tile-preset-sel',r).value = 'Custom';
        const customOption = cE('option', {value: 'Custom', textContent: 'Custom'});
        gE('#tile-preset-sel',r).appendChild(customOption);
    }

    gE('#save-tile-btn',r).onclick=()=>{
        const u=gE('#tile-url-in',r).value.trim();
        const p=gE('#tile-preset-sel',r).value;
        if(u){
            confSvc.setTileUrl(u); // This also sets preset to 'Custom'
            mapSvc.updTile(u);
            showToast("Tile server saved.", 'success');
        } else {
            showToast("Tile URL cannot be empty.", 'warning');
        }
    };

    gE('#img-host-sel',r).onchange=e=>{const nip96Fields=gE('#nip96-fields',r);nip96Fields.style.display=e.target.value==='nip96'?'block':'none';if(e.target.value!==C.IMG_UPLOAD_NOSTR_BUILD)gE('#nip96-url-in',r).value=appStore.get().settings.nip96Host||'';else gE('#nip96-url-in',r).value='';gE('#nip96-token-in',r).value=appStore.get().settings.nip96Token||'';};
    gE('#save-img-host-btn',r).onclick=()=>{const sel=gE('#img-host-sel',r).value;if(sel==='nip96'){const h=gE('#nip96-url-in',r).value.trim(),t=gE('#nip96-token-in',r).value.trim();if(!h)return showToast("NIP-96 URL required.", 'warning');confSvc.setImgHost(h,!0,t)}else{confSvc.setImgHost(C.IMG_UPLOAD_NOSTR_BUILD)}showToast("Image host saved.", 'success')};

    gE('#mute-list',r).onclick=e=>{
        if(e.target.classList.contains('remove-mute-btn')){
            const idx=parseInt(e.target.dataset.idx);
            let muteList=[...appStore.get().settings.mute];
            muteList.splice(idx,1);
            confSvc.rmMute(appStore.get().settings.mute[idx]); // Use the service to update
            rendMuteList();
        }
    };
    gE('#add-mute-btn',r).onclick=async()=>{
        let pkInput = gE('#new-mute-pk-input',r).value.trim();
        if (!pkInput) return showToast("Pubkey cannot be empty.", 'warning');
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        try {
            const pkHex = npubToHex(pkInput); // Convert npub to hex if needed
            if (!isNostrId(pkHex)) throw new Error("Invalid Nostr ID format.");
            confSvc.addMute(pkHex);
            gE('#new-mute-pk-input',r).value='';
            rendMuteList();
            showToast("Pubkey added to mute list.", 'success');
        } catch (e) {
            showToast(`Error adding pubkey to mute list: ${e.message}`, 'error');
        } finally {
            appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
        }
    };
    gE('#save-mute-list-btn',r).onclick=()=>{
        // Mute list is saved immediately by addMute/rmMute, this button just confirms
        showToast("Mute list saved.", 'success');
    };


    gE('#clr-reps-btn',r).onclick=async()=>{
        showConfirmModal(
            "Clear All Cached Reports?",
            "Are you sure you want to clear ALL cached reports from your device? This action cannot be undone.",
            async () => {
                await dbSvc.clearReps();
                appStore.set({reports:[]});
                showToast("All cached reports cleared.", 'success');
            },
            () => showToast("Clearing reports cancelled.", 'info')
        );
    };
    gE('#exp-setts-btn',r).onclick=async()=>{
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        try {
            const s=await dbSvc.loadSetts();
            if(s){
                const j=JSON.stringify(s,null,2),b=new Blob([j],{type:'application/json'}),u=URL.createObjectURL(b),a=cE('a',{href:u,download:'nm-setts.json'});
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(u);
                showToast("Settings exported.", 'success');
            } else {
                showToast("No settings to export.", 'info');
            }
        } catch (e) {
            showToast(`Error exporting settings: ${e.message}`, 'error');
        } finally {
            appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
        }
    };
    gE('#imp-setts-file',r).onchange=async e=>{
        const f=e.target.files[0];
        if(f){
            appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
            const rdr=new FileReader();
            rdr.onload=async ev=>{
                try{
                    const iS=JSON.parse(ev.target.result);
                    if(iS.rls&&iS.tileUrl){
                        await confSvc.save(iS);
                        showToast("Settings imported. Reconnecting relays...", 'success');
                        nostrSvc.discAllRlys();
                        nostrSvc.connRlys();
                        mapSvc.updTile(iS.tileUrl);
                        hideModal('settings-modal');
                        setTimeout(()=>{$('#settings-btn').click()},100)/*reopen to refresh*/
                    } else {
                        throw new Error("Invalid settings file format.");
                    }
                }catch(er){
                    showToast(`Import error: ${er.message}`, 'error');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
                }
            };
            rdr.readAsText(f);
            e.target.value=''
        }
    };
    return r
}

// --- Report List & Detail ---
const rendRepCard=r=>{const s=r.sum||(r.ct?r.ct.substring(0,100)+'...':'N/A');return`<div class="report-card" data-rep-id="${sH(r.id)}" role="button" tabindex="0" aria-labelledby="card-title-${r.id}">
<h3 id="card-title-${r.id}">${sH(r.title||'Report')}</h3><p>${sH(s)}</p>
<small>By: ${formatNpubShort(r.pk)} | ${new Date(r.at*1000).toLocaleDateString()}</small>
<small>Cats: ${r.cat.map(sH).join(', ')||'N/A'}</small></div>`};

const showReportDetails=async r=>{
    const dC=gE('#report-detail-container'),lC=gE('#report-list-container');
    if(!dC||!lC)return;
    lC.style.display='none';
    
    const imgsHTML=(r.imgs||[]).map(i=>`<img src="${sH(i.url)}" alt="report image" style="max-width:100%;margin:.3rem 0;border-radius:4px;">`).join('');
    const descHTML=marked.parse(sH(r.ct||''));
    
    dC.innerHTML=`<button id="back-to-list-btn" class="small-button">&lt; List</button><h2 id="detail-title">${sH(r.title||'Report')}</h2>
    <p><strong>By:</strong> <a href="https://njump.me/${nip19.npubEncode(r.pk)}" target="_blank" rel="noopener noreferrer">${formatNpubShort(r.pk)}</a></p>
    <p><strong>Date:</strong> ${new Date(r.at*1000).toLocaleString()}</p>
    <p><strong>Summary:</strong> ${sH(r.sum||'N/A')}</p>
    <p><strong>Description:</strong></p><div class="markdown-content" tabindex="0">${descHTML}</div>
    ${imgsHTML?`<h3>Images:</h3>${imgsHTML}`:''}
    <p><strong>Location:</strong> ${r.lat?.toFixed(5)}, ${r.lon?.toFixed(5)} (Geohash: ${sH(r.gh||'N/A')})</p>
    <div id="mini-map-det" style="height:150px;margin-top:.7rem;border:1px solid #ccc"></div>
    <div class="interactions" id="interactions-for-${r.id}">Loading interactions...</div>`;
    
    dC.style.display='block';
    dC.focus();
    gE('#back-to-list-btn',dC).onclick=()=>{dC.style.display='none';lC.style.display='block'};
    
    if(r.lat&&r.lon&&typeof L!=='undefined'){
        const mm=L.map('mini-map-det').setView([r.lat,r.lon],13);
        L.tileLayer(confSvc.getTileServer(),{attribution:'&copy; OSM'}).addTo(mm);
        // Invalidate size to ensure map renders correctly in a hidden div
        setTimeout(() => { mm.invalidateSize(); }, 0);
    }
    loadAndDisplayInteractions(r.id, r.pk, gE(`#interactions-for-${r.id}`, dC));
};

const rendRepList=reps=>{const lE=gE('#report-list'),lC=gE('#report-list-container');if(!lE||!lC)return;lE.innerHTML='';if(reps.length>0){reps.forEach(r=>{const cW=cE('div');cW.innerHTML=rendRepCard(r);const cEl=cW.firstElementChild;cEl.onclick=()=>showReportDetails(r);cEl.onkeydown=e=>(e.key==='Enter'||e.key===' ')?showReportDetails(r):null;lE.appendChild(cEl)});lC.style.display='block'}else{lE.innerHTML='<p>No reports match filters.</p>';lC.style.display='block'}};

// --- Filtering ---
let _cFilt={q:'',fT:'',cat:'',auth:'',tStart:null,tEnd:null}; /* cFilt: currentFilters */
const appAllFilt=()=>{const allR=appStore.get().reports,mute=appStore.get().settings.mute;const filtR=allR.filter(r=>{if(mute.includes(r.pk))return!1;const fTMatch=_cFilt.fT?.startsWith('#')?_cFilt.fT.substring(1):_cFilt.fT;if(fTMatch&&fTMatch!=='NostrMapper_Global'&&!r.fTags.includes(fTMatch))return!1;if(_cFilt.q){const q=_cFilt.q.toLowerCase();if(!(r.title?.toLowerCase().includes(q)||r.sum?.toLowerCase().includes(q)||r.ct?.toLowerCase().includes(q)))return!1}if(_cFilt.cat&&!r.cat.includes(_cFilt.cat))return!1;if(_cFilt.auth){const aH=npubToHex(_cFilt.auth);if(r.pk!==aH)return!1}if(_cFilt.tStart&&r.at<_cFilt.tStart)return!1;if(_cFilt.tEnd&&r.at>_cFilt.tEnd)return!1;return!0}).sort((a,b)=>b.at-a.at);rendRepList(filtR);mapSvc.updReps(filtR)};
const debAppAllFilt=debounce(appAllFilt,350);

// --- Init UI ---
export function initUI(){
gE('#create-report-btn').onclick=()=>{gE('#report-form-modal').innerHTML='';gE('#report-form-modal').appendChild(RepFormComp());showModal('report-form-modal','rep-title')};
gE('#auth-button').onclick=()=>{
    if(appStore.get().user){
        showConfirmModal(
            "Logout Confirmation",
            "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.",
            () => idSvc.logout(),
            () => showToast("Logout cancelled.", 'info')
        );
    }else{
        gE('#auth-modal').innerHTML='';
        gE('#auth-modal').appendChild(AuthModalComp());
        showModal('auth-modal','conn-nip07-btn');
    }
};
gE('#settings-btn').onclick=()=>{gE('#settings-modal').innerHTML='';gE('#settings-modal').appendChild(SettPanComp());showModal('settings-modal')};

// Initialize focus tag filter display
_cFilt.fT=appStore.get().currentFocusTag;
gE('#focus-tag-input').value=_cFilt.fT;

// Main filter event listeners
gE('#search-query-input').oninput=e=>{_cFilt.q=e.target.value;debAppAllFilt()};
// The focus tag input in the main UI is now just a display of the current active tag
// The setting/changing of focus tags happens in the settings modal
gE('#set-focus-tag-btn').style.display = 'none'; // Hide the old set button
gE('#focus-tag-input').readOnly = true; // Make it read-only

const popFiltCats=()=>{const s=gE('#filter-category');s.innerHTML='<option value="">All</option>';appStore.get().settings.cats.forEach(c=>s.appendChild(cE('option',{value:c,textContent:sH(c)})))};popFiltCats();
gE('#filter-category').onchange=e=>{_cFilt.cat=e.target.value;appAllFilt()};
gE('#filter-author').oninput=e=>{_cFilt.auth=e.target.value.trim();debAppAllFilt()};
gE('#filter-time-start').onchange=e=>{_cFilt.tStart=e.target.value?new Date(e.target.value).getTime()/1000:null;appAllFilt()};
gE('#filter-time-end').onchange=e=>{_cFilt.tEnd=e.target.value?new Date(e.target.value).getTime()/1000:null;appAllFilt()};
gE('#apply-filters-btn').onclick=appAllFilt;
gE('#reset-filters-btn').onclick=()=>{_cFilt={q:'',fT:appStore.get().currentFocusTag,cat:'',auth:'',tStart:null,tEnd:null};gE('#search-query-input').value='';gE('#focus-tag-input').value=_cFilt.fT;gE('#filter-category').value='';gE('#filter-author').value='';gE('#filter-time-start').value='';gE('#filter-time-end').value='';appAllFilt()};

appStore.on((s,oS)=>{
    updAuthDisp(s.user?.pk);
    updConnDisp(s.online);
    updSyncDisp();
    if(s.reports!==oS?.reports||s.settings.mute!==oS?.settings?.mute||s.currentFocusTag!==oS?.currentFocusTag){ // Listen to currentFocusTag
        if(s.currentFocusTag!==_cFilt.fT){
            _cFilt.fT=s.currentFocusTag;
            gE('#focus-tag-input').value=_cFilt.fT;
        }
        appAllFilt()
    }
    if(s.settings.cats!==oS?.settings?.cats)popFiltCats();
    if(s.ui.modalOpen&&!oS?.ui?.modalOpen&&gE(`#${s.ui.modalOpen}`))gE(`#${s.ui.modalOpen}`).focus();
    if(s.ui.viewingReport && s.ui.viewingReport !== oS?.ui?.viewingReport){
        const rep=s.reports.find(r=>r.id===s.ui.viewingReport);
        if(rep)showReportDetails(rep)
    }
    // New: Global Loading Spinner visibility
    const globalSpinner = gE('#global-loading-spinner');
    if (globalSpinner) {
        globalSpinner.style.display = s.ui.loading ? 'flex' : 'none';
    }
});
// Onboarding
if (!localStorage.getItem(C.ONBOARDING_KEY)) {
    showModal('onboarding-info');
    localStorage.setItem(C.ONBOARDING_KEY, 'true'); // Set it after showing
}
} // End initUI
