import L from 'leaflet';
import 'leaflet.markercluster'; // Import the MarkerCluster plugin
// L.Draw is typically global after its script is loaded, no explicit import needed here if using CDN
import { generatePrivateKey as genSk, getPublicKey as getPk, nip19, getEventHash as getEvH, signEvent as signEvNostr, relayInit, nip11 } from 'nostr-tools';
import { appStore } from './store.js';
import { C, $, encrypt, decrypt, sha256, npubToHex, geohashEncode, parseReport, getGhPrefixes, nsecToHex, isNostrId, showToast, generateUUID } from './utils.js';
import { showPassphraseModal, showConfirmModal } from './ui.js'; // Import the new modal function

let _db; /* db instance */

/**
 * Gets an IndexedDB object store. Opens the database if not already open.
 * @param {string} storeName - The name of the object store.
 * @param {IDBTransactionMode} mode - The transaction mode ('readonly' or 'readwrite').
 * @returns {Promise<IDBObjectStore>} The IndexedDB object store.
 */
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
                if (!db.objectStoreNames.contains(C.STORE_DRAWN_SHAPES)) db.createObjectStore(C.STORE_DRAWN_SHAPES, { keyPath: 'id' }); // New store for drawn shapes
                if (!db.objectStoreNames.contains(C.STORE_FOLLOWED_PUBKEYS)) db.createObjectStore(C.STORE_FOLLOWED_PUBKEYS, { keyPath: 'pk' }); // New store for followed pubkeys
            };
        });
    }
    return _db.transaction(storeName, mode).objectStore(storeName);
};

