import { C } from './utils.js';
let _s={
    user:null,
    online:navigator.onLine,
    focusTags:[{tag:C.FOCUS_TAG_DEFAULT,active:true}], // Changed to array of objects
    currentFocusTag:C.FOCUS_TAG_DEFAULT, // New: stores the currently active focus tag string
    reports:[],
    relays:C.RELAYS_DEFAULT.map(u=>({url:u,read:!0,write:!0,status:'?',nip11:null})),
    settings:{
        tileUrl:C.TILE_SERVER_DEFAULT, // Changed from 'tile' to 'tileUrl'
        tilePreset:'OpenStreetMap', // New: stores the name of the selected tile preset
        cats:['Incident','Observation','Aid','Info'],
        mute:[],
        imgHost:C.IMG_UPLOAD_NOSTR_BUILD,
        nip96Host:'',
        nip96Token:''
    },
    map:null,
    mapBnds:null,
    mapGhs:[],
    ui:{modalOpen:null,loading:!1,syncMsg:''} // Changed 'modal' to 'modalOpen' for consistency
}; /* s: state */
const _l=new Set(); /* l: listeners */
export const appStore={
get:k=>k?_s[k]:{..._s},
set:u=>{const oS={..._s};_s=typeof u==='function'?{..._s,...u(_s)}:{..._s,...u};_l.forEach(l=>l(_s,oS))},
on:(l)=>{_l.add(l);l(_s);return()=>_l.delete(l)}
};
window.addEventListener('online',()=>appStore.set({online:!0}));
window.addEventListener('offline',()=>appStore.set({online:!1}));
