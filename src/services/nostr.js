import { SimplePool, getEventHash, validateEvent, verifySignature } from 'nostr-tools';
import { appStore } from '../store.js';
import { dbSvc } from '../services/db.js';
import { idSvc } from './identity.js';
import { C, parseReport, showToast } from '../utils.js';

let _pool = null;
const _activeSubs = new Map();
const _relayStatus = new Map();
const _connectedRelays = new Set();

const updateRelayStatus = (url, status) => {
    _relayStatus.set(url, status);
    appStore.set(s => ({
        relays: s.relays.map(r => r.url === url ? { ...r, status } : r)
    }));
};

const addReportToStoreAndDb = async signedEvent => {
    const report = parseReport(signedEvent);
    report.interactions = (await dbSvc.getRep(report.id))?.interactions || [];
    appStore.set(s => {
        const updatedReports = s.reports.some(rp => rp.id === report.id) ?
            s.reports.map(rp => rp.id === report.id ? report : rp) :
            [...s.reports, report];
        return { reports: updatedReports.sort((a, b) => b.at - a.at) };
    });
    await dbSvc.addRep(report);
};

const addProfileToStoreAndDb = async signedEvent => {
    const profile = JSON.parse(signedEvent.content);
    profile.pk = signedEvent.pubkey;
    profile.at = signedEvent.created_at;
    await dbSvc.addProf(profile);
};

const addInteractionToReport = async signedEvent => {
    const eventId = signedEvent.tags.find(t => t[0] === 'e')?.[1];
    if (!eventId) return;

    const report = await dbSvc.getRep(eventId);
    if (report) {
        const newInteraction = { ...signedEvent, pubkey: signedEvent.pubkey, created_at: signedEvent.created_at };
        report.interactions = [...(report.interactions || []), newInteraction];
        await dbSvc.addRep(report);
        appStore.set(s => ({
            reports: s.reports.map(r => r.id === report.id ? report : r)
        }));
    }
};

const handleEvent = async (event, relayUrl) => {
    if (!validateEvent(event) || !verifySignature(event)) {
        console.warn("Invalid event received:", event);
        return;
    }

    switch (event.kind) {
        case C.NOSTR_KIND_REPORT:
            await addReportToStoreAndDb(event);
            break;
        case C.NOSTR_KIND_PROFILE:
            await addProfileToStoreAndDb(event);
            break;
        case C.NOSTR_KIND_REACTION:
        case C.NOSTR_KIND_NOTE:
            await addInteractionToReport(event);
            break;
        case 5:
            await dbSvc.rmRep(event.tags.find(t => t[0] === 'e')?.[1]);
            appStore.set(s => ({ reports: s.reports.filter(r => r.id !== event.tags.find(t => t[0] === 'e')?.[1]) }));
            break;
    }
};

const buildReportFilter = (appState, mapGeohashes) => {
    const filter = { kinds: [C.NOSTR_KIND_REPORT] };
    if (appState.currentFocusTag && appState.currentFocusTag !== C.FOCUS_TAG_DEFAULT) filter['#t'] = [appState.currentFocusTag.substring(1)];
    if (appState.ui.followedOnlyFilter && appState.followedPubkeys?.length) filter.authors = appState.followedPubkeys.map(f => f.pk);
    if (mapGeohashes?.length) filter['#g'] = mapGeohashes;
    return filter;
};

const publishEventOnline = async signedEvent => {
    // Rely on Workbox Background Sync for offline queuing and retries.
    // This function simply attempts the fetch request.
    try {
        const response = await fetch('/api/publishNostrEvent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(signedEvent)
        });
        if (!response.ok) {
            console.error("Publish Error (SW Proxy):", response.statusText);
            throw new Error(response.statusText);
        }
    } catch (e) {
        console.error("Publish Error:", e);
        throw e;
    }
};