export const dbSvc = { /* dbSvc: dbService */
    getRep: async id => (await getDbStore(C.STORE_REPORTS)).get(id),
    getAllReps: async () => (await getDbStore(C.STORE_REPORTS)).getAll(),
    addRep: async r => (await getDbStore(C.STORE_REPORTS, 'readwrite')).put(r),
    rmRep: async id => (await getDbStore(C.STORE_REPORTS, 'readwrite')).delete(id), // Added for deletion
    clearReps: async () => (await getDbStore(C.STORE_REPORTS, 'readwrite')).clear(),
    getProf: async pk => (await getDbStore(C.STORE_PROFILES)).get(pk),
    addProf: async p => (await getDbStore(C.STORE_PROFILES, 'readwrite')).put(p),
    saveSetts: async s => (await getDbStore(C.STORE_SETTINGS, 'readwrite')).put({ id: 'appSettings', ...s }),
    loadSetts: async () => (await getDbStore(C.STORE_SETTINGS)).get('appSettings'),
    addOfflineQ: async e => (await getDbStore(C.STORE_OFFLINE_QUEUE, 'readwrite')).add(e),
    getOfflineQ: async () => (await getDbStore(C.STORE_OFFLINE_QUEUE)).getAll(),
    rmOfflineQ: async qid => (await getDbStore(C.STORE_OFFLINE_QUEUE, 'readwrite')).delete(qid),
    // New: Methods for drawn shapes
    addDrawnShape: async shape => (await getDbStore(C.STORE_DRAWN_SHAPES, 'readwrite')).put(shape),
    getAllDrawnShapes: async () => (await getDbStore(C.STORE_DRAWN_SHAPES)).getAll(),
    rmDrawnShape: async id => (await getDbStore(C.STORE_DRAWN_SHAPES, 'readwrite')).delete(id),
    clearDrawnShapes: async () => (await getDbStore(C.STORE_DRAWN_SHAPES, 'readwrite')).clear(),
    // New: Methods for followed pubkeys
    getFollowedPubkeys: async () => (await getDbStore(C.STORE_FOLLOWED_PUBKEYS)).getAll(),
    addFollowedPubkey: async (pk) => (await getDbStore(C.STORE_FOLLOWED_PUBKEYS, 'readwrite')).put({ pk, followedAt: Date.now() }),
    rmFollowedPubkey: async (pk) => (await getDbStore(C.STORE_FOLLOWED_PUBKEYS, 'readwrite')).delete(pk),
    clearFollowedPubkeys: async () => (await getDbStore(C.STORE_FOLLOWED_PUBKEYS, 'readwrite')).clear(),

    /**
     * Prunes old reports and profiles from IndexedDB to manage storage.
     */
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
        const allProfiles = await getDbStore(C.STORE_PROFILES).getAll();
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

export const confSvc = { /* confSvc: configService */
    /**
     * Loads application settings from IndexedDB and initializes appStore.
     * Handles migrations for old settings formats.
     */
    async load() {
        let settings = await dbSvc.loadSetts();
        let followedPubkeys = await dbSvc.getFollowedPubkeys(); // New: Load followed pubkeys

        // Initialize with defaults if no settings found
        if (!settings) {
            settings = {
                rls: C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?', nip11: null })),
                tileUrl: C.TILE_SERVER_DEFAULT,
                tilePreset: 'OpenStreetMap',
                focusTags: [{ tag: C.FOCUS_TAG_DEFAULT, active: true }],
                cats: ['Incident', 'Observation', 'Aid'],
                mute: [],
                id: null,
                imgH: C.IMG_UPLOAD_NOSTR_BUILD,
                nip96H: '',
                nip96T: ''
            };
        }

        // Ensure backward compatibility and proper initialization for relays
        settings.rls = settings.rls || C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?', nip11: null }));
        settings.rls.forEach(r => {
            if (r.status === undefined) r.status = '?';
            if (r.nip11 === undefined) r.nip11 = null;
        });

        // Handle focus tag migration from string to array of objects
        if (typeof settings.focus === 'string') {
            settings.focusTags = [{ tag: settings.focus, active: true }];
            delete settings.focus; // Remove old property
        } else if (!settings.focusTags || settings.focusTags.length === 0) {
            settings.focusTags = [{ tag: C.FOCUS_TAG_DEFAULT, active: true }];
        }
        const currentFocusTag = settings.focusTags.find(t => t.active)?.tag || C.FOCUS_TAG_DEFAULT;

        // Handle tile server migration
        settings.tileUrl = settings.tileUrl || settings.tile || C.TILE_SERVER_DEFAULT;
        settings.tilePreset = settings.tilePreset || (settings.tile === C.TILE_SERVER_DEFAULT ? 'OpenStreetMap' : 'Custom');
        delete settings.tile; // Remove old property

        // New: Handle followed pubkeys migration/initialization
        if (!followedPubkeys) {
            followedPubkeys = [];
        }

        appStore.set({
            relays: settings.rls,
            focusTags: settings.focusTags,
            currentFocusTag: currentFocusTag,
            followedPubkeys: followedPubkeys, // New: Set followed pubkeys
            settings: {
                ...appStore.get().settings, // Keep existing settings not explicitly loaded
                tileUrl: settings.tileUrl,
                tilePreset: settings.tilePreset,
                cats: settings.cats,
                mute: settings.mute,
                imgHost: settings.imgH,
                nip96Host: settings.nip96H,
                nip96Token: settings.nip96T
            },
            user: settings.id ? { pk: settings.id.pk, authM: settings.id.authM } : null
        });
        return settings;
    },

    /**
     * Saves partial settings to IndexedDB and updates the appStore.
     * @param {object} partialSettings - An object containing settings to update.
     */
    async save(partialSettings) {
        const currentSettings = await dbSvc.loadSetts() || {};
        const updatedSettings = { ...currentSettings, ...partialSettings };
        await dbSvc.saveSetts(updatedSettings);

        // New: Handle followedPubkeys separately as they are in their own store
        if (partialSettings.followedPubkeys !== undefined) {
            const currentFollowed = await dbSvc.getFollowedPubkeys();
            const newFollowed = partialSettings.followedPubkeys;

            // Add new ones
            for (const fp of newFollowed) {
                if (!currentFollowed.some(cf => cf.pk === fp.pk)) {
                    await dbSvc.addFollowedPubkey(fp.pk);
                }
            }
            // Remove old ones
            for (const cfp of currentFollowed) {
                if (!newFollowed.some(nfp => nfp.pk === cfp.pk)) {
                    await dbSvc.rmFollowedPubkey(cfp.pk);
                }
            }
        }

        appStore.set(s => ({
            relays: updatedSettings.rls || s.relays,
            focusTags: updatedSettings.focusTags || s.focusTags,
            currentFocusTag: updatedSettings.currentFocusTag || s.currentFocusTag,
            followedPubkeys: partialSettings.followedPubkeys !== undefined ? partialSettings.followedPubkeys : s.followedPubkeys, // New: Update followedPubkeys in appStore
            settings: {
                ...s.settings,
                tileUrl: updatedSettings.tileUrl || s.settings.tileUrl,
                tilePreset: updatedSettings.tilePreset || s.settings.tilePreset,
                cats: updatedSettings.cats || s.settings.cats,
                mute: updatedSettings.mute || s.settings.mute,
                imgHost: updatedSettings.imgH || s.settings.imgHost,
                nip96Host: updatedSettings.nip96H || s.settings.nip96Host,
                nip96Token: updatedSettings.nip96T || s.settings.nip96T
            },
            user: updatedSettings.id ? { pk: updatedSettings.id.pk, authM: updatedSettings.id.authM } : s.user
        }));
    },

    setRlys: rls => confSvc.save({ rls }),
    setFocusTags: tags => confSvc.save({ focusTags: tags }),
    setCurrentFocusTag: tag => confSvc.save({ currentFocusTag: tag }),
    setCats: c => confSvc.save({ cats: c }),
    addMute: pk => { const m = appStore.get().settings.mute; if (!m.includes(pk)) confSvc.save({ mute: [...m, pk] }) },
    rmMute: pk => confSvc.save({ mute: appStore.get().settings.mute.filter(p => p !== pk) }),
    saveId: id => confSvc.save({ id }),
    getId: async () => (await dbSvc.loadSetts())?.id,
    clearId: () => { appStore.set({ user: null }); confSvc.save({ id: null }) },
    setTileUrl: url => confSvc.save({ tileUrl: url, tilePreset: 'Custom' }),
    setTilePreset: (preset, url) => confSvc.save({ tilePreset: preset, tileUrl: url }),
    getTileServer: () => appStore.get().settings.tileUrl,
    getCurrentFocusTag: () => appStore.get().currentFocusTag,
    setImgHost: (host, isNip96 = false, token = '') => confSvc.save(isNip96 ? { nip96H: host, nip96T: token, imgH: '' } : { imgH: host, nip96H: '', nip96T: '' }),
    // New: Followed pubkey management
    addFollowed: pk => { const f = appStore.get().followedPubkeys; if (!f.some(fp => fp.pk === pk)) confSvc.save({ followedPubkeys: [...f, { pk, followedAt: Date.now() }] }) },
    rmFollowed: pk => confSvc.save({ followedPubkeys: appStore.get().followedPubkeys.filter(fp => fp.pk !== pk) }),
    setFollowedPubkeys: f => confSvc.save({ followedPubkeys: f }),
};

let _locSk = null; /* locSk: local SecretKey */

export const idSvc = { /* idSvc: identityService */
    async init() {
        const id = await confSvc.getId();
        if (id) appStore.set({ user: { pk: id.pk, authM: id.authM } });
    },

    async nip07() {
        if (!window.nostr?.getPublicKey) {
            showToast("NIP-07 extension not found. Please install Alby or nos2x.", 'warning');
            return null;
        }
        try {
            const pubkey = await window.nostr.getPublicKey();
            if (pubkey) {
                const identity = { pk: pubkey, authM: 'nip07' };
                await confSvc.saveId(identity);
                appStore.set({ user: identity });
                showToast("NIP-07 connected successfully!", 'success');
                return pubkey;
            }
        } catch (e) {
            showToast(`NIP-07 connection error: ${e.message}`, 'error');
        }
        return null;
    },

    async newProf(passphrase) {
        if (!passphrase || passphrase.length < 8) {
            showToast("Passphrase too short (min 8 chars).", 'warning');
            return null;
        }
        const sk = genSk();
        const pk = getPk(sk);
        try {
            const encryptedSk = await encrypt(sk, passphrase);
            const identity = { pk, authM: 'local', eSk: encryptedSk };
            await confSvc.saveId(identity);
            appStore.set({ user: { pk, authM: 'local' } });
            _locSk = sk;
            showToast(`Profile created! Pubkey: ${nip19.npubEncode(pk)}.`, 'success');
            showToast(
                `CRITICAL: Backup your private key (nsec)!`,
                'warning',
                0, // Make it persistent until dismissed
                nip19.nsecEncode(sk)
            );
            return { pk, sk };
        } catch (e) {
            showToast(`Profile creation error: ${e.message}`, 'error');
            return null;
        }
    },

    async impSk(skInput, passphrase) {
        if (!passphrase || passphrase.length < 8) {
            showToast("Passphrase too short (min 8 chars).", 'warning');
            return null;
        }
        let skHex;
        try {
            skHex = nsecToHex(skInput);
            if (!isNostrId(skHex)) throw new Error("Invalid Nostr private key format.");
        } catch (e) {
            showToast(e.message, 'error');
            return null;
        }
        const pk = getPk(skHex);
        try {
            const encryptedSk = await encrypt(skHex, passphrase);
            const identity = { pk, authM: 'import', eSk: encryptedSk };
            await confSvc.saveId(identity);
            appStore.set({ user: { pk, authM: 'import' } });
            _locSk = skHex;
            showToast("Private key imported successfully.", 'success');
            return { pk, sk: skHex };
        } catch (e) {
            showToast(`Key import error: ${e.message}`, 'error');
            return null;
        }
    },

    async getSk(promptPassphrase = true) {
        const user = appStore.get().user;
        if (!user || user.authM === 'nip07') return null;
        if (_locSk) return _locSk;

        const identity = await confSvc.getId();
        if (!identity?.eSk) return null;
        if (!promptPassphrase) return null;

        const passphrase = await showPassphraseModal(
            "Decrypt Private Key",
            "Enter your passphrase to decrypt your private key:"
        );

        if (!passphrase) {
            showToast("Decryption cancelled.", 'info');
            return null;
        }
        try {
            const decryptedSk = await decrypt(identity.eSk, passphrase);
            _locSk = decryptedSk;
            return decryptedSk;
        } catch (e) {
            showToast("Decryption failed. Incorrect passphrase?", 'error');
            return null;
        }
    },

    async chgPass(oldPassphrase, newPassphrase) {
        const identity = await confSvc.getId();
        if (!identity?.eSk || (identity.authM !== 'local' && identity.authM !== 'import')) {
            throw new Error("No local key to change passphrase for.");
        }
        let decryptedSk;
        try {
            decryptedSk = await decrypt(identity.eSk, oldPassphrase);
        } catch (e) {
            throw new Error("Old passphrase incorrect.");
        }
        if (!decryptedSk) throw new Error("Decryption failed.");

        const newEncryptedSk = await encrypt(decryptedSk, newPassphrase);
        await confSvc.saveId({ ...identity, eSk: newEncryptedSk });
        _locSk = decryptedSk; // Keep the decrypted key in memory
        showToast("Passphrase changed successfully.", 'success');
    },

    logout() {
        _locSk = null;
        confSvc.clearId();
        showToast("Logged out successfully.", 'info');
    },

    currU: () => appStore.get().user,

    /**
     * Signs a Nostr event using the current user's authentication method.
     * @param {object} event - The event object to sign.
     * @returns {Promise<object>} The signed event.
     * @throws {Error} If no identity is connected or signing fails.
     */
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

let _nostrRlys = new Map(),
    _nostrSubs = new Map(); /* nostrRlys: nostrRelays, nostrSubs: nostrSubscriptions */

/**
 * Updates the status of a relay in the appStore.
 * @param {string} url - The URL of the relay.
 * @param {string} status - The new status ('connected', 'disconnected', 'error').
 * @param {object|null} nip11Doc - NIP-11 relay information document.
 */
const updRlyStore = (url, status, nip11Doc = null) => {
    const updatedRelays = appStore.get().relays.map(r =>
        r.url === url ? { ...r, status, nip11: nip11Doc || r.nip11 } : r
    );
    appStore.set({ relays: updatedRelays });
};

/**
 * Helper function to add/update a report in the appStore and IndexedDB.
 * @param {object} signedEvent - The signed Nostr event (report).
 */
const addReportToStoreAndDb = async (signedEvent) => {
    const report = parseReport(signedEvent);
    await dbSvc.addRep(report);
    appStore.set(s => {
        const index = s.reports.findIndex(rp => rp.id === report.id);
        const updatedReports = (index > -1) ?
            [...s.reports.slice(0, index), report, ...s.reports.slice(index + 1)] :
            [...s.reports, report];
        return { reports: updatedReports.sort((a, b) => b.at - a.at) };
    });
};

export const nostrSvc = { /* nostrSvc: nostrService */
    /**
     * Connects to configured relays.
     */
    async connRlys() {
        appStore.get().relays.forEach(async rConf => {
            // Skip if already connected or not enabled for read/write
            if (_nostrRlys.has(rConf.url) && _nostrRlys.get(rConf.url).status === 1) return;
            if (!rConf.read && !rConf.write) return;

            /**
             * Attempts to connect to a single relay with retry logic.
             * @param {string} url - The relay URL.
             * @param {number} attempt - Current retry attempt.
             */
            const connectRelay = async (url, attempt = 1) => {
                try {
                    const relay = relayInit(url);
                    relay.on('connect', async () => {
                        _nostrRlys.set(relay.url, relay);
                        const nip11Doc = await nip11.fetchRelayInformation(relay.url).catch(() => null);
                        updRlyStore(relay.url, 'connected', nip11Doc);
                        showToast(`Connected to ${url}`, 'success', 2000);
                        this.subToReps(relay); // Subscribe to reports on new connection
                    });
                    relay.on('disconnect', () => {
                        updRlyStore(relay.url, 'disconnected');
                        showToast(`Disconnected from ${url}`, 'warning', 2000);
                        // Optional: try to reconnect after a delay
                        setTimeout(() => connectRelay(url, 1), 5000);
                    });
                    relay.on('error', () => {
                        updRlyStore(relay.url, 'error');
                        showToast(`Error connecting to ${url}`, 'error', 2000);
                        // Optional: retry with backoff
                        if (attempt < 3) { // Max 3 retries
                            setTimeout(() => connectRelay(url, attempt + 1), attempt * 5000);
                        }
                    });
                    await relay.connect();
                } catch (e) {
                    updRlyStore(url, 'error');
                    showToast(`Failed to connect to ${url}: ${e.message}`, 'error', 2000);
                    if (attempt < 3) {
                        setTimeout(() => connectRelay(url, attempt + 1), attempt * 5000);
                    }
                }
            };
            connectRelay(rConf.url);
        });
    },

    /**
     * Disconnects from all currently connected relays.
     */
    discAllRlys() {
        _nostrRlys.forEach(r => r.close());
        _nostrRlys.clear();
        _nostrSubs.forEach(s => s.sub.unsub());
        _nostrSubs.clear();
        appStore.set(s => ({ relays: s.relays.map(r => ({ ...r, status: 'disconnected' })) }));
        showToast("All relays disconnected.", 'info');
    },

    /**
     * Subscribes to reports from relays based on current filters (focus tag, map bounds).
     * @param {object} [specificRelay=null] - An optional specific relay to subscribe from.
     */
    async subToReps(specificRelay = null) {
        this.unsubAllReps(); // Unsubscribe from existing report subscriptions

        const focusTag = appStore.get().currentFocusTag;
        const mapGeohashes = appStore.get().mapGhs;
        const followedPubkeys = appStore.get().followedPubkeys.map(f => f.pk); // New: Get followed pubkeys

        const baseFilter = { kinds: [C.NOSTR_KIND_REPORT] };
        if (focusTag && focusTag !== C.FOCUS_TAG_DEFAULT) {
            baseFilter['#t'] = [focusTag.substring(1)]; // Remove '#' prefix for tag filter
        }

        // New: If "followed only" filter is active, add authors to the filter
        if (appStore.get().ui.followedOnlyFilter && followedPubkeys.length > 0) {
            baseFilter.authors = followedPubkeys;
        }

        const relaysToQuery = specificRelay ? [specificRelay] : Array.from(_nostrRlys.values());

        relaysToQuery.forEach(relay => {
            const relayConfig = appStore.get().relays.find(rc => rc.url === relay.url);
            // Only subscribe if relay is connected and enabled for reading
            if (relay.status !== 1 || !relayConfig?.read) return;

            let currentFilter = { ...baseFilter };

            // Apply geohash filter if map bounds are available
            if (mapGeohashes?.length > 0) {
                if (relayConfig.nip11?.supported_nips?.includes(52)) {
                    currentFilter['#g'] = mapGeohashes; // Use all geohash prefixes if NIP-52 supported
                } else {
                    // Fallback for non-NIP-52 relays: use the broadest geohash prefix (precision 4)
                    currentFilter['#g'] = [mapGeohashes[0]];
                }
            }

            const subscriptionId = `reps-${relay.url}-${Date.now()}`;
            try {
                const sub = relay.sub([currentFilter]);

                sub.on('event', async event => {
                    const report = parseReport(event);
                    // Skip muted authors
                    if (appStore.get().settings.mute.includes(report.pk)) return;

                    await dbSvc.addRep(report); // Add/update report in DB

                    // Preserve existing interactions if any, then update appStore
                    const existingInteractions = (await dbSvc.getRep(report.id))?.interactions || [];
                    report.interactions = existingInteractions;

                    appStore.set(s => {
                        const index = s.reports.findIndex(rp => rp.id === report.id);
                        const updatedReports = (index > -1) ?
                            [...s.reports.slice(0, index), report, ...s.reports.slice(index + 1)] :
                            [...s.reports, report];
                        return { reports: updatedReports.sort((a, b) => b.at - a.at) };
                    });
                });

                sub.on('eose', () => {
                    // End of stored events for this subscription
                });

                _nostrSubs.set(subscriptionId, { sub, rU: relay.url, filt: currentFilter, type: 'reports' });
            } catch (e) {
                console.error(`Subscription Error for ${relay.url}:`, e);
                showToast(`Subscription error for ${relay.url}: ${e.message}`, 'error');
            }
        });
    },

    /**
     * Unsubscribes from all active report subscriptions.
     */
    unsubAllReps() {
        _nostrSubs.forEach((s, id) => {
            if (s.type === 'reports') {
                try { s.sub.unsub(); } catch (e) { console.warn(`Error unsubscribing ${id}:`, e); }
                _nostrSubs.delete(id);
            }
        });
    },

    /**
     * Refreshes all subscriptions, reconnecting relays if none are connected.
     */
    refreshSubs() {
        this.unsubAllReps();
        const connectedCount = Array.from(_nostrRlys.values()).filter(r => r.status === 1).length;
        if (connectedCount === 0) {
            this.connRlys();
        } else {
            this.subToReps();
        }
    },

    /**
     * Publishes a Nostr event. Uses Service Worker for offline queuing.
     * @param {object} eventData - The event data to publish.
     * @returns {Promise<object>} The signed event.
     */
    async pubEv(eventData) {
        const signedEvent = await idSvc.signEv(eventData);

        if (appStore.get().online) {
            try {
                // Use a local API endpoint that the Service Worker can intercept
                const response = await fetch('/api/publishNostrEvent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(signedEvent)
                });

                // If SW defers (e.g., 503), it will handle queuing.
                // Otherwise, check if the direct publish was successful.
                if (!response.ok && response.status !== 503) {
                    console.error("Publish Error (SW Proxy):", response.statusText);
                } else if (response.status === 503) {
                    console.log("Publish deferred by Service Worker (offline or network issue).");
                    if (signedEvent.kind === C.NOSTR_KIND_REPORT) {
                        await addReportToStoreAndDb(signedEvent);
                    }
                }
            } catch (e) {
                // Network error, SW should handle it via fetch interception
                console.warn("Publish Network Error, Service Worker should handle:", e);
                if (signedEvent.kind === C.NOSTR_KIND_REPORT) {
                    await addReportToStoreAndDb(signedEvent);
                }
            }
        } else {
            // Explicitly offline, add to IndexedDB queue
            await dbSvc.addOfflineQ({ event: signedEvent, ts: Date.now() });
            if (signedEvent.kind === C.NOSTR_KIND_REPORT) {
                await addReportToStoreAndDb(signedEvent);
            }
        }

        return signedEvent;
    },

    /**
     * Publishes a NIP-09 event (Kind 5) to delete a specific event.
     * @param {string} eventIdToDelete - The ID of the event to delete.
     * @returns {Promise<object>} The signed deletion event.
     */
    async deleteEv(eventIdToDelete) {
        const user = appStore.get().user;
        if (!user) throw new Error("No Nostr identity connected to delete events.");

        const eventData = {
            kind: 5, // NIP-09 event kind for deletion
            content: "Reason for deletion (optional)", // Can be empty or a reason
            tags: [['e', eventIdToDelete]] // Tag the event to be deleted
        };

        const signedDeletionEvent = await this.pubEv(eventData);

        // Immediately remove from local state and DB for UI responsiveness
        appStore.set(s => ({ reports: s.reports.filter(r => r.id !== eventIdToDelete) }));
        await dbSvc.rmRep(eventIdToDelete);
        showToast("Report deletion event sent (NIP-09).", 'info');

        return signedDeletionEvent;
    },

    /**
     * Fetches a Nostr profile from a connected relay or cache.
     * @param {string} pubkey - The public key of the profile to fetch.
     * @returns {Promise<object|null>} The profile object or null.
     */
    async fetchProf(pubkey) {
        let profile = await dbSvc.getProf(pubkey);
        // Return cached profile if less than 24 hours old
        if (profile && (Date.now() - (profile.fetchedAt || 0)) < 864e5) return profile;

        const filter = { kinds: [C.NOSTR_KIND_PROFILE], authors: [pubkey], limit: 1 };
        const relaysToQuery = Array.from(_nostrRlys.values()).filter(r => r.status === 1);

        if (relaysToQuery.length === 0) return profile; // Return existing if no relays connected

        try {
            // Try to fetch from the first connected relay
            const events = await relaysToQuery[0].list([filter]);
            if (events?.length > 0) {
                const latestProfileEvent = events.sort((a, b) => b.at - a.at)[0];
                try {
                    const parsedContent = JSON.parse(latestProfileEvent.content);
                    profile = {
                        pk: pubkey,
                        name: parsedContent.name || '',
                        nip05: parsedContent.nip05 || '',
                        picture: parsedContent.picture || '',
                        about: parsedContent.about || '',
                        fetchedAt: Date.now(),
                        ...parsedContent // Include any other profile fields
                    };
                    await dbSvc.addProf(profile); // Cache the fetched profile
                    return profile;
                } catch (e) {
                    console.error("Error parsing profile content:", e);
                }
            }
        } catch (e) {
            showToast(`Error fetching profile for ${formatNpubShort(pubkey)}: ${e.message}`, 'error');
        }
        return profile; // Return existing (possibly stale) or null
    },

    /**
     * Fetches interactions (reactions, comments) for a given report.
     * @param {string} reportId - The ID of the report.
     * @param {string} reportPk - The public key of the report author.
     * @returns {Promise<Array<object>>} An array of interaction events.
     */
    async fetchInteractions(reportId, reportPk) {
        const filters = [
            { kinds: [C.NOSTR_KIND_REACTION], "#e": [reportId] }, // Reactions to the report
            { kinds: [C.NOSTR_KIND_NOTE], "#e": [reportId] } // Text notes (comments) referencing the report
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
            id: ev.id,
            kind: ev.kind,
            content: ev.content,
            pubkey: ev.pubkey,
            created_at: ev.created_at,
            tags: ev.tags,
            reportId: reportId
        }));

        return allInteractions.sort((a, b) => a.created_at - b.created_at); // Oldest first for display
    },

    /**
     * Publishes a NIP-02 contact list (kind 3 event).
     * @param {Array<object>} contacts - Array of {pubkey: string, relay: string, petname: string}
     */
    async pubContacts(contacts) {
        const user = appStore.get().user;
        if (!user) throw new Error("No Nostr identity connected to publish contacts.");

        const tags = contacts.map(c => {
            const tag = ['p', c.pubkey];
            if (c.relay) tag.push(c.relay);
            if (c.petname) tag.push(c.petname);
            return tag;
        });

        const eventData = {
            kind: C.NOSTR_KIND_CONTACTS,
            content: '', // NIP-02 content is empty
            tags: tags
        };

        return this.pubEv(eventData);
    },

    /**
     * Fetches the current user's NIP-02 contact list (kind 3 event).
     * @returns {Promise<Array<object>>} Array of {pubkey: string, relay: string, petname: string}
     */
    async fetchContacts() {
        const user = appStore.get().user;
        if (!user) return [];

        const filter = { kinds: [C.NOSTR_KIND_CONTACTS], authors: [user.pk], limit: 1 };
        const relaysToQuery = Array.from(_nostrRlys.values()).filter(r => r.status === 1 && r.read);

        if (relaysToQuery.length === 0) {
            showToast("No connected relays to fetch contacts from.", 'warning');
            return [];
        }

        try {
            const events = await relaysToQuery[0].list([filter]);
            if (events?.length > 0) {
                const latestContactsEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
                return latestContactsEvent.tags
                    .filter(tag => tag[0] === 'p' && tag[1])
                    .map(tag => ({
                        pubkey: tag[1],
                        relay: tag[2] || '',
                        petname: tag[3] || ''
                    }));
            }
        } catch (e) {
            showToast(`Error fetching contacts: ${e.message}`, 'error');
        }
        return [];
    }
};

