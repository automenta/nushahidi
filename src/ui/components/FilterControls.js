import {booleanPointInPolygon, point} from '@turf/turf';
import {appStore} from '../../store.js';
import {mapSvc, nostrSvc} from '../../services.js';
import {$, C, debounce, npubToHex, createEl, sanitizeHTML} from '../../utils.js';
import {renderForm} from '../forms.js';

// This function will now update the store, and ReportList will react to store changes.
export const applyAllFilters = () => {
    const { reports: allReports, settings, currentFocusTag, drawnShapes, ui, followedPubkeys } = appStore.get();
    const { mute: mutedPubkeys } = settings;
    const { spatialFilterEnabled, followedOnlyFilter, filters } = ui;
    const { q: searchQuery, cat: categoryFilter, auth: authorFilter, tStart: timeStart, tEnd: timeEnd } = filters;

    const filteredReports = allReports.filter(report =>
        isMuted(report, mutedPubkeys) &&
        matchesFocusTag(report, currentFocusTag) &&
        matchesSearchQuery(report, searchQuery) &&
        matchesCategory(report, categoryFilter) &&
        matchesAuthor(report, authorFilter) &&
        matchesTimeRange(report, timeStart, timeEnd) &&
        matchesSpatialFilter(report, spatialFilterEnabled, drawnShapes) &&
        matchesFollowedOnly(report, followedOnlyFilter, followedPubkeys)
    ).sort((a, b) => b.at - a.at);

    appStore.set({ filteredReports }); // Update the store with filtered reports
    mapSvc.updReps(filteredReports);
};
export const debouncedApplyAllFilters = debounce(applyAllFilters, 350);

const isMuted = (report, mutedPubkeys) => !mutedPubkeys.includes(report.pk);
const matchesFocusTag = (report, currentFocusTag) => (currentFocusTag === 'NostrMapper_Global' || report.fTags.includes(currentFocusTag?.substring(1)));
const matchesSearchQuery = (report, searchQuery) => !searchQuery || ['title', 'sum', 'ct'].some(prop => report[prop]?.toLowerCase().includes(searchQuery.toLowerCase()));
const matchesCategory = (report, categoryFilter) => !categoryFilter || report.cat.includes(categoryFilter);
const matchesAuthor = (report, authorFilter) => !authorFilter || report.pk === npubToHex(authorFilter);
const matchesTimeRange = (report, timeStart, timeEnd) => !(timeStart && report.at < timeStart) && !(timeEnd && report.at > timeEnd);
const matchesSpatialFilter = (report, spatialFilterEnabled, drawnShapes) => {
    if (!spatialFilterEnabled || !drawnShapes.length || !report.lat || !report.lon) return true;
    const reportPoint = point([report.lon, report.lat]);
    return drawnShapes.some(shape => booleanPointInPolygon(reportPoint, shape));
};
const matchesFollowedOnly = (report, followedOnlyFilter, followedPubkeys) => !followedOnlyFilter || followedPubkeys.map(f => f.pk).includes(report.pk);


