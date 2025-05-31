import { SimplePool } from 'nostr-tools/pool';
import { getEventHash } from 'nostr-tools/pure'; // getEventHash is still useful for event IDs
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
    // SimplePool handles validateEvent and verifySignature internally
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

const _publishEventToRelays = async signedEvent => {
    const writeRelays = appStore.get().relays.filter(r => r.write && _connectedRelays.has(r.url)).map(r => r.url);
    if (!writeRelays.length) {
        console.warn("No connected write relays available to publish event.");
        return false; // Indicate failure
    }

    try {
        // Use Promise.any to resolve as soon as one relay publishes successfully
        await Promise.any(writeRelays.map(url => {
            const pub = _pool.publish(url, signedEvent);
            return new Promise((resolve, reject) => {
                pub.on('ok', () => {
                    console.log(`Event ${signedEvent.id.substring(0, 8)}... published to ${url}`);
                    resolve(true); // Resolve with true on success
                });
                pub.on('failed', reason => {
                    console.error(`Failed to publish event ${signedEvent.id.substring(0, 8)}... to ${url}: ${reason}`);
                    reject(new Error(`Failed to publish to ${url}: ${reason}`)); // Reject on failure
                });
                // Add a timeout for relays that don't respond
                setTimeout(() => {
                    reject(new Error(`Timeout publishing event ${signedEvent.id.substring(0, 8)}... to ${url}`));
                }, 5000); // 5 second timeout
            });
        }));
        return true; // At least one relay published successfully
    } catch (e) {
        console.error("All publish attempts failed or timed out:", e);
        return false; // All attempts failed
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
        const sub = _pool.sub(relaysToQuery, [filter], {
            onevent: event => handleEvent(event, event.relay),
            oneose: () => console.log('Reports EOSE')
        });
        _activeSubs.set('reports', { sub, type: 'reports' });
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

    async pubEv(eventData, fromOfflineQueue = false) {
        const signedEvent = await idSvc.signEv(eventData);
        if (signedEvent.kind === C.NOSTR_KIND_REPORT) await addReportToStoreAndDb(signedEvent);

        const published = await _publishEventToRelays(signedEvent);
        if (!published && !fromOfflineQueue) {
            // Only add to offline queue if it wasn't already from there
            await dbSvc.addOfflineQ({ qid: signedEvent.id, event: signedEvent, ts: Date.now() });
            appStore.set(s => ({ offlineQueueCount: s.offlineQueueCount + 1 }));
            showToast("Event queued for offline publishing.", 'info');
        }
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
        const published = await _publishEventToRelays(signedEvent);
        if (!published) {
            await dbSvc.addOfflineQ({ qid: signedEvent.id, event: signedEvent, ts: Date.now() });
            appStore.set(s => ({ offlineQueueCount: s.offlineQueueCount + 1 }));
            showToast("Deletion event queued for offline publishing.", 'info');
        } else {
            showToast("Report deletion event published.", 'success');
        }
        await dbSvc.rmRep(eventId);
        appStore.set(s => ({ reports: s.reports.filter(r => r.id !== eventId) }));
    },

    async fetchProf(pubkey) {
        const cachedProf = await dbSvc.getProf(pubkey);
        if (cachedProf) return cachedProf;

        const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
        if (!relaysToQuery.length) return null;

        return new Promise(resolve => {
            const sub = _pool.sub(relaysToQuery, [{ kinds: [C.NOSTR_KIND_PROFILE], authors: [pubkey], limit: 1 }], {
                onevent: async event => {
                    await handleEvent(event, event.relay);
                    resolve(JSON.parse(event.content));
                    sub.unsub();
                },
                oneose: () => resolve(null)
            });
        });
    },

    async fetchContacts() {
        const user = appStore.get().user;
        if (!user) return [];

        const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
        if (!relaysToQuery.length) return [];

        return new Promise(resolve => {
            const sub = _pool.sub(relaysToQuery, [{ kinds: [C.NOSTR_KIND_CONTACTS], authors: [user.pk], limit: 1 }], {
                onevent: async event => {
                    const contacts = event.tags.filter(t => t[0] === 'p').map(t => ({ pubkey: t[1], relay: t[2], petname: t[3] }));
                    resolve(contacts);
                    sub.unsub();
                },
                oneose: () => resolve([])
            });
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
        const published = await _publishEventToRelays(signedEvent);
        if (!published) {
            await dbSvc.addOfflineQ({ qid: signedEvent.id, event: signedEvent, ts: Date.now() });
            appStore.set(s => ({ offlineQueueCount: s.offlineQueueCount + 1 }));
            showToast("NIP-02 contact list queued for offline publishing.", 'info');
        } else {
            showToast("NIP-02 contact list published!", 'success');
        }
    },

    async fetchInteractions(eventId, reportPk) {
        const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
        if (!relaysToQuery.length) return [];

        const filter = {
            kinds: [C.NOSTR_KIND_REACTION, C.NOSTR_KIND_NOTE],
            '#e': [eventId],
            '#p': [reportPk]
        };

        const interactions = [];
        return new Promise(resolve => {
            const sub = _pool.sub(relaysToQuery, [filter], {
                onevent: event => {
                    interactions.push(event);
                },
                oneose: () => {
                    resolve(interactions.sort((a, b) => a.created_at - b.created_at));
                    sub.unsub();
                }
            });
        });
    }
};
