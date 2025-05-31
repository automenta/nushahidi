import { appStore } from '../store.js';
import { mapSvc, imgSvc, nostrSvc } from '../services.js';
import { C, $, createEl, sanitizeHTML, geohashEncode, showToast, isValidUrl, generateUUID, processImageFile } from '../utils.js';
import { renderForm, renderList } from './forms.js';
import { createModalWrapper, showModal, hideModal } from './modals.js';

/**
 * Renders the image preview section of the report form.
 * @param {HTMLElement} previewElement - The DOM element to render into.
 * @param {Array<object>} imagesMetadata - Array of image metadata.
 * @param {function} onRemoveImage - Callback for when an image is removed.
 */
const _renderImagePreview = (previewElement, imagesMetadata, onRemoveImage) => {
    previewElement.innerHTML = '';
    if (imagesMetadata.length === 0) {
        previewElement.textContent = 'No images selected.';
        return;
    }

    const imageItemRenderer = (img) => createEl('span', { textContent: sanitizeHTML(img.url.substring(img.url.lastIndexOf('/') + 1)) });
    const imageActionsConfig = [{
        label: 'x',
        className: 'remove-image-btn',
        onClick: (item, index) => onRemoveImage(index) // Pass index to the callback
    }];

    renderList(
        previewElement.id, // Use the element's ID for renderList
        imagesMetadata,
        imageItemRenderer,
        imageActionsConfig,
        'uploaded-image-item',
        previewElement.parentNode // Scope to the parent of previewElement if it's not a direct child of modalContent
    );
};

/**
 * Sets up event handlers for location-related actions in the report form.
 * @param {HTMLElement} formRoot - The root element of the form.
 * @param {object} formState - Object to hold form state (e.g., _pFLoc).
 * @param {function} renderLocationDisplay - Function to update location display.
 */
const _setupReportFormLocationHandlers = (formRoot, formState, renderLocationDisplay) => {
    $('#pick-loc-map-btn', formRoot).onclick = () => {
        hideModal('report-form-modal');
        mapSvc.enPickLoc(latlng => {
            formState.pFLoc = latlng;
            renderLocationDisplay();
            showModal('report-form-modal', 'rep-title');
        });
    };

    $('#use-gps-loc-btn', formRoot).onclick = () => {
        if (!navigator.geolocation) return showToast("GPS not supported by your browser.", 'warning');
        navigator.geolocation.getCurrentPosition(
            position => {
                formState.pFLoc = { lat: position.coords.latitude, lng: position.coords.longitude };
                renderLocationDisplay();
            },
            error => showToast(`GPS Error: ${error.message}`, 'error')
        );
    };

    $('#geocode-address-btn', formRoot).onclick = async () => {
        const address = $('#rep-address', formRoot).value.trim();
        if (!address) return showToast("Please enter an address to geocode.", 'warning');
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
            const data = await response.json();
            if (data?.length > 0) {
                const { lat, lon, display_name } = data[0];
                formState.pFLoc = { lat: parseFloat(lat), lng: parseFloat(lon) };
                renderLocationDisplay(display_name);
                showToast(`Address found: ${display_name}`, 'success');
            } else {
                showToast("Address not found.", 'info');
            }
        } catch (e) {
            showToast(`Geocoding error: ${e.message}`, 'error');
        } finally {
            appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
        }
    };
};

/**
 * Returns a handler function for the image file input.
 * @param {Array<object>} imagesMetadata - Array to store image metadata.
 * @param {function} renderPreview - Function to re-render image preview.
 * @returns {function} The onchange event handler for the file input.
 */
const _setupReportFormImageUploadHandler = (imagesMetadata, renderPreview) => {
    return async e => {
        const files = e.target.files;
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading for image upload
        try {
            for (const file of files) {
                try {
                    const processedImage = await processImageFile(file); // Use the new utility
                    const uploadedUrl = await imgSvc.upload(processedImage.file);
                    imagesMetadata.push({
                        url: uploadedUrl,
                        type: processedImage.file.type,
                        dim: `${processedImage.dimensions.w}x${processedImage.dimensions.h}`,
                        hHex: processedImage.hash
                    });
                    showToast(`Image ${file.name} uploaded.`, 'success', 1500);
                } catch (error) {
                    showToast(`Failed to upload ${file.name}: ${error.message}`, 'error');
                }
            }
            renderPreview(); // Re-render preview after all uploads
        } finally {
            appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
        }
    };
};

