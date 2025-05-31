import { C } from './utils.js';
let _s={user:null,online:navigator.onLine,focusTag:C.FOCUS_TAG_DEFAULT,reports:[],relays:C.RELAYS_DEFAULT.map(u=>({url:u,read:!0,write:!0,status:'?',nip11:null})),settings:{tile:C.TILE_SERVER_DEFAULT,cats:['Incident','Observation','Aid','Info'],mute:[],imgHost:C.IMG_UPLOAD_NOSTR_BUILD,nip96Host:'',nip96Token:''},map:null,mapBnds:null,mapGhs:[],ui:{modal:null,loading:!1,syncMsg:''}}; /* s: state */
const _l=new Set(); /* l: listeners */
export const appStore={
get:k=>k?_s[k]:{..._s},
set:u=>{const oS={..._s};_s=typeof u==='function'?{..._s,...u(_s)}:{..._s,...u};_l.forEach(l=>l(_s,oS))},
on:(l)=>{_l.add(l);l(_s);return()=>_l.delete(l)}
};
window.addEventListener('online',()=>appStore.set({online:!0}));
window.addEventListener('offline',()=>appStore.set({online:!1}));
