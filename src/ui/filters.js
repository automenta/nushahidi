import { point, booleanPointInPolygon } from '@turf/turf';
import { appStore } from '../store.js';
import { mapSvc, nostrSvc } from '../services.js';
import { C, $, createEl, sanitizeHTML, debounce, npubToHex } from '../utils.js';
import { renderForm } from './forms.js';
import { renderReportList } from './reportList.js';

const filterFormFields = [
    { type: 'h4', content: ['Filter Reports'] },
    { label: 'Search reports...', type: 'search', id: 'search-query-input', name: 'searchQuery', placeholder: 'Search reports text' },
    { label: 'Focus Tag:', type: 'text', id: 'focus-tag-input', name: 'focusTag', readOnly: true },
    {
        label: 'Category:',
        type: 'select',
        id: 'filter-category',
        name: 'filterCategory',
        options: [{ value: '', label: 'All' }, ...appStore.get().settings.cats.map(cat => ({ value: cat, label: cat }))]
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

const isMuted = (report, mutedPubkeys) => !mutedPubkeys.includes(report.pk);

const matchesFocusTag = (report, currentFocusTag) => {
    const focusTagMatch = currentFocusTag?.startsWith('#') ? currentFocusTag.substring(1) : currentFocusTag;
    return focusTagMatch === 'NostrMapper_Global' || report.fTags.includes(focusTagMatch);
};

const matchesSearchQuery = (report, searchQuery) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return report.title?.toLowerCase().includes(query) ||
           report.sum?.toLowerCase().includes(query) ||
           report.ct?.toLowerCase().includes(query);
};

const matchesCategory = (report, categoryFilter) => {
    if (!categoryFilter) return true;
    return report.cat.includes(categoryFilter);
};

const matchesAuthor = (report, authorFilter) => {
    if (!authorFilter) return true;
    const authorHex = npubToHex(authorFilter);
    return report.pk === authorHex;
};

const matchesTimeRange = (report, timeStart, timeEnd) => {
    if (timeStart && report.at < timeStart) return false;
    if (timeEnd && report.at > timeEnd) return false;
    return true;
};

const matchesSpatialFilter = (report, spatialFilterEnabled, drawnShapes) => {
    if (!spatialFilterEnabled || drawnShapes.length === 0) return true;
    if (!report.lat || !report.lon) return false;

    const reportPoint = point([report.lon, report.lat]);
    for (const shape of drawnShapes) {
        if (booleanPointInPolygon(reportPoint, shape)) {
            return true;
        }
    }
    return false;
};

const matchesFollowedOnly = (report, followedOnlyFilter, followedPubkeys) => {
    if (!followedOnlyFilter) return true;
    return followedPubkeys.map(f => f.pk).includes(report.pk);
};

export const applyAllFilters = () => {
    const appState = appStore.get();
    const { reports: allReports, settings, currentFocusTag, drawnShapes, ui, followedPubkeys } = appState;
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

    renderReportList(filteredReports);
    mapSvc.updReps(filteredReports);
};
export const debouncedApplyAllFilters = debounce(applyAllFilters, 350);

const updateFilterState = (key, value) => {
    appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, [key]: value } } }));
};

const setupSearchInput = filterForm => {
    $('#search-query-input', filterForm).oninput = e => {
        updateFilterState('q', e.target.value);
        debouncedApplyAllFilters();
    };
};

const setupCategorySelect = filterForm => {
    $('#filter-category', filterForm).onchange = e => {
        updateFilterState('cat', e.target.value);
        applyAllFilters();
    };
};

const setupAuthorInput = filterForm => {
    $('#filter-author', filterForm).oninput = e => {
        updateFilterState('auth', e.target.value.trim());
        debouncedApplyAllFilters();
    };
};

const setupTimeFilters = filterForm => {
    $('#filter-time-start', filterForm).onchange = e => {
        updateFilterState('tStart', e.target.value ? new Date(e.target.value).getTime() / 1000 : null);
        applyAllFilters();
    };
    $('#filter-time-end', filterForm).onchange = e => {
        updateFilterState('tEnd', e.target.value ? new Date(e.target.value).getTime() / 1000 : null);
        applyAllFilters();
    };
};

const setupApplyResetButtons = filterForm => {
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
        $('#search-query-input', filterForm).value = '';
        $('#focus-tag-input', filterForm).value = C.FOCUS_TAG_DEFAULT;
        $('#filter-category', filterForm).value = '';
        $('#filter-author', filterForm).value = '';
        $('#filter-time-start', filterForm).value = '';
        $('#filter-time-end', filterForm).value = '';
        $('#spatial-filter-toggle', filterForm).checked = false;
        $('#followed-only-toggle', filterForm).checked = false;
        applyAllFilters();
    };
};

const setupSpatialAndFollowedToggles = filterForm => {
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
};

const setupClearDrawnShapesButton = filterForm => {
    $('#clear-drawn-shapes-btn', filterForm).onclick = mapSvc.clearAllDrawnShapes;
};

const setupFilterEventListeners = filterForm => {
    setupSearchInput(filterForm);
    setupCategorySelect(filterForm);
    setupAuthorInput(filterForm);
    setupTimeFilters(filterForm);
    setupApplyResetButtons(filterForm);
    setupSpatialAndFollowedToggles(filterForm);
    setupClearDrawnShapesButton(filterForm);
};

export const initFilterControls = () => {
    const filterControlsContainer = $('#filter-controls');
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

    filterControlsContainer.innerHTML = '';
    const filterForm = renderForm(filterFormFields, initialFilterData, { id: 'filter-form' });
    filterControlsContainer.appendChild(filterForm);

    setupFilterEventListeners(filterForm);

    const mapDrawControlsDiv = $('#map-draw-controls', filterForm);
    const drawControl = mapSvc.getDrawControl();
    if (drawControl) {
        mapDrawControlsDiv.appendChild(drawControl.onAdd(mapSvc.get()));
    }
};