export const offSvc = { /* offSvc: offlineService */
    /**
     * Processes the offline queue, attempting to publish events.
     */
    async procQ() {
        if (!appStore.get().online) {
            return;
        }
        const items = await dbSvc.getOfflineQ();
        if (items.length === 0) {
            return;
        }
        for (const item of items) {
            try {
                const response = await fetch('/api/publishNostrEvent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item.event)
                });
                // If successful or SW handled it (503), remove from queue
                if (response.ok || response.status === 503) {
                    await dbSvc.rmOfflineQ(item.qid);
                }
            } catch (e) {
                console.error("Error processing offline queue item:", e);
                showToast(`Failed to sync offline event: ${e.message}`, 'error');
            }
        }
    },

    /**
     * Sets up event listeners for online/offline status and background sync.
     */
    setupSyncLs() {
        window.addEventListener('online', () => { this.procQ() });
        window.addEventListener('offline', () => {}); // No specific action on offline, just update status

        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(registration => {
                if ('sync' in registration) {
                    registration.addEventListener('sync', event => {
                        if (event.tag === 'nostrPublishQueue') {
                            event.waitUntil(this.procQ());
                        }
                    });
                }
            });
        }
        this.procQ(); // Attempt to process queue on startup
    },
};

let _map, _mapRepsLyr = L.layerGroup(),
    _mapTileLyr; /* map: mapInstance, mapRepsLyr: mapReportsLayer, mapTileLyr: mapTileLayer */
