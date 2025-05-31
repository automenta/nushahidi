import { appStore } from './store.js';
import { confSvc, idSvc, nostrSvc, mapSvc, dbSvc, offSvc } from './services.js';
import { initUI } from './ui.js';
import { showToast } from './utils.js';

async function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    registration.onupdatefound = () => {
                        const installingWorker = registration.installing;
                        if (installingWorker) {
                            installingWorker.onstatechange = () => {
                                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    if (confirm("New version available. Refresh?")) {
                                        window.location.reload();
                                    }
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

        if (!mapSvc.init('map-container')) {
            $('#map-container').innerHTML = '<p style="color:red">Map init failed.</p>';
        }

        initUI();

        const cachedReports = await dbSvc.getAllReps();
        appStore.set({ reports: cachedReports.sort((a, b) => b.at - a.at) });

        nostrSvc.refreshSubs();
        offSvc.setupSyncLs();
        await dbSvc.pruneDb();
    } catch (e) {
        console.error("Application initialization failed:", e);
        showToast(`App failed to load: ${e.message}`, 'error', 0);
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupServiceWorker();
    initializeApplication();
});
