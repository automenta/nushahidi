import {appStore} from '../../store.js';
import {imgSvc, mapSvc, nostrSvc} from '../../services.js';
import {C, createEl, generateUUID, geohashEncode, processImageFile, sanitizeHTML, showToast} from '../../utils.js';
import {renderForm, renderList} from '../forms.js';
import {Modal} from '../modals.js';
import {withLoading, withToast} from '../../decorators.js';

export class ReportFormModal extends Modal {
    constructor(reportToEdit = null) {
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

        let modalContentContainer;
        let form;
        let pFLocCoordsEl;
        let upldPhotosPreviewEl;

        const getReportFormFields = (cats, initialData) => [
            { label: 'Title:', type: 'text', id: 'rep-title', name: 'title' },
            { label: 'Summary:', type: 'text', id: 'rep-sum', name: 'summary', required: true },
            { label: 'Description (MD):', type: 'textarea', id: 'rep-desc', name: 'description', required: true, rows: 3 },
            { label: 'Location:', type: 'custom-html', content: ['Selected: ', createEl('span', { id: 'pFLoc-coords', textContent: initialData.location || 'None' })] },
            { type: 'button', id: 'pick-loc-map-btn', label: 'Pick Location', buttonType: 'button' },
            { type: 'button', id: 'use-gps-loc-btn', label: 'Use GPS', buttonType: 'button' },
            { label: 'Or Enter Address:', type: 'text', id: 'rep-address', name: 'address', placeholder: 'e.g., 1600 Amphitheatre Pkwy' },
            { type: 'button', id: 'geocode-address-btn', label: 'Geocode Address', buttonType: 'button' },
            {
                label: 'Categories:',
                type: 'checkbox-group',
                id: 'cats-cont-form',
                name: 'category',
                class: 'cats-cont-form',
                options: (cats || []).map(cat => ({ value: cat, label: cat }))
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
            { type: 'button', id: 'submit-report-btn', label: initialData.isEdit ? 'Update Report' : 'Submit', buttonType: 'submit' },
            { type: 'button', id: 'cancel-report-btn', class: 'secondary', label: 'Cancel', onclick: () => this.hide() }
        ];

        const renderImagePreview = (imagesMetadata) => {
            upldPhotosPreviewEl.innerHTML = '';
            if (!imagesMetadata.length) {
                upldPhotosPreviewEl.textContent = 'No images selected.';
                return;
            }

            const imageItemRenderer = img => createEl('span', { textContent: sanitizeHTML(img.url.substring(img.url.lastIndexOf('/') + 1)) });
            const imageActionsConfig = [{
                label: 'x',
                className: 'remove-image-btn',
                onClick: (item, index) => {
                    imagesMetadata.splice(index, 1);
                    updatePreview(imagesMetadata);
                }
            }];

            renderList(
                upldPhotosPreviewEl,
                imagesMetadata,
                imageItemRenderer,
                imageActionsConfig,
                'uploaded-image-item'
            );
        };

        const updateLocationDisplay = (addressName = '') => {
            if (pFLocCoordsEl) {
                pFLocCoordsEl.textContent = formState.pFLoc ?
                    `${formState.pFLoc.lat.toFixed(5)},${formState.pFLoc.lng.toFixed(5)}${addressName ? ` (${sanitizeHTML(addressName)})` : ''}` :
                    'None';
            }
        };

        const contentRenderer = () => {
            modalContentContainer = createEl('div');
            form = renderForm(getReportFormFields(categories, initialFormData), initialFormData, { id: 'nstr-rep-form' });
            modalContentContainer.appendChild(form);

            pFLocCoordsEl = form.querySelector('#pFLoc-coords');
            upldPhotosPreviewEl = form.querySelector('#upld-photos-preview');

            form.querySelector('#rep-photos').onchange = this.setupReportFormImageUploadHandler(formState.uIMeta, renderImagePreview, form);
            this.setupReportFormLocationHandlers(form, formState, updateLocationDisplay);
            this.setupReportFormSubmission(form, reportToEdit, formState, formState.uIMeta);

            renderImagePreview(formState.uIMeta);
            updateLocationDisplay();

            return modalContentContainer;
        };

        super('report-form-modal', reportToEdit ? 'Edit Report' : 'New Report', contentRenderer);
    }

    buildReportTags(formData, formState, imagesMetadata, reportToEdit, currentFocusTag) {
        const data = Object.fromEntries(formData.entries());
        const tags = [['g', geohashEncode(formState.pFLoc.lat, formState.pFLoc.lng)]];

        if (data.title) tags.push(['title', data.title]);
        if (data.summary) tags.push(['summary', data.summary]);
        if (currentFocusTag && currentFocusTag !== 'NostrMapper_Global') tags.push(['t', currentFocusTag.substring(1)]);

        formData.getAll('category').forEach(cat => {
            tags.push(['L', 'report-category']);
            tags.push(['l', cat, 'report-category']);
        });

        if (data.freeTags) {
            data.freeTags.split(',').forEach(tag => {
                const trimmedTag = tag.trim();
                if (trimmedTag) tags.push(['t', trimmedTag.replace(/^#/, '')]);
            });
        }

        if (data.eventType) tags.push(['event_type', data.eventType]);
        if (data.status) tags.push(['status', data.status]);

        imagesMetadata.forEach(img => tags.push(['image', img.url, img.type, img.dim, `ox${img.hHex}`]));

        tags.push(['d', reportToEdit?.d || generateUUID()]);

        return tags;
    }

    setupReportFormLocationHandlers(formElement, formState, updateLocationDisplay) {
        const pickLocMapBtn = formElement.querySelector('#pick-loc-map-btn');
        const useGpsLocBtn = formElement.querySelector('#use-gps-loc-btn');
        const geocodeAddressBtn = formElement.querySelector('#geocode-address-btn');
        const repAddressInput = formElement.querySelector('#rep-address');

        pickLocMapBtn.onclick = () => {
            this.hide();
            mapSvc.enPickLoc(latlng => {
                formState.pFLoc = latlng;
                updateLocationDisplay();
                this.show('rep-title');
            });
        };

        useGpsLocBtn.onclick = () => {
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

        geocodeAddressBtn.onclick = withLoading(withToast(async () => {
            const address = repAddressInput.value.trim();
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
    }

    setupReportFormImageUploadHandler = (imagesMetadata, updatePreview) => async e => {
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
                updatePreview(imagesMetadata);
                return `Image ${file.name} uploaded.`;
            }, null, `Failed to upload ${file.name}`))();
        }
    };

    setupReportFormSubmission(formElement, reportToEdit, formState, imagesMetadata) {
        formElement.onsubmit = withLoading(withToast(async e => {
            e.preventDefault();
            const submitBtn = e.target.querySelector('button[type=submit]');
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());

            if (!formState.pFLoc) throw new Error("Location missing. Please pick or geocode a location.");

            submitBtn.disabled = true;

            const currentFocusTag = appStore.get().currentFocusTag;
            const tags = this.buildReportTags(formData, formState, imagesMetadata, reportToEdit, currentFocusTag);

            await nostrSvc.pubEv({ kind: C.NOSTR_KIND_REPORT, content: data.description, tags });
            e.target.reset();
            formElement.querySelector('#pFLoc-coords').textContent = 'None';
            formElement.querySelector('#upld-photos-preview').innerHTML = '';
            formState.pFLoc = null;
            imagesMetadata.length = 0;
            this.hide();
            return 'Report sent!';
        }, null, "Report submission error", e => {
            formElement.querySelector('button[type=submit]').disabled = false;
        }));
    }
}
