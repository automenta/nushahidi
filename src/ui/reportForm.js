import {appStore} from '../store.js';
import {imgSvc, mapSvc, nostrSvc} from '../services.js';
import {$, C, createEl, generateUUID, geohashEncode, processImageFile, sanitizeHTML, showToast} from '../utils.js';
import {renderForm, renderList} from './forms.js';
import {createModalWrapper, hideModal, showModal} from './modals.js';
import {withLoading, withToast} from '../decorators.js';

const getReportFormFields = (categories, initialFormData) => [
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
        options: (categories || []).map(cat => ({ value: cat, label: cat }))
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
    { label: 'Photos (max 5MB each):', type: 'file', id: 'rep-photos', name: 'photos', multiple: true, accept: 'image/*' },
    { type: 'custom-html', id: 'upld-photos-preview' },
    { type: 'paragraph', class: 'warning', content: ['Reports are public on Nostr.'] },
    { label: initialFormData.isEdit ? 'Update Report' : 'Submit', type: 'button', id: 'submit-report-btn', buttonType: 'submit' },
    { label: 'Cancel', type: 'button', id: 'cancel-report-btn', buttonType: 'button', class: 'secondary', onclick: () => hideModal('report-form-modal') }
];

const renderImagePreview = (previewElement, imagesMetadata, onRemoveImage) => {
    previewElement.innerHTML = '';
    if (!imagesMetadata.length) {
        previewElement.textContent = 'No images selected.';
        return;
    }

    const imageItemRenderer = img => createEl('span', { textContent: sanitizeHTML(img.url.substring(img.url.lastIndexOf('/') + 1)) });
    const imageActionsConfig = [{
        label: 'x',
        className: 'remove-image-btn',
        onClick: (item, index) => onRemoveImage(index)
    }];

    renderList(
        previewElement.id,
        imagesMetadata,
        imageItemRenderer,
        imageActionsConfig,
        'uploaded-image-item',
        previewElement.parentNode
    );
};

