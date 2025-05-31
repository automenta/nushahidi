import { SimplePool, getEventHash, validateEvent, verifySignature } from 'nostr-tools';
import { appStore } from '../store.js';
import { dbSvc } from '../services/db.js';
import { idSvc } from './identity.js';
import { C, parseReport, showToast } from '../utils.js';

let _pool = null;
const _activeSubs = new Map();
const _relayStatus = new Map();

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
        case 5: // Deletion event
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
    try {
        const response = await fetch('/api/publishNostrEvent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(signedEvent)
        });
        if (!response.ok && response.status !== 503) {
            console.error("Publish Error (SW Proxy):", response.statusText);
            showToast(`Publish failed: ${response.statusText}`, 'error');
            throw new Error(response.statusText);
        } else if (response.status === 503) {
            showToast("Service Worker offline. Event queued.", 'info');
            throw new Error("Service Worker offline");
        }
    } catch (e) {
        console.error("Publish Error:", e);
        throw e;
    }
};

const queueEventOffline = async signedEvent => {
    await dbSvc.addOfflineQ({ event: signedEvent, ts: Date.now() });
    showToast("Offline. Event added to queue for later publishing.", 'info');
};

export const nostrSvc = {
    async connRlys() {
        if (!_pool || typeof _pool.on !== 'function') {
            try {
                _pool = new SimplePool();
            } catch (e) {
                console.error("Error initializing Nostr SimplePool:", e);
                _pool = null;
                showToast(`Critical Nostr error: ${e.message}. Please refresh.`, 'error', 0);
                throw e;
            }
        }

        const relaysToConnect = appStore.get().relays.filter(r => r.read || r.write);
        for (const r of relaysToConnect) {
            if (_relayStatus.get(r.url) !== 'connected') {
                updateRelayStatus(r.url, 'connecting');
                try {
                    await _pool.ensureRelay(r.url);
                    updateRelayStatus(r.url, 'connected');
                } catch (e) {
                    console.error(`Failed to connect to relay ${r.url}:`, e);
                    updateRelayStatus(r.url, 'failed');
                }
            }
        }
    },

    discAllRlys() {
        _pool?.close();
        _pool = null;
        _activeSubs.forEach(s => s.sub.unsub());
        _activeSubs.clear();
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
        await this.connRlys();
        await this.subToReps();
    },

    async pubEv(eventData) {
        const signedEvent = await idSvc.signEv(eventData);
        if (signedEvent.kind === C.NOSTR_KIND_REPORT) await addReportToStoreAndDb(signedEvent);
        appStore.get().online ? await publishEventOnline(signedEvent) : await queueEventOffline(signedEvent);
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
        appStore.get().online ? await publishEventOnline(signedEvent) : await queueEventOffline(signedEvent);
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
        appStore.get().online ? await publishEventOnline(signedEvent) : await queueEventOffline(signedEvent);
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
