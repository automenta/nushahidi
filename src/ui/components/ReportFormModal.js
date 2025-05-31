import {appStore} from '../../store.js';
import {imgSvc, mapSvc, nostrSvc} from '../../services.js';
import {C, createEl, generateUUID, geohashEncode, processImageFile, sanitizeHTML, showToast} from '../../utils.js';
import {renderForm} from '../forms.js';
import {Modal} from '../modals.js';
import {withLoading, withToast} from '../../decorators.js';
import {ImagePreviewItem} from './ImagePreviewItem.js';

export class ReportFormModal extends Modal {
    constructor() {
        // The contentRenderer for the Modal constructor should be minimal
        // and not access 'this' of ReportFormModal.
        // The actual form rendering and setup will happen in the show() method.
        const contentRenderer = () => {
            // This div will be populated by the show() method later
            return createEl('div', {class: 'report-form-content-container'});
        };

        super('report-form-modal', 'New Report', contentRenderer);

        // Now 'this' is available
        this.reportToEdit = null;
        this.formState = {
            pFLoc: null,
            uIMeta: []
        };

        // Get reference to the container created by contentRenderer
        this.modalContentContainer = this.root.querySelector('.report-form-content-container');
        this.form = null;
        this.pFLocCoordsEl = null;
        this.upldPhotosPreviewEl = null;

        // Call show() to perform the initial rendering and setup.
        this.show();
    }

    show(focusElOrSelector, reportToEdit = null) {
        this.reportToEdit = reportToEdit;
        const categories = appStore.get().settings.cats;

        this.formState.pFLoc = reportToEdit?.lat && reportToEdit?.lon ? {lat: reportToEdit.lat, lng: reportToEdit.lon} : null;
        this.formState.uIMeta = reportToEdit?.imgs?.length ? [...reportToEdit.imgs] : [];

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

        this.root.querySelector('h2').textContent = reportToEdit ? 'Edit Report' : 'New Report';

        const {form: newForm, fields} = renderForm(this.getReportFormFields(categories, initialFormData), initialFormData, {class: 'nstr-rep-form'});
        
        // Clear existing content and append the new form
        this.modalContentContainer.innerHTML = '';
        this.modalContentContainer.appendChild(newForm);
        this.form = newForm; // Update reference to the current form

        this.pFLocCoordsEl = fields.pFLocCoords;
        this.upldPhotosPreviewEl = fields.uploadedPhotosPreview;

        fields.reportPhotos.onchange = this.setupReportFormImageUploadHandler(this.formState.uIMeta, this.renderImagePreview.bind(this));
        this.setupReportFormLocationHandlers(fields, this.formState, this.updateLocationDisplay.bind(this));
        this.setupReportFormSubmission(this.form, this.reportToEdit, this.formState, this.formState.uIMeta);

        this.renderImagePreview(this.formState.uIMeta);
        this.updateLocationDisplay();

        super.show(focusElOrSelector);
    }