const buildReportTags = (formData, formState, imagesMetadata, reportToEdit, currentFocusTag) => {
    const data = Object.fromEntries(formData.entries());
    const tags = [['g', geohashEncode(formState.pFLoc.lat, formState.pFLoc.lng)]];

    if (data.title) tags.push(['title', data.title]);
    if (data.summary) tags.push(['summary', data.summary]);
    if (currentFocusTag && currentFocusTag !== 'NostrMapper_Global') tags.push(['t', currentFocusTag.substring(1)]);

    data.freeTags?.split(',').forEach(tag => {
        const trimmedTag = tag.trim();
        if (trimmedTag) tags.push(['t', trimmedTag.replace(/^#/, '')]);
    });

    formData.getAll('category').forEach(cat => {
        tags.push(['L', 'report-category']);
        tags.push(['l', cat, 'report-category']);
    });

    if (data.eventType) tags.push(['event_type', data.eventType]);
    if (data.status) tags.push(['status', data.status]);

    imagesMetadata.forEach(img => tags.push(['image', img.url, img.type, img.dim, `ox${img.hHex}`]));

    tags.push(['d', reportToEdit?.d || generateUUID()]);

    return tags;
};

const setupReportFormLocationHandlers = (formElement, formState, updateLocationDisplay) => {
    $('#pick-loc-map-btn', formElement).onclick = () => {
        hideModal('report-form-modal');
        mapSvc.enPickLoc(latlng => {
            formState.pFLoc = latlng;
            updateLocationDisplay();
            showModal('report-form-modal', 'rep-title');
        });
    };

    $('#use-gps-loc-btn', formElement).onclick = () => {
        if (!navigator.geolocation) {
            showToast("GPS not supported by your browser.", 'warning');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            position => {
                formState.pFLoc = { lat: position.coords.latitude, lng: position.coords.longitude };
                updateLocationDisplay();
            },
            error => showToast(`GPS Error: ${error.message}`, 'error')
        );
    };

    $('#geocode-address-btn', formElement).onclick = withLoading(withToast(async () => {
        const address = $('#rep-address', formElement).value.trim();
        if (!address) throw new Error("Please enter an address to geocode.");

        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
        const data = await response.json();
        if (data?.length) {
            const { lat, lon, display_name } = data[0];
            formState.pFLoc = { lat: parseFloat(lat), lng: parseFloat(lon) };
            updateLocationDisplay(display_name);
            return `Address found: ${display_name}`;
        } else {
            throw new Error("Location not found.");
        }
    }, null, "Geocoding error"));
};

const setupReportFormImageUploadHandler = (imagesMetadata, updatePreview) => async e => {
    for (const file of e.target.files) {
        await withLoading(withToast(async () => {
            const processedImage = await processImageFile(file);
            const uploadedUrl = await imgSvc.upload(processedImage.file);
            imagesMetadata.push({
                url: uploadedUrl,
                type: processedImage.file.type,
                dim: `${processedImage.dimensions.w}x${processedImage.dimensions.h}`,
                hHex: processedImage.hash
            });
            updatePreview();
            return `Image ${file.name} uploaded.`;
        }, null, `Failed to upload ${file.name}`))();
    }
};

const setupReportFormSubmission = (formElement, reportToEdit, formState, imagesMetadata) => {
    formElement.onsubmit = withLoading(withToast(async e => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type=submit]');
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        if (!formState.pFLoc) throw new Error("Location missing. Please pick or geocode a location.");

        submitBtn.disabled = true;

        const currentFocusTag = appStore.get().currentFocusTag;
        const tags = buildReportTags(formData, formState, imagesMetadata, reportToEdit, currentFocusTag);

        await nostrSvc.pubEv({ kind: C.NOSTR_KIND_REPORT, content: data.description, tags });
        e.target.reset();
        $('#pFLoc-coords', formElement).textContent = 'None';
        $('#upld-photos-preview', formElement).innerHTML = '';
        formState.pFLoc = null;
        imagesMetadata.length = 0;
        hideModal('report-form-modal');
        return 'Report sent!';
    }, null, "Report submission error", e => {
        formElement.querySelector('button[type=submit]').disabled = false;
    }));
};

export function RepFormComp(reportToEdit = null) {
    const categories = appStore.get().settings.cats;

    const formState = {
        pFLoc: reportToEdit?.lat && reportToEdit?.lon ? { lat: reportToEdit.lat, lng: reportToEdit.lon } : null,
        uIMeta: reportToEdit?.imgs?.length ? [...reportToEdit.imgs] : []
    };

    const initialFormData = {
        title: reportToEdit?.title,
        summary: reportToEdit?.sum,
        description: reportToEdit?.ct,
        category: reportToEdit?.cat,
        freeTags: reportToEdit?.fTags?.join(', '),
        eventType: reportToEdit?.evType,
        status: reportToEdit?.stat,
        isEdit: !!reportToEdit,
        uIMeta: formState.uIMeta,
        location: formState.pFLoc ? `${formState.pFLoc.lat.toFixed(5)},${formState.pFLoc.lng.toFixed(5)}` : 'None'
    };

    const formRoot = createModalWrapper('report-form-modal', reportToEdit ? 'Edit Report' : 'New Report', modalContent => {
        const updateLocationDisplay = (addressName = '') => {
            const coordsEl = $('#pFLoc-coords', modalContent);
            coordsEl.textContent = formState.pFLoc ?
                `${formState.pFLoc.lat.toFixed(5)},${formState.pFLoc.lng.toFixed(5)}${addressName ? ` (${sanitizeHTML(addressName)})` : ''}` :
                'None';
        };

        const updateImagePreview = () => {
            const previewElement = $('#upld-photos-preview', modalContent);
            renderImagePreview(previewElement, formState.uIMeta, index => {
                formState.uIMeta.splice(index, 1);
                updateImagePreview();
            });
        };

        const form = renderForm(getReportFormFields(categories, initialFormData), initialFormData, { id: 'nstr-rep-form' });
        modalContent.appendChild(form);

        $('#rep-photos', form).onchange = setupReportFormImageUploadHandler(formState.uIMeta, updateImagePreview);
        setupReportFormLocationHandlers(form, formState, updateLocationDisplay);
        setupReportFormSubmission(form, reportToEdit, formState, formState.uIMeta);

        updateImagePreview();
        updateLocationDisplay();

        return form;
    });

    return formRoot;
}
