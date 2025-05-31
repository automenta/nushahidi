import { point, booleanPointInPolygon } from '@turf/turf';
import { appStore } from '../store.js';
import { mapSvc, nostrSvc } from '../services.js';
import { C, $, createEl, sanitizeHTML, debounce, npubToHex } from '../utils.js';
import { renderForm } from './forms.js';
import { rendRepList } from './reportList.js'; // Needs to update the list

export const applyAllFilters = () => {
    const appState = appStore.get();
    const { reports: allReports, settings, currentFocusTag, drawnShapes, ui, followedPubkeys } = appState;
    const { mute: mutedPubkeys } = settings;
    const { spatialFilterEnabled, followedOnlyFilter, filters } = ui;
    const { q: searchQuery, cat: categoryFilter, auth: authorFilter, tStart: timeStart, tEnd: timeEnd } = filters;

    const filteredReports = allReports.filter(report => {
        // 1. Mute filter
        if (mutedPubkeys.includes(report.pk)) return false;

        // 2. Focus Tag filter
        const focusTagMatch = currentFocusTag?.startsWith('#') ? currentFocusTag.substring(1) : currentFocusTag;
        if (focusTagMatch && focusTagMatch !== 'NostrMapper_Global' && !report.fTags.includes(focusTagMatch)) {
            return false;
        }

        // 3. Search Query filter (title, summary, content)
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            if (!(report.title?.toLowerCase().includes(query) ||
                    report.sum?.toLowerCase().includes(query) ||
                    report.ct?.toLowerCase().includes(query))) {
                return false;
            }
        }

        // 4. Category filter
        if (categoryFilter && !report.cat.includes(categoryFilter)) return false;

        // 5. Author filter
        if (authorFilter) {
            const authorHex = npubToHex(authorFilter);
            if (report.pk !== authorHex) return false;
        }

        // 6. Time filters (start and end date)
        if (timeStart && report.at < timeStart) return false;
        if (timeEnd && report.at > timeEnd) return false;

        // 7. Spatial filter (based on drawn shapes)
        if (spatialFilterEnabled && drawnShapes.length > 0) {
            if (!report.lat || !report.lon) return false; // Report must have location to be spatially filtered
            const reportPoint = point([report.lon, report.lat]); // Turf expects [lon, lat]
            let isInDrawnShape = false;
            for (const shape of drawnShapes) {
                if (booleanPointInPolygon(reportPoint, shape)) {
                    isInDrawnShape = true;
                    break;
                }
            }
            if (!isInDrawnShape) return false;
        }

        // 8. Followed Only filter
        if (followedOnlyFilter && !followedPubkeys.map(f => f.pk).includes(report.pk)) {
            return false;
        }

        return true;
    }).sort((a, b) => b.at - a.at); // Sort by created_at descending

    rendRepList(filteredReports);
    mapSvc.updReps(filteredReports);
};
export const debAppAllFilt = debounce(applyAllFilters, 350);

/**
 * Sets up event listeners for the filter controls.
 * @param {HTMLElement} filterForm - The rendered filter form element.
 */
const _setupFilterEventListeners = (filterForm) => {
    $('#search-query-input', filterForm).oninput = e => {
        appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, q: e.target.value } } }));
        debAppAllFilt();
    };
    $('#filter-category', filterForm).onchange = e => {
        appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, cat: e.target.value } } }));
        applyAllFilters();
    };
    $('#filter-author', filterForm).oninput = e => {
        appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, auth: e.target.value.trim() } } }));
        debAppAllFilt();
    };
    $('#filter-time-start', filterForm).onchange = e => {
        appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, tStart: e.target.value ? new Date(e.target.value).getTime() / 1000 : null } } }));
        applyAllFilters();
    };
    $('#filter-time-end', filterForm).onchange = e => {
        appStore.set(s => ({ ui: { ...s.ui, filters: { ...s.ui.filters, tEnd: e.target.value ? new Date(e.target.value).getTime() / 1000 : null } } }));
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
            currentFocusTag: C.FOCUS_TAG_DEFAULT // Reset focus tag in main store
        }));
        // Manually update form fields to reflect reset state
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

    // Spatial Filter Toggle
    const spatialFilterToggle = $('#spatial-filter-toggle', filterForm);
    spatialFilterToggle.checked = appStore.get().ui.spatialFilterEnabled; // Ensure initial state is correct
    spatialFilterToggle.onchange = e => {
        appStore.set(s => ({ ui: { ...s.ui, spatialFilterEnabled: e.target.checked } }));
        applyAllFilters(); // Re-apply filters immediately
    };

    // Followed Only Toggle
    const followedOnlyToggle = $('#followed-only-toggle', filterForm);
    followedOnlyToggle.checked = appStore.get().ui.followedOnlyFilter; // Ensure initial state is correct
    followedOnlyToggle.onchange = e => {
        appStore.set(s => ({ ui: { ...s.ui, followedOnlyFilter: e.target.checked } }));
        nostrSvc.refreshSubs(); // Refresh subscriptions to apply author filter if needed
        applyAllFilters(); // Re-apply filters immediately
    };

    // Clear Drawn Shapes Button
    $('#clear-drawn-shapes-btn', filterForm).onclick = () => {
        mapSvc.clearAllDrawnShapes();
    };
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

    // Clear existing content and render the form
    filterControlsContainer.innerHTML = '';
    const filterForm = renderForm(filterFormFields, initialFilterData, { id: 'filter-form' });
    filterControlsContainer.appendChild(filterForm);

    // Attach filter event listeners to the new form elements
    _setupFilterEventListeners(filterForm);

    // Map Drawing Controls
    const mapDrawControlsDiv = $('#map-draw-controls', filterForm);
    const drawControl = mapSvc.getDrawControl();
    if (drawControl) {
        // Append the draw control's toolbar to the designated div
        mapDrawControlsDiv.appendChild(drawControl.onAdd(mapSvc.get()));
    }
};

const filterFormFields = [
    { type: 'h4', content: ['Filter Reports'] }, // Custom heading
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
    { type: 'h4', content: ['Map Drawing Filters'] }, // Custom heading
    { type: 'custom-html', id: 'map-draw-controls' }, // Placeholder for Leaflet.draw controls
    { label: 'Enable Spatial Filter', type: 'checkbox', id: 'spatial-filter-toggle', name: 'spatialFilterEnabled' },
    { label: 'Show Only Followed Users', type: 'checkbox', id: 'followed-only-toggle', name: 'followedOnlyFilter' },
    { type: 'button', id: 'clear-drawn-shapes-btn', label: 'Clear All Drawn Shapes', class: 'clear-drawn-shapes-btn' }
];
