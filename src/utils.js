import { nip19 } from 'nostr-tools';
import ngeohash from 'ngeohash';

export const C = { // Constants
    NOSTR_KIND_REPORT: 30315, NOSTR_KIND_REACTION: 7, NOSTR_KIND_NOTE: 1, NOSTR_KIND_PROFILE: 0,
    RELAYS_DEFAULT: ['wss://relay.damus.io','wss://relay.snort.social','wss://nostr.wine','wss://nos.lol'],
    TILE_SERVER_DEFAULT: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    TILE_SERVERS_PREDEFINED: [ // New: Predefined tile servers
        {name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'},
        {name: 'Stamen Toner', url: 'http://stamen-tiles-{s}.a.ssl.fastly.net/toner/{z}/{x}/{y}.png'},
        {name: 'Stamen Terrain', url: 'http://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}.png'},
        {name: 'ESRI World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'}
    ],
    FOCUS_TAG_DEFAULT: '#NostrMapper_Global',
    DB_NAME: 'NostrMapperDB_vFinal', DB_VERSION: 1,
    STORE_REPORTS: 'reports', STORE_PROFILES: 'profiles', STORE_SETTINGS: 'settings', STORE_OFFLINE_QUEUE: 'offlineQueue',
    IMG_UPLOAD_NOSTR_BUILD: 'https://nostr.build/api/v2/upload/files',
    IMG_SIZE_LIMIT_BYTES: 5 * 1024 * 1024, // 5MB
    ONBOARDING_KEY: 'nostrmapper_onboarded_v1',
    // New: DB Pruning Constants
    DB_PRUNE_REPORTS_MAX: 5000, // Max number of reports to keep
    DB_PRUNE_PROFILES_MAX_AGE_DAYS: 30 // Max age for profiles in days
};
export const $ = (s,p=document)=>p.querySelector(s);
export const $$ = (s,p=document)=>Array.from(p.querySelectorAll(s));
export function createEl(t,a={},c=[]){const e=document.createElement(t);Object.entries(a).forEach(([k,v])=>{if(k.startsWith('on')&&typeof v==='function')e.addEventListener(k.substring(2).toLowerCase(),v);else if(typeof v==='boolean')v?e.setAttribute(k,''):e.removeAttribute(k);else if(k==='textContent')e.textContent=v;else if(k==='innerHTML')e.innerHTML=v;else e.setAttribute(k,v)});(Array.isArray(c)?c:[c]).forEach(ch=>{if(typeof ch==='string')e.appendChild(document.createTextNode(ch));else if(ch instanceof Node)e.appendChild(ch)});return e}
export const showModal=(id, focusElId)=>{const m=$(`#${id}`);if(m){m.style.display='block';m.setAttribute('aria-hidden','false');if(focusElId)$(focusElId,m)?.focus()}appStore.set(s=>({...s,ui:{...s.ui,modalOpen:id}}))};
export const hideModal=(id)=>{const m=$(`#${id}`);if(m){m.style.display='none';m.setAttribute('aria-hidden','true')}appStore.set(s=>({...s,ui:{...s.ui,modalOpen:null}}))};
export const sanitizeHTML=s=>(s==null?'':String(s).replace(/[&<>"']/g,m=>{return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]}));
const CRYPTO={ALG:'AES-GCM',IV_L:12,SALT_L:16,ITER:1e5};
async function deriveKey(p,s){const kM=await crypto.subtle.importKey('raw',new TextEncoder().encode(p),{name:'PBKDF2'},!1,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:s,iterations:CRYPTO.ITER,hash:'SHA-256'},kM,{name:CRYPTO.ALG,length:256},!0,['encrypt','decrypt'])}
export async function encrypt(d,p){const s=crypto.getRandomValues(new Uint8Array(CRYPTO.SALT_L)),i=crypto.getRandomValues(new Uint8Array(CRYPTO.IV_L)),k=await deriveKey(p,s),eD=await crypto.subtle.encrypt({name:CRYPTO.ALG,iv:i},k,new TextEncoder().encode(d)),r=new Uint8Array(s.length+i.length+eD.byteLength);r.set(s,0);r.set(i,s.length);r.set(new Uint8Array(eD),s.length+i.length);return btoa(String.fromCharCode(...r))}
export async function decrypt(eDS,p){try{const eDB=Uint8Array.from(atob(eDS),c=>c.charCodeAt(0)),s=eDB.slice(0,CRYPTO.SALT_L),i=eDB.slice(CRYPTO.SALT_L,CRYPTO.SALT_L+CRYPTO.IV_L),d=eDB.slice(CRYPTO.SALT_L+CRYPTO.IV_L),k=await deriveKey(p,s),dC=await crypto.subtle.decrypt({name:CRYPTO.ALG,iv:i},k,d);return new TextDecoder().decode(dC)}catch(e){throw new Error('Decryption failed.')}}
export async function sha256(b){const hB=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(hB)).map(b=>b.toString(16).padStart(2,'0')).join('')}
export const nsecToHex=s=>s.startsWith('nsec')?nip19.decode(s).data:s;
export const npubToHex=p=>p.startsWith('npub')?nip19.decode(p).data:p;
export const geohashEncode=(lat,lon,prec=7)=>ngeohash.encode(lat,lon,prec);
export const geohashDecode=gStr=>ngeohash.decode(gStr);
export function parseReport(e){const t={id:e.id,pk:e.pubkey,at:e.created_at,tags:e.tags,ct:e.content,title:e.tags.find(t=>t[0]==='title')?.[1]||'',sum:e.tags.find(t=>t[0]==='summary')?.[1]||'',gh:e.tags.find(t=>t[0]==='g')?.[1],cat:e.tags.filter(t=>t[0]==='l'&&t[2]==='report-category').map(t=>t[1]),fTags:e.tags.filter(t=>t[0]==='t').map(t=>t[1]),imgs:e.tags.filter(t=>t[0]==='image').map(tg=>({url:tg[1],type:tg[2],dim:tg[3],hash:tg[4]})),evType:e.tags.find(t=>t[0]==='event_type')?.[1],stat:e.tags.find(t=>t[0]==='status')?.[1]||'new',lat:null,lon:null,interactions:[]};if(t.gh){const{latitude,longitude}=geohashDecode(t.gh);t.lat=latitude;t.lon=longitude}return t}
export const getGhPrefixes=(b,minP=4,maxP=6)=>{if(!b)return[];const c=b.getCenter(),p=new Set();for(let i=minP;i<=maxP;i++)p.add(ngeohash.encode(c.lat,c.lng,i));return Array.from(p)}
export const debounce=(fn,dl)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),dl)}};
export const getImgDims=f=>new Promise((rs,rj)=>{const i=new Image();i.onload=()=>rs({w:i.width,h:i.height});i.onerror=rj;i.src=URL.createObjectURL(f)});
export const formatNpubShort = pk => nip19.npubEncode(pk).substring(0,12)+'...';
export const isNostrId = id => /^[0-9a-f]{64}$/.test(id);

// New: Toast Notification System
export function showToast(message, type = 'info', duration = 3000, valueToCopy = null) {
    const toastContainer = $('#toast-container');
    if (!toastContainer) {
        console.warn('Toast container not found. Message:', message);
        return;
    }

    const toast = createEl('div', { class: `toast toast-${type}` });
    toast.appendChild(createEl('span', { textContent: message })); // Wrap message in a span

    if (valueToCopy) {
        const copyButton = createEl('button', {
            class: 'copy-button',
            textContent: 'Copy'
        });
        copyButton.onclick = async () => {
            try {
                await navigator.clipboard.writeText(valueToCopy);
                showToast('Copied to clipboard!', 'success', 1500);
            } catch (err) {
                console.error('Failed to copy:', err);
                showToast('Failed to copy to clipboard.', 'error', 1500);
            }
        };
        toast.appendChild(copyButton);
    }

    toastContainer.appendChild(toast);

    // Force reflow to enable CSS transition
    void toast.offsetWidth;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

// New: URL validation helper
export const isValidUrl = (string) => {
    try {
        new URL(string);
        return true;
    } catch (e) {
        return false;
    }
};
