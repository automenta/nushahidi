import {booleanPointInPolygon, point} from '@turf/turf';
import {appStore} from '../../store.js';
import {mapSvc, nostrSvc} from '../../services.js';
import {C, debounce, npubToHex, createEl} from '../../utils.js';
import {renderForm} from '../forms.js';

export const applyAllFilters = () => {
    const {reports: allReports, settings, currentFocusTag, drawnShapes, ui, followedPubkeys} = appStore.get();
    const {mute: mutedPubkeys} = settings;
    const {spatialFilterEnabled, followedOnlyFilter, filters} = ui;
    const {q: searchQuery, cat: categoryFilter, auth: authorFilter, tStart: timeStart, tEnd: timeEnd} = filters;

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

    appStore.set({filteredReports});
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


export class FilterControls {
    constructor() {
        this.filterFormElement = createEl('div', {class: 'filter-controls-container'});
        this.mapDrawControlsDiv = null;

        this.render(appStore.get());

        this.unsubscribe = appStore.on((newState, oldState) => {
            const categoriesChanged = newState.settings?.cats !== oldState?.settings?.cats;
            const focusTagChanged = newState.currentFocusTag !== oldState?.currentFocusTag;
            const filtersReset = JSON.stringify(newState.ui.filters) !== JSON.stringify(oldState?.ui?.filters) &&
                                 (newState.ui.filters.q === '' && newState.ui.filters.cat === '' && newState.ui.filters.auth === '' && newState.ui.filters.tStart === null && newState.ui.filters.tEnd === null);

            if (categoriesChanged || focusTagChanged || filtersReset) {
                this.render(newState);
            }
        });
    }

    updateFilterState(key, value) {
        appStore.set(s => ({ui: {...s.ui, filters: {...s.ui.filters, [key]: value}}}));
    }

    setupFilterInput(fields, refKey, stateKey, handler = applyAllFilters, debounceInput = false) {
        const inputElement = fields[refKey];
        if (!inputElement) return;
        inputElement.oninput = e => {
            this.updateFilterState(stateKey, e.target.value.trim());
            debounceInput ? debouncedApplyAllFilters() : handler();
        };
    }

    setupFilterSelect(fields, refKey, stateKey, handler = applyAllFilters) {
        const selectElement = fields[refKey];
        if (!selectElement) return;
        selectElement.onchange = e => {
            this.updateFilterState(stateKey, e.target.value);
            handler();
        };
    }

    setupFilterTimeInput(fields, refKey, stateKey) {
        const inputElement = fields[refKey];
        if (!inputElement) return;
        inputElement.onchange = e => {
            this.updateFilterState(stateKey, e.target.value ? new Date(e.target.value).getTime() / 1000 : null);
            applyAllFilters();
        };
    }

    render(appState) {
        const filterFormFields = [
            {type: 'h4', content: ['Filter Reports']},
            {label: 'Search reports...', type: 'search', ref: 'searchQueryInput', name: 'searchQuery', placeholder: 'Search reports text'},
            {label: 'Focus Tag:', type: 'text', ref: 'focusTagInput', name: 'focusTag', readOnly: true},
            {
                label: 'Category:',
                type: 'select',
                ref: 'filterCategorySelect',
                name: 'filterCategory',
                options: [{value: '', label: 'All'}, ...(appState.settings?.cats || []).map(cat => ({value: cat, label: cat}))]
            },
            {label: 'Author (npub/hex):', type: 'text', ref: 'filterAuthorInput', name: 'filterAuthor', placeholder: 'Author pubkey'},
            {label: 'From:', type: 'datetime-local', ref: 'filterTimeStartInput', name: 'filterTimeStart'},
            {label: 'To:', type: 'datetime-local', ref: 'filterTimeEndInput', name: 'filterTimeEnd'},
            {type: 'button', ref: 'applyFiltersBtn', label: 'Apply', class: 'apply-filters-btn'},
            {type: 'button', ref: 'resetFiltersBtn', label: 'Reset', class: 'reset-filters-btn'},
            {type: 'hr'},
            {type: 'h4', content: ['Map Drawing Filters']},
            {type: 'custom-html', ref: 'mapDrawControlsContainer', class: 'map-draw-controls'},
            {label: 'Enable Spatial Filter', type: 'checkbox', ref: 'spatialFilterToggle', name: 'spatialFilterEnabled'},
            {label: 'Show Only Followed Users', type: 'checkbox', ref: 'followedOnlyToggle', name: 'followedOnlyFilter'},
            {type: 'button', ref: 'clearDrawnShapesBtn', label: 'Clear All Drawn Shapes', class: 'clear-drawn-shapes-btn'}
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

        const {form: newForm, fields} = renderForm(filterFormFields, initialFilterData, {class: 'filter-form'});

        this.setupFilterInput(fields, 'searchQueryInput', 'q', applyAllFilters, true);
        this.setupFilterSelect(fields, 'filterCategorySelect', 'cat');
        this.setupFilterInput(fields, 'filterAuthorInput', 'auth', applyAllFilters, true);
        this.setupFilterTimeInput(fields, 'filterTimeStartInput', 'tStart');
        this.setupFilterTimeInput(fields, 'filterTimeEndInput', 'tEnd');

        fields.applyFiltersBtn.onclick = applyAllFilters;
        fields.resetFiltersBtn.onclick = () => {
            appStore.set(s => ({
                ui: {
                    ...s.ui,
                    spatialFilterEnabled: false,
                    followedOnlyFilter: false,
                    filters: {q: '', cat: '', auth: '', tStart: null, tEnd: null}
                },
                currentFocusTag: C.FOCUS_TAG_DEFAULT
            }));
        };

        const spatialFilterToggle = fields.spatialFilterToggle;
        spatialFilterToggle.checked = appState.ui.spatialFilterEnabled;
        spatialFilterToggle.onchange = e => {
            appStore.set(s => ({ui: {...s.ui, spatialFilterEnabled: e.target.checked}}));
            applyAllFilters();
        };

        const followedOnlyToggle = fields.followedOnlyToggle;
        followedOnlyToggle.checked = appState.ui.followedOnlyFilter;
        followedOnlyToggle.onchange = e => {
            appStore.set(s => ({ui: {...s.ui, followedOnlyFilter: e.target.checked}}));
            nostrSvc.refreshSubs();
            applyAllFilters();
        };

        fields.clearDrawnShapesBtn.onclick = mapSvc.clearAllDrawnShapes;

        const mapDrawControlsContainer = fields.mapDrawControlsContainer;
        mapDrawControlsContainer.innerHTML = '';
        mapDrawControlsContainer.appendChild(mapSvc.getDrawControl().onAdd(mapSvc.get()));

        this.filterFormElement.innerHTML = '';
        this.filterFormElement.appendChild(newForm);

        return this.filterFormElement;
    }
}
