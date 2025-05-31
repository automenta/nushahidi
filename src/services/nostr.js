import { relayInit, nip11 } from 'nostr-tools';
import { appStore } from '../store.js';
import { C, parseReport, showToast } from '../utils.js';
import { withLoading, withToast } from '../decorators.js';
import { dbSvc } from './db.js';
import { idSvc } from './identity.js';

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
            nostrSvc.subToReps(relay);
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

const _buildReportFilter = (appState, relayConfig, mapGeohashes) => {
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
        if (relayConfig.nip11?.supported_nips?.includes(52)) {
            filter['#g'] = mapGeohashes;
        } else {
            filter['#g'] = [mapGeohashes[0]];
        }
    }
    return filter;
};

const _handleSubscriptionEvent = async (event) => {
    const report = parseReport(event);
    if (appStore.get().settings.mute.includes(report.pk)) return;
    await addReportToStoreAndDb(event);
};

const _publishEventOnline = async (signedEvent) => {
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

const _queueEventOffline = async (signedEvent) => {
    await dbSvc.addOfflineQ({ event: signedEvent, ts: Date.now() });
    showToast("Offline. Event added to queue for later publishing.", 'info');
};

const _fetchProfileLogic = async (pubkey) => {
    let profile = await dbSvc.getProf(pubkey);
    if (profile && (Date.now() - (profile.fetchedAt || 0)) < 864e5) return profile;

    const filter = { kinds: [C.NOSTR_KIND_PROFILE], authors: [pubkey], limit: 1 };
    const relaysToQuery = Array.from(_nostrRlys.values()).filter(r => r.status === 1);

    if (relaysToQuery.length === 0) {
        throw new Error("No connected relays to fetch profiles from.");
    }

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
            throw new Error("Error parsing profile content.");
        }
    }
    return profile;
};

const _fetchInteractionsLogic = async (reportId) => {
    const filters = [
        { kinds: [C.NOSTR_KIND_REACTION], "#e": [reportId] },
        { kinds: [C.NOSTR_KIND_NOTE], "#e": [reportId] }
    ];
    const relaysToQuery = Array.from(_nostrRlys.values()).filter(r => r.status === 1 && r.read);
    if (relaysToQuery.length === 0) {
        throw new Error("No connected relays to fetch interactions from.");
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

const _publishContactsLogic = async (contacts) => {
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

const _fetchContactsLogic = async () => {
    const user = appStore.get().user;
    if (!user) return [];

    const filter = { kinds: [C.NOSTR_KIND_CONTACTS], authors: [user.pk], limit: 1 };
    const relaysToQuery = Array.from(_nostrRlys.values()).filter(r => r.status === 1 && r.read);

    if (relaysToQuery.length === 0) {
        throw new Error("No connected relays to fetch contacts from.");
    }

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
    return [];
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
        const mapGeohashes = appState.mapGhs;

        const relaysToQuery = specificRelay ? [specificRelay] : Array.from(_nostrRlys.values());

        relaysToQuery.forEach(relay => {
            const relayConfig = appStore.get().relays.find(rc => rc.url === relay.url);
            if (relay.status !== 1 || !relayConfig?.read) return;

            const currentFilter = _buildReportFilter(appState, relayConfig, mapGeohashes);
            const subscriptionId = `reps-${relay.url}-${Date.now()}`;
            try {
                const sub = relay.sub([currentFilter]);

                sub.on('event', _handleSubscriptionEvent);
                sub.on('eose', () => {});

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
            await _publishEventOnline(signedEvent);
        } else {
            await _queueEventOffline(signedEvent);
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

    fetchProf: withLoading(withToast(_fetchProfileLogic, null, "Error fetching profile")),

    fetchInteractions: withLoading(withToast(_fetchInteractionsLogic, null, "Error fetching interactions")),

    pubContacts: withLoading(withToast(_publishContactsLogic, "NIP-02 contact list published!", "Error publishing contacts")),

    fetchContacts: withLoading(withToast(_fetchContactsLogic, null, "Error fetching contacts"))
};
