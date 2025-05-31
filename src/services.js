import L from 'leaflet';
import 'leaflet.markercluster';
import { generatePrivateKey as genSk, getPublicKey as getPk, nip19, getEventHash as getEvH, signEvent as signEvNostr, relayInit, nip11 } from 'nostr-tools';
import { appStore } from './store.js';
import { C, $, encrypt, decrypt, sha256, npubToHex, geohashEncode, parseReport, getGhPrefixes, nsecToHex, isNostrId, showToast, generateUUID } from './utils.js';
import { showPassphraseModal, showConfirmModal } from './ui.js';

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

// Factory function to create common IndexedDB CRUD operations
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

    // Specific methods not covered by the factory
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

export const confSvc = {
    async load() {
        let settings = await dbSvc.loadSetts();
        let followedPubkeys = await dbSvc.getFollowedPubkeys();

        const initializeSettingsDefaults = () => ({
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
        });

        const migrateRelaySettings = (currentSettings) => {
            currentSettings.rls = currentSettings.rls || C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?', nip11: null }));
            currentSettings.rls.forEach(r => {
                if (r.status === undefined) r.status = '?';
                if (r.nip11 === undefined) r.nip11 = null;
            });
            return currentSettings.rls;
        };

        const migrateFocusTags = (currentSettings) => {
            if (typeof currentSettings.focus === 'string') {
                const tags = [{ tag: currentSettings.focus, active: true }];
                delete currentSettings.focus;
                return tags;
            } else if (!currentSettings.focusTags || currentSettings.focusTags.length === 0) {
                return [{ tag: C.FOCUS_TAG_DEFAULT, active: true }];
            }
            return currentSettings.focusTags;
        };

        const migrateTileSettings = (currentSettings) => {
            const tileUrl = currentSettings.tileUrl || currentSettings.tile || C.TILE_SERVER_DEFAULT;
            const tilePreset = currentSettings.tilePreset || (currentSettings.tile === C.TILE_SERVER_DEFAULT ? 'OpenStreetMap' : 'Custom');
            delete currentSettings.tile;
            return { tileUrl, tilePreset };
        };

        if (!settings) {
            settings = initializeSettingsDefaults();
        }

        const updatedRelays = migrateRelaySettings(settings);
        const updatedFocusTags = migrateFocusTags(settings);
        const { tileUrl, tilePreset } = migrateTileSettings(settings);
        const currentFocusTag = updatedFocusTags.find(t => t.active)?.tag || C.FOCUS_TAG_DEFAULT;

        if (!followedPubkeys) {
            followedPubkeys = [];
        }

        appStore.set({
            relays: updatedRelays,
            focusTags: updatedFocusTags,
            currentFocusTag: currentFocusTag,
            followedPubkeys: followedPubkeys,
            settings: {
                ...appStore.get().settings,
                tileUrl: tileUrl,
                tilePreset: tilePreset,
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

    async save(partialSettings) {
        const currentSettings = await dbSvc.loadSetts() || {};
        const updatedSettings = { ...currentSettings, ...partialSettings };
        await dbSvc.saveSetts(updatedSettings);

        if (partialSettings.followedPubkeys !== undefined) {
            const currentFollowed = await dbSvc.getFollowedPubkeys();
            const newFollowed = partialSettings.followedPubkeys;

            for (const fp of newFollowed) {
                if (!currentFollowed.some(cf => cf.pk === fp.pk)) {
                    await dbSvc.addFollowedPubkey(fp.pk);
                }
            }
            for (const cfp of currentFollowed) {
                if (!newFollowed.some(nfp => nfp.pk === cfp.pk)) {
                    await dbSvc.rmFollowedPubkey(cfp.pk);
                }
            }
        }

        const appStoreUpdate = {
            relays: updatedSettings.rls || appStore.get().relays,
            focusTags: updatedSettings.focusTags || appStore.get().focusTags,
            currentFocusTag: updatedSettings.currentFocusTag || appStore.get().currentFocusTag,
            followedPubkeys: partialSettings.followedPubkeys !== undefined ? partialSettings.followedPubkeys : appStore.get().followedPubkeys,
            settings: {
                ...appStore.get().settings,
                tileUrl: updatedSettings.tileUrl || appStore.get().settings.tileUrl,
                tilePreset: updatedSettings.tilePreset || appStore.get().settings.tilePreset,
                cats: updatedSettings.cats || appStore.get().settings.cats,
                mute: updatedSettings.mute || appStore.get().settings.mute,
                imgHost: updatedSettings.imgH || appStore.get().settings.imgHost,
                nip96Host: updatedSettings.nip96H || appStore.get().settings.nip96Host,
                nip96Token: updatedSettings.nip96T || appStore.get().settings.nip96T
            },
            user: updatedSettings.id ? { pk: updatedSettings.id.pk, authM: updatedSettings.id.authM } : appStore.get().user
        };
        appStore.set(appStoreUpdate);
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
    addFollowed: pk => { const f = appStore.get().followedPubkeys; if (!f.some(fp => fp.pk === pk)) confSvc.save({ followedPubkeys: [...f, { pk, followedAt: Date.now() }] }) },
    rmFollowed: pk => confSvc.save({ followedPubkeys: appStore.get().followedPubkeys.filter(fp => fp.pk !== pk) }),
    setFollowedPubkeys: f => confSvc.save({ followedPubkeys: f }),
};

let _locSk = null;

export const idSvc = {
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
                0,
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
        _locSk = decryptedSk;
        showToast("Passphrase changed successfully.", 'success');
    },

    logout() {
        _locSk = null;
        confSvc.clearId();
        showToast("Logged out successfully.", 'info');
    },

    currU: () => appStore.get().user,

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
            const sk = await idSvc.getSk(true);
            if (!sk) throw new Error("Private key not available for signing. Passphrase might be needed.");
            const signedEvent = { ...event, pubkey: user.pk, id: getEvH(event), sig: signEvNostr(event, sk) };
            return signedEvent;
        } else {
            throw new Error("Unsupported authentication method.");
        }
    }
};

let _nostrRlys = new Map(),
    _nostrSubs = new Map();

const updRlyStore = (url, status, nip11Doc = null) => {
    const updatedRelays = appStore.get().relays.map(r =>
        r.url === url ? { ...r, status, nip11: nip11Doc || r.nip11 } : r
    );
    appStore.set({ relays: updatedRelays });
};

const addReportToStoreAndDb = async (signedEvent) => {
    const report = parseReport(signedEvent);
    await dbSvc.addRep(report);

    const existingReportInDb = await dbSvc.getRep(report.id);
    report.interactions = existingReportInDb?.interactions || [];

    appStore.set(s => {
        const index = s.reports.findIndex(rp => rp.id === report.id);
        const updatedReports = (index > -1) ?
            [...s.reports.slice(0, index), report, ...s.reports.slice(index + 1)] :
            [...s.reports, report];
        return { reports: updatedReports.sort((a, b) => b.at - a.at) };
    });
};

const _connectRelay = async (url, attempt = 1) => {
    try {
        const relay = relayInit(url);
        relay.on('connect', async () => {
            _nostrRlys.set(relay.url, relay);
            const nip11Doc = await nip11.fetchRelayInformation(relay.url).catch(() => null);
            updRlyStore(relay.url, 'connected', nip11Doc);
            showToast(`Connected to ${url}`, 'success', 2000);
            nostrSvc.subToReps(relay); // Use nostrSvc here
        });
        relay.on('disconnect', () => {
            updRlyStore(relay.url, 'disconnected');
            showToast(`Disconnected from ${url}`, 'warning', 2000);
            setTimeout(() => _connectRelay(url, 1), C.RELAY_RETRY_DELAY_MS);
        });
        relay.on('error', () => {
            updRlyStore(relay.url, 'error');
            showToast(`Error connecting to ${url}`, 'error', 2000);
            if (attempt < C.MAX_RELAY_RETRIES) {
                setTimeout(() => _connectRelay(url, attempt + 1), attempt * C.RELAY_RETRY_DELAY_MS);
            }
        });
        await relay.connect();
    } catch (e) {
        updRlyStore(url, 'error');
        showToast(`Failed to connect to ${url}: ${e.message}`, 'error', 2000);
        if (attempt < C.MAX_RELAY_RETRIES) {
            setTimeout(() => _connectRelay(url, attempt + 1), attempt * C.RELAY_RETRY_DELAY_MS);
        }
    }
};

export const nostrSvc = {
    async connRlys() {
        appStore.get().relays.forEach(async rConf => {
            if (_nostrRlys.has(rConf.url) && _nostrRlys.get(rConf.url).status === 1) return;
            if (!rConf.read && !rConf.write) return;
            _connectRelay(rConf.url);
        });
    },

    discAllRlys() {
        _nostrRlys.forEach(r => r.close());
        _nostrRlys.clear();
        _nostrSubs.forEach(s => s.sub.unsub());
        _nostrSubs.clear();
        appStore.set(s => ({ relays: s.relays.map(r => ({ ...r, status: 'disconnected' })) }));
        showToast("All relays disconnected.", 'info');
    },

    async subToReps(specificRelay = null) {
        this.unsubAllReps();

        const appState = appStore.get();
        const focusTag = appState.currentFocusTag;
        const mapGeohashes = appState.mapGhs;
        const followedPubkeys = appState.followedPubkeys.map(f => f.pk);

        const baseFilter = { kinds: [C.NOSTR_KIND_REPORT] };

        if (focusTag && focusTag !== C.FOCUS_TAG_DEFAULT) {
            baseFilter['#t'] = [focusTag.substring(1)];
        }

        if (appState.ui.followedOnlyFilter && followedPubkeys.length > 0) {
            baseFilter.authors = followedPubkeys;
        }

        const relaysToQuery = specificRelay ? [specificRelay] : Array.from(_nostrRlys.values());

        relaysToQuery.forEach(relay => {
            const relayConfig = appStore.get().relays.find(rc => rc.url === relay.url);
            if (relay.status !== 1 || !relayConfig?.read) return;

            let currentFilter = { ...baseFilter };

            if (mapGeohashes?.length > 0) {
                if (relayConfig.nip11?.supported_nips?.includes(52)) {
                    currentFilter['#g'] = mapGeohashes;
                } else {
                    currentFilter['#g'] = [mapGeohashes[0]];
                }
            }

            const subscriptionId = `reps-${relay.url}-${Date.now()}`;
            try {
                const sub = relay.sub([currentFilter]);

                sub.on('event', async event => {
                    const report = parseReport(event);
                    if (appStore.get().settings.mute.includes(report.pk)) return;

                    await addReportToStoreAndDb(event);
                });

                sub.on('eose', () => {
                });

                _nostrSubs.set(subscriptionId, { sub, rU: relay.url, filt: currentFilter, type: 'reports' });
            } catch (e) {
                console.error(`Subscription Error for ${relay.url}:`, e);
                showToast(`Subscription error for ${relay.url}: ${e.message}`, 'error');
            }
        });
    },

    unsubAllReps() {
        _nostrSubs.forEach((s, id) => {
            if (s.type === 'reports') {
                try { s.sub.unsub(); } catch (e) { console.warn(`Error unsubscribing ${id}:`, e); }
                _nostrSubs.delete(id);
            }
        });
    },

    refreshSubs() {
        this.unsubAllReps();
        const connectedCount = Array.from(_nostrRlys.values()).filter(r => r.status === 1).length;
        if (connectedCount === 0) {
            this.connRlys();
        } else {
            this.subToReps();
        }
    },

    async pubEv(eventData) {
        const signedEvent = await idSvc.signEv(eventData);

        if (signedEvent.kind === C.NOSTR_KIND_REPORT) {
            await addReportToStoreAndDb(signedEvent);
        }

        if (appStore.get().online) {
            try {
                const response = await fetch('/api/publishNostrEvent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(signedEvent)
                });

                if (!response.ok && response.status !== 503) {
                    console.error("Publish Error (SW Proxy):", response.statusText);
                } else if (response.status === 503) {
                    console.log("Publish deferred by Service Worker (offline or network issue).");
                }
            } catch (e) {
                console.warn("Publish Network Error, Service Worker should handle:", e);
            }
        } else {
            await dbSvc.addOfflineQ({ event: signedEvent, ts: Date.now() });
        }

        return signedEvent;
    },

    async deleteEv(eventIdToDelete) {
        const user = appStore.get().user;
        if (!user) throw new Error("No Nostr identity connected to delete events.");

        const eventData = {
            kind: 5,
            content: "Reason for deletion (optional)",
            tags: [['e', eventIdToDelete]]
        };

        const signedDeletionEvent = await this.pubEv(eventData);

        appStore.set(s => ({ reports: s.reports.filter(r => r.id !== eventIdToDelete) }));
        await dbSvc.rmRep(eventIdToDelete);
        showToast("Report deletion event sent (NIP-09).", 'info');

        return signedDeletionEvent;
    },

    async fetchProf(pubkey) {
        let profile = await dbSvc.getProf(pubkey);
        if (profile && (Date.now() - (profile.fetchedAt || 0)) < 864e5) return profile;

        const filter = { kinds: [C.NOSTR_KIND_PROFILE], authors: [pubkey], limit: 1 };
        const relaysToQuery = Array.from(_nostrRlys.values()).filter(r => r.status === 1);

        if (relaysToQuery.length === 0) return profile;

        try {
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
                        ...parsedContent
                    };
                    await dbSvc.addProf(profile);
                    return profile;
                } catch (e) {
                    console.error("Error parsing profile content:", e);
                }
            }
        } catch (e) {
            showToast(`Error fetching profile for ${formatNpubShort(pubkey)}: ${e.message}`, 'error');
        }
        return profile;
    },

    async fetchInteractions(reportId, reportPk) {
        const filters = [
            { kinds: [C.NOSTR_KIND_REACTION], "#e": [reportId] },
            { kinds: [C.NOSTR_KIND_NOTE], "#e": [reportId] }
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
                return [];
            })
        );

        const results = await Promise.allSettled(fetchPromises);
        const uniqueEvents = new Map();

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

        return allInteractions.sort((a, b) => a.created_at - b.created_at);
    },

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
            content: '',
            tags: tags
        };

        return this.pubEv(eventData);
    },

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

