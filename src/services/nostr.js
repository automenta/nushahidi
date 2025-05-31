import { nip11 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/lib/pool';
import {appStore} from '../store.js';
import {C, parseReport, showToast} from '../utils.js';
import {withLoading, withToast} from '../decorators.js';
import {dbSvc} from './db.js';
import {idSvc} from './identity.js';

let _pool = null;
let _activeSubs = new Map();

const updRlyStore = (url, status, nip11Doc = null) => {
    appStore.set(s => {
        const updatedRelays = s.relays.map(r => {
            if (r.url === url) {
                return { ...r, status, nip11: nip11Doc || r.nip11 };
            }
            return r;
        });
        return { relays: updatedRelays };
    });
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

const buildReportFilter = (appState, mapGeohashes) => {
    const focusTag = appState.currentFocusTag;
    const followedPubkeys = appState.followedPubkeys.map(f => f.pk);

    const filter = { kinds: [C.NOSTR_KIND_REPORT] };

    if (focusTag && focusTag !== C.FOCUS_TAG_DEFAULT) {
        filter['#t'] = [focusTag.substring(1)];
    }

    if (appState.ui.followedOnlyFilter && followedPubkeys.length > 0) {
        filter.authors = followedPubkeys;
    }

    if (mapGeohashes?.length > 0) {
        filter['#g'] = mapGeohashes;
    }
    return filter;
};

const handleSubscriptionEvent = async (event) => {
    const report = parseReport(event);
    if (appStore.get().settings.mute.includes(report.pk)) return;
    await addReportToStoreAndDb(event);
};

const publishEventOnline = async (signedEvent) => {
    try {
        const response = await fetch('/api/publishNostrEvent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(signedEvent)
        });

        if (!response.ok && response.status !== 503) {
            console.error("Publish Error (SW Proxy):", response.statusText);
            showToast(`Publish failed: ${response.statusText}`, 'error');
        } else if (response.status === 503) {
            console.log("Publish deferred by Service Worker (offline or network issue).");
            showToast("Publish deferred (offline or network issue).", 'info');
        } else {
            showToast("Event published successfully!", 'success');
        }
    } catch (e) {
        console.warn("Publish Network Error, Service Worker should handle:", e);
        showToast(`Network error during publish: ${e.message}. Will retry offline.`, 'warning');
    }
};

const queueEventOffline = async (signedEvent) => {
    await dbSvc.addOfflineQ({ event: signedEvent, ts: Date.now() });
    showToast("Offline. Event added to queue for later publishing.", 'info');
};

const fetchProfileLogic = async (pubkey) => {
    let profile = await dbSvc.getProf(pubkey);
    if (profile && (Date.now() - (profile.fetchedAt || 0)) < 864e5) return profile;

    const filter = { kinds: [C.NOSTR_KIND_PROFILE], authors: [pubkey], limit: 1 };
    const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);

    if (relaysToQuery.length === 0) {
        throw new Error("No connected relays to fetch profiles from.");
    }

    const event = await _pool.get(relaysToQuery, filter);
    if (event) {
        try {
            const parsedContent = JSON.parse(event.content);
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
            throw new Error("Error parsing profile content.");
        }
    }
    return profile;
};

const fetchInteractionsLogic = async (reportId) => {
    const filters = [
        { kinds: [C.NOSTR_KIND_REACTION], "#e": [reportId] },
        { kinds: [C.NOSTR_KIND_NOTE], "#e": [reportId] }
    ];
    const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
    if (relaysToQuery.length === 0) {
        throw new Error("No connected relays to fetch interactions from.");
    }

    const events = await _pool.list(relaysToQuery, filters);
    const uniqueEvents = new Map();

    events.forEach(ev => {
        if (!uniqueEvents.has(ev.id)) {
            uniqueEvents.set(ev.id, ev);
        }
    });

    return Array.from(uniqueEvents.values()).map(ev => ({
        id: ev.id,
        kind: ev.kind,
        content: ev.content,
        pubkey: ev.pubkey,
        created_at: ev.created_at,
        tags: ev.tags,
        reportId: reportId
    })).sort((a, b) => a.created_at - b.created_at);
};

const publishContactsLogic = async (contacts) => {
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

    return nostrSvc.pubEv(eventData);
};

const fetchContactsLogic = async () => {
    const user = appStore.get().user;
    if (!user) return [];

    const filter = { kinds: [C.NOSTR_KIND_CONTACTS], authors: [user.pk], limit: 1 };
    const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);

    if (relaysToQuery.length === 0) {
        throw new Error("No connected relays to fetch contacts from.");
    }

    const event = await _pool.get(relaysToQuery, filter);
    if (event) {
        const latestContactsEvent = event;
        return latestContactsEvent.tags
            .filter(tag => tag[0] === 'p' && tag[1])
            .map(tag => ({
                pubkey: tag[1],
                relay: tag[2] || '',
                petname: tag[3] || ''
            }));
    }
    return [];
};

