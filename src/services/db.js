import {C} from '../utils.js';

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

                for (const storeName in storeConfigs) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName, storeConfigs[storeName]);
                    }
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

    saveSetts: async s => (await getDbStore(C.STORE_SETTINGS, 'readwrite')).put({ id: 'appSettings', ...s }),
    loadSetts: async () => (await getDbStore(C.STORE_SETTINGS)).get('appSettings'),

    getOfflineQ: createDbStoreCrud(C.STORE_OFFLINE_QUEUE).getAll,
    addOfflineQ: createDbStoreCrud(C.STORE_OFFLINE_QUEUE).add,
    rmOfflineQ: createDbStoreCrud(C.STORE_OFFLINE_QUEUE).rm,

    getDrawnShape: createDbStoreCrud(C.STORE_DRAWN_SHAPES).get,
    getAllDrawnShapes: createDbStoreCrud(C.STORE_DRAWN_SHAPES).getAll,
    addDrawnShape: createDbStoreCrud(C.STORE_DRAWN_SHAPES).add,
    rmDrawnShape: createDbStoreCrud(C.STORE_DRAWN_SHAPES).rm,
    clearDrawnShapes: createDbStoreCrud(C.STORE_DRAWN_SHAPES).clear,

    getFollowedPubkeys: createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS).getAll,
    addFollowedPubkey: createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS).add,
    rmFollowedPubkey: createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS).rm,
    clearFollowedPubkeys: createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS).clear,

    async pruneDb() {
        const allReports = await this.getAllReps();
        if (allReports.length > C.DB_PRUNE_REPORTS_MAX) {
            const sortedReports = allReports.sort((a, b) => b.at - a.at);
            for (let i = C.DB_PRUNE_REPORTS_MAX; i < sortedReports.length; i++) {
                await this.rmRep(sortedReports[i].id);
            }
        }

        const allProfiles = await this.getAllProfiles();
        // Ensure allProfiles is an array before iterating
        const profilesToPrune = Array.isArray(allProfiles) ? allProfiles : [];
        const thirtyDaysAgo = Date.now() / 1000 - (C.DB_PRUNE_PROFILES_MAX_AGE_DAYS * 24 * 60 * 60);
        for (const profile of profilesToPrune) {
            if (profile.at < thirtyDaysAgo) {
                await createDbStoreCrud(C.STORE_PROFILES).rm(profile.pk);
            }
        }
    }
};
