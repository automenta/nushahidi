import {appStore} from '../../store.js';
import {imgSvc, mapSvc, nostrSvc} from '../../services.js';
import {C, createEl, generateUUID, geohashEncode, processImageFile, sanitizeHTML, showToast} from '../../utils.js';
import {renderForm, renderList} from '../forms.js';
import {Modal} from '../modals.js';
import {withLoading, withToast} from '../../decorators.js';

export class ReportFormModal extends Modal {
    constructor(reportToEdit = null) {
        const categories = appStore.get().settings.cats;
        this.formState = {
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
            uIMeta: this.formState.uIMeta,
            location: this.formState.pFLoc ? `${this.formState.pFLoc.lat.toFixed(5)},${this.formState.pFLoc.lng.toFixed(5)}` : 'None'
        };

        this.modalContentContainer = null;
        this.form = null;
        this.pFLocCoordsEl = null;
        this.upldPhotosPreviewEl = null;
        this.reportToEdit = reportToEdit;

        const contentRenderer = () => {
            this.modalContentContainer = createEl('div');
            this.form = renderForm(this.getReportFormFields(categories, initialFormData), initialFormData, { id: 'nstr-rep-form' });
            this.modalContentContainer.appendChild(this.form);

            this.pFLocCoordsEl = this.form.querySelector('#pFLoc-coords');
            this.upldPhotosPreviewEl = this.form.querySelector('#upld-photos-preview');

            this.form.querySelector('#rep-photos').onchange = this.setupReportFormImageUploadHandler(this.formState.uIMeta, this.renderImagePreview.bind(this), this.form);
            this.setupReportFormLocationHandlers(this.form, this.formState, this.updateLocationDisplay.bind(this));
            this.setupReportFormSubmission(this.form, this.reportToEdit, this.formState, this.formState.uIMeta);

            this.renderImagePreview(this.formState.uIMeta);
            this.updateLocationDisplay();

            return this.modalContentContainer;
        };

        super('report-form-modal', reportToEdit ? 'Edit Report' : 'New Report', contentRenderer);
    }

    getReportFormFields(cats, initialData) {
        return [
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
    }

    renderImagePreview(imagesMetadata) {
        this.upldPhotosPreviewEl.innerHTML = '';
        if (!imagesMetadata.length) {
            this.upldPhotosPreviewEl.textContent = 'No images selected.';
            return;
        }

        const imageItemRenderer = img => createEl('span', { textContent: sanitizeHTML(img.url.substring(img.url.lastIndexOf('/') + 1)) });
        const imageActionsConfig = [{
            label: 'x',
            className: 'remove-image-btn',
            onClick: (item, index) => {
                imagesMetadata.splice(index, 1);
                this.renderImagePreview(imagesMetadata);
            }
        }];

        renderList(
            this.upldPhotosPreviewEl,
            imagesMetadata,
            imageItemRenderer,
            imageActionsConfig,
            'uploaded-image-item'
        );
    }

    updateLocationDisplay(addressName = '') {
        if (this.pFLocCoordsEl) {
            this.pFLocCoordsEl.textContent = this.formState.pFLoc ?
                `${this.formState.pFLoc.lat.toFixed(5)},${this.formState.pFLoc.lng.toFixed(5)}${addressName ? ` (${sanitizeHTML(addressName)})` : ''}` :
                'None';
        }
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

            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}}&limit=1`);
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

    buildReportTags(formData, formState, imagesMetadata, reportToEdit, currentFocusTag) {
        const tags = [];
        if (reportToEdit) tags.push(['e', reportToEdit.id, '', 'root']);
        tags.push(['title', formData.get('title') || '']);
        tags.push(['summary', formData.get('summary') || '']);
        tags.push(['g', geohashEncode(formState.pFLoc.lat, formState.pFLoc.lng)]);
        formData.getAll('category').forEach(cat => tags.push(['l', cat, 'report-category']));
        if (formData.get('freeTags')) {
            formData.get('freeTags').split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.push(['t', t]));
        }
        if (currentFocusTag && currentFocusTag !== C.FOCUS_TAG_DEFAULT) tags.push(['t', currentFocusTag.substring(1)]);
        if (formData.get('eventType')) tags.push(['event_type', formData.get('eventType')]);
        if (formData.get('status')) tags.push(['status', formData.get('status')]);
        imagesMetadata.forEach(img => tags.push(['image', img.url, img.type, img.dim, img.hHex]));
        if (reportToEdit) tags.push(['d', reportToEdit.d || generateUUID()]);
        return tags;
    }

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
            this.pFLocCoordsEl.textContent = 'None';
            this.upldPhotosPreviewEl.innerHTML = '';
            formState.pFLoc = null;
            imagesMetadata.length = 0;
            this.hide();
            return 'Report sent!';
        }, null, "Report submission error", e => {
            formElement.querySelector('button[type=submit]').disabled = false;
        }));
    }
}