export const nostrSvc = {
    async updateRelayConnections() {
        if (!_pool) {
            try {
                _pool = new SimplePool();
            } catch (e) {
                console.error("Error initializing Nostr SimplePool:", e);
                _pool = null;
                showToast(`Critical Nostr error: ${e.message}. Please refresh.`, 'error', 0);
                throw e;
            }
        }

        const desiredRelays = new Set(appStore.get().relays.filter(r => r.read || r.write).map(r => r.url));
        const relaysToDisconnect = new Set([..._connectedRelays].filter(url => !desiredRelays.has(url)));
        const relaysToConnect = new Set([...desiredRelays].filter(url => !_connectedRelays.has(url)));

        for (const url of relaysToDisconnect) {
            _pool.removeRelay(url);
            _connectedRelays.delete(url);
            updateRelayStatus(url, 'disconnected');
        }

        for (const url of relaysToConnect) {
            updateRelayStatus(url, 'connecting');
            try {
                await _pool.ensureRelay(url);
                _connectedRelays.add(url);
                updateRelayStatus(url, 'connected');
            } catch (e) {
                console.error(`Failed to connect to relay ${url}:`, e);
                updateRelayStatus(url, 'failed');
            }
        }
    },

    discAllRlys() {
        _pool?.close();
        _pool = null;
        _activeSubs.forEach(s => s.sub.unsub());
        _activeSubs.clear();
        _connectedRelays.clear();
        appStore.set(s => ({ relays: s.relays.map(r => ({ ...r, status: 'disconnected' })) }));
        showToast("All relays disconnected.", 'info');
    },

    async subToReps() {
        this.unsubAllReps();

        const appState = appStore.get();
        const relaysToQuery = appState.relays.filter(r => r.read).map(r => r.url);

        if (!relaysToQuery.length) {
            showToast("No read-enabled relays configured for subscription.", 'warning');
            return;
        }

        const filter = buildReportFilter(appState, appState.mapGhs);
        const sub = _pool.sub(relaysToQuery, [filter]);
        _activeSubs.set('reports', { sub, type: 'reports' });

        sub.on('event', event => handleEvent(event, event.relay));
        sub.on('eose', () => console.log('Reports EOSE'));
    },

    unsubAllReps() {
        _activeSubs.forEach((s, id) => {
            if (s.type === 'reports') {
                s.sub.unsub();
                _activeSubs.delete(id);
            }
        });
    },

    async refreshSubs() {
        await this.updateRelayConnections();
        await this.subToReps();
    },

    async pubEv(eventData) {
        const signedEvent = await idSvc.signEv(eventData);
        if (signedEvent.kind === C.NOSTR_KIND_REPORT) await addReportToStoreAndDb(signedEvent);
        await publishEventOnline(signedEvent); // This will be handled by Workbox for offline queuing
        return signedEvent;
    },

    async deleteEv(eventId) {
        const eventTemplate = {
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['e', eventId]],
            content: 'Event deleted'
        };
        const signedEvent = await idSvc.signEv(eventTemplate);
        await publishEventOnline(signedEvent); // This will be handled by Workbox for offline queuing
        await dbSvc.rmRep(eventId);
        appStore.set(s => ({ reports: s.reports.filter(r => r.id !== eventId) }));
        showToast("Report deletion event published.", 'success');
    },

    async fetchProf(pubkey) {
        const cachedProf = await dbSvc.getProf(pubkey);
        if (cachedProf) return cachedProf;

        const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
        if (!relaysToQuery.length) return null;

        const sub = _pool.sub(relaysToQuery, [{ kinds: [C.NOSTR_KIND_PROFILE], authors: [pubkey], limit: 1 }]);
        return new Promise(resolve => {
            sub.on('event', async event => {
                await handleEvent(event, event.relay);
                resolve(JSON.parse(event.content));
                sub.unsub();
            });
            sub.on('eose', () => resolve(null));
        });
    },

    async fetchContacts() {
        const user = appStore.get().user;
        if (!user) return [];

        const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
        if (!relaysToQuery.length) return [];

        const sub = _pool.sub(relaysToQuery, [{ kinds: [C.NOSTR_KIND_CONTACTS], authors: [user.pk], limit: 1 }]);
        return new Promise(resolve => {
            sub.on('event', async event => {
                const contacts = event.tags.filter(t => t[0] === 'p').map(t => ({ pubkey: t[1], relay: t[2], petname: t[3] }));
                resolve(contacts);
                sub.unsub();
            });
            sub.on('eose', () => resolve([]));
        });
    },

    async pubContacts(contacts) {
        const user = appStore.get().user;
        if (!user) throw new Error("No Nostr identity connected.");

        const eventTemplate = {
            kind: C.NOSTR_KIND_CONTACTS,
            created_at: Math.floor(Date.now() / 1000),
            tags: contacts.map(c => ['p', c.pubkey, c.relay || '', c.petname || '']),
            content: ''
        };
        const signedEvent = await idSvc.signEv(eventTemplate);
        await publishEventOnline(signedEvent);
        showToast("NIP-02 contact list published!", 'success');
    },

    async fetchInteractions(eventId, reportPk) {
        const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
        if (!relaysToQuery.length) return [];

        const filter = {
            kinds: [C.NOSTR_KIND_REACTION, C.NOSTR_KIND_NOTE],
            '#e': [eventId],
            '#p': [reportPk]
        };

        const sub = _pool.sub(relaysToQuery, [filter]);
        const interactions = [];
        return new Promise(resolve => {
            sub.on('event', event => {
                if (validateEvent(event) && verifySignature(event)) {
                    interactions.push(event);
                }
            });
            sub.on('eose', () => {
                resolve(interactions.sort((a, b) => a.created_at - b.created_at));
                sub.unsub();
            });
        });
    }
};
