import {booleanPointInPolygon, point} from '@turf/turf';
import {appStore} from '../../store.js';
import {mapSvc, nostrSvc} from '../../services.js';
import {$, C, debounce, npubToHex} from '../../utils.js';
import {renderForm} from '../forms.js';
import {ReportList} from './ReportList.js';

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

    ReportList(filteredReports);
    mapSvc.updReps(filteredReports);
};
export const debouncedApplyAllFilters = debounce(applyAllFilters, 350);

export function FilterControls(containerElement) {
    const filterFormFields = [
        { type: 'h4', content: ['Filter Reports'] },
        { label: 'Search reports...', type: 'search', id: 'search-query-input', name: 'searchQuery', placeholder: 'Search reports text' },
        { label: 'Focus Tag:', type: 'text', id: 'focus-tag-input', name: 'focusTag', readOnly: true },
        {
            label: 'Category:',
            type: 'select',
            id: 'filter-category',
            name: 'filterCategory',
            options: [{ value: '', label: 'All' }, ...(appStore.get().settings?.cats || []).map(cat => ({ value: cat, label: cat }))]
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

    const updateFilterState = (key, value) => appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, [key]: value } } }));

    const setupFilterInput = (filterForm, id, stateKey, handler = applyAllFilters, debounceInput = false) => {
        const inputElement = $(`#${id}`, filterForm);
        if (!inputElement) return;
        inputElement.oninput = e => {
            updateFilterState(stateKey, e.target.value.trim());
            debounceInput ? debouncedApplyAllFilters() : handler();
        };
    };

    const setupFilterSelect = (filterForm, id, stateKey, handler = applyAllFilters) => {
        const selectElement = $(`#${id}`, filterForm);
        if (!selectElement) return;
        selectElement.onchange = e => {
            updateFilterState(stateKey, e.target.value);
            handler();
        };
    };

    const setupFilterTimeInput = (filterForm, id, stateKey) => {
        const inputElement = $(`#${id}`, filterForm);
        if (!inputElement) return;
        inputElement.onchange = e => {
            updateFilterState(stateKey, e.target.value ? new Date(e.target.value).getTime() / 1000 : null);
            applyAllFilters();
        };
    };

    const appState = appStore.get();

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

    containerElement.innerHTML = '';
    const filterForm = renderForm(filterFormFields, initialFilterData, { id: 'filter-form' });
    containerElement.appendChild(filterForm);

    setupFilterInput(filterForm, 'search-query-input', 'q', applyAllFilters, true);
    setupFilterSelect(filterForm, 'filter-category', 'cat');
    setupFilterInput(filterForm, 'filter-author', 'auth', applyAllFilters, true);
    setupFilterTimeInput(filterForm, 'filter-time-start', 'tStart');
    setupFilterTimeInput(filterForm, 'filter-time-end', 'tEnd');

    $('#apply-filters-btn', filterForm).onclick = applyAllFilters;
    $('#reset-filters-btn', filterForm).onclick = () => {
        appStore.set(s => ({
            ui: {
                ...s.ui,
                spatialFilterEnabled: false,
                followedOnlyFilter: false,
                filters: { q: '', cat: '', auth: '', tStart: null, tEnd: null }
            },
            currentFocusTag: C.FOCUS_TAG_DEFAULT
        }));

        const resetFields = {
            '#search-query-input': '',
            '#focus-tag-input': C.FOCUS_TAG_DEFAULT,
            '#filter-category': '',
            '#filter-author': '',
            '#filter-time-start': '',
            '#filter-time-end': '',
        };
        for (const selector in resetFields) $(selector, filterForm).value = resetFields[selector];
        $('#spatial-filter-toggle', filterForm).checked = false;
        $('#followed-only-toggle', filterForm).checked = false;
        applyAllFilters();
    };

    const spatialFilterToggle = $('#spatial-filter-toggle', filterForm);
    spatialFilterToggle.checked = appStore.get().ui.spatialFilterEnabled;
    spatialFilterToggle.onchange = e => {
        appStore.set(s => ({ ui: { ...s.ui, spatialFilterEnabled: e.target.checked } }));
        applyAllFilters();
    };

    const followedOnlyToggle = $('#followed-only-toggle', filterForm);
    followedOnlyToggle.checked = appStore.get().ui.followedOnlyFilter;
    followedOnlyToggle.onchange = e => {
        appStore.set(s => ({ ui: { ...s.ui, followedOnlyFilter: e.target.checked } }));
        nostrSvc.refreshSubs();
        applyAllFilters();
    };

    $('#clear-drawn-shapes-btn', filterForm).onclick = mapSvc.clearAllDrawnShapes;

    const mapDrawControlsDiv = $('#map-draw-controls', filterForm);
    mapDrawControlsDiv.appendChild(mapSvc.getDrawControl().onAdd(mapSvc.get()));
}
