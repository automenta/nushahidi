import {C, showToast} from '../utils.js';

let _db;

const getDbStore = async (storeName, mode = 'readonly') => {
    if (!_db) {
        _db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(C.DB_NAME, C.DB_VERSION);
            request.onerror = e => reject(e.target.error);
            request.onsuccess = e => resolve(e.target.result);
            request.onupgradeneeded = e => {
                const db = e.target.result;
                const storeConfigs = {
                    [C.STORE_REPORTS]: { keyPath: 'id' },
                    [C.STORE_PROFILES]: { keyPath: 'pk' },
                    [C.STORE_SETTINGS]: { keyPath: 'id' },
                    [C.STORE_OFFLINE_QUEUE]: { keyPath: 'qid', autoIncrement: true },
                    [C.STORE_DRAWN_SHAPES]: { keyPath: 'id' },
                    [C.STORE_FOLLOWED_PUBKEYS]: { keyPath: 'pk' }
                };
                for (const store of Object.keys(storeConfigs)) {
                    if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, storeConfigs[store]);
                }
            };
        });
    }
    return _db.transaction(storeName, mode).objectStore(storeName);
};

const createDbStoreCrud = storeName => ({
    get: async id => (await getDbStore(storeName)).get(id),
    getAll: async () => (await getDbStore(storeName)).getAll(),
    add: async item => (await getDbStore(storeName, 'readwrite')).put(item),
    rm: async id => (await getDbStore(storeName, 'readwrite')).delete(id),
    clear: async () => (await getDbStore(storeName, 'readwrite')).clear(),
});

export const dbSvc = {
    getRep: createDbStoreCrud(C.STORE_REPORTS).get,
    getAllReps: createDbStoreCrud(C.STORE_REPORTS).getAll,
    addRep: createDbStoreCrud(C.STORE_REPORTS).add,
    rmRep: createDbStoreCrud(C.STORE_REPORTS).rm,
    clearReps: createDbStoreCrud(C.STORE_REPORTS).clear,

    getProf: createDbStoreCrud(C.STORE_PROFILES).get,
    getAllProfiles: createDbStoreCrud(C.STORE_PROFILES).getAll,
    addProf: createDbStoreCrud(C.STORE_PROFILES).add,
    rmProf: createDbStoreCrud(C.STORE_PROFILES).rm,
    clearProfiles: createDbStoreCrud(C.STORE_PROFILES).clear,

    getSettings: createDbStoreCrud(C.STORE_SETTINGS).get,
    getAllSettings: createDbStoreCrud(C.STORE_SETTINGS).getAll,
    addSettings: createDbStoreCrud(C.STORE_SETTINGS).add,
    rmSettings: createDbStoreCrud(C.STORE_SETTINGS).rm,
    clearSettings: createDbStoreCrud(C.STORE_SETTINGS).clear,

    getOfflineQ: createDbStoreCrud(C.STORE_OFFLINE_QUEUE).getAll,
    addOfflineQ: createDbStoreCrud(C.STORE_OFFLINE_QUEUE).add,
    rmOfflineQ: createDbStoreCrud(C.STORE_OFFLINE_QUEUE).rm,
    clearOfflineQ: createDbStoreCrud(C.STORE_OFFLINE_QUEUE).clear,

    getDrawnShape: createDbStoreCrud(C.STORE_DRAWN_SHAPES).get,
    getAllDrawnShapes: createDbStoreCrud(C.STORE_DRAWN_SHAPES).getAll,
    addDrawnShape: createDbStoreCrud(C.STORE_DRAWN_SHAPES).add,
    rmDrawnShape: createDbStoreCrud(C.STORE_DRAWN_SHAPES).rm,
    clearDrawnShapes: createDbStoreCrud(C.STORE_DRAWN_SHAPES).clear,

    getFollowedPubkeys: createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS).getAll,
    addFollowedPubkey: createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS).add,
    rmFollowedPubkey: createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS).rm,
    clearFollowedPubkeys: createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS).clear,

    saveSetts: async s => (await getDbStore(C.STORE_SETTINGS, 'readwrite')).put({ id: 'appSettings', ...s }),
    loadSetts: async () => (await getDbStore(C.STORE_SETTINGS)).get('appSettings'),

    async pruneDb() {
        const now = Date.now();

        const allReports = await this.getAllReps();
        if (allReports.length > C.DB_PRUNE_REPORTS_MAX) {
            const toDelete = allReports.sort((a, b) => b.at - a.at).slice(C.DB_PRUNE_REPORTS_MAX);
            const store = await getDbStore(C.STORE_REPORTS, 'readwrite');
            for (const rep of toDelete) await store.delete(rep.id);
            showToast(`Pruned ${toDelete.length} old reports.`, 'info');
        }

        const rawProfiles = await this.getAllProfiles();
        const allProfiles = Array.isArray(rawProfiles) ? rawProfiles : [];
        const profileStore = await getDbStore(C.STORE_PROFILES, 'readwrite');
        let profilesDeleted = 0;
        for (const prof of allProfiles) {
            if (prof.fetchedAt && (now - prof.fetchedAt) > (C.DB_PRUNE_PROFILES_MAX_AGE_DAYS * 24 * 60 * 60 * 1000)) {
                await profileStore.delete(prof.pk);
                profilesDeleted++;
            }
        }
        if (profilesDeleted > 0) showToast(`Pruned ${profilesDeleted} old profiles.`, 'info');
    }
};
