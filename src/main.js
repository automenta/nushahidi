import { appStore } from './store.js';
import { confSvc, idSvc, nostrSvc, mapSvc, dbSvc, offSvc } from './services.js';
import { initUI } from './ui.js';
import { $, C } from './utils.js';

async function main() {
    appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start global loading

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

    await confSvc.load();
    await idSvc.init();

    if (!mapSvc.init('map-container')) {
        $('#map-container').innerHTML = '<p style="color:red">Map init failed.</p>';
    }

    initUI();

    const cachedReports = await dbSvc.getAllReps();
    // Always set reports from cache, sorted. appStore.reports is empty at this point.
    appStore.set({ reports: cachedReports.sort((a, b) => b.at - a.at) });

    nostrSvc.refreshSubs();
    offSvc.setupSyncLs();
    await dbSvc.pruneDb(); // Prune IndexedDB on startup

    appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End global loading
    console.log("NostrMapper Initialized (vFinal Compact). Focus Tag:", appStore.get().currentFocusTag);
}

document.addEventListener('DOMContentLoaded', main);
