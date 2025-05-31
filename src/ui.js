import { marked } from 'marked';
import { point, booleanPointInPolygon } from '@turf/turf'; // Import turf for spatial queries
import { appStore } from './store.js';
import { mapSvc, idSvc, confSvc, nostrSvc, imgSvc, dbSvc } from './services.js';
import { C, $, $$, createEl, showModal, hideModal, sanitizeHTML, debounce, geohashEncode, sha256, getImgDims, formatNpubShort, npubToHex, showToast, isValidUrl, generateUUID } from './utils.js';

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

// --- Generic Confirmation Modal ---
let _confirmModalRoot;

export function showConfirmModal(title, message, onConfirm, onCancel) {
    if (!_confirmModalRoot) {
        _confirmModalRoot = cE('div', { class: 'modal-content' });
        gE('#confirm-modal').appendChild(_confirmModalRoot);
    }
    _confirmModalRoot.innerHTML = ''; // Clear previous content

    const closeBtn = cE('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => { hideModal('confirm-modal'); if (onCancel) onCancel(); } });
    const heading = cE('h2', { id: 'confirm-modal-heading', textContent: title });
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

    _confirmModalRoot.appendChild(closeBtn);
    _confirmModalRoot.appendChild(heading);
    _confirmModalRoot.appendChild(msgPara);
    _confirmModalRoot.appendChild(buttonContainer);

    showModal('confirm-modal', 'confirm-modal-heading');
}

// --- Passphrase Input Modal ---
let _passphraseModalRoot;
export function showPassphraseModal(title, message) {
    return new Promise((resolve) => {
        if (!_passphraseModalRoot) {
            _passphraseModalRoot = cE('div', { class: 'modal-content' });
            gE('#passphrase-modal').appendChild(_passphraseModalRoot);
        }
        _passphraseModalRoot.innerHTML = ''; // Clear previous content

        const closeBtn = cE('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => { hideModal('passphrase-modal'); resolve(null); } });
        const heading = cE('h2', { id: 'passphrase-modal-heading', textContent: title });
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

        _passphraseModalRoot.appendChild(closeBtn);
        _passphraseModalRoot.appendChild(heading);
        _passphraseModalRoot.appendChild(msgPara);
        _passphraseModalRoot.appendChild(passphraseInput);
        _passphraseModalRoot.appendChild(buttonContainer);

        showModal('passphrase-modal', 'passphrase-input');
    });
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
        // Add reaction buttons and comment form
        html += `<div class="reaction-buttons" style="margin-top:0.5rem;">
            <button data-report-id="${sH(reportId)}" data-report-pk="${sH(reportPk)}" data-reaction="+">👍 Like</button>
            <button data-report-id="${sH(reportId)}" data-report-pk="${sH(reportPk)}" data-reaction="-">👎 Dislike</button>
        </div>`;
        html += `<form id="comment-form" data-report-id="${sH(reportId)}" data-report-pk="${sH(reportPk)}" style="margin-top:0.5rem;">
            <textarea name="comment" placeholder="Add a public comment..." rows="2" required></textarea>
            <button type="submit">Post Comment</button>
        </form>`;
        container.innerHTML = html;

        // Add event listeners for new buttons/forms
        $$('.reaction-buttons button', container).forEach(btn => btn.onclick = handleReactionSubmit);
        $('#comment-form', container)?.addEventListener('submit', handleCommentSubmit);

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

// ReportForm
let _repFormRoot, _pFLoc, _uIMeta = []; /* pFLoc: pickedFileLocation, uIMeta: uploadedImageMetadata */

function RepFormComp(reportToEdit = null) {
    _repFormRoot = cE('div', { class: 'modal-content' });
    const categories = appStore.get().settings.cats;

    // Pre-fill location and images if editing
    if (reportToEdit) {
        if (reportToEdit.lat && reportToEdit.lon) {
            _pFLoc = { lat: reportToEdit.lat, lng: reportToEdit.lon };
        }
        if (reportToEdit.imgs && reportToEdit.imgs.length > 0) {
            _uIMeta = [...reportToEdit.imgs];
        }
    } else {
        _pFLoc = null;
        _uIMeta = [];
    }

    // Helper to create the form structure
    const createReportFormStructure = () => {
        return [
            cE('span', { class: 'close-btn', innerHTML: '&times;', 'data-modal-id': 'report-form-modal', onclick: () => hideModal('report-form-modal') }),
            cE('h2', { id: 'report-form-heading', textContent: reportToEdit ? 'Edit Report' : 'New Report' }),
            cE('form', { id: 'nstr-rep-form' }, [
                cE('label', { for: 'rep-title', textContent: 'Title:' }),
                cE('input', { type: 'text', id: 'rep-title', name: 'title', value: reportToEdit?.title || '' }),

                cE('label', { for: 'rep-sum', textContent: 'Summary:' }),
                cE('input', { type: 'text', id: 'rep-sum', name: 'summary', required: true, value: reportToEdit?.sum || '' }),

                cE('label', { for: 'rep-desc', textContent: 'Description (MD):' }),
                cE('textarea', { id: 'rep-desc', name: 'description', required: true, rows: 3, textContent: reportToEdit?.ct || '' }),

                cE('label', { textContent: 'Location:' }),
                cE('div', { id: 'map-pick-area' }, ['Selected: ', cE('span', { id: 'pFLoc-coords', textContent: _pFLoc ? `${_pFLoc.lat.toFixed(5)},${_pFLoc.lng.toFixed(5)}` : 'None' })]),
                cE('button', { type: 'button', id: 'pick-loc-map-btn', textContent: 'Pick Location' }),
                cE('button', { type: 'button', id: 'use-gps-loc-btn', textContent: 'Use GPS' }),

                cE('label', { for: 'rep-address', textContent: 'Or Enter Address:' }),
                cE('input', { type: 'text', id: 'rep-address', name: 'address', placeholder: 'e.g., 1600 Amphitheatre Pkwy' }),
                cE('button', { type: 'button', id: 'geocode-address-btn', textContent: 'Geocode Address' }),

                cE('label', { textContent: 'Categories:' }),
                cE('div', { id: 'cats-cont-form' }, categories.map(cat => cE('label', {}, [cE('input', { type: 'checkbox', name: 'category', value: cat, checked: reportToEdit?.cat?.includes(cat) || false }), ` ${sH(cat)}`]))),

                cE('label', { for: 'rep-ftags', textContent: 'Add. Tags (comma-sep):' }),
                cE('input', { type: 'text', id: 'rep-ftags', name: 'freeTags', value: reportToEdit?.fTags?.join(', ') || '' }),

                cE('label', { for: 'rep-evType', textContent: 'Event Type:' }),
                cE('select', { id: 'rep-evType', name: 'eventType' }, ['Observation', 'Incident', 'Request', 'Offer', 'Other'].map(type => cE('option', { value: type.toLowerCase(), textContent: type, selected: reportToEdit?.evType === type.toLowerCase() }))),

                cE('label', { for: 'rep-stat', textContent: 'Status:' }),
                cE('select', { id: 'rep-stat', name: 'status' }, ['New', 'Active', 'Needs Verification'].map(status => cE('option', { value: status.toLowerCase().replace(' ', '_'), textContent: status, selected: reportToEdit?.stat === status.toLowerCase().replace(' ', '_') }))),

                cE('label', { for: 'rep-photos', textContent: 'Photos (max 5MB each):' }),
                cE('input', { type: 'file', id: 'rep-photos', multiple: true, accept: 'image/*' }),
                cE('div', { id: 'upld-photos-preview' }),

                cE('p', { class: 'warning', textContent: 'Reports are public on Nostr.' }),
                cE('button', { type: 'submit', textContent: reportToEdit ? 'Update Report' : 'Submit' }),
                cE('button', { type: 'button', class: 'secondary', textContent: 'Cancel', onclick: () => hideModal('report-form-modal') })
            ])
        ];
    };

    createReportFormStructure().forEach(el => _repFormRoot.appendChild(el));

    // Helper to render the image preview with remove buttons
    const renderImagePreview = () => {
        const previewElement = gE('#upld-photos-preview', _repFormRoot);
        previewElement.innerHTML = '';
        if (_uIMeta.length === 0) {
            previewElement.textContent = 'No images selected.';
            return;
        }
        _uIMeta.forEach((img, index) => {
            const imgDiv = cE('div', { class: 'uploaded-image-item' }, [
                cE('span', { textContent: sH(img.url.substring(img.url.lastIndexOf('/') + 1)) }),
                cE('button', {
                    type: 'button',
                    class: 'remove-image-btn',
                    textContent: 'x',
                    onclick: () => {
                        _uIMeta.splice(index, 1); // Remove image from array
                        renderImagePreview(); // Re-render preview
                    }
                })
            ]);
            previewElement.appendChild(imgDiv);
        });
    };

    // Display existing images if editing
    if (reportToEdit && _uIMeta.length > 0) {
        renderImagePreview();
    } else {
        gE('#upld-photos-preview', _repFormRoot).textContent = 'No images selected.';
    }


    // Helper to set up location-related event handlers
    const setupReportFormLocationHandlers = () => {
        gE('#pick-loc-map-btn', _repFormRoot).onclick = () => {
            hideModal('report-form-modal');
            mapSvc.enPickLoc(latlng => {
                _pFLoc = latlng;
                gE('#pFLoc-coords', _repFormRoot).textContent = `${latlng.lat.toFixed(5)},${latlng.lng.toFixed(5)}`;
                showModal('report-form-modal', 'rep-title');
            });
        };

        gE('#use-gps-loc-btn', _repFormRoot).onclick = () => {
            if (!navigator.geolocation) return showToast("GPS not supported by your browser.", 'warning');
            navigator.geolocation.getCurrentPosition(
                position => {
                    _pFLoc = { lat: position.coords.latitude, lng: position.coords.longitude };
                    gE('#pFLoc-coords', _repFormRoot).textContent = `${_pFLoc.lat.toFixed(5)},${_pFLoc.lng.toFixed(5)}`;
                },
                error => showToast(`GPS Error: ${error.message}`, 'error')
            );
        };

        gE('#geocode-address-btn', _repFormRoot).onclick = async () => {
            const address = gE('#rep-address', _repFormRoot).value.trim();
            if (!address) return showToast("Please enter an address to geocode.", 'warning');
            appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
                const data = await response.json();
                if (data?.length > 0) {
                    const { lat, lon, display_name } = data[0];
                    _pFLoc = { lat: parseFloat(lat), lng: parseFloat(lon) };
                    gE('#pFLoc-coords', _repFormRoot).textContent = `${_pFLoc.lat.toFixed(5)},${_pFLoc.lon.toFixed(5)} (${sH(display_name)})`;
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

    // Helper to set up image upload handler
    const setupReportFormImageUpload = () => {
        gE('#rep-photos', _repFormRoot).onchange = async e => {
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
                        _uIMeta.push({ url: uploadedUrl, type: file.type, dim: `${dimensions.w}x${dimensions.h}`, hHex: hash });
                        showToast(`Image ${file.name} uploaded.`, 'success', 1500);
                    } catch (error) {
                        showToast(`Failed to upload ${file.name}: ${error.message}`, 'error');
                    }
                }
                renderImagePreview(); // Re-render preview after all uploads
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
            }
        };
    };

    // Helper to set up form submission handler
    const setupReportFormSubmission = () => {
        gE('form', _repFormRoot).onsubmit = async e => {
            e.preventDefault();
            const submitBtn = e.target.querySelector('button[type=submit]');
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());

            if (!_pFLoc) return showToast("Location missing. Please pick or geocode a location.", 'warning');

            submitBtn.disabled = true;
            appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading for report submission
            try {
                const lat = _pFLoc.lat;
                const lon = _pFLoc.lng;
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

                // Add categories
                $$('input[name="category"]:checked', e.target).forEach(checkbox => {
                    tags.push(['L', 'report-category']); // NIP-32 label tag
                    tags.push(['l', checkbox.value, 'report-category']); // NIP-32 value tag
                });

                if (data.eventType) tags.push(['event_type', data.eventType]);
                if (data.status) tags.push(['status', data.status]);

                _uIMeta.forEach(img => tags.push(['image', img.url, img.type, img.dim, `ox${img.hHex}`]));

                // NIP-33 d-tag for parameterized replaceable events
                // If editing, retain the original d-tag. If new, generate a UUID.
                const dTagValue = reportToEdit?.d || generateUUID();
                tags.push(['d', dTagValue]);

                const eventData = { kind: C.NOSTR_KIND_REPORT, content: data.description, tags };

                await nostrSvc.pubEv(eventData);
                showToast('Report sent!', 'success');
                e.target.reset();
                gE('#pFLoc-coords', _repFormRoot).textContent = 'None';
                gE('#upld-photos-preview', _repFormRoot).innerHTML = '';
                _pFLoc = null;
                _uIMeta = [];
                hideModal('report-form-modal');
            } catch (error) {
                showToast(`Report submission error: ${error.message}`, 'error');
            } finally {
                submitBtn.disabled = false;
                appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
            }
        };
    };

    // Initialize handlers and reset form state
    setupReportFormLocationHandlers();
    setupReportFormImageUpload();
    setupReportFormSubmission();

    return _repFormRoot;
}

// AuthModal
function AuthModalComp() {
    const modalContent = cE('div', { class: 'modal-content' });

    const elements = [
        cE('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => hideModal('auth-modal') }),
        cE('h2', { id: 'auth-modal-heading', textContent: 'Nostr Identity' }),
        cE('p', {}, [cE('strong', { textContent: 'Recommended: ' }), 'Use NIP-07 (Alby, etc.)']),
        cE('button', { id: 'conn-nip07-btn', textContent: 'Connect NIP-07' }),
        cE('hr'),
        cE('h4', { textContent: 'Local Keys (Advanced/Risky)' }),
        cE('div', { class: 'critical-warning', innerHTML: '<p><strong>SECURITY WARNING:</strong> Storing keys in browser is risky. Backup private key (nsec)!</p>' }),
        cE('label', { for: 'auth-pass', textContent: 'Passphrase (min 8 chars):' }),
        cE('input', { type: 'password', id: 'auth-pass', autocomplete: 'new-password' }),
        cE('button', { id: 'create-prof-btn', textContent: 'Create New Profile' }),
        cE('hr'),
        cE('label', { for: 'auth-sk', textContent: 'Import Private Key (nsec/hex):' }),
        cE('input', { type: 'text', id: 'auth-sk' }),
        cE('button', { id: 'import-sk-btn', textContent: 'Import Key' }),
        cE('button', { type: 'button', class: 'secondary', textContent: 'Cancel', onclick: () => hideModal('auth-modal'), style: 'margin-top:1rem' })
    ];
    elements.forEach(el => modalContent.appendChild(el));

    gE('#conn-nip07-btn', modalContent).onclick = async () => {
        appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
        try {
            await idSvc.nip07();
            if (appStore.get().user) hideModal('auth-modal');
        } finally {
            appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
        }
    };

    gE('#create-prof-btn', modalContent).onclick = async () => {
        const passphrase = gE('#auth-pass', modalContent).value;
        if (!passphrase || passphrase.length < 8) {
            showToast("Passphrase too short (min 8 chars).", 'warning');
            return;
        }
        showConfirmModal(
            "Backup Private Key?",
            "<strong>CRITICAL:</strong> You are about to create a new Nostr identity. Your private key (nsec) will be generated and displayed. You MUST copy and securely back it up. If you lose it, your identity and associated data will be unrecoverable. Do you understand and wish to proceed?",
            async () => {
                appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
                try {
                    const result = await idSvc.newProf(passphrase);
                    if (result) hideModal('auth-modal');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
                }
            },
            () => showToast("New profile creation cancelled.", 'info')
        );
    };

    gE('#import-sk-btn', modalContent).onclick = async () => {
        const privateKey = gE('#auth-sk', modalContent).value;
        const passphrase = gE('#auth-pass', modalContent).value;
        if (!privateKey || !passphrase || passphrase.length < 8) {
            showToast("Private key and passphrase (min 8 chars) are required.", 'warning');
            return;
        }
        showConfirmModal(
            "Import Private Key?",
            "<strong>HIGH RISK:</strong> Importing a private key directly into the browser is generally discouraged due to security risks. Ensure you understand the implications. It is highly recommended to use a NIP-07 browser extension instead. Do you wish to proceed?",
            async () => {
                appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
                try {
                    const result = await idSvc.impSk(privateKey, passphrase);
                    if (result) hideModal('auth-modal');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
                }
            },
            () => showToast("Private key import cancelled.", 'info')
        );
    };
    return modalContent;
}

// SettingsPanel
function SettPanComp() {
    const modalContent = cE('div', { class: 'modal-content', style: 'max-width:700px' });
    const appState = appStore.get();

    // Append the close button and heading directly to modalContent
    modalContent.appendChild(cE('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => hideModal('settings-modal') }));
    modalContent.appendChild(cE('h2', { id: 'settings-modal-heading', textContent: 'Settings' }));

    // Create the wrapper for sections, which the CSS expects
    const settingsSectionsWrapper = cE('div', { id: 'settings-sections' });

    // Define and append all sections to the settingsSectionsWrapper
    settingsSectionsWrapper.appendChild(cE('section', {}, [
        cE('h3', { textContent: 'Relays' }),
        cE('div', { id: 'rly-list' }),
        cE('input', { type: 'url', id: 'new-rly-url', placeholder: 'wss://new.relay.com' }),
        cE('button', { id: 'add-rly-btn', textContent: 'Add Relay' }),
        cE('button', { id: 'save-rlys-btn', textContent: 'Save & Reconnect Relays' })
    ]));
    settingsSectionsWrapper.appendChild(cE('hr'));

    if (appState.user && (appState.user.authM === 'local' || appState.user.authM === 'import')) {
        settingsSectionsWrapper.appendChild(cE('section', {}, [
            cE('h3', { textContent: 'Local Key Management' }),
            cE('button', { id: 'exp-sk-btn', textContent: 'Export Private Key' }),
            cE('br'),
            cE('label', { for: 'chg-pass-old', textContent: 'Old Passphrase:' }),
            cE('input', { type: 'password', id: 'chg-pass-old' }),
            cE('label', { for: 'chg-pass-new', textContent: 'New Passphrase:' }),
            cE('input', { type: 'password', id: 'chg-pass-new' }),
            cE('button', { id: 'chg-pass-btn', textContent: 'Change Passphrase' })
        ]));
        settingsSectionsWrapper.appendChild(cE('hr'));
    }

    settingsSectionsWrapper.appendChild(cE('section', {}, [ // Focus Tags Section
        cE('h3', { textContent: 'Focus Tags' }),
        cE('div', { id: 'focus-tag-list' }),
        cE('input', { type: 'text', id: 'new-focus-tag-input', placeholder: '#NewFocusTag' }),
        cE('button', { id: 'add-focus-tag-btn', textContent: 'Add Focus Tag' }),
        cE('button', { id: 'save-focus-tags-btn', textContent: 'Save Focus Tags' })
    ]));
    settingsSectionsWrapper.appendChild(cE('hr'));

    settingsSectionsWrapper.appendChild(cE('section', {}, [
        cE('h3', { textContent: 'Categories' }),
        cE('div', { id: 'cat-list' }),
        cE('input', { type: 'text', id: 'new-cat-name', placeholder: 'New Category' }),
        cE('button', { id: 'add-cat-btn', textContent: 'Add Category' }),
        cE('button', { id: 'save-cats-btn', textContent: 'Save Categories' })
    ]));
    settingsSectionsWrapper.appendChild(cE('hr'));

    settingsSectionsWrapper.appendChild(cE('section', {}, [ // Map Tiles Section
        cE('h3', { textContent: 'Map Tiles' }),
        cE('label', { for: 'tile-preset-sel', textContent: 'Tile Server Preset:' }),
        cE('select', { id: 'tile-preset-sel' },
            C.TILE_SERVERS_PREDEFINED.map(p => cE('option', { value: p.name, textContent: p.name }))
        ),
        cE('label', { for: 'tile-url-in', textContent: 'Custom Tile URL Template:' }),
        cE('input', { type: 'url', id: 'tile-url-in', value: appState.settings.tileUrl }),
        cE('button', { id: 'save-tile-btn', textContent: 'Save Tiles' })
    ]));
    settingsSectionsWrapper.appendChild(cE('hr'));

    settingsSectionsWrapper.appendChild(cE('section', {}, [
        cE('h3', { textContent: 'Image Host' }),
        cE('label', { for: 'img-host-sel', textContent: 'Provider:' }),
        cE('select', { id: 'img-host-sel' }, [
            cE('option', { value: C.IMG_UPLOAD_NOSTR_BUILD, textContent: 'nostr.build (Default)' }),
            cE('option', { value: 'nip96', textContent: 'NIP-96 Server' })
        ]),
        cE('div', { id: 'nip96-fields', style: appState.settings.nip96Host ? '' : 'display:none' }, [
            cE('label', { for: 'nip96-url-in', textContent: 'NIP-96 Server URL:' }),
            cE('input', { type: 'url', id: 'nip96-url-in', value: appState.settings.nip96Host, placeholder: 'https://your.nip96.server' }),
            cE('label', { for: 'nip96-token-in', textContent: 'NIP-96 Auth Token (Optional):' }),
            cE('input', { type: 'text', id: 'nip96-token-in', value: appState.settings.nip96Token })
        ]),
        cE('button', { id: 'save-img-host-btn', textContent: 'Save Image Host' })
    ]));
    settingsSectionsWrapper.appendChild(cE('hr'));

    settingsSectionsWrapper.appendChild(cE('section', {}, [ // Mute List Section
        cE('h3', { textContent: 'Mute List' }),
        cE('div', { id: 'mute-list' }),
        cE('input', { type: 'text', id: 'new-mute-pk-input', placeholder: 'npub... or hex pubkey' }),
        cE('button', { id: 'add-mute-btn', textContent: 'Add to Mute List' }),
        cE('button', { id: 'save-mute-list-btn', textContent: 'Save Mute List' })
    ]));
    settingsSectionsWrapper.appendChild(cE('hr'));

    settingsSectionsWrapper.appendChild(cE('section', {}, [ // New: Followed Users Section
        cE('h3', { textContent: 'Followed Users (NIP-02)' }),
        cE('div', { id: 'followed-list' }),
        cE('input', { type: 'text', id: 'new-followed-pk-input', placeholder: 'npub... or hex pubkey' }),
        cE('button', { id: 'add-followed-btn', textContent: 'Add to Followed' }),
        cE('button', { id: 'save-followed-btn', textContent: 'Save Followed List' }),
        cE('hr'),
        cE('button', { id: 'import-contacts-btn', textContent: 'Import NIP-02 Contacts' }),
        cE('button', { id: 'publish-contacts-btn', textContent: 'Publish NIP-02 Contacts' })
    ]));
    settingsSectionsWrapper.appendChild(cE('hr'));

    settingsSectionsWrapper.appendChild(cE('section', {}, [
        cE('h3', { textContent: 'Data Management' }),
        cE('button', { id: 'clr-reps-btn', textContent: 'Clear Cached Reports' }),
        cE('button', { id: 'exp-setts-btn', textContent: 'Export Settings' }),
        cE('label', { for: 'imp-setts-file', textContent: 'Import Settings:' }),
        cE('input', { type: 'file', id: 'imp-setts-file', accept: '.json' })
    ]));

    // Append the settingsSectionsWrapper to the modalContent
    modalContent.appendChild(settingsSectionsWrapper);

    // Append the final close button
    modalContent.appendChild(cE('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));

    // Render functions for lists (these need to be called after elements are in modalContent)
    renderRelays();
    renderCategories();
    renderFocusTags();
    renderMuteList();
    renderFollowedList(); // New: Render followed list

    // Event Listeners for Settings Panel (these need to be called after elements are in modalContent)
    setupRelayListeners();
    setupKeyManagementListeners();
    setupFocusTagListeners();
    setupCategoryListeners();
    setupMapTilesListeners();
    setupImageHostListeners();
    setupMuteListListeners();
    setupFollowedListListeners(); // New: Setup followed list listeners
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

    detailContainer.innerHTML = `<button id="back-to-list-btn" class="small-button">&lt; List</button>
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
    <div class="interactions" id="interactions-for-${report.id}">Loading interactions...</div>`;

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
    const followedPubkeys = appStore.get().followedPubkeys.map(f => f.pk); // New: Get followed pubkeys for filtering

    const filteredReports = allReports.filter(report => {
        // Mute filter
        if (mutedPubkeys.includes(report.pk)) return false;

        // Focus Tag filter
        const focusTagMatch = _cFilt.fT?.startsWith('#') ? _cFilt.fT.substring(1) : _cFilt.fT;
        if (focusTagMatch && focusTagMatch !== 'NostrMapper_Global' && !report.fTags.includes(focusTagMatch)) {
            return false;
        }

        // Search Query filter
        if (_cFilt.q) {
            const query = _cFilt.q.toLowerCase();
            if (!(report.title?.toLowerCase().includes(query) ||
                    report.sum?.toLowerCase().includes(query) ||
                    report.ct?.toLowerCase().includes(query))) {
                return false;
            }
        }

        // Category filter
        if (_cFilt.cat && !report.cat.includes(_cFilt.cat)) return false;

        // Author filter
        if (_cFilt.auth) {
            const authorHex = npubToHex(_cFilt.auth);
            if (report.pk !== authorHex) return false;
        }

        // Time filters
        if (_cFilt.tStart && report.at < _cFilt.tStart) return false;
        if (_cFilt.tEnd && report.at > _cFilt.tEnd) return false;

        // Spatial filter (new)
        if (spatialFilterEnabled && drawnShapes.length > 0) {
            if (!report.lat || !report.lon) return false; // Report must have location
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

        // New: Followed Only filter
        if (_cFilt.followedOnly && !followedPubkeys.includes(report.pk)) {
            return false;
        }

        return true;
    }).sort((a, b) => b.at - a.at); // Sort by created_at descending

    rendRepList(filteredReports);
    mapSvc.updReps(filteredReports);
};
const debAppAllFilt = debounce(applyAllFilters, 350);

// --- Settings Panel Listeners (New and Modified) ---

function renderFollowedList() {
    const followedListDiv = gE('#followed-list');
    followedListDiv.innerHTML = '';
    const followedPubkeys = appStore.get().followedPubkeys;
    if (followedPubkeys.length === 0) {
        followedListDiv.textContent = 'No users followed.';
        return;
    }
    followedPubkeys.forEach(f => {
        const entry = cE('div', { class: 'followed-entry' }, [
            cE('span', { textContent: formatNpubShort(f.pk) }),
            cE('button', {
                class: 'remove-followed-btn',
                textContent: 'Remove',
                onclick: () => {
                    showConfirmModal(
                        "Remove Followed User",
                        `Are you sure you want to unfollow ${formatNpubShort(f.pk)}?`,
                        () => confSvc.rmFollowed(f.pk),
                        () => showToast("Unfollow cancelled.", 'info')
                    );
                }
            })
        ]);
        followedListDiv.appendChild(entry);
    });
}

function setupFollowedListListeners() {
    gE('#add-followed-btn').onclick = () => {
        const input = gE('#new-followed-pk-input');
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

    gE('#save-followed-btn').onclick = () => {
        // The add/remove functions already update the appStore and trigger save via confSvc.save
        // This button is mostly for user clarity or if manual edits were allowed in the UI
        showToast("Followed list saved.", 'info');
    };

    gE('#import-contacts-btn').onclick = async () => {
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

    gE('#publish-contacts-btn').onclick = async () => {
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
}

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
        // Initialize focus tag filter display
        _cFilt.fT = appStore.get().currentFocusTag;
        gE('#focus-tag-input').value = _cFilt.fT;
        gE('#set-focus-tag-btn').style.display = 'none'; // Hide the old set button
        gE('#focus-tag-input').readOnly = true; // Make it read-only

        // Populate category filter dropdown
        const populateFilterCategories = () => {
            const selectElement = gE('#filter-category');
            selectElement.innerHTML = '<option value="">All</option>';
            appStore.get().settings.cats.forEach(cat => selectElement.appendChild(cE('option', { value: cat, textContent: sH(cat) })));
        };
        populateFilterCategories();

        // Attach filter event listeners
        gE('#search-query-input').oninput = e => { _cFilt.q = e.target.value; debAppAllFilt() };
        gE('#filter-category').onchange = e => { _cFilt.cat = e.target.value; applyAllFilters() };
        gE('#filter-author').oninput = e => { _cFilt.auth = e.target.value.trim(); debAppAllFilt() };
        gE('#filter-time-start').onchange = e => { _cFilt.tStart = e.target.value ? new Date(e.target.value).getTime() / 1000 : null; applyAllFilters() };
        gE('#filter-time-end').onchange = e => { _cFilt.tEnd = e.target.value ? new Date(e.target.value).getTime() / 1000 : null; applyAllFilters() };
        gE('#apply-filters-btn').onclick = applyAllFilters;

        gE('#reset-filters-btn').onclick = () => {
            _cFilt = { q: '', fT: appStore.get().currentFocusTag, cat: '', auth: '', tStart: null, tEnd: null, followedOnly: false };
            gE('#search-query-input').value = '';
            gE('#focus-tag-input').value = _cFilt.fT;
            gE('#filter-category').value = '';
            gE('#filter-author').value = '';
            gE('#filter-time-start').value = '';
            gE('#filter-time-end').value = '';
            // Reset spatial filter state
            appStore.set(s => ({ ui: { ...s.ui, spatialFilterEnabled: false, followedOnlyFilter: false } })); // New: Reset followedOnlyFilter
            gE('#spatial-filter-toggle').checked = false;
            gE('#followed-only-toggle').checked = false; // New: Reset followed only toggle
            applyAllFilters();
        };

        // New: Map Drawing Controls
        const mapDrawControlsDiv = gE('#map-draw-controls');
        const drawControl = mapSvc.getDrawControl();
        if (drawControl) {
            // Append the draw control's toolbar to the designated div
            mapDrawControlsDiv.appendChild(drawControl.onAdd(mapSvc.get()));
        }

        // New: Spatial Filter Toggle
        const spatialFilterToggle = gE('#spatial-filter-toggle');
        spatialFilterToggle.checked = appStore.get().ui.spatialFilterEnabled;
        spatialFilterToggle.onchange = e => {
            appStore.set(s => ({ ui: { ...s.ui, spatialFilterEnabled: e.target.checked } }));
            applyAllFilters(); // Re-apply filters immediately
        };

        // New: Followed Only Toggle
        const followedOnlyToggle = cE('input', { type: 'checkbox', id: 'followed-only-toggle' });
        const followedOnlyLabel = cE('label', {}, [followedOnlyToggle, ' Show Only Followed Users']);
        gE('#filter-controls').insertBefore(followedOnlyLabel, gE('#clear-drawn-shapes-btn')); // Insert before clear button
        followedOnlyToggle.checked = appStore.get().ui.followedOnlyFilter;
        followedOnlyToggle.onchange = e => {
            appStore.set(s => ({ ui: { ...s.ui, followedOnlyFilter: e.target.checked } }));
            _cFilt.followedOnly = e.target.checked; // Update local filter state
            applyAllFilters(); // Re-apply filters immediately
            nostrSvc.refreshSubs(); // Refresh subscriptions to apply author filter if needed
        };


        // New: Clear Drawn Shapes Button
        gE('#clear-drawn-shapes-btn').onclick = () => {
            mapSvc.clearAllDrawnShapes();
        };
    };

    // Setup appStore listeners for UI updates
    const setupAppStoreListeners = () => {
        appStore.on((newState, oldState) => {
            updAuthDisp(newState.user?.pk);
            updConnDisp(newState.online);
            updSyncDisp();

            // Re-apply filters if reports, mute list, current focus tag, or drawn shapes/spatial filter changes
            if (newState.reports !== oldState?.reports ||
                newState.settings.mute !== oldState?.settings?.mute ||
                newState.currentFocusTag !== oldState?.currentFocusTag ||
                newState.drawnShapes !== oldState?.drawnShapes || // New: Trigger filter on drawn shapes change
                newState.ui.spatialFilterEnabled !== oldState?.ui?.spatialFilterEnabled || // New: Trigger filter on spatial filter toggle
                newState.followedPubkeys !== oldState?.followedPubkeys || // New: Trigger filter on followed pubkeys change
                newState.ui.followedOnlyFilter !== oldState?.ui?.followedOnlyFilter) { // New: Trigger filter on followed only toggle
                if (newState.currentFocusTag !== _cFilt.fT) {
                    _cFilt.fT = newState.currentFocusTag;
                    gE('#focus-tag-input').value = _cFilt.fT;
                }
                _cFilt.followedOnly = newState.ui.followedOnlyFilter; // Ensure filter state is in sync
                applyAllFilters();
            }

            // Re-populate categories if settings change
            if (newState.settings.cats !== oldState?.settings?.cats) {
                gE('#filter-category').innerHTML = '<option value="">All</option>'; // Clear existing options
                newState.settings.cats.forEach(c => gE('#filter-category').appendChild(cE('option', { value: c, textContent: sH(c) })));
            }

            // Re-render followed list in settings if it changes
            if (newState.followedPubkeys !== oldState?.followedPubkeys && gE('#settings-modal').style.display === 'block') {
                renderFollowedList();
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