export const nostrSvc = {
    async connRlys() {
        // Only re-initialize if _pool is not a valid SimplePool instance
        if (!_pool || typeof _pool.on !== 'function') {
            try {
                const newPool = new SimplePool(); // Create a new instance
                // Validate the newly created instance immediately
                if (typeof newPool.on !== 'function') {
                    console.error("SimplePool constructor returned an object without an 'on' method.");
                    throw new Error("Nostr SimplePool failed to initialize correctly: Missing 'on' method.");
                }
                _pool = newPool; // Assign to _pool only if valid

                // Attach listeners only once when the pool is successfully created
                _pool.on('relay:connect', (url) => {
                    updRlyStore(url, 'connected');
                    showToast(`Connected to ${url}`, 'success', 2000);
                });
                _pool.on('relay:disconnect', (url) => {
                    updRlyStore(url, 'disconnected');
                    showToast(`Disconnected from ${url}`, 'warning', 2000);
                });
                _pool.on('relay:error', (url) => {
                    updRlyStore(url, 'error');
                    showToast(`Error connecting to ${url}`, 'error', 2000);
                });
            } catch (e) {
                console.error("Error initializing Nostr SimplePool:", e);
                _pool = null; // Ensure _pool is null if initialization failed
                showToast(`Critical Nostr error: ${e.message}. Please refresh.`, 'error', 0);
                throw e; // Re-throw to stop further execution if pool init fails
            }
        }

        // If _pool is still null here, it means initialization failed.
        // This check is crucial before attempting to use _pool.
        if (!_pool) {
            throw new Error("Nostr SimplePool is not initialized. Cannot connect relays.");
        }

        const currentRelaysInStore = appStore.get().relays;
        const poolRelayUrls = _pool.relays.map(r => r.url);

        for (const rConf of currentRelaysInStore) {
            if (!rConf.read && !rConf.write) continue;

            if (!poolRelayUrls.includes(rConf.url)) {
                _pool.addRelay(rConf.url);
                updRlyStore(rConf.url, 'connecting');

                if (!rConf.nip11) {
                    try {
                        const nip11Doc = await nip11.fetchRelayInformation(rConf.url);
                        updRlyStore(rConf.url, 'connecting', nip11Doc);
                    } catch (e) {
                        console.warn(`Failed to fetch NIP-11 for ${rConf.url}: ${e.message}`);
                    }
                }
            }
        }
    },

    discAllRlys() {
        if (_pool) {
            _pool.close();
            _pool = null;
        }
        _activeSubs.forEach(s => {
            try { s.sub.unsub(); } catch (e) { console.warn(`Error unsubscribing:`, e); }
        });
        _activeSubs.clear();
        appStore.set(s => ({ relays: s.relays.map(r => ({ ...r, status: 'disconnected' })) }));
        showToast("All relays disconnected.", 'info');
    },

    async subToReps() {
        this.unsubAllReps();

        const appState = appStore.get();
        const mapGeohashes = appState.mapGhs;

        const relaysToQuery = appState.relays.filter(r => r.read).map(r => r.url);

        if (relaysToQuery.length === 0) {
            showToast("No read-enabled relays configured for subscription.", 'warning');
            return;
        }

        // Ensure _pool is connected and valid before subscribing
        await this.connRlys();

        const currentFilter = buildReportFilter(appState, mapGeohashes);

        const subscriptionId = `reps-${Date.now()}`;
        try {
            const sub = _pool.sub(relaysToQuery, [currentFilter]);

            sub.on('event', handleSubscriptionEvent);
            sub.on('eose', () => {});

            _activeSubs.set(subscriptionId, { sub, rUs: relaysToQuery, filt: currentFilter, type: 'reports' });
        } catch (e) {
            console.error(`Subscription Error:`, e);
            showToast(`Subscription error: ${e.message}`, 'error');
        }
    },

    unsubAllReps() {
        _activeSubs.forEach((s, id) => {
            if (s.type === 'reports') {
                try { s.sub.unsub(); } catch (e) { console.warn(`Error unsubscribing ${id}:`, e); }
                _activeSubs.delete(id);
            }
        });
    },

    async refreshSubs() {
        // This function now primarily orchestrates, ensuring connRlys is awaited
        // and then subToReps is called. The internal checks in connRlys and subToReps
        // handle the _pool initialization.
        await this.connRlys();
        await this.subToReps();
    },

    async pubEv(eventData) {
        const signedEvent = await idSvc.signEv(eventData);

        if (signedEvent.kind === C.NOSTR_KIND_REPORT) {
            await addReportToStoreAndDb(signedEvent);
        }

        if (appStore.get().online) {
            await publishEventOnline(signedEvent);
        } else {
            await queueEventOffline(signedEvent);
        }
        return signedEvent;
    },

    deleteEv: withLoading(withToast(async (eventIdToDelete) => {
        const user = appStore.get().user;
        if (!user) throw new Error("No Nostr identity connected to delete events.");

        const eventData = {
            kind: 5,
            content: "Reason for deletion (optional)",
            tags: [['e', eventIdToDelete]]
        };

        const signedDeletionEvent = await nostrSvc.pubEv(eventData);

        appStore.set(s => ({ reports: s.reports.filter(r => r.id !== eventIdToDelete) }));
        await dbSvc.rmRep(eventIdToDelete);
        return signedDeletionEvent;
    }, "Report deletion event sent (NIP-09).", "Failed to delete report")),

    fetchProf: withLoading(withToast(fetchProfileLogic, null, "Error fetching profile")),

    fetchInteractions: withLoading(withToast(fetchInteractionsLogic, null, "Error fetching interactions")),

    pubContacts: withLoading(withToast(publishContactsLogic, "NIP-02 contact list published!", "Error publishing contacts")),

    fetchContacts: withLoading(withToast(fetchContactsLogic, null, "Error fetching contacts"))
};
