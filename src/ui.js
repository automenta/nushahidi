import { marked } from 'marked';
import { point, booleanPointInPolygon } from '@turf/turf'; // Import turf for spatial queries
import { appStore } from './store.js';
import { mapSvc, idSvc, confSvc, nostrSvc, imgSvc, dbSvc } from './services.js';
import { C, $, $$, createEl, showModal, hideModal, sanitizeHTML, debounce, geohashEncode, sha256, getImgDims, formatNpubShort, npubToHex, showToast, isValidUrl, generateUUID, renderList } from './utils.js';

const gE = (id, p = document) => $(id, p); /* gE: getElement */
const cE = (t, a, c) => createEl(t, a, c); /* cE: createElement */
const sH = s => sanitizeHTML(s); /* sH: sanitizeHTML */

// --- UI State & General Updates ---
const updAuthDisp = pk => {
    const authButton = gE('#auth-button');
    const userPubkeySpan = gE('#user-pubkey');
    if (pk) {
        authButton.textContent = 'Logout';
        userPubkeySpan.textContent = `User: ${formatNpubShort(pk)}`;
        userPubkeySpan.style.display = 'inline';
    } else {
        authButton.textContent = 'Connect Nostr';
        userPubkeySpan.style.display = 'none';
    }
};

const updConnDisp = isOnline => {
    const connectionStatusElement = gE('#connection-status');
    if (connectionStatusElement) {
        connectionStatusElement.textContent = isOnline ? 'Online' : 'Offline';
        connectionStatusElement.style.color = isOnline ? 'lightgreen' : 'lightcoral';
    }
};

const updSyncDisp = async () => {
    const syncStatusElement = gE('#sync-status');
    if (!syncStatusElement) return;
    try {
        const queue = await dbSvc.getOfflineQ();
        if (queue.length > 0) {
            syncStatusElement.textContent = `Syncing (${queue.length})...`;
            syncStatusElement.style.color = 'orange';
        } else {
            syncStatusElement.textContent = appStore.get().online ? 'Synced' : 'Offline';
            syncStatusElement.style.color = 'lightgreen';
        }
    } catch {
        syncStatusElement.textContent = 'Sync status err';
        syncStatusElement.style.color = 'red';
    }
};

// --- Generic Modal Factory ---
/**
 * Creates a generic modal wrapper with common elements (close button, heading).
 * @param {string} modalId - The ID of the modal container element (e.g., 'confirm-modal').
 * @param {string} title - The title for the modal heading.
 * @param {function(HTMLElement): (HTMLElement|HTMLElement[])} contentRenderer - A function that takes the modal's content root element and appends/returns its specific content.
 * @returns {HTMLElement} The modal-content div.
 */
export function createModalWrapper(modalId, title, contentRenderer) {
    const modalElement = gE(`#${modalId}`);
    if (!modalElement) {
        console.error(`Modal element with ID ${modalId} not found.`);
        return null;
    }

    const modalContent = cE('div', { class: 'modal-content' });
    modalElement.innerHTML = ''; // Clear previous content
    modalElement.appendChild(modalContent);

    const closeBtn = cE('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => hideModal(modalId) });
    const heading = cE('h2', { id: `${modalId}-heading`, textContent: title });

    modalContent.appendChild(closeBtn);
    modalContent.appendChild(heading);

    // Render specific content
    const specificContent = contentRenderer(modalContent);
    if (Array.isArray(specificContent)) {
        specificContent.forEach(el => modalContent.appendChild(el));
    } else if (specificContent instanceof Node) {
        modalContent.appendChild(specificContent);
    }

    return modalContent; // Return the modal-content div for further manipulation if needed
}

// --- Generic Confirmation Modal ---
export function showConfirmModal(title, message, onConfirm, onCancel) {
    const modalContent = createModalWrapper('confirm-modal', title, (root) => {
        const msgPara = cE('p', { innerHTML: message });
        const buttonContainer = cE('div', { class: 'confirm-modal-buttons' });

        const confirmBtn = cE('button', {
            class: 'confirm-button',
            textContent: 'Confirm',
            onclick: () => { hideModal('confirm-modal'); onConfirm(); }
        });
        const cancelBtn = cE('button', {
            class: 'cancel-button',
            textContent: 'Cancel',
            onclick: () => { hideModal('confirm-modal'); if (onCancel) onCancel(); }
        });

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(confirmBtn);

        return [msgPara, buttonContainer];
    });

    showModal('confirm-modal', 'confirm-modal-heading');
}

// --- Passphrase Input Modal ---
export function showPassphraseModal(title, message) {
    return new Promise((resolve) => {
        const modalContent = createModalWrapper('passphrase-modal', title, (root) => {
            const msgPara = cE('p', { textContent: message });
            const passphraseInput = cE('input', { type: 'password', id: 'passphrase-input', placeholder: 'Enter passphrase', autocomplete: 'current-password' });
            const buttonContainer = cE('div', { class: 'confirm-modal-buttons' }); // Re-use styles

            const decryptBtn = cE('button', {
                class: 'confirm-button',
                textContent: 'Decrypt',
                onclick: () => {
                    const passphrase = passphraseInput.value;
                    hideModal('passphrase-modal');
                    resolve(passphrase);
                }
            });
            const cancelBtn = cE('button', {
                class: 'cancel-button',
                textContent: 'Cancel',
                onclick: () => { hideModal('passphrase-modal'); resolve(null); }
            });

            passphraseInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    decryptBtn.click();
                }
            });

            buttonContainer.appendChild(cancelBtn);
            buttonContainer.appendChild(decryptBtn);

            return [msgPara, passphraseInput, buttonContainer];
        });

        showModal('passphrase-modal', 'passphrase-input');
    });
}

// --- Data-Driven Form Rendering ---
/**
 * Renders a form based on a configuration array.
 * @param {Array<object>} fieldsConfig - Array of field definitions. Each object:
 *   { type: string, id?: string, name?: string, label?: string, placeholder?: string, value?: any,
 *     required?: boolean, autocomplete?: string, rows?: number, multiple?: boolean, accept?: string,
 *     options?: Array<{value: string, label: string, selected?: boolean, onchange?: function}>,
 *     class?: string, buttonType?: string, onclick?: function, content?: (string|HTMLElement)[],
 *     innerHTML?: string, style?: string }
 * @param {object} initialData - Object with initial values for form fields (keyed by 'name').
 * @param {object} formOptions - Options for the form element itself (e.g., { id: 'my-form', onSubmit: handler }).
 * @returns {HTMLElement} The generated <form> element.
 */
