import {C} from './utils.js';

let _s = {
    user: null,
    online: navigator.onLine,
    focusTags: [{ tag: C.FOCUS_TAG_DEFAULT, active: true }],
    currentFocusTag: C.FOCUS_TAG_DEFAULT,
    reports: [],
    relays: C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?', nip11: null })),
    followedPubkeys: [],
    settings: {
        tileUrl: C.TILE_SERVER_DEFAULT,
        tilePreset: 'OpenStreetMap',
        cats: ['Incident', 'Observation', 'Aid', 'Info'],
        mute: [],
        imgHost: C.IMG_UPLOAD_NOSTR_BUILD,
        nip96Host: '',
        nip96Token: ''
    },
    map: null,
    mapBnds: null,
    mapGhs: [],
    drawnShapes: [],
    ui: {
        modalOpen: null,
        loading: false,
        syncMsg: '',
        spatialFilterEnabled: false,
        followedOnlyFilter: false,
        filters: { q: '', cat: '', auth: '', tStart: null, tEnd: null }
    }
};

const _l = new Set();

export const appStore = {
    get: (key) => key ? _s[key] : { ..._s },
    set: (updater) => {
        const oldState = { ..._s };
        _s = typeof updater === 'function' ? { ..._s, ...updater(_s) } : { ..._s, ...updater };
        _l.forEach(listener => listener(_s, oldState));
    },
    on: (listener) => {
        _l.add(listener);
        listener(_s);
        return () => _l.delete(listener);
    }
};

window.addEventListener('online', () => appStore.set({ online: true }));
window.addEventListener('offline', () => appStore.set({ online: false }));