export const offSvc = {
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
                if (response.ok || response.status === 503) {
                    await dbSvc.rmOfflineQ(item.qid);
                }
            } catch (e) {
                console.error("Error processing offline queue item:", e);
                showToast(`Failed to sync offline event: ${e.message}`, 'error');
            }
        }
    },

    setupSyncLs() {
        window.addEventListener('online', () => { this.procQ() });
        window.addEventListener('offline', () => {});

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
        this.procQ();
    },
};

let _map, _mapRepsLyr = L.layerGroup(),
    _mapTileLyr;
let _drawnItems;
let _drawControl;

const handleDrawCreated = async e => {
    const layer = e.layer;
    const geojson = layer.toGeoJSON();
    const shapeId = generateUUID();
    geojson.properties = { ...geojson.properties, id: shapeId };
    layer.options.id = shapeId;

    _drawnItems.addLayer(layer);
    await dbSvc.addDrawnShape({ id: shapeId, geojson: geojson });
    appStore.set(s => ({ drawnShapes: [...s.drawnShapes, geojson] }));
    showToast("Shape drawn and saved!", 'success');
};

const handleDrawEdited = async e => {
    for (const layer of Object.values(e.layers._layers)) {
        const geojson = layer.toGeoJSON();
        const shapeId = layer.options.id;
        geojson.properties = { ...geojson.properties, id: shapeId };
        await dbSvc.addDrawnShape({ id: shapeId, geojson: geojson });
    }
    const updatedShapes = await dbSvc.getAllDrawnShapes();
    appStore.set({ drawnShapes: updatedShapes.map(s => s.geojson) });
    showToast("Shape edited and saved!", 'success');
};