let _drawnItems; // FeatureGroup to store drawn items
let _drawControl; // Leaflet.draw control instance

export const mapSvc = { /* mapSvc: mapService */
    /**
     * Initializes the Leaflet map.
     * @param {string} id - The ID of the map container element.
     * @returns {L.Map} The Leaflet map instance.
     */
    init(id = 'map-container') {
        const tileUrl = confSvc.getTileServer();
        _map = L.map(id).setView([20, 0], 3);
        _mapTileLyr = L.tileLayer(tileUrl, { attribution: '&copy; OSM & NM', maxZoom: 19 }).addTo(_map);

        _mapRepsLyr = L.markerClusterGroup(); // Changed to MarkerClusterGroup
        _map.addLayer(_mapRepsLyr);

        // Initialize the FeatureGroup to store drawn items
        _drawnItems = new L.FeatureGroup();
        _map.addLayer(_drawnItems);

        // Initialize the draw control and add it to the map
        _drawControl = new L.Control.Draw({
            edit: {
                featureGroup: _drawnItems,
                poly: {
                    allowIntersection: false
                }
            },
            draw: {
                polygon: {
                    allowIntersection: false,
                    showArea: true
                },
                polyline: false, // Disable polyline
                rectangle: true,
                circle: true,
                marker: false, // Disable marker
                circlemarker: false // Disable circlemarker
            }
        });
        // Add the draw control to a specific div, not directly to the map
        // This allows us to place it in the sidebar
        // _map.addControl(_drawControl); // This line is removed

        appStore.set({ map: _map });

        _map.on('moveend zoomend', () => {
            const bounds = _map.getBounds();
            const geohashes = getGhPrefixes(bounds);
            appStore.set({ mapBnds: bounds, mapGhs: geohashes });
        });

        // Event handlers for Leaflet.draw
        _map.on(L.Draw.Event.CREATED, async e => {
            const layer = e.layer;
            const geojson = layer.toGeoJSON();
            const shapeId = generateUUID(); // Generate a unique ID for the shape
            geojson.properties = { ...geojson.properties, id: shapeId }; // Add ID to properties
            layer.options.id = shapeId; // Store ID on the layer itself for easy lookup

            _drawnItems.addLayer(layer);
            await dbSvc.addDrawnShape({ id: shapeId, geojson: geojson });
            appStore.set(s => ({ drawnShapes: [...s.drawnShapes, geojson] }));
            showToast("Shape drawn and saved!", 'success');
        });

        _map.on(L.Draw.Event.EDITED, async e => {
            for (const layer of Object.values(e.layers._layers)) {
                const geojson = layer.toGeoJSON();
                const shapeId = layer.options.id; // Retrieve ID from layer options
                geojson.properties = { ...geojson.properties, id: shapeId };
                await dbSvc.addDrawnShape({ id: shapeId, geojson: geojson }); // Update in DB
            }
            // Re-fetch all drawn shapes to update appStore
            const updatedShapes = await dbSvc.getAllDrawnShapes();
            appStore.set({ drawnShapes: updatedShapes.map(s => s.geojson) });
            showToast("Shape edited and saved!", 'success');
        });

        _map.on(L.Draw.Event.DELETED, async e => {
            for (const layer of Object.values(e.layers._layers)) {
                const shapeId = layer.options.id; // Retrieve ID from layer options
                await dbSvc.rmDrawnShape(shapeId); // Remove from DB
            }
            // Re-fetch all drawn shapes to update appStore
            const updatedShapes = await dbSvc.getAllDrawnShapes();
            appStore.set({ drawnShapes: updatedShapes.map(s => s.geojson) });
            showToast("Shape deleted!", 'info');
        });

        // Load existing drawn shapes from IndexedDB on startup
        this.loadDrawnShapes();

        return _map;
    },

    /**
     * Loads drawn shapes from IndexedDB and adds them to the map.
     */
    async loadDrawnShapes() {
        const storedShapes = await dbSvc.getAllDrawnShapes();
        _drawnItems.clearLayers(); // Clear any existing layers before loading
        const geojsonShapes = [];
        storedShapes.forEach(s => {
            const layer = L.GeoJSON.geometryToLayer(s.geojson);
            layer.options.id = s.id; // Store the ID on the layer
            _drawnItems.addLayer(layer);
            geojsonShapes.push(s.geojson);
        });
        appStore.set({ drawnShapes: geojsonShapes });
        console.log(`Loaded ${storedShapes.length} drawn shapes.`);
    },

    /**
     * Clears all drawn shapes from the map and IndexedDB.
     */
    async clearAllDrawnShapes() {
        showConfirmModal(
            "Clear All Drawn Shapes",
            "Are you sure you want to clear ALL drawn shapes from the map and database? This action cannot be undone.",
            async () => {
                _drawnItems.clearLayers();
                await dbSvc.clearDrawnShapes();
                appStore.set({ drawnShapes: [] });
                showToast("All drawn shapes cleared.", 'info');
            },
            () => showToast("Clearing shapes cancelled.", 'info')
        );
    },

    /**
     * Gets the Leaflet.draw control instance.
     * @returns {L.Control.Draw} The draw control.
     */
    getDrawControl: () => _drawControl,

    /**
     * Gets the FeatureGroup containing drawn items.
     * @returns {L.FeatureGroup} The drawn items feature group.
     */
    getDrawnItems: () => _drawnItems,

    /**
     * Updates the map's tile layer URL.
     * @param {string} url - The new tile URL.
     */
    updTile(url) {
        if (_mapTileLyr) _mapTileLyr.setUrl(url);
    },

    /**
     * Updates the markers on the map based on the provided reports.
     * @param {Array<object>} reports - An array of report objects.
     */
    updReps(reports) {
        if (!_map) return;
        _mapRepsLyr.clearLayers(); // Clear existing markers
        reports.forEach(report => {
            if (report.lat && report.lon) {
                const marker = L.marker([report.lat, report.lon]);
                marker.bindPopup(`<b>${report.title || 'Report'}</b><br>${report.sum || report.ct.substring(0, 50) + '...'}`, { maxWidth: 250 });
                marker.on('click', () => {
                    appStore.set(s => ({ ...s, ui: { ...s.ui, viewingReport: report.id } }));
                });
                _mapRepsLyr.addLayer(marker);
            }
        });
    },

    /**
     * Centers the map on the user's current geolocation.
     */
    ctrUser() {
        if (!_map || !navigator.geolocation) {
            return showToast("Geolocation not supported by your browser.", 'warning');
        }
        navigator.geolocation.getCurrentPosition(
            position => {
                const latlng = [position.coords.latitude, position.coords.longitude];
                _map.setView(latlng, 13);
                L.marker(latlng).addTo(_map).bindPopup("You").openPopup();
            },
            error => showToast(`GPS Error: ${error.message}`, 'error')
        );
    },

    /**
     * Searches for a location using Nominatim and centers the map.
     * @param {string} query - The location query string.
     */
    searchLoc: async query => {
        if (!_map) return;
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
            const data = await response.json();
            if (data?.length > 0) {
                const { lat, lon, display_name } = data[0];
                _map.setView([parseFloat(lat), parseFloat(lon)], 12);
                L.popup().setLatLng([parseFloat(lat), parseFloat(lon)]).setContent(display_name).openOn(_map);
                showToast(`Location found: ${display_name}`, 'success');
            } else {
                showToast("Location not found.", 'info');
            }
        } catch (e) {
            showToast(`Location search error: ${e.message}`, 'error');
        }
    },

    /**
     * Enables map click to pick a location.
     * @param {function} callback - Callback function with latlng object.
     */
    enPickLoc: callback => {
        if (!_map) return;
        const mapContainer = $('#map-container');
        mapContainer.style.cursor = 'crosshair';
        showToast("Click on the map to pick a location.", 'info');
        _map.once('click', e => {
            mapContainer.style.cursor = '';
            callback(e.latlng);
        });
    },

    /**
     * Disables map click for location picking.
     */
    disPickLoc: () => {
        if ($('#map-container')) $('#map-container').style.cursor = '';
        if (_map) _map.off('click');
    },

    get: () => _map,
};