function renderForm(fieldsConfig, initialData = {}, formOptions = {}) {
    const form = cE('form', { id: formOptions.id || 'dynamic-form' });
    if (formOptions.onSubmit) {
        form.onsubmit = formOptions.onSubmit;
    }

    fieldsConfig.forEach(field => {
        const fieldId = field.id || (field.name ? `field-${field.name}` : null);

        if (field.label && field.type !== 'button' && field.type !== 'custom-html' && field.type !== 'paragraph' && field.type !== 'hr' && field.type !== 'checkbox' && field.type !== 'h4') {
            form.appendChild(cE('label', { for: fieldId, textContent: field.label }));
        }

        let inputElement;
        switch (field.type) {
            case 'text':
            case 'password':
            case 'url':
            case 'email':
            case 'search':
            case 'datetime-local':
                inputElement = cE('input', {
                    type: field.type,
                    id: fieldId,
                    name: field.name,
                    placeholder: field.placeholder || '',
                    value: initialData[field.name] !== undefined ? initialData[field.name] : (field.value || ''),
                    required: field.required || false,
                    autocomplete: field.autocomplete || 'off',
                    readOnly: field.readOnly || false, // Added readOnly
                });
                break;
            case 'textarea':
                inputElement = cE('textarea', {
                    id: fieldId,
                    name: field.name,
                    placeholder: field.placeholder || '',
                    rows: field.rows || 3,
                    required: field.required || false,
                    textContent: initialData[field.name] !== undefined ? initialData[field.name] : (field.value || '')
                });
                break;
            case 'select':
                inputElement = cE('select', {
                    id: fieldId,
                    name: field.name,
                    required: field.required || false,
                    class: field.class || ''
                }, field.options.map(opt => cE('option', {
                    value: opt.value,
                    textContent: opt.label,
                    selected: (initialData[field.name] !== undefined && initialData[field.name] === opt.value) || (field.value !== undefined && field.value === opt.value)
                })));
                break;
            case 'checkbox-group': // For categories
                inputElement = cE('div', { id: fieldId, class: field.class || '' });
                field.options.forEach(opt => {
                    inputElement.appendChild(cE('label', {}, [
                        cE('input', {
                            type: 'checkbox',
                            name: field.name,
                            value: opt.value,
                            checked: initialData[field.name]?.includes(opt.value) || false
                        }),
                        ` ${sH(opt.label)}`
                    ]));
                });
                break;
            case 'checkbox': // For single checkboxes like spatial filter toggle
                inputElement = cE('label', {}, [
                    cE('input', {
                        type: 'checkbox',
                        id: fieldId,
                        name: field.name,
                        checked: initialData[field.name] || false,
                    }),
                    ` ${sH(field.label)}`
                ]);
                if (field.onchange) {
                    inputElement.querySelector('input').addEventListener('change', field.onchange);
                }
                break;
            case 'file':
                inputElement = cE('input', {
                    type: 'file',
                    id: fieldId,
                    name: field.name,
                    multiple: field.multiple || false,
                    accept: field.accept || ''
                });
                if (field.onchange) {
                    input.addEventListener('change', field.onchange);
                }
                break;
            case 'button':
                inputElement = cE('button', {
                    type: field.buttonType || 'button',
                    id: fieldId,
                    textContent: field.label,
                    class: field.class || '',
                    style: field.style || '' // Added style handling
                });
                if (field.onclick) {
                    inputElement.onclick = field.onclick;
                }
                break;
            case 'custom-html': // For things like location display or image preview
                inputElement = cE('div', { id: fieldId, class: field.class || '', innerHTML: field.innerHTML || '' }, field.content || []);
                break;
            case 'paragraph':
                inputElement = cE('p', { class: field.class || '', innerHTML: field.innerHTML || '' }, field.content || []);
                break;
            case 'hr':
                inputElement = cE('hr');
                break;
            case 'h4': // Added for headings within forms
                inputElement = cE('h4', { textContent: field.content[0] });
                break;
            case 'radio-group': // For active focus tag
                inputElement = cE('div', { id: fieldId, class: field.class || '' });
                field.options.forEach(opt => {
                    const radio = cE('input', {
                        type: 'radio',
                        name: field.name,
                        value: opt.value,
                        checked: (initialData[field.name] !== undefined && initialData[field.name] === opt.value) || (field.value !== undefined && field.value === opt.value) || false,
                    });
                    if (opt.onchange) {
                        radio.onchange = opt.onchange;
                    }
                    inputElement.appendChild(cE('label', {}, [radio, ` ${sH(opt.label)}`]));
                });
                break;
            default:
                console.warn(`Unknown field type: ${field.type}`);
                continue;
        }
        form.appendChild(inputElement);
    });

    return form;
}