const handleDrawDeleted = async e => {
    for (const layer of Object.values(e.layers._layers)) {
        const shapeId = layer.options.id;
        await dbSvc.rmDrawnShape(shapeId);
    }
    const updatedShapes = await dbSvc.getAllDrawnShapes();
    appStore.set({ drawnShapes: updatedShapes.map(s => s.geojson) });
    showToast("Shape deleted!", 'info');
};

export const mapSvc = {
    init(id = 'map-container') {
        const tileUrl = confSvc.getTileServer();
        _map = L.map(id).setView([20, 0], 3);
        _mapTileLyr = L.tileLayer(tileUrl, { attribution: '&copy; OSM & NM', maxZoom: 19 }).addTo(_map);

        _mapRepsLyr = L.markerClusterGroup();
        _map.addLayer(_mapRepsLyr);

        _drawnItems = new L.FeatureGroup();
        _map.addLayer(_drawnItems);

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
                polyline: false,
                rectangle: true,
                circle: true,
                marker: false,
                circlemarker: false
            }
        });

        appStore.set({ map: _map });

        _map.on('moveend zoomend', () => {
            const bounds = _map.getBounds();
            const geohashes = getGhPrefixes(bounds);
            appStore.set({ mapBnds: bounds, mapGhs: geohashes });
        });

        _map.on(L.Draw.Event.CREATED, handleDrawCreated);
        _map.on(L.Draw.Event.EDITED, handleDrawEdited);
        _map.on(L.Draw.Event.DELETED, handleDrawDeleted);

        this.loadDrawnShapes();

        return _map;
    },

    async loadDrawnShapes() {
        const storedShapes = await dbSvc.getAllDrawnShapes();
        _drawnItems.clearLayers();
        const geojsonShapes = [];
        storedShapes.forEach(s => {
            const layer = L.GeoJSON.geometryToLayer(s.geojson);
            layer.options.id = s.id;
            _drawnItems.addLayer(layer);
            geojsonShapes.push(s.geojson);
        });
        appStore.set({ drawnShapes: geojsonShapes });
    },

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

    getDrawControl: () => _drawControl,

    getDrawnItems: () => _drawnItems,

    updTile(url) {
        if (_mapTileLyr) _mapTileLyr.setUrl(url);
    },

    updReps(reports) {
        if (!_map) return;
        _mapRepsLyr.clearLayers();
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

    disPickLoc: () => {
        if ($('#map-container')) $('#map-container').style.cursor = '';
        if (_map) _map.off('click');
    },

    get: () => _map,
};

export const imgSvc = {
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

        if (nip96Host) {
            uploadUrl = nip96Host;
            if (nip96Token) headers['Authorization'] = `Bearer ${nip96Token}`;
            body = file;
            headers['Content-Type'] = file.type;
        } else if (!imgHost || imgHost === C.IMG_UPLOAD_NOSTR_BUILD) {
            uploadUrl = C.IMG_UPLOAD_NOSTR_BUILD;
            const formData = new FormData();
            formData.append('file', file);
            body = formData;
        } else {
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
            if (!finalUrl && typeof data === 'string' && data.startsWith('http')) finalUrl = data;
            if (!finalUrl) throw new Error('Image URL not found in response from host.');

            return finalUrl;
        } catch (e) {
            console.error("Image upload error:", e);
            throw new Error(`Image upload failed: ${e.message}`);
        }
    }
};