export const imgSvc = { /* imgSvc: imageUploadService */
    /**
     * Uploads an image file to the configured image host.
     * @param {File} file - The image file to upload.
     * @returns {Promise<string>} The URL of the uploaded image.
     * @throws {Error} If file type is invalid, size limit exceeded, or upload fails.
     */
    async upload(file) {
        const { imgHost, nip96Host, nip96Token } = appStore.get().settings;

        if (!file.type.startsWith('image/')) {
            throw new Error('Invalid file type. Only images are allowed.');
        }
        if (file.size > C.IMG_SIZE_LIMIT_BYTES) {
            throw new Error(`File too large (max ${C.IMG_SIZE_LIMIT_BYTES / 1024 / 1024}MB).`);
        }

        let uploadUrl = imgHost;
        let headers = {};
        let body;

        if (nip96Host) { // NIP-96
            uploadUrl = nip96Host;
            if (nip96Token) headers['Authorization'] = `Bearer ${nip96Token}`;
            body = file; // NIP-96 often expects raw file data
            headers['Content-Type'] = file.type; // Set content type for raw body
        } else if (!imgHost || imgHost === C.IMG_UPLOAD_NOSTR_BUILD) { // Default to nostr.build
            uploadUrl = C.IMG_UPLOAD_NOSTR_BUILD;
            const formData = new FormData();
            formData.append('file', file); // nostr.build expects 'file' in FormData
            body = formData;
        } else { // Custom host, assume FormData
            const formData = new FormData();
            formData.append('file', file);
            body = formData;
        }

        try {
            const response = await fetch(uploadUrl, { method: 'POST', body: body, headers });
            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
            }
            const data = await response.json();

            let finalUrl = data.url || data.uri || data.link || (Array.isArray(data.data) && data.data[0]?.url) || (data.data?.url);
            if (!finalUrl && typeof data === 'string' && data.startsWith('http')) finalUrl = data; // Some NIP-96 return plain URL
            if (!finalUrl) throw new Error('Image URL not found in response from host.');

            return finalUrl;
        } catch (e) {
            console.error("Image upload error:", e);
            throw new Error(`Image upload failed: ${e.message}`);
        }
    }
};
