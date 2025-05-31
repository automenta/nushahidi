import {appStore} from './store.js';
import {confSvc, dbSvc, idSvc, nostrSvc, offSvc} from './services.js';
import {App} from './ui/App.js';

async function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js', {type: 'module'})
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
    appStore.set(s => ({ui: {...s.ui, loading: true}}));
    try {
        await confSvc.load();
        await idSvc.init();

        const appRoot = document.getElementById('app');
        if (!appRoot) throw new Error("App root element not found!");

        new App(appRoot);

        const cachedReports = await dbSvc.getAllReps();
        appStore.set({reports: (Array.isArray(cachedReports) ? cachedReports : []).sort((a, b) => b.at - a.at)});

        const offlineQueueCount = (await dbSvc.getOfflineQ()).length;
        appStore.set(s => ({offlineQueueCount}));

        await nostrSvc.refreshSubs();
        offSvc.setupSyncLs();
        await dbSvc.pruneDb();
    } catch (e) {
        console.error("Application initialization failed:", e);
    } finally {
        appStore.set(s => ({ui: {...s.ui, loading: false}}));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupServiceWorker().then(() => initializeApplication());
});
