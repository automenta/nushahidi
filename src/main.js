import {appStore} from './store.js';
import {confSvc, dbSvc, idSvc, mapSvc, nostrSvc, offSvc} from './services.js';
import {initUI} from './ui.js';
import {$} from './utils.js';

async function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js', { type: 'module' })
                .then(registration => {
                    registration.onupdatefound = () => {
                        const installingWorker = registration.installing;
                        if (installingWorker) {
                            installingWorker.onstatechange = () => {
                                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    if (confirm("New version available. Refresh?")) window.location.reload();
                                }
                            };
                        }
                    };
                })
                .catch(error => console.error("SW Registration Failed:", error));
        });
    }
}

async function initializeApplication() {
    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
    try {
        await confSvc.load();
        await idSvc.init();

        if (!await mapSvc.init('map-container')) $('#map-container').innerHTML = '<p style="color:red">Map init failed.</p>';

        initUI();

        let cachedReports = await dbSvc.getAllReps();
        if (!Array.isArray(cachedReports)) {
            cachedReports = [];
        }
        appStore.set({ reports: cachedReports.sort((a, b) => b.at - a.at) });

        await nostrSvc.refreshSubs();
        offSvc.setupSyncLs();
        await dbSvc.pruneDb();
    } catch (e) {
        console.error("Application initialization failed:", e);
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupServiceWorker().then(_ => initializeApplication());
});