/**
 * Sets up the form submission handler for the report form.
 * @param {HTMLElement} formElement - The form element.
 * @param {object|null} reportToEdit - The report object if editing, null if new.
 * @param {object} formState - Object holding form state (_pFLoc).
 * @param {Array<object>} imagesMetadata - Array of image metadata.
 */
const _setupReportFormSubmission = (formElement, reportToEdit, formState, imagesMetadata) => {
    formElement.onsubmit = async e => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type=submit]');
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        if (!formState.pFLoc) return showToast("Location missing. Please pick or geocode a location.", 'warning');

        submitBtn.disabled = true;
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading for report submission
        try {
            const lat = formState.pFLoc.lat;
            const lon = formState.pFLoc.lng;
            const geohash = geohashEncode(lat, lon);
            const focusTag = appStore.get().currentFocusTag.substring(1); // Remove '#' prefix

            const tags = [['g', geohash]];

            if (data.title) tags.push(['title', data.title]);
            if (data.summary) tags.push(['summary', data.summary]);
            if (focusTag && focusTag !== 'NostrMapper_Global') tags.push(['t', focusTag]);

            // Add free tags
            if (data.freeTags) {
                data.freeTags.split(',').forEach(tag => {
                    const trimmedTag = tag.trim();
                    if (trimmedTag) tags.push(['t', trimmedTag.replace(/^#/, '')]); // Remove '#' if present
                });
            }

            // Add categories (checkbox-group will have multiple entries for 'category')
            const selectedCategories = formData.getAll('category');
            selectedCategories.forEach(cat => {
                tags.push(['L', 'report-category']); // NIP-32 label tag
                tags.push(['l', cat, 'report-category']); // NIP-32 value tag
            });

            if (data.eventType) tags.push(['event_type', data.eventType]);
            if (data.status) tags.push(['status', data.status]);

            imagesMetadata.forEach(img => tags.push(['image', img.url, img.type, img.dim, `ox${img.hHex}`]));

            // NIP-33 d-tag for parameterized replaceable events
            // If editing, retain the original d-tag. If new, generate a UUID.
            const dTagValue = reportToEdit?.d || generateUUID();
            tags.push(['d', dTagValue]);

            const eventData = { kind: C.NOSTR_KIND_REPORT, content: data.description, tags };

            await nostrSvc.pubEv(eventData);
            showToast('Report sent!', 'success');
            e.target.reset();
            $('#pFLoc-coords', formRoot).textContent = 'None';
            $('#upld-photos-preview', formRoot).innerHTML = '';
            formState.pFLoc = null;
            imagesMetadata.length = 0; // Clear the array
            hideModal('report-form-modal');
        } catch (error) {
            showToast(`Report submission error: ${error.message}`, 'error');
        } finally {
            submitBtn.disabled = false;
            appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
        }
    };
};

export function RepFormComp(reportToEdit = null) {
    const categories = appStore.get().settings.cats;

    // Encapsulate form state within this function's scope
    let pFLoc = null;
    let uIMeta = [];

    // Pre-fill location and images if editing
    if (reportToEdit) {
        if (reportToEdit.lat && reportToEdit.lon) {
            pFLoc = { lat: reportToEdit.lat, lng: reportToEdit.lon };
        }
        if (reportToEdit.imgs && reportToEdit.imgs.length > 0) {
            uIMeta = [...reportToEdit.imgs];
        }
    }

    // Helper to update the location display text
    const renderLocationDisplay = (addressName = '') => {
        const coordsEl = $('#pFLoc-coords', formRoot);
        if (pFLoc) {
            coordsEl.textContent = `${pFLoc.lat.toFixed(5)},${pFLoc.lng.toFixed(5)}${addressName ? ` (${sanitizeHTML(addressName)})` : ''}`;
        } else {
            coordsEl.textContent = 'None';
        }
    };

    // Helper to re-render image preview
    const renderImagePreview = () => {
        const previewElement = $('#upld-photos-preview', formRoot);
        _renderImagePreview(previewElement, uIMeta, (index) => {
            uIMeta.splice(index, 1); // Remove image from array
            renderImagePreview(); // Re-render preview
        });
    };

    const initialFormData = {
        title: reportToEdit?.title,
        summary: reportToEdit?.sum,
        description: reportToEdit?.ct,
        category: reportToEdit?.cat, // For checkbox-group
        freeTags: reportToEdit?.fTags?.join(', '),
        eventType: reportToEdit?.evType,
        status: reportToEdit?.stat
    };

    const reportFormFields = [
        { label: 'Title:', type: 'text', id: 'rep-title', name: 'title' },
        { label: 'Summary:', type: 'text', id: 'rep-sum', name: 'summary', required: true },
        { label: 'Description (MD):', type: 'textarea', id: 'rep-desc', name: 'description', required: true, rows: 3 },
        { label: 'Location:', type: 'custom-html', id: 'map-pick-area', content: ['Selected: ', createEl('span', { id: 'pFLoc-coords', textContent: initialFormData.location || 'None' })] },
        { label: 'Pick Location', type: 'button', id: 'pick-loc-map-btn', buttonType: 'button' },
        { label: 'Use GPS', type: 'button', id: 'use-gps-loc-btn', buttonType: 'button' },
        { label: 'Or Enter Address:', type: 'text', id: 'rep-address', name: 'address', placeholder: 'e.g., 1600 Amphitheatre Pkwy' },
        { label: 'Geocode Address', type: 'button', id: 'geocode-address-btn', buttonType: 'button' },
        {
            label: 'Categories:',
            type: 'checkbox-group',
            id: 'cats-cont-form',
            name: 'category',
            class: 'cats-cont-form',
            options: categories.map(cat => ({ value: cat, label: cat }))
        },
        { label: 'Add. Tags (comma-sep):', type: 'text', id: 'rep-ftags', name: 'freeTags' },
        {
            label: 'Event Type:',
            type: 'select',
            id: 'rep-evType',
            name: 'eventType',
            options: ['Observation', 'Incident', 'Request', 'Offer', 'Other'].map(type => ({ value: type.toLowerCase(), label: type }))
        },
        {
            label: 'Status:',
            type: 'select',
            id: 'rep-stat',
            name: 'status',
            options: ['New', 'Active', 'Needs Verification'].map(status => ({ value: status.toLowerCase().replace(' ', '_'), label: status }))
        },
        { label: 'Photos (max 5MB each):', type: 'file', id: 'rep-photos', name: 'photos', multiple: true, accept: 'image/*', onchange: _setupReportFormImageUploadHandler(uIMeta, renderImagePreview) },
        { type: 'custom-html', id: 'upld-photos-preview' },
        { type: 'paragraph', class: 'warning', content: ['Reports are public on Nostr.'] },
        { label: reportToEdit ? 'Update Report' : 'Submit', type: 'button', buttonType: 'submit' },
        { label: 'Cancel', type: 'button', buttonType: 'button', class: 'secondary', onclick: () => hideModal('report-form-modal') }
    ];

    const formRoot = createModalWrapper('report-form-modal', reportToEdit ? 'Edit Report' : 'New Report', (modalContent) => {
        const form = renderForm(reportFormFields, initialFormData, { id: 'nstr-rep-form' });
        modalContent.appendChild(form);

        // Attach other handlers after form is rendered
        _setupReportFormLocationHandlers(form, { pFLoc }, renderLocationDisplay);
        _setupReportFormSubmission(form, reportToEdit, { pFLoc }, uIMeta);

        // Initial render of image preview and location display
        renderImagePreview();
        renderLocationDisplay();

        return form; // Return the form element
    });

    return formRoot; // This is the modal-content div
}
