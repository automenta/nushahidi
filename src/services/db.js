import { appStore } from '../store.js';
import { C, showToast } from '../utils.js';

let _db;

const getDbStore = async (storeName, mode = 'readonly') => {
    if (!_db) {
        _db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(C.DB_NAME, C.DB_VERSION);
            request.onerror = e => reject(e.target.error);
            request.onsuccess = e => resolve(e.target.result);
            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(C.STORE_REPORTS)) db.createObjectStore(C.STORE_REPORTS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(C.STORE_PROFILES)) db.createObjectStore(C.STORE_PROFILES, { keyPath: 'pk' });
                if (!db.objectStoreNames.contains(C.STORE_SETTINGS)) db.createObjectStore(C.STORE_SETTINGS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(C.STORE_OFFLINE_QUEUE)) db.createObjectStore(C.STORE_OFFLINE_QUEUE, { autoIncrement: true, keyPath: 'qid' });
                if (!db.objectStoreNames.contains(C.STORE_DRAWN_SHAPES)) db.createObjectStore(C.STORE_DRAWN_SHAPES, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(C.STORE_FOLLOWED_PUBKEYS)) db.createObjectStore(C.STORE_FOLLOWED_PUBKEYS, { keyPath: 'pk' });
            };
        });
    }
    return _db.transaction(storeName, mode).objectStore(storeName);
};

const createDbStoreCrud = (storeName) => ({
    get: async id => (await getDbStore(storeName)).get(id),
    getAll: async () => (await getDbStore(storeName)).getAll(),
    add: async item => (await getDbStore(storeName, 'readwrite')).put(item),
    rm: async id => (await getDbStore(storeName, 'readwrite')).delete(id),
    clear: async () => (await getDbStore(storeName, 'readwrite')).clear(),
});

export const dbSvc = {
    ...createDbStoreCrud(C.STORE_REPORTS),
    ...createDbStoreCrud(C.STORE_PROFILES),
    ...createDbStoreCrud(C.STORE_SETTINGS),
    ...createDbStoreCrud(C.STORE_OFFLINE_QUEUE),
    ...createDbStoreCrud(C.STORE_DRAWN_SHAPES),
    ...createDbStoreCrud(C.STORE_FOLLOWED_PUBKEYS),

    saveSetts: async s => (await getDbStore(C.STORE_SETTINGS, 'readwrite')).put({ id: 'appSettings', ...s }),
    loadSetts: async () => (await getDbStore(C.STORE_SETTINGS)).get('appSettings'),
    addOfflineQ: async e => (await getDbStore(C.STORE_OFFLINE_QUEUE, 'readwrite')).add(e),
    rmOfflineQ: async qid => (await getDbStore(C.STORE_OFFLINE_QUEUE, 'readwrite')).delete(qid),
    addFollowedPubkey: async (pk) => (await getDbStore(C.STORE_FOLLOWED_PUBKEYS, 'readwrite')).put({ pk, followedAt: Date.now() }),
    rmFollowedPubkey: async (pk) => (await getDbStore(C.STORE_FOLLOWED_PUBKEYS, 'readwrite')).delete(pk),

    async pruneDb() {
        const now = Date.now();

        const allReports = await this.getAllReps();
        if (allReports.length > C.DB_PRUNE_REPORTS_MAX) {
            const sortedReports = allReports.sort((a, b) => b.at - a.at);
            const toDelete = sortedReports.slice(C.DB_PRUNE_REPORTS_MAX);
            const store = await getDbStore(C.STORE_REPORTS, 'readwrite');
            for (const rep of toDelete) {
                await store.delete(rep.id);
            }
            showToast(`Pruned ${toDelete.length} old reports.`, 'info');
        }

        const allProfiles = await this.getAllProfiles();
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
    }
};
