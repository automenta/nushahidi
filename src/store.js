export const appStore = (() => {
    let _s = {
        user: null,
        relays: [],
        reports: [],
        filteredReports: [],
        mapBnds: null,
        mapGhs: [],
        currentFocusTag: null,
        focusTags: [],
        settings: {},
        online: navigator.onLine,
        drawnShapes: [],
        followedPubkeys: [],
        ui: {
            loading: false,
            modalOpen: null,
            showReportList: true,
            reportIdToView: null,
            spatialFilterEnabled: false,
            followedOnlyFilter: false,
            filters: {
                q: '',
                cat: '',
                auth: '',
                tStart: null,
                tEnd: null
            }
        }
    };
    const _l = new Set();

    window.addEventListener('online', () => appStore.set({ online: true }));
    window.addEventListener('offline', () => appStore.set({ online: false }));

    return {
        get: (key) => key ? _s[key] : { ..._s },
        set: (updater) => {
            const oldState = { ..._s };
            _s = typeof updater === 'function' ? { ..._s, ...updater(_s) } : { ..._s, ...updater };
            _l.forEach(listener => listener(_s, oldState));
        },
        on: (listener) => {
            _l.add(listener);
            listener(_s);
            return () => _l.delete(listener);
        }
    };
})();
