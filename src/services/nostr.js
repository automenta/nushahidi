import {SimplePool} from 'nostr-tools/pool';
import {appStore} from '../store.js';
import {C, parseReport, showToast} from '../utils.js';
import {withLoading, withToast} from '../decorators.js';
import {dbSvc} from './db.js';
import {idSvc} from './identity.js';

let _pool = null;
let _activeSubs = new Map();

const updRlyStore = (url, status, nip11Doc = null) => appStore.set(s => ({
    relays: s.relays.map(r => r.url === url ? { ...r, status, nip11: nip11Doc || r.nip11 } : r)
}));

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

const buildReportFilter = (appState, mapGeohashes) => {
    const filter = { kinds: [C.NOSTR_KIND_REPORT] };
    if (appState.currentFocusTag && appState.currentFocusTag !== C.FOCUS_TAG_DEFAULT) filter['#t'] = [appState.currentFocusTag.substring(1)];
    if (appState.ui.followedOnlyFilter && appState.followedPubkeys?.length) filter.authors = appState.followedPubkeys.map(f => f.pk);
    if (mapGeohashes?.length) filter['#g'] = mapGeohashes;
    return filter;
};

const handleSubscriptionEvent = async event => {
    const report = parseReport(event);
    if (!appStore.get().settings.mute.includes(report.pk)) await addReportToStoreAndDb(event);
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
        } else if (response.status === 503) {
            showToast("Publish deferred (offline or network issue).", 'info');
        } else {
            showToast("Event published successfully!", 'success');
        }
    } catch (e) {
        console.warn("Publish Network Error, Service Worker should handle:", e);
        showToast(`Network error during publish: ${e.message}. Will retry offline.`, 'warning');
    }
};

const queueEventOffline = async signedEvent => {
    await dbSvc.addOfflineQ({ event: signedEvent, ts: Date.now() });
    showToast("Offline. Event added to queue for later publishing.", 'info');
};

const fetchProfileLogic = async pubkey => {
    let profile = await dbSvc.getProf(pubkey);
    if (profile && (Date.now() - (profile.fetchedAt || 0)) < 864e5) return profile;

    const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
    if (!relaysToQuery.length) throw new Error("No connected relays to fetch profiles from.");

    const event = await _pool.get(relaysToQuery, { kinds: [C.NOSTR_KIND_PROFILE], authors: [pubkey], limit: 1 });
    if (!event) return profile;

    try {
        const parsedContent = JSON.parse(event.content);
        profile = { pk: pubkey, fetchedAt: Date.now(), ...parsedContent };
        await dbSvc.addProf(profile);
        return profile;
    } catch (e) {
        console.error("Error parsing profile content:", e);
        throw new Error("Error parsing profile content.");
    }
};

const fetchInteractionsLogic = async reportId => {
    const filters = [{ kinds: [C.NOSTR_KIND_REACTION], "#e": [reportId] }, { kinds: [C.NOSTR_KIND_NOTE], "#e": [reportId] }];
    const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
    if (!relaysToQuery.length) throw new Error("No connected relays to fetch interactions from.");

    const events = await _pool.list(relaysToQuery, filters);
    const uniqueEvents = new Map(events.map(ev => [ev.id, ev]));

    return Array.from(uniqueEvents.values())
        .map(ev => ({ id: ev.id, kind: ev.kind, content: ev.content, pubkey: ev.pubkey, created_at: ev.created_at, tags: ev.tags, reportId }))
        .sort((a, b) => a.created_at - b.created_at);
};

const publishContactsLogic = async contacts => {
    const user = appStore.get().user;
    if (!user) throw new Error("No Nostr identity connected to publish contacts.");

    const tags = contacts.map(c => ['p', c.pubkey, c.relay || '', c.petname || ''].filter(Boolean));
    return nostrSvc.pubEv({ kind: C.NOSTR_KIND_CONTACTS, content: '', tags });
};

const fetchContactsLogic = async () => {
    const user = appStore.get().user;
    if (!user) return [];

    const relaysToQuery = appStore.get().relays.filter(r => r.read).map(r => r.url);
    if (!relaysToQuery.length) throw new Error("No connected relays to fetch contacts from.");

    const event = await _pool.get(relaysToQuery, { kinds: [C.NOSTR_KIND_CONTACTS], authors: [user.pk], limit: 1 });
    return event?.tags.filter(tag => tag[0] === 'p' && tag[1]).map(tag => ({
        pubkey: tag[1],
        relay: tag[2] || '',
        petname: tag[3] || ''
    })) || [];
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

        await this.connRlys();

        const currentFilter = buildReportFilter(appState, appState.mapGhs);
        const subscriptionId = `reps-${Date.now()}`;
        try {
            const sub = _pool.subscribe(relaysToQuery, [currentFilter], { onevent: handleSubscriptionEvent, oneose: () => {} });
            _activeSubs.set(subscriptionId, { sub, rUs: relaysToQuery, filt: currentFilter, type: 'reports' });
        } catch (e) {
            console.error(`Subscription Error:`, e);
            showToast(`Subscription error: ${e.message}`, 'error');
        }
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

    deleteEv: withLoading(withToast(async eventIdToDelete => {
        if (!appStore.get().user) throw new Error("No Nostr identity connected to delete events.");
        const signedDeletionEvent = await nostrSvc.pubEv({ kind: 5, content: "Reason for deletion (optional)", tags: [['e', eventIdToDelete]] });
        appStore.set(s => ({ reports: s.reports.filter(r => r.id !== eventIdToDelete) }));
        await dbSvc.rmRep(eventIdToDelete);
        return signedDeletionEvent;
    }, "Report deletion event sent (NIP-09).", "Failed to delete report")),

    fetchProf: withLoading(withToast(fetchProfileLogic, null, "Error fetching profile")),
    fetchInteractions: withLoading(withToast(fetchInteractionsLogic, null, "Error fetching interactions")),
    pubContacts: withLoading(withToast(publishContactsLogic, "NIP-02 contact list published!", "Error publishing contacts")),
    fetchContacts: withLoading(withToast(fetchContactsLogic, null, "Error fetching contacts"))
};