export function FilterControls() {
    let filterFormElement; // Renamed to avoid conflict with renderFilterForm's local `filterForm`

    const updateFilterState = (key, value) => appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, [key]: value } } }));

    const setupFilterInput = (formScope, id, stateKey, handler = applyAllFilters, debounceInput = false) => {
        const inputElement = $(`#${id}`, formScope);
        if (!inputElement) return;
        inputElement.oninput = e => {
            updateFilterState(stateKey, e.target.value.trim());
            debounceInput ? debouncedApplyAllFilters() : handler();
        };
    };

    const setupFilterSelect = (formScope, id, stateKey, handler = applyAllFilters) => {
        const selectElement = $(`#${id}`, formScope);
        if (!selectElement) return;
        selectElement.onchange = e => {
            updateFilterState(stateKey, e.target.value);
            handler();
        };
    };

    const setupFilterTimeInput = (formScope, id, stateKey) => {
        const inputElement = $(`#${id}`, formScope);
        if (!inputElement) return;
        inputElement.onchange = e => {
            updateFilterState(stateKey, e.target.value ? new Date(e.target.value).getTime() / 1000 : null);
            applyAllFilters();
        };
    };

    const renderFilterForm = (appState) => {
        const filterFormFields = [
            { type: 'h4', content: ['Filter Reports'] },
            { label: 'Search reports...', type: 'search', id: 'search-query-input', name: 'searchQuery', placeholder: 'Search reports text' },
            { label: 'Focus Tag:', type: 'text', id: 'focus-tag-input', name: 'focusTag', readOnly: true },
            {
                label: 'Category:',
                type: 'select',
                id: 'filter-category',
                name: 'filterCategory',
                options: [{ value: '', label: 'All' }, ...(appState.settings?.cats || []).map(cat => ({ value: cat, label: cat }))]
            },
            { label: 'Author (npub/hex):', type: 'text', id: 'filter-author', name: 'filterAuthor', placeholder: 'Author pubkey' },
            { label: 'From:', type: 'datetime-local', id: 'filter-time-start', name: 'filterTimeStart' },
            { label: 'To:', type: 'datetime-local', id: 'filter-time-end', name: 'filterTimeEnd' },
            { type: 'button', id: 'apply-filters-btn', label: 'Apply', class: 'apply-filters-btn' },
            { type: 'button', id: 'reset-filters-btn', label: 'Reset', class: 'reset-filters-btn' },
            { type: 'hr' },
            { type: 'h4', content: ['Map Drawing Filters'] },
            { type: 'custom-html', id: 'map-draw-controls' },
            { label: 'Enable Spatial Filter', type: 'checkbox', id: 'spatial-filter-toggle', name: 'spatialFilterEnabled' },
            { label: 'Show Only Followed Users', type: 'checkbox', id: 'followed-only-toggle', name: 'followedOnlyFilter' },
            { type: 'button', id: 'clear-drawn-shapes-btn', label: 'Clear All Drawn Shapes', class: 'clear-drawn-shapes-btn' }
        ];

        const initialFilterData = {
            searchQuery: appState.ui.filters.q,
            focusTag: appState.currentFocusTag,
            filterCategory: appState.ui.filters.cat,
            filterAuthor: appState.ui.filters.auth,
            filterTimeStart: appState.ui.filters.tStart ? new Date(appState.ui.filters.tStart * 1000).toISOString().slice(0, 16) : '',
            filterTimeEnd: appState.ui.filters.tEnd ? new Date(appState.ui.filters.tEnd * 1000).toISOString().slice(0, 16) : '',
            spatialFilterEnabled: appState.ui.spatialFilterEnabled,
            followedOnlyFilter: appState.ui.followedOnlyFilter
        };

        const newForm = renderForm(filterFormFields, initialFilterData, { id: 'filter-form' });

        // Setup event listeners scoped to the new form
        setupFilterInput(newForm, 'search-query-input', 'q', applyAllFilters, true);
        setupFilterSelect(newForm, 'filter-category', 'cat');
        setupFilterInput(newForm, 'filter-author', 'auth', applyAllFilters, true);
        setupFilterTimeInput(newForm, 'filter-time-start', 'tStart');
        setupFilterTimeInput(newForm, 'filter-time-end', 'tEnd');

        $('#apply-filters-btn', newForm).onclick = applyAllFilters;
        $('#reset-filters-btn', newForm).onclick = () => {
            appStore.set(s => ({
                ui: {
                    ...s.ui,
                    spatialFilterEnabled: false,
                    followedOnlyFilter: false,
                    filters: { q: '', cat: '', auth: '', tStart: null, tEnd: null }
                },
                currentFocusTag: C.FOCUS_TAG_DEFAULT
            }));
            // Re-render the form to reflect reset values
            filterFormElement.replaceWith(renderFilterForm(appStore.get()));
        };

        const spatialFilterToggle = $('#spatial-filter-toggle', newForm);
        spatialFilterToggle.checked = appState.ui.spatialFilterEnabled;
        spatialFilterToggle.onchange = e => {
            appStore.set(s => ({ ui: { ...s.ui, spatialFilterEnabled: e.target.checked } }));
            applyAllFilters();
        };

        const followedOnlyToggle = $('#followed-only-toggle', newForm);
        followedOnlyToggle.checked = appState.ui.followedOnlyFilter;
        followedOnlyToggle.onchange = e => {
            appStore.set(s => ({ ui: { ...s.ui, followedOnlyFilter: e.target.checked } }));
            nostrSvc.refreshSubs();
            applyAllFilters();
        };

        $('#clear-drawn-shapes-btn', newForm).onclick = mapSvc.clearAllDrawnShapes;

        const mapDrawControlsDiv = $('#map-draw-controls', newForm);
        mapDrawControlsDiv.appendChild(mapSvc.getDrawControl().onAdd(mapSvc.get()));

        return newForm;
    };

    filterFormElement = renderFilterForm(appStore.get());

    appStore.on((newState, oldState) => {
        // Only re-render the form if categories or currentFocusTag change,
        // as other filter changes are handled by input listeners.
        if (newState.settings?.cats !== oldState?.settings?.cats || newState.currentFocusTag !== oldState?.currentFocusTag) {
            const newForm = renderFilterForm(newState);
            filterFormElement.replaceWith(newForm);
            filterFormElement = newForm;
        }
    });

    return filterFormElement;
}