    getReportFormFields(cats, initialData) {
        return [
            {label: 'Title:', type: 'text', name: 'title'},
            {label: 'Summary:', type: 'text', name: 'summary', required: true},
            {label: 'Description (MD):', type: 'textarea', name: 'description', required: true, rows: 3},
            {label: 'Location:', type: 'custom-html', ref: 'pFLocCoords', content: ['Selected: ', createEl('span', {class: 'pFLoc-coords', textContent: initialData.location || 'None'})]},
            {type: 'button', ref: 'pickLocMapBtn', label: 'Pick Location', buttonType: 'button'},
            {type: 'button', ref: 'useGpsLocBtn', label: 'Use GPS', buttonType: 'button'},
            {label: 'Or Enter Address:', type: 'text', name: 'address', placeholder: 'e.g., 1600 Amphitheatre Pkwy'},
            {type: 'button', ref: 'geocodeAddressBtn', label: 'Geocode Address', buttonType: 'button'},
            {
                label: 'Categories:',
                type: 'checkbox-group',
                name: 'category',
                class: 'cats-cont-form',
                options: (cats || []).map(cat => ({value: cat, label: cat}))
            },
            {label: 'Add. Tags (comma-sep):', type: 'text', name: 'freeTags'},
            {
                label: 'Event Type:',
                type: 'select',
                name: 'eventType',
                options: ['Observation', 'Incident', 'Request', 'Offer', 'Other'].map(type => ({value: type.toLowerCase(), label: type}))
            },
            {
                label: 'Status:',
                type: 'select',
                name: 'status',
                options: ['New', 'Active', 'Needs Verification'].map(status => ({value: status.toLowerCase().replace(' ', '_'), label: status}))
            },
            {label: 'Photos (max 5MB each):', type: 'file', ref: 'reportPhotos', name: 'photos', multiple: true, accept: 'image/*'},
            {type: 'custom-html', ref: 'uploadedPhotosPreview', class: 'upld-photos-preview'},
            {type: 'paragraph', class: 'warning', content: ['Reports are public on Nostr.']},
            {type: 'button', ref: 'submitReportBtn', label: initialData.isEdit ? 'Update Report' : 'Submit', buttonType: 'submit'},
            {type: 'button', ref: 'cancelReportBtn', class: 'secondary', label: 'Cancel', onclick: () => this.hide()}
        ];
    }

    renderImagePreview(imagesMetadata) {
        this.upldPhotosPreviewEl.innerHTML = '';
        if (!imagesMetadata.length) {
            this.upldPhotosPreviewEl.textContent = 'No images selected.';
            return;
        }

        imagesMetadata.forEach((img, index) => {
            const item = new ImagePreviewItem(img, () => {
                imagesMetadata.splice(index, 1);
                this.renderImagePreview(imagesMetadata);
            });
            this.upldPhotosPreviewEl.appendChild(item.element);
        });
    }

    updateLocationDisplay(addressName = '') {
        if (this.pFLocCoordsEl) {
            this.pFLocCoordsEl.textContent = this.formState.pFLoc ?
                `${this.formState.pFLoc.lat.toFixed(5)},${this.formState.pFLoc.lng.toFixed(5)}${addressName ? ` (${sanitizeHTML(addressName)})` : ''}` :
                'None';
        }
    }

    setupReportFormLocationHandlers(fields, formState, updateLocationDisplay) {
        const pickLocMapBtn = fields.pickLocMapBtn;
        const useGpsLocBtn = fields.useGpsLocBtn;
        const geocodeAddressBtn = fields.geocodeAddressBtn;
        const repAddressInput = fields.address;

        pickLocMapBtn.onclick = () => {
            this.hide();
            mapSvc.enPickLoc(latlng => {
                formState.pFLoc = latlng;
                updateLocationDisplay();
                this.show('.nstr-rep-form #field-title', this.reportToEdit);
            });
        };

        useGpsLocBtn.onclick = () => {
            if (!navigator.geolocation) {
                showToast("GPS not supported by your browser.", 'warning');
                return;
            }
            navigator.geolocation.getCurrentPosition(
                position => {
                    formState.pFLoc = {lat: position.coords.latitude, lng: position.coords.longitude};
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
                const {lat, lon, display_name} = data[0];
                formState.pFLoc = {lat: parseFloat(lat), lng: parseFloat(lon)};
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

            const signedEvent = await nostrSvc.pubEv({kind: C.NOSTR_KIND_REPORT, content: data.description, tags});
            e.target.reset();
            this.pFLocCoordsEl.textContent = 'None';
            this.upldPhotosPreviewEl.innerHTML = '';
            formState.pFLoc = null;
            imagesMetadata.length = 0;
            this.hide();
            submitBtn.disabled = false; // Re-enable button on success

            // After successful submission, navigate to the report details
            appStore.set(s => ({ui: {...s.ui, reportIdToView: signedEvent.id, showReportList: false}}));

            return 'Report sent!';
        }, null, "Report submission error", e => {
            formElement.querySelector('button[type=submit]').disabled = false;
        }));
    }
}
