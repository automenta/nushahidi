import { point, booleanPointInPolygon } from '@turf/turf';
import { appStore } from '../store.js';
import { mapSvc, nostrSvc } from '../services.js';
import { C, $, createEl, sanitizeHTML, debounce, npubToHex } from '../utils.js';
import { renderForm } from './forms.js';
import { rendRepList } from './reportList.js';

export const applyAllFilters = () => {
    const appState = appStore.get();
    const { reports: allReports, settings, currentFocusTag, drawnShapes, ui, followedPubkeys } = appState;
    const { mute: mutedPubkeys } = settings;
    const { spatialFilterEnabled, followedOnlyFilter, filters } = ui;
    const { q: searchQuery, cat: categoryFilter, auth: authorFilter, tStart: timeStart, tEnd: timeEnd } = filters;

    const filteredReports = allReports.filter(report => {
        if (mutedPubkeys.includes(report.pk)) return false;

        const focusTagMatch = currentFocusTag?.startsWith('#') ? currentFocusTag.substring(1) : currentFocusTag;
        if (focusTagMatch && focusTagMatch !== 'NostrMapper_Global' && !report.fTags.includes(focusTagMatch)) {
            return false;
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            if (!(report.title?.toLowerCase().includes(query) ||
                    report.sum?.toLowerCase().includes(query) ||
                    report.ct?.toLowerCase().includes(query))) {
                return false;
            }
        }

        if (categoryFilter && !report.cat.includes(categoryFilter)) return false;

        if (authorFilter) {
            const authorHex = npubToHex(authorFilter);
            if (report.pk !== authorHex) return false;
        }

        if (timeStart && report.at < timeStart) return false;
        if (timeEnd && report.at > timeEnd) return false;

        if (spatialFilterEnabled && drawnShapes.length > 0) {
            if (!report.lat || !report.lon) return false;
            const reportPoint = point([report.lon, report.lat]);
            let isInDrawnShape = false;
            for (const shape of drawnShapes) {
                if (booleanPointInPolygon(reportPoint, shape)) {
                    isInDrawnShape = true;
                    break;
                }
            }
            if (!isInDrawnShape) return false;
        }

        if (followedOnlyFilter && !followedPubkeys.map(f => f.pk).includes(report.pk)) {
            return false;
        }

        return true;
    }).sort((a, b) => b.at - a.at);

    rendRepList(filteredReports);
    mapSvc.updReps(filteredReports);
};
export const debAppAllFilt = debounce(applyAllFilters, 350);

const updateFilterState = (key, value) => {
    appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, [key]: value } } }));
};

const setupFilterEventListeners = (filterForm) => {
    $('#search-query-input', filterForm).oninput = e => {
        updateFilterState('q', e.target.value);
        debAppAllFilt();
    };
    $('#filter-category', filterForm).onchange = e => {
        updateFilterState('cat', e.target.value);
        applyAllFilters();
    };
    $('#filter-author', filterForm).oninput = e => {
        updateFilterState('auth', e.target.value.trim());
        debAppAllFilt();
    };
    $('#filter-time-start', filterForm).onchange = e => {
        updateFilterState('tStart', e.target.value ? new Date(e.target.value).getTime() / 1000 : null);
        applyAllFilters();
    };
    $('#filter-time-end', filterForm).onchange = e => {
        updateFilterState('tEnd', e.target.value ? new Date(e.target.value).getTime() / 1000 : null);
        applyAllFilters();
    };
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