// --- Report Detail Interactions ---
async function loadAndDisplayInteractions(reportId, reportPk, container) {
    container.innerHTML = '<h4>Interactions</h4><div class="spinner"></div>';
    appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading for interactions
    try {
        const interactions = await nostrSvc.fetchInteractions(reportId, reportPk);
        let html = '<h4>Interactions</h4>';
        if (interactions.length === 0) {
            html += '<p>No interactions yet.</p>';
        } else {
            interactions.forEach(i => {
                const interactionUser = formatNpubShort(i.pubkey);
                const interactionTime = new Date(i.created_at * 1000).toLocaleString();
                if (i.kind === C.NOSTR_KIND_REACTION) { // Simple reaction
                    html += `<div class="interaction-item"><strong>${sH(interactionUser)}</strong> reacted: ${sH(i.content)} <small>(${interactionTime})</small></div>`;
                } else if (i.kind === C.NOSTR_KIND_NOTE) { // Text note comment
                    html += `<div class="interaction-item"><strong>${sH(interactionUser)}</strong> commented: <div class="markdown-content">${marked.parse(sH(i.content))}</div> <small>(${interactionTime})</small></div>`;
                }
            });
        }
        // Add reaction buttons
        const reactionButtonsDiv = cE('div', { class: 'reaction-buttons', style: 'margin-top:0.5rem;' });
        reactionButtonsDiv.appendChild(cE('button', { 'data-report-id': sH(reportId), 'data-report-pk': sH(reportPk), 'data-reaction': '+', textContent: '👍 Like' }));
        reactionButtonsDiv.appendChild(cE('button', { 'data-report-id': sH(reportId), 'data-report-pk': sH(reportPk), 'data-reaction': '-', textContent: '👎 Dislike' }));

        // Define comment form fields
        const commentFormFields = [
            { type: 'textarea', name: 'comment', placeholder: 'Add a public comment...', rows: 2, required: true },
            { type: 'button', buttonType: 'submit', label: 'Post Comment' }
        ];

        // Render comment form using renderForm
        const commentForm = renderForm(commentFormFields, {}, {
            id: 'comment-form',
            onSubmit: handleCommentSubmit,
            'data-report-id': sH(reportId),
            'data-report-pk': sH(reportPk),
            style: 'margin-top:0.5rem;'
        });

        container.innerHTML = html; // Set the static HTML content first
        container.appendChild(reactionButtonsDiv); // Append reaction buttons
        container.appendChild(commentForm); // Append the dynamically rendered form

        // Add event listeners for new buttons/forms
        $$('.reaction-buttons button', container).forEach(btn => btn.onclick = handleReactionSubmit);
        // The commentForm already has its onSubmit listener attached via renderForm
        // $('#comment-form', container)?.addEventListener('submit', handleCommentSubmit); // This line is no longer needed

        // Update local report with fetched interactions (if needed for caching)
        appStore.set(s => {
            const reportIndex = s.reports.findIndex(rep => rep.id === reportId);
            if (reportIndex > -1) {
                const updatedReports = [...s.reports];
                updatedReports[reportIndex] = { ...updatedReports[reportIndex], interactions: interactions };
                return { reports: updatedReports };
            }
            return {};
        });
    } catch (e) {
        showToast(`Error loading interactions: ${e.message}`, 'error');
        container.innerHTML = `<h4>Interactions</h4><p style="color:red;">Failed to load interactions: ${sH(e.message)}</p>`;
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
}

async function handleReactionSubmit(event) {
    const btn = event.target;
    const reportId = btn.dataset.reportId;
    const reportPk = btn.dataset.reportPk;
    const reactionContent = btn.dataset.reaction;
    if (!appStore.get().user) return showToast("Please connect your Nostr identity to react.", 'warning');
    try {
        btn.disabled = true;
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        await nostrSvc.pubEv({
            kind: C.NOSTR_KIND_REACTION,
            content: reactionContent,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
        showToast("Reaction sent!", 'success');
        // Refresh interactions, or wait for subscription update
        const report = appStore.get().reports.find(r => r.id === reportId);
        if (report) showReportDetails(report); // Re-render detail view which calls loadAndDisplayInteractions
    } catch (e) {
        showToast(`Error sending reaction: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
}

async function handleCommentSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const reportId = form.dataset.reportId;
    const reportPk = form.dataset.reportPk;
    const commentText = form.elements.comment.value.trim();
    if (!commentText) return showToast("Comment cannot be empty.", 'warning');
    if (!appStore.get().user) return showToast("Please connect your Nostr identity to comment.", 'warning');
    try {
        submitBtn.disabled = true;
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        await nostrSvc.pubEv({
            kind: C.NOSTR_KIND_NOTE,
            content: commentText,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
        showToast("Comment sent!", 'success');
        form.reset();
        // Refresh interactions for this report
        const report = appStore.get().reports.find(r => r.id === reportId);
        if (report) showReportDetails(report); // Re-render detail view which calls loadAndDisplayInteractions
    } catch (e) {
        showToast(`Error sending comment: ${e.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
    }
}


// --- MODAL COMPONENTS (Implementations) ---

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

    const imageItemRenderer = (img) => cE('span', { textContent: sH(img.url.substring(img.url.lastIndexOf('/') + 1)) });
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
    gE('#pick-loc-map-btn', formRoot).onclick = () => {
        hideModal('report-form-modal');
        mapSvc.enPickLoc(latlng => {
            formState.pFLoc = latlng;
            renderLocationDisplay();
            showModal('report-form-modal', 'rep-title');
        });
    };

    gE('#use-gps-loc-btn', formRoot).onclick = () => {
        if (!navigator.geolocation) return showToast("GPS not supported by your browser.", 'warning');
        navigator.geolocation.getCurrentPosition(
            position => {
                formState.pFLoc = { lat: position.coords.latitude, lng: position.coords.longitude };
                renderLocationDisplay();
            },
            error => showToast(`GPS Error: ${error.message}`, 'error')
        );
    };

    gE('#geocode-address-btn', formRoot).onclick = async () => {
        const address = gE('#rep-address', formRoot).value.trim();
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
                    if (file.size > C.IMG_SIZE_LIMIT_BYTES) throw new Error(`Max ${C.IMG_SIZE_LIMIT_BYTES / 1024 / 1024}MB`);
                    const buffer = await file.arrayBuffer();
                    const hash = await sha256(buffer);
                    const dimensions = await getImgDims(file);
                    const uploadedUrl = await imgSvc.upload(file);
                    imagesMetadata.push({ url: uploadedUrl, type: file.type, dim: `${dimensions.w}x${dimensions.h}`, hHex: hash });
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
            gE('#pFLoc-coords', formRoot).textContent = 'None';
            gE('#upld-photos-preview', formRoot).innerHTML = '';
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

function RepFormComp(reportToEdit = null) {
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
        const coordsEl = gE('#pFLoc-coords', formRoot);
        if (pFLoc) {
            coordsEl.textContent = `${pFLoc.lat.toFixed(5)},${pFLoc.lng.toFixed(5)}${addressName ? ` (${sH(addressName)})` : ''}`;
        } else {
            coordsEl.textContent = 'None';
        }
    };

    // Helper to re-render image preview
    const renderImagePreview = () => {
        const previewElement = gE('#upld-photos-preview', formRoot);
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
        { label: 'Location:', type: 'custom-html', id: 'map-pick-area', content: ['Selected: ', cE('span', { id: 'pFLoc-coords', textContent: initialFormData.location || 'None' })] },
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

// AuthModal
function AuthModalComp() {
    const authFormFields = [
        { type: 'paragraph', content: [cE('strong', { textContent: 'Recommended: ' }), 'Use NIP-07 (Alby, etc.)'] },
        { type: 'button', id: 'conn-nip07-btn', label: 'Connect NIP-07' },
        { type: 'hr' },
        { type: 'paragraph', content: [cE('h4', { textContent: 'Local Keys (Advanced/Risky)' })] },
        { type: 'custom-html', class: 'critical-warning', innerHTML: '<p><strong>SECURITY WARNING:</strong> Storing keys in browser is risky. Backup private key (nsec)!</p>' },
        { label: 'Passphrase (min 8 chars):', type: 'password', id: 'auth-pass', autocomplete: 'new-password' },
        { type: 'button', id: 'create-prof-btn', label: 'Create New Profile' },
        { type: 'hr' },
        { label: 'Import Private Key (nsec/hex):', type: 'text', id: 'auth-sk' },
        { type: 'button', id: 'import-sk-btn', label: 'Import Key' },
        { type: 'button', class: 'secondary', label: 'Cancel', onclick: () => hideModal('auth-modal'), style: 'margin-top:1rem' }
    ];

    const modalContent = createModalWrapper('auth-modal', 'Nostr Identity', (root) => {
        const form = renderForm(authFormFields, {}, { id: 'auth-form' });
        root.appendChild(form); // Append the form to the modal content root

        // Attach event listeners to the elements *after* they are rendered by renderForm
        gE('#conn-nip07-btn', form).onclick = async () => { // Scope to form
            appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
            try {
                await idSvc.nip07();
                if (appStore.get().user) hideModal('auth-modal');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
            }
        };

        gE('#create-prof-btn', form).onclick = async () => { // Scope to form
            const passphrase = gE('#auth-pass', form).value;
            if (!passphrase || passphrase.length < 8) {
                showToast("Passphrase too short (min 8 chars).", 'warning');
                return;
            }
            showConfirmModal(
                "Backup Private Key?",
                "<strong>CRITICAL:</strong> You are about to create a new Nostr identity. Your private key (nsec) will be generated and displayed. You MUST copy and securely back it up. If you lose it, your identity and associated data will be unrecoverable. Do you understand and wish to proceed?",
                async () => {
                    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                    try {
                        const result = await idSvc.newProf(passphrase);
                        if (result) hideModal('auth-modal');
                    } finally {
                        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    }
                },
                () => showToast("New profile creation cancelled.", 'info')
            );
        };

        gE('#import-sk-btn', form).onclick = async () => { // Scope to form
            const privateKey = gE('#auth-sk', form).value;
            const passphrase = gE('#auth-pass', form).value;
            if (!privateKey || !passphrase || passphrase.length < 8) {
                showToast("Private key and passphrase (min 8 chars) are required.", 'warning');
                return;
            }
            showConfirmModal(
                "Import Private Key?",
                "<strong>HIGH RISK:</strong> Importing a private key directly into the browser is generally discouraged due to security risks. Ensure you understand the implications. It is highly recommended to use a NIP-07 browser extension instead. Do you wish to proceed?",
                async () => {
                    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                    try {
                        const result = await idSvc.impSk(privateKey, passphrase);
                        if (result) hideModal('auth-modal');
                    } finally {
                        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    }
                },
                () => showToast("Private key import cancelled.", 'info')
            );
        };
        return form; // Return the form element
    });
    return modalContent;
}

// SettingsPanel
function SettPanComp() {
    const appState = appStore.get();

    // Render functions for specific lists
    const renderRelays = () => {
        const removeRelayAction = r => {
            const updatedRelays = appStore.get().relays.filter(rl => rl.url !== r.url);
            confSvc.setRlys(updatedRelays);
            nostrSvc.discAllRlys(); // Disconnect all and reconnect with new list
            nostrSvc.connRlys();
        };
        const relayItemRenderer = r => cE('span', { textContent: `${sH(r.url)} (${r.read ? 'R' : ''}${r.write ? 'W' : ''}) - ${sH(r.status)}` });
        const relayActionsConfig = [{
            label: 'Remove',
            className: 'remove-relay-btn',
            onClick: removeRelayAction,
            confirm: { title: 'Remove Relay', message: 'Are you sure you want to remove this relay?' }
        }];
        renderList('#rly-list', appStore.get().relays, relayItemRenderer, relayActionsConfig, 'relay-entry', modalContent);
    };

    const renderCategories = () => {
        const removeCategoryAction = c => {
            const updatedCats = appStore.get().settings.cats.filter(cat => cat !== c);
            confSvc.setCats(updatedCats);
        };
        const categoryItemRenderer = c => cE('span', { textContent: sH(c) });
        const categoryActionsConfig = [{
            label: 'Remove',
            className: 'remove-category-btn',
            onClick: removeCategoryAction,
            confirm: { title: 'Remove Category', message: 'Are you sure you want to remove this category?' }
        }];
        renderList('#cat-list', appStore.get().settings.cats, categoryItemRenderer, categoryActionsConfig, 'category-entry', modalContent);
    };

    const renderFocusTags = () => {
        const removeFocusTagAction = t => {
            const updatedTags = appStore.get().focusTags.filter(ft => ft.tag !== t.tag);
            confSvc.setFocusTags(updatedTags);
            if (t.active && updatedTags.length > 0) {
                // If active tag was removed, set first available as active
                confSvc.setCurrentFocusTag(updatedTags[0].tag);
                updatedTags[0].active = true;
            } else if (updatedTags.length === 0) {
                // If all tags removed, reset to default
                confSvc.setCurrentFocusTag(C.FOCUS_TAG_DEFAULT);
                confSvc.setFocusTags([{ tag: C.FOCUS_TAG_DEFAULT, active: true }]);
            }
        };
        const focusTagItemRenderer = ft => {
            const span = cE('span', { textContent: `${sH(ft.tag)}${ft.active ? ' (Active)' : ''}` });
            const radio = cE('input', {
                type: 'radio',
                name: 'activeFocusTag',
                value: ft.tag,
                checked: ft.active,
                onchange: () => {
                    const updatedTags = appStore.get().focusTags.map(t => ({ ...t, active: t.tag === ft.tag }));
                    confSvc.setFocusTags(updatedTags);
                    confSvc.setCurrentFocusTag(ft.tag);
                    nostrSvc.refreshSubs(); // Refresh subscriptions with new focus tag
                }
            });
            const label = cE('label', {}, [radio, ` Set Active`]);
            return cE('div', {}, [span, label]);
        };
        const focusTagActionsConfig = [{
            label: 'Remove',
            className: 'remove-focus-tag-btn',
            onClick: removeFocusTagAction,
            confirm: { title: 'Remove Focus Tag', message: 'Are you sure you want to remove this focus tag?' }
        }];
        renderList('#focus-tag-list', appStore.get().focusTags, focusTagItemRenderer, focusTagActionsConfig, 'focus-tag-entry', modalContent);
    };

    const renderMuteList = () => {
        const removeMuteAction = pk => confSvc.rmMute(pk);
        const muteItemRenderer = pk => cE('span', { textContent: formatNpubShort(pk) });
        const muteActionsConfig = [{
            label: 'Remove',
            className: 'remove-mute-btn',
            onClick: removeMuteAction,
            confirm: { title: 'Remove Muted Pubkey', message: 'Are you sure you want to unmute this pubkey?' }
        }];
        renderList('#mute-list', appStore.get().settings.mute, muteItemRenderer, muteActionsConfig, 'mute-entry', modalContent);
    };

    const renderFollowedList = () => {
        const removeFollowedAction = f => confSvc.rmFollowed(f.pk);
        const followedItemRenderer = f => cE('span', { textContent: formatNpubShort(f.pk) });
        const followedActionsConfig = [{
            label: 'Unfollow',
            className: 'remove-followed-btn',
            onClick: removeFollowedAction,
            confirm: { title: 'Unfollow User', message: 'Are you sure you want to unfollow this user?' }
        }];
        renderList('#followed-list', appStore.get().followedPubkeys, followedItemRenderer, followedActionsConfig, 'followed-entry', modalContent);
    };

    const settingsContentRenderer = (modalRoot) => {
        const settingsSectionsWrapper = cE('div', { id: 'settings-sections' });

        // Section: Relays
        settingsSectionsWrapper.appendChild(cE('section', {}, [
            cE('h3', { textContent: 'Relays' }),
            cE('div', { id: 'rly-list' }),
            renderForm([
                { label: 'New Relay URL:', type: 'url', id: 'new-rly-url', name: 'newRelayUrl', placeholder: 'wss://new.relay.com' },
                { label: 'Add Relay', type: 'button', id: 'add-rly-btn', buttonType: 'button' },
                { label: 'Save & Reconnect Relays', type: 'button', id: 'save-rlys-btn', buttonType: 'button' }
            ], {}, { id: 'relay-form' }) // Give form an ID if needed for specific handlers
        ]));
        settingsSectionsWrapper.appendChild(cE('hr'));

        if (appState.user && (appState.user.authM === 'local' || appState.user.authM === 'import')) {
            settingsSectionsWrapper.appendChild(cE('section', {}, [
                cE('h3', { textContent: 'Local Key Management' }),
                renderForm([
                    { type: 'button', id: 'exp-sk-btn', label: 'Export Private Key' },
                    { label: 'Old Passphrase:', type: 'password', id: 'chg-pass-old', name: 'oldPassphrase' },
                    { label: 'New Passphrase:', type: 'password', id: 'chg-pass-new', name: 'newPassphrase' },
                    { type: 'button', id: 'chg-pass-btn', label: 'Change Passphrase' }
                ], {}, { id: 'key-management-form' })
            ]));
            settingsSectionsWrapper.appendChild(cE('hr'));
        }

        settingsSectionsWrapper.appendChild(cE('section', {}, [ // Focus Tags Section
            cE('h3', { textContent: 'Focus Tags' }),
            cE('div', { id: 'focus-tag-list' }),
            renderForm([
                { label: 'New Focus Tag:', type: 'text', id: 'new-focus-tag-input', name: 'newFocusTag', placeholder: '#NewFocusTag' },
                { label: 'Add Focus Tag', type: 'button', id: 'add-focus-tag-btn', buttonType: 'button' },
                { label: 'Save Focus Tags', type: 'button', id: 'save-focus-tags-btn', buttonType: 'button' }
            ], {}, { id: 'focus-tag-form' })
        ]));
        settingsSectionsWrapper.appendChild(cE('hr'));

        settingsSectionsWrapper.appendChild(cE('section', {}, [
            cE('h3', { textContent: 'Categories' }),
            cE('div', { id: 'cat-list' }),
            renderForm([
                { label: 'New Category Name:', type: 'text', id: 'new-cat-name', name: 'newCategory', placeholder: 'New Category' },
                { label: 'Add Category', type: 'button', id: 'add-cat-btn', buttonType: 'button' },
                { label: 'Save Categories', type: 'button', id: 'save-cats-btn', buttonType: 'button' }
            ], {}, { id: 'category-form' })
        ]));
        settingsSectionsWrapper.appendChild(cE('hr'));

        settingsSectionsWrapper.appendChild(cE('section', {}, [ // Map Tiles Section
            cE('h3', { textContent: 'Map Tiles' }),
            renderForm([
                {
                    label: 'Tile Server Preset:',
                    type: 'select',
                    id: 'tile-preset-sel',
                    name: 'tilePreset',
                    value: appState.settings.tilePreset,
                    options: C.TILE_SERVERS_PREDEFINED.map(p => ({ value: p.name, label: p.name }))
                },
                { label: 'Custom Tile URL Template:', type: 'url', id: 'tile-url-in', name: 'tileUrl', value: appState.settings.tileUrl },
                { label: 'Save Tiles', type: 'button', id: 'save-tile-btn', buttonType: 'button' }
            ], {}, { id: 'map-tiles-form' })
        ]));
        settingsSectionsWrapper.appendChild(cE('hr'));

        settingsSectionsWrapper.appendChild(cE('section', {}, [
            cE('h3', { textContent: 'Image Host' }),
            renderForm([
                {
                    label: 'Provider:',
                    type: 'select',
                    id: 'img-host-sel',
                    name: 'imgHostProvider',
                    value: appState.settings.nip96Host ? 'nip96' : (appState.settings.imgHost || C.IMG_UPLOAD_NOSTR_BUILD),
                    options: [
                        { value: C.IMG_UPLOAD_NOSTR_BUILD, label: 'nostr.build (Default)' },
                        { value: 'nip96', label: 'NIP-96 Server' }
                    ]
                },
                {
                    type: 'custom-html',
                    id: 'nip96-fields',
                    class: 'nip96-fields',
                    content: [
                        cE('label', { for: 'nip96-url-in', textContent: 'NIP-96 Server URL:' }),
                        cE('input', { type: 'url', id: 'nip96-url-in', name: 'nip96Url', value: appState.settings.nip96Host, placeholder: 'https://your.nip96.server' }),
                        cE('label', { for: 'nip96-token-in', textContent: 'NIP-96 Auth Token (Optional):' }),
                        cE('input', { type: 'text', id: 'nip96-token-in', name: 'nip96Token', value: appState.settings.nip96Token })
                    ]
                }
            ], {}, { id: 'image-host-form' }),
            cE('button', { type: 'button', id: 'save-img-host-btn', textContent: 'Save Image Host' }) // Moved outside renderForm to avoid nested form tag
        ]));
        settingsSectionsWrapper.appendChild(cE('hr'));

        settingsSectionsWrapper.appendChild(cE('section', {}, [ // Mute List Section
            cE('h3', { textContent: 'Mute List' }),
            cE('div', { id: 'mute-list' }),
            renderForm([
                { label: 'New Muted Pubkey:', type: 'text', id: 'new-mute-pk-input', name: 'newMutePk', placeholder: 'npub... or hex pubkey' },
                { label: 'Add to Mute List', type: 'button', id: 'add-mute-btn', buttonType: 'button' },
                { label: 'Save Mute List', type: 'button', id: 'save-mute-list-btn', buttonType: 'button' }
            ], {}, { id: 'mute-list-form' })
        ]));
        settingsSectionsWrapper.appendChild(cE('hr'));

        settingsSectionsWrapper.appendChild(cE('section', {}, [ // New: Followed Users Section
            cE('h3', { textContent: 'Followed Users (NIP-02)' }),
            cE('div', { id: 'followed-list' }),
            renderForm([
                { label: 'New Followed Pubkey:', type: 'text', id: 'new-followed-pk-input', name: 'newFollowedPk', placeholder: 'npub... or hex pubkey' },
                { label: 'Add to Followed', type: 'button', id: 'add-followed-btn', buttonType: 'button' },
                { label: 'Save Followed List', type: 'button', id: 'save-followed-btn', buttonType: 'button' },
                { type: 'hr' },
                { label: 'Import NIP-02 Contacts', type: 'button', id: 'import-contacts-btn', buttonType: 'button' },
                { label: 'Publish NIP-02 Contacts', type: 'button', id: 'publish-contacts-btn', buttonType: 'button' }
            ], {}, { id: 'followed-list-form' })
        ]));
        settingsSectionsWrapper.appendChild(cE('hr'));

        settingsSectionsWrapper.appendChild(cE('section', {}, [
            cE('h3', { textContent: 'Data Management' }),
            renderForm([
                { type: 'button', id: 'clr-reps-btn', label: 'Clear Cached Reports' },
                { type: 'button', id: 'exp-setts-btn', label: 'Export Settings' },
                { label: 'Import Settings:', type: 'file', id: 'imp-setts-file', name: 'importSettingsFile', accept: '.json' }
            ], {}, { id: 'data-management-form' })
        ]));

        return settingsSectionsWrapper;
    };

    const modalContent = createModalWrapper('settings-modal', 'Settings', settingsContentRenderer);

    // Append the final close button
    modalContent.appendChild(cE('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));

    // Render lists (must be called after modalContent is in DOM)
    renderRelays();
    renderCategories();
    renderFocusTags();
    renderMuteList();
    renderFollowedList();

    // Setup Event Listeners for Settings Panel (must be called after modalContent is in DOM)
    const setupRelayListeners = () => {
        gE('#add-rly-btn', modalContent).onclick = () => {
            const input = gE('#new-rly-url', modalContent);
            const url = input.value.trim();
            if (!isValidUrl(url)) return showToast("Invalid URL.", 'warning');
            const currentRelays = appStore.get().relays;
            if (currentRelays.some(r => r.url === url)) return showToast("Relay already exists.", 'info');
            confSvc.setRlys([...currentRelays, { url, read: true, write: true, status: '?' }]);
            input.value = '';
            renderRelays();
        };
        gE('#save-rlys-btn', modalContent).onclick = () => {
            nostrSvc.discAllRlys();
            nostrSvc.connRlys();
            showToast("Relays saved and reconnected.", 'success');
        };
    };

    const setupKeyManagementListeners = () => {
        const expSkBtn = gE('#exp-sk-btn', modalContent);
        if (expSkBtn) {
            expSkBtn.onclick = async () => {
                if (!appStore.get().user) return showToast("No Nostr identity connected.", 'warning');
                if (appStore.get().user.authM === 'nip07') return showToast("NIP-07 keys cannot be exported.", 'info');

                appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                try {
                    const sk = await idSvc.getSk(true); // Prompt for passphrase
                    if (sk) {
                        showToast(
                            "Your private key (nsec) is displayed below. Copy it NOW and store it securely. DO NOT share it.",
                            'critical-warning',
                            0, // Persistent
                            nip19.nsecEncode(sk)
                        );
                    }
                } catch (e) {
                    showToast(`Export failed: ${e.message}`, 'error');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                }
            };
        }

        const chgPassBtn = gE('#chg-pass-btn', modalContent);
        if (chgPassBtn) {
            chgPassBtn.onclick = async () => {
                const oldPass = gE('#chg-pass-old', modalContent).value;
                const newPass = gE('#chg-pass-new', modalContent).value;
                if (!oldPass || !newPass || newPass.length < 8) {
                    return showToast("Both passphrases are required, new must be min 8 chars.", 'warning');
                }
                appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                try {
                    await idSvc.chgPass(oldPass, newPass);
                    gE('#chg-pass-old', modalContent).value = '';
                    gE('#chg-pass-new', modalContent).value = '';
                } catch (e) {
                    showToast(`Passphrase change failed: ${e.message}`, 'error');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                }
            };
        }
    };

    const setupFocusTagListeners = () => {
        gE('#add-focus-tag-btn', modalContent).onclick = () => {
            const input = gE('#new-focus-tag-input', modalContent);
            let tag = input.value.trim();
            if (!tag) return showToast("Please enter a focus tag.", 'warning');
            if (!tag.startsWith('#')) tag = '#' + tag;
            const currentTags = appStore.get().focusTags;
            if (currentTags.some(t => t.tag === tag)) return showToast("Focus tag already exists.", 'info');
            confSvc.setFocusTags([...currentTags, { tag, active: false }]);
            input.value = '';
            renderFocusTags();
        };
        gE('#save-focus-tags-btn', modalContent).onclick = () => {
            showToast("Focus tags saved.", 'info');
            nostrSvc.refreshSubs(); // Refresh subscriptions to apply new focus tag if active
        };
    };

    const setupCategoryListeners = () => {
        gE('#add-cat-btn', modalContent).onclick = () => {
            const input = gE('#new-cat-name', modalContent);
            const cat = input.value.trim();
            if (!cat) return showToast("Please enter a category name.", 'warning');
            const currentCats = appStore.get().settings.cats;
            if (currentCats.includes(cat)) return showToast("Category already exists.", 'info');
            confSvc.setCats([...currentCats, cat]);
            input.value = '';
            renderCategories();
        };
        gE('#save-cats-btn', modalContent).onclick = () => {
            showToast("Categories saved.", 'info');
        };
    };

    const setupMapTilesListeners = () => {
        const tilePresetSel = gE('#tile-preset-sel', modalContent);
        const tileUrlIn = gE('#tile-url-in', modalContent);

        // Set initial selected preset
        tilePresetSel.value = appState.settings.tilePreset;

        tilePresetSel.onchange = () => {
            const selectedPreset = C.TILE_SERVERS_PREDEFINED.find(p => p.name === tilePresetSel.value);
            if (selectedPreset) {
                tileUrlIn.value = selectedPreset.url;
            } else {
                tileUrlIn.value = ''; // Clear if 'Custom' or not found
            }
        };

        gE('#save-tile-btn', modalContent).onclick = () => {
            const selectedPresetName = tilePresetSel.value;
            const customUrl = tileUrlIn.value.trim();

            if (!isValidUrl(customUrl)) {
                return showToast("Invalid tile URL.", 'warning');
            }

            confSvc.setTilePreset(selectedPresetName, customUrl);
            mapSvc.updTile(customUrl);
            showToast("Map tile settings saved.", 'success');
        };
    };

    const setupImageHostListeners = () => {
        const imgHostSel = gE('#img-host-sel', modalContent);
        const nip96Fields = gE('#nip96-fields', modalContent);
        const nip96UrlIn = gE('#nip96-url-in', modalContent);
        const nip96TokenIn = gE('#nip96-token-in', modalContent);

        // Set initial selection
        if (appState.settings.nip96Host) {
            imgHostSel.value = 'nip96';
            nip96Fields.style.display = '';
        } else {
            imgHostSel.value = appState.settings.imgHost || C.IMG_UPLOAD_NOSTR_BUILD;
            nip96Fields.style.display = 'none';
        }

        imgHostSel.onchange = () => {
            if (imgHostSel.value === 'nip96') {
                nip96Fields.style.display = '';
            } else {
                nip96Fields.style.display = 'none';
            }
        };

        gE('#save-img-host-btn', modalContent).onclick = () => {
            const selectedHost = imgHostSel.value;
            if (selectedHost === 'nip96') {
                const nip96Url = nip96UrlIn.value.trim();
                const nip96Token = nip96TokenIn.value.trim();
                if (!isValidUrl(nip96Url)) {
                    return showToast("Invalid NIP-96 server URL.", 'warning');
                }
                confSvc.setImgHost(nip96Url, true, nip96Token);
            } else {
                confSvc.setImgHost(selectedHost, false);
            }
            showToast("Image host settings saved.", 'success');
        };
    };

    const setupMuteListListeners = () => {
        gE('#add-mute-btn', modalContent).onclick = () => {
            const input = gE('#new-mute-pk-input', modalContent);
            let pk = input.value.trim();
            if (!pk) return showToast("Please enter a pubkey or npub.", 'warning');
            try {
                pk = npubToHex(pk);
                if (!isNostrId(pk)) throw new Error("Invalid Nostr pubkey format.");
                confSvc.addMute(pk);
                input.value = '';
                showToast("Pubkey added to mute list.", 'success');
            } catch (e) {
                showToast(`Error adding pubkey: ${e.message}`, 'error');
            }
        };
        gE('#save-mute-list-btn', modalContent).onclick = () => {
            showToast("Mute list saved.", 'info');
        };
    };

    const setupFollowedListListeners = () => {
        gE('#add-followed-btn', modalContent).onclick = () => {
            const input = gE('#new-followed-pk-input', modalContent);
            let pk = input.value.trim();
            if (!pk) return showToast("Please enter a pubkey or npub.", 'warning');
            try {
                pk = npubToHex(pk);
                if (!isNostrId(pk)) throw new Error("Invalid Nostr pubkey format.");
                confSvc.addFollowed(pk);
                input.value = '';
                showToast("User added to followed list.", 'success');
            } catch (e) {
                showToast(`Error adding user: ${e.message}`, 'error');
            }
        };

        gE('#save-followed-btn', modalContent).onclick = () => {
            // The add/remove functions already update the appStore and trigger save via confSvc.save
            // This button is mostly for user clarity or if manual edits were allowed in the UI
            showToast("Followed list saved.", 'info');
        };

        gE('#import-contacts-btn', modalContent).onclick = async () => {
            if (!appStore.get().user) {
                showToast("Please connect your Nostr identity to import contacts.", 'warning');
                return;
            }
            appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
            try {
                const contacts = await nostrSvc.fetchContacts();
                if (contacts.length > 0) {
                    const currentFollowed = appStore.get().followedPubkeys.map(f => f.pk);
                    const newFollowed = contacts.filter(c => !currentFollowed.includes(c.pubkey)).map(c => ({ pk: c.pubkey, followedAt: Date.now() }));
                    if (newFollowed.length > 0) {
                        confSvc.setFollowedPubkeys([...appStore.get().followedPubkeys, ...newFollowed]);
                        showToast(`Imported ${newFollowed.length} contacts from Nostr.`, 'success');
                    } else {
                        showToast("No new contacts found to import.", 'info');
                    }
                } else {
                    showToast("No NIP-02 contact list found on relays for your account.", 'info');
                }
            } catch (e) {
                showToast(`Error importing contacts: ${e.message}`, 'error');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
            }
        };

        gE('#publish-contacts-btn', modalContent).onclick = async () => {
            if (!appStore.get().user) {
                showToast("Please connect your Nostr identity to publish contacts.", 'warning');
                return;
            }
            showConfirmModal(
                "Publish Contacts",
                "This will publish your current followed list as a NIP-02 contact list (Kind 3 event) to your connected relays. This will overwrite any existing Kind 3 event for your pubkey. Continue?",
                async () => {
                    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                    try {
                        const contactsToPublish = appStore.get().followedPubkeys.map(f => ({ pubkey: f.pk, relay: '', petname: '' })); // NIP-02 only requires pubkey
                        await nostrSvc.pubContacts(contactsToPublish);
                        showToast("NIP-02 contact list published!", 'success');
                    } catch (e) {
                        showToast(`Error publishing contacts: ${e.message}`, 'error');
                    } finally {
                        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    }
                },
                () => showToast("Publish contacts cancelled.", 'info')
            );
        };
    };

    const setupDataManagementListeners = () => {
        gE('#clr-reps-btn', modalContent).onclick = () => {
            showConfirmModal(
                "Clear Cached Reports",
                "Are you sure you want to clear all cached reports from your local database? This will not delete them from relays.",
                async () => {
                    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                    try {
                        await dbSvc.clearReps();
                        appStore.set({ reports: [] });
                        showToast("Cached reports cleared.", 'info');
                    } catch (e) {
                        showToast(`Error clearing reports: ${e.message}`, 'error');
                    } finally {
                        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    }
                },
                () => showToast("Clearing reports cancelled.", 'info')
            );
        };

        gE('#exp-setts-btn', modalContent).onclick = async () => {
            appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
            try {
                const settings = await dbSvc.loadSetts();
                const followedPubkeys = await dbSvc.getFollowedPubkeys();
                const exportData = { settings, followedPubkeys };
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", "nostrmapper_settings.json");
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
                showToast("Settings exported.", 'success');
            } catch (e) {
                showToast(`Error exporting settings: ${e.message}`, 'error');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
            }
        };

        gE('#imp-setts-file', modalContent).onchange = async e => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const importedData = JSON.parse(event.target.result);
                    if (!importedData.settings || !importedData.followedPubkeys) {
                        throw new Error("Invalid settings file format.");
                    }

                    showConfirmModal(
                        "Import Settings",
                        "Are you sure you want to import settings? This will overwrite your current settings and followed users.",
                        async () => {
                            appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                            try {
                                await dbSvc.saveSetts(importedData.settings);
                                // Clear existing followed pubkeys and add new ones
                                await dbSvc.clearFollowedPubkeys();
                                for (const fp of importedData.followedPubkeys) {
                                    await dbSvc.addFollowedPubkey(fp.pk);
                                }
                                await confSvc.load(); // Reload all settings into appStore
                                showToast("Settings imported successfully! Please refresh the page.", 'success', 5000);
                                // Optionally, prompt for page reload
                                setTimeout(() => {
                                    if (confirm("Settings imported. Reload page now?")) {
                                        window.location.reload();
                                    }
                                }, 2000);
                            } catch (err) {
                                showToast(`Error importing settings: ${err.message}`, 'error');
                            } finally {
                                appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                            }
                        },
                        () => showToast("Import cancelled.", 'info')
                    );
                } catch (err) {
                    showToast(`Failed to parse settings file: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
    };

    // Initialize all listeners
    setupRelayListeners();
    setupKeyManagementListeners();
    setupFocusTagListeners();
    setupCategoryListeners();
    setupMapTilesListeners();
    setupImageHostListeners();
    setupMuteListListeners();
    setupFollowedListListeners();
    setupDataManagementListeners();

    return modalContent;
}

// --- Report List & Detail ---
const rendRepCard = report => {
    const summary = report.sum || (report.ct ? report.ct.substring(0, 100) + '...' : 'N/A');
    return `<div class="report-card" data-rep-id="${sH(report.id)}" role="button" tabindex="0" aria-labelledby="card-title-${report.id}">
        <h3 id="card-title-${report.id}">${sH(report.title || 'Report')}</h3><p>${sH(summary)}</p>
        <small>By: ${formatNpubShort(report.pk)} | ${new Date(report.at * 1000).toLocaleDateString()}</small>
        <small>Cats: ${report.cat.map(sH).join(', ') || 'N/A'}</small></div>`;
};

const showReportDetails = async report => {
    const detailContainer = gE('#report-detail-container');
    const listContainer = gE('#report-list-container');
    if (!detailContainer || !listContainer) return;

    listContainer.style.display = 'none';

    const imagesHtml = (report.imgs || []).map(img =>
        `<img src="${sH(img.url)}" alt="report image" style="max-width:100%;margin:.3rem 0;border-radius:4px;">`
    ).join('');
    const descriptionHtml = marked.parse(sH(report.ct || ''));

    // Fetch profile for NIP-05 display and other details
    const profile = await nostrSvc.fetchProf(report.pk);
    const authorDisplay = profile?.name || (profile?.nip05 ? sH(profile.nip05) : formatNpubShort(report.pk));
    const authorPicture = profile?.picture ? `<img src="${sH(profile.picture)}" alt="Profile Picture" class="profile-picture">` : '';
    const authorAbout = profile?.about ? `<p class="profile-about">${sH(profile.about)}</p>` : '';
    const authorNip05 = profile?.nip05 ? `<span class="nip05-verified">${sH(profile.nip05)} ✅</span>` : '';

    const currentUserPk = appStore.get().user?.pk;
    const isAuthor = currentUserPk && currentUserPk === report.pk;
    const isFollowed = appStore.get().followedPubkeys.some(f => f.pk === report.pk);
    const canFollow = currentUserPk && currentUserPk !== report.pk; // Can follow if logged in and not self

    detailContainer.innerHTML = `
        <button id="back-to-list-btn" class="small-button">&lt; List</button>
        ${isAuthor ? `<button id="edit-report-btn" class="small-button edit-button" data-report-id="${sH(report.id)}" style="float:right;">Edit Report</button>` : ''}
        ${isAuthor ? `<button id="delete-report-btn" class="small-button delete-button" data-report-id="${sH(report.id)}" style="float:right; margin-right: 0.5rem;">Delete Report</button>` : ''}
        <h2 id="detail-title">${sH(report.title || 'Report')}</h2>
        <div class="report-author-info">
            ${authorPicture}
            <p><strong>By:</strong> <a href="https://njump.me/${nip19.npubEncode(report.pk)}" target="_blank" rel="noopener noreferrer">${authorDisplay}</a> ${authorNip05}</p>
            ${authorAbout}
            ${canFollow ? `<button id="follow-toggle-btn" class="small-button ${isFollowed ? 'unfollow-button' : 'follow-button'}" data-pubkey="${sH(report.pk)}">${isFollowed ? 'Unfollow' : 'Follow'}</button>` : ''}
        </div>
        <p><strong>Date:</strong> ${new Date(report.at * 1000).toLocaleString()}</p>
        <p><strong>Summary:</strong> ${sH(report.sum || 'N/A')}</p>
        <p><strong>Description:</strong></p><div class="markdown-content" tabindex="0">${descriptionHtml}</div>
        ${imagesHtml ? `<h3>Images:</h3>${imagesHtml}` : ''}
        <p><strong>Location:</strong> ${report.lat?.toFixed(5)}, ${report.lon?.toFixed(5)} (Geohash: ${sH(report.gh || 'N/A')})</p>
        <div id="mini-map-det" style="height:150px;margin-top:.7rem;border:1px solid #ccc"></div>
        <div class="interactions" id="interactions-for-${report.id}">Loading interactions...</div>
    `;

    detailContainer.style.display = 'block';
    detailContainer.focus();
    gE('#back-to-list-btn', detailContainer).onclick = () => { detailContainer.style.display = 'none'; listContainer.style.display = 'block' };

    if (isAuthor) {
        gE('#edit-report-btn', detailContainer).onclick = () => {
            gE('#report-form-modal').innerHTML = '';
            gE('#report-form-modal').appendChild(RepFormComp(report)); // Pass the report for editing
            showModal('report-form-modal', 'rep-title');
        };
        gE('#delete-report-btn', detailContainer).onclick = () => {
            showConfirmModal(
                "Delete Report",
                `Are you sure you want to delete the report "${sH(report.title || report.id.substring(0, 8) + '...')}"? This action publishes a deletion event to relays.`,
                async () => {
                    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                    try {
                        await nostrSvc.deleteEv(report.id); // Call the new deleteEv method
                        // The deleteEv method already updates appStore and DB, and shows toast
                        hideModal('report-detail-container'); // Hide detail view after deletion
                        listContainer.style.display = 'block'; // Show list view
                    } catch (e) {
                        showToast(`Failed to delete report: ${e.message}`, 'error');
                    } finally {
                        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    }
                },
                () => showToast("Report deletion cancelled.", 'info')
            );
        };
    }

    if (canFollow) {
        gE('#follow-toggle-btn', detailContainer).onclick = handleFollowToggle;
    }

    if (report.lat && report.lon && typeof L !== 'undefined') {
        const miniMap = L.map('mini-map-det').setView([report.lat, report.lon], 13);
        L.tileLayer(confSvc.getTileServer(), { attribution: '&copy; OSM' }).addTo(miniMap);
        // Invalidate size to ensure map renders correctly in a hidden div
        setTimeout(() => { miniMap.invalidateSize(); }, 0);
    }
    loadAndDisplayInteractions(report.id, report.pk, gE(`#interactions-for-${report.id}`, detailContainer));
};

async function handleFollowToggle(event) {
    const btn = event.target;
    const pubkeyToToggle = btn.dataset.pubkey;
    const isCurrentlyFollowed = appStore.get().followedPubkeys.some(f => f.pk === pubkeyToToggle);

    if (!appStore.get().user) {
        showToast("Please connect your Nostr identity to follow users.", 'warning');
        return;
    }

    try {
        btn.disabled = true;
        appStore.set(s => ({ ui: { ...s.ui, loading: true } }));

        if (isCurrentlyFollowed) {
            confSvc.rmFollowed(pubkeyToToggle);
            showToast(`Unfollowed ${formatNpubShort(pubkeyToToggle)}.`, 'info');
        } else {
            confSvc.addFollowed(pubkeyToToggle);
            showToast(`Followed ${formatNpubShort(pubkeyToToggle)}!`, 'success');
        }
        // Re-render the report details to update the button state
        const report = appStore.get().reports.find(r => r.pk === pubkeyToToggle); // Find any report by this author
        if (report) showReportDetails(report); // Re-render to update button
    } catch (e) {
        showToast(`Error toggling follow status: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
    }
}

const rendRepList = reports => {
    const listElement = gE('#report-list');
    const listContainer = gE('#report-list-container');
    if (!listElement || !listContainer) return;

    listElement.innerHTML = '';
    if (reports.length > 0) {
        reports.forEach(report => {
            const cardWrapper = cE('div');
            cardWrapper.innerHTML = rendRepCard(report);
            const cardElement = cardWrapper.firstElementChild;
            cardElement.onclick = () => showReportDetails(report);
            cardElement.onkeydown = e => (e.key === 'Enter' || e.key === ' ') ? showReportDetails(report) : null;
            listElement.appendChild(cardElement);
        });
        listContainer.style.display = 'block';
    } else {
        listElement.innerHTML = '<p>No reports match filters.</p>';
        listContainer.style.display = 'block';
    }
};

// --- Filtering ---
let _cFilt = { q: '', fT: '', cat: '', auth: '', tStart: null, tEnd: null, followedOnly: false }; /* cFilt: currentFilters */

const applyAllFilters = () => {
    const allReports = appStore.get().reports;
    const mutedPubkeys = appStore.get().settings.mute;
    const drawnShapes = appStore.get().drawnShapes;
    const spatialFilterEnabled = appStore.get().ui.spatialFilterEnabled;
    const followedPubkeys = appStore.get().followedPubkeys.map(f => f.pk);

    const filteredReports = allReports.filter(report => {
        // 1. Mute filter
        if (mutedPubkeys.includes(report.pk)) return false;

        // 2. Focus Tag filter
        const focusTagMatch = _cFilt.fT?.startsWith('#') ? _cFilt.fT.substring(1) : _cFilt.fT;
        if (focusTagMatch && focusTagMatch !== 'NostrMapper_Global' && !report.fTags.includes(focusTagMatch)) {
            return false;
        }

        // 3. Search Query filter (title, summary, content)
        if (_cFilt.q) {
            const query = _cFilt.q.toLowerCase();
            if (!(report.title?.toLowerCase().includes(query) ||
                    report.sum?.toLowerCase().includes(query) ||
                    report.ct?.toLowerCase().includes(query))) {
                return false;
            }
        }

        // 4. Category filter
        if (_cFilt.cat && !report.cat.includes(_cFilt.cat)) return false;

        // 5. Author filter
        if (_cFilt.auth) {
            const authorHex = npubToHex(_cFilt.auth);
            if (report.pk !== authorHex) return false;
        }

        // 6. Time filters (start and end date)
        if (_cFilt.tStart && report.at < _cFilt.tStart) return false;
        if (_cFilt.tEnd && report.at > _cFilt.tEnd) return false;

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
        if (_cFilt.followedOnly && !followedPubkeys.includes(report.pk)) {
            return false;
        }

        return true;
    }).sort((a, b) => b.at - a.at); // Sort by created_at descending

    rendRepList(filteredReports);
    mapSvc.updReps(filteredReports);
};
const debAppAllFilt = debounce(applyAllFilters, 350);

// --- Init UI ---
export function initUI() {
    // Setup global button listeners
    const initGlobalButtons = () => {
        gE('#create-report-btn').onclick = () => {
            gE('#report-form-modal').innerHTML = '';
            gE('#report-form-modal').appendChild(RepFormComp()); // No report passed for new creation
            showModal('report-form-modal', 'rep-title');
        };

        gE('#auth-button').onclick = () => {
            if (appStore.get().user) {
                showConfirmModal(
                    "Logout Confirmation",
                    "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.",
                    () => idSvc.logout(),
                    () => showToast("Logout cancelled.", 'info')
                );
            } else {
                gE('#auth-modal').innerHTML = '';
                gE('#auth-modal').appendChild(AuthModalComp());
                showModal('auth-modal', 'conn-nip07-btn');
            }
        };

        gE('#settings-btn').onclick = () => {
            gE('#settings-modal').innerHTML = '';
            gE('#settings-modal').appendChild(SettPanComp());
            showModal('settings-modal');
        };
    };

    // Setup filter controls
    const initFilterControls = () => {
        const filterControlsContainer = gE('#filter-controls');
        const appState = appStore.get();

        // Initial filter state for rendering
        _cFilt.fT = appState.currentFocusTag;
        _cFilt.followedOnly = appState.ui.followedOnlyFilter;

        const filterFormFields = [
            { type: 'h4', content: ['Filter Reports'] }, // Custom heading
            { label: 'Search reports...', type: 'search', id: 'search-query-input', name: 'searchQuery', placeholder: 'Search reports text' },
            { label: 'Focus Tag:', type: 'text', id: 'focus-tag-input', name: 'focusTag', readOnly: true },
            {
                label: 'Category:',
                type: 'select',
                id: 'filter-category',
                name: 'filterCategory',
                options: [{ value: '', label: 'All' }, ...appState.settings.cats.map(cat => ({ value: cat, label: cat }))]
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

        const initialFilterData = {
            searchQuery: _cFilt.q,
            focusTag: _cFilt.fT,
            filterCategory: _cFilt.cat,
            filterAuthor: _cFilt.auth,
            filterTimeStart: _cFilt.tStart ? new Date(_cFilt.tStart * 1000).toISOString().slice(0, 16) : '',
            filterTimeEnd: _cFilt.tEnd ? new Date(_cFilt.tEnd * 1000).toISOString().slice(0, 16) : '',
            spatialFilterEnabled: appState.ui.spatialFilterEnabled,
            followedOnlyFilter: appState.ui.followedOnlyFilter
        };

        // Clear existing content and render the form
        filterControlsContainer.innerHTML = '';
        const filterForm = renderForm(filterFormFields, initialFilterData, { id: 'filter-form' });
        filterControlsContainer.appendChild(filterForm);

        // Attach filter event listeners to the new form elements
        gE('#search-query-input', filterForm).oninput = e => { _cFilt.q = e.target.value; debAppAllFilt() };
        gE('#filter-category', filterForm).onchange = e => { _cFilt.cat = e.target.value; applyAllFilters() };
        gE('#filter-author', filterForm).oninput = e => { _cFilt.auth = e.target.value.trim(); debAppAllFilt() };
        gE('#filter-time-start', filterForm).onchange = e => { _cFilt.tStart = e.target.value ? new Date(e.target.value).getTime() / 1000 : null; applyAllFilters() };
        gE('#filter-time-end', filterForm).onchange = e => { _cFilt.tEnd = e.target.value ? new Date(e.target.value).getTime() / 1000 : null; applyAllFilters() };
        gE('#apply-filters-btn', filterForm).onclick = applyAllFilters;

        gE('#reset-filters-btn', filterForm).onclick = () => {
            _cFilt = { q: '', fT: appStore.get().currentFocusTag, cat: '', auth: '', tStart: null, tEnd: null, followedOnly: false };
            gE('#search-query-input', filterForm).value = '';
            gE('#focus-tag-input', filterForm).value = _cFilt.fT;
            gE('#filter-category', filterForm).value = '';
            gE('#filter-author', filterForm).value = '';
            gE('#filter-time-start', filterForm).value = '';
            gE('#filter-time-end', filterForm).value = '';
            // Reset spatial filter state
            appStore.set(s => ({ ui: { ...s.ui, spatialFilterEnabled: false, followedOnlyFilter: false } }));
            gE('#spatial-filter-toggle', filterForm).checked = false;
            gE('#followed-only-toggle', filterForm).checked = false;
            applyAllFilters();
        };

        // Map Drawing Controls
        const mapDrawControlsDiv = gE('#map-draw-controls', filterForm);
        const drawControl = mapSvc.getDrawControl();
        if (drawControl) {
            // Append the draw control's toolbar to the designated div
            mapDrawControlsDiv.appendChild(drawControl.onAdd(mapSvc.get()));
        }

        // Spatial Filter Toggle
        const spatialFilterToggle = gE('#spatial-filter-toggle', filterForm);
        spatialFilterToggle.checked = appStore.get().ui.spatialFilterEnabled; // Ensure initial state is correct
        spatialFilterToggle.onchange = e => {
            appStore.set(s => ({ ui: { ...s.ui, spatialFilterEnabled: e.target.checked } }));
            applyAllFilters(); // Re-apply filters immediately
        };

        // Followed Only Toggle
        const followedOnlyToggle = gE('#followed-only-toggle', filterForm);
        followedOnlyToggle.checked = appStore.get().ui.followedOnlyFilter; // Ensure initial state is correct
        followedOnlyToggle.onchange = e => {
            appStore.set(s => ({ ui: { ...s.ui, followedOnlyFilter: e.target.checked } }));
            _cFilt.followedOnly = e.target.checked; // Update local filter state
            nostrSvc.refreshSubs(); // Refresh subscriptions to apply author filter if needed
            applyAllFilters(); // Re-apply filters immediately
        };

        // Clear Drawn Shapes Button
        gE('#clear-drawn-shapes-btn', filterForm).onclick = () => {
            mapSvc.clearAllDrawnShapes();
        };
    };

    // Setup appStore listeners for UI updates
    const setupAppStoreListeners = () => {
        appStore.on((newState, oldState) => {
            updAuthDisp(newState.user?.pk);
            updConnDisp(newState.online);
            updSyncDisp();

            // Trigger filter re-application if relevant state changes
            const shouldReapplyFilters =
                newState.reports !== oldState?.reports ||
                newState.settings.mute !== oldState?.settings?.mute ||
                newState.currentFocusTag !== oldState?.currentFocusTag ||
                newState.drawnShapes !== oldState?.drawnShapes ||
                newState.ui.spatialFilterEnabled !== oldState?.ui?.spatialFilterEnabled ||
                newState.followedPubkeys !== oldState?.followedPubkeys ||
                newState.ui.followedOnlyFilter !== oldState?.ui?.followedOnlyFilter;

            if (shouldReapplyFilters) {
                // Update local filter state if currentFocusTag changed in appStore
                if (newState.currentFocusTag !== _cFilt.fT) {
                    _cFilt.fT = newState.currentFocusTag;
                    gE('#focus-tag-input', gE('#filter-controls')).value = _cFilt.fT; // Scope to filter form
                }
                // Update local filter state for followedOnlyFilter
                _cFilt.followedOnly = newState.ui.followedOnlyFilter;
                applyAllFilters();
            }

            // Re-populate categories if settings change
            if (newState.settings.cats !== oldState?.settings?.cats) {
                const selectElement = gE('#filter-category', gE('#filter-controls')); // Scope to filter form
                selectElement.innerHTML = '<option value="">All</option>'; // Clear existing options
                newState.settings.cats.forEach(c => selectElement.appendChild(cE('option', { value: c, textContent: sH(c) })));
            }

            // Handle modal focus
            if (newState.ui.modalOpen && !oldState?.ui?.modalOpen && gE(`#${newState.ui.modalOpen}`)) {
                gE(`#${newState.ui.modalOpen}`).focus();
            }

            // Handle viewing a specific report
            if (newState.ui.viewingReport && newState.ui.viewingReport !== oldState?.ui?.viewingReport) {
                const report = newState.reports.find(r => r.id === newState.ui.viewingReport);
                if (report) showReportDetails(report);
            }

            // Global Loading Spinner visibility
            const globalSpinner = gE('#global-loading-spinner');
            if (globalSpinner) {
                globalSpinner.style.display = newState.ui.loading ? 'flex' : 'none';
            }
        });
    };

    // Execute initialization functions
    initGlobalButtons();
    initFilterControls();
    setupAppStoreListeners();

    // Onboarding check
    if (!localStorage.getItem(C.ONBOARDING_KEY)) {
        showModal('onboarding-info');
    }
} // End initUI
