import { C } from './utils.js';

let _s = {
    user: null,
    online: navigator.onLine,
    focusTags: [{ tag: C.FOCUS_TAG_DEFAULT, active: true }], // Array of objects for focus tags
    currentFocusTag: C.FOCUS_TAG_DEFAULT, // Currently active focus tag string
    reports: [],
    relays: C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?', nip11: null })),
    followedPubkeys: [], // Stores public keys of followed users
    settings: {
        tileUrl: C.TILE_SERVER_DEFAULT,
        tilePreset: 'OpenStreetMap', // Stores the name of the selected tile preset
        cats: ['Incident', 'Observation', 'Aid', 'Info'],
        mute: [],
        imgHost: C.IMG_UPLOAD_NOSTR_BUILD,
        nip96Host: '',
        nip96Token: ''
    },
    map: null,
    mapBnds: null,
    mapGhs: [],
    drawnShapes: [], // Stores GeoJSON of drawn shapes
    ui: {
        modalOpen: null, // ID of the currently open modal, or null
        loading: false, // Global loading indicator
        syncMsg: '',
        spatialFilterEnabled: false, // Is spatial filtering active?
        followedOnlyFilter: false // Is "show only followed users" filter active?
    }
};

const _l = new Set(); // Listeners

export const appStore = {
    get: (key) => key ? _s[key] : { ..._s },
    set: (updater) => {
        const oldState = { ..._s };
        _s = typeof updater === 'function' ? { ..._s, ...updater(_s) } : { ..._s, ...updater };
        _l.forEach(listener => listener(_s, oldState));
    },
    on: (listener) => {
        _l.add(listener);
        listener(_s); // Immediately call with current state
        return () => _l.delete(listener); // Return unsubscribe function
    }
};

// Update online status based on browser events
window.addEventListener('online', () => appStore.set({ online: true }));
window.addEventListener('offline', () => appStore.set({ online: false }));
