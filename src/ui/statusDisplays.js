import {appStore} from '../store.js';
import {createEl, sanitizeHTML} from '../utils.js';
import {ReportDetailsModal} from './components/ReportDetailsModal.js';
import {applyAllFilters} from './components/FilterControls.js';
import {showModal} from './modals.js';

export const handleReportAndFilterUpdates = (newState, oldState) => {
    const filterDependencies = [
        'reports', 'settings.mute', 'currentFocusTag', 'drawnShapes', 'ui.spatialFilterEnabled',
        'followedPubkeys', 'ui.followedOnlyFilter', 'ui.filters.q', 'ui.filters.cat',
        'ui.filters.auth', 'ui.filters.tStart', 'ui.filters.tEnd'
    ];

    const shouldReapplyFilters = filterDependencies.some(path => {
        const newVal = path.split('.').reduce((o, i) => o?.[i], newState);
        const oldVal = path.split('.').reduce((o, i) => o?.[i], oldState);
        return newVal !== oldVal;
    });

    if (shouldReapplyFilters) {
        applyAllFilters();
    }
};

export const handleReportViewing = (reportId, reports) => {
    if (reportId) {
        const report = reports.find(r => r.id === reportId);
        if (report) {
            const reportDetailsModalElement = ReportDetailsModal(report);
            showModal(reportDetailsModalElement, 'detail-title');
        }
    }
};
