import { marked } from 'marked';
import { appStore } from './store.js';
import { mapSvc, idSvc, confSvc, nostrSvc, imgSvc, dbSvc } from './services.js';
import { C, $, $$, createEl, showModal, hideModal, sanitizeHTML, debounce, geohashEncode, sha256, getImgDims, formatNpubShort, npubToHex, showToast, isValidUrl } from './utils.js';

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

function showConfirmModal(title, message, onConfirm, onCancel) {
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

function RepFormComp() {
    _repFormRoot = cE('div', { class: 'modal-content' });
    const categories = appStore.get().settings.cats;

    // Helper to create the form structure
    const createReportFormStructure = () => {
        return [
            cE('span', { class: 'close-btn', innerHTML: '&times;', 'data-modal-id': 'report-form-modal', onclick: () => hideModal('report-form-modal') }),
            cE('h2', { id: 'report-form-heading', textContent: 'New Report' }),
            cE('form', { id: 'nstr-rep-form' }, [
                cE('label', { for: 'rep-title', textContent: 'Title:' }),
                cE('input', { type: 'text', id: 'rep-title', name: 'title' }),

                cE('label', { for: 'rep-sum', textContent: 'Summary:' }),
                cE('input', { type: 'text', id: 'rep-sum', name: 'summary', required: true }),

                cE('label', { for: 'rep-desc', textContent: 'Description (MD):' }),
                cE('textarea', { id: 'rep-desc', name: 'description', required: true, rows: 3 }),

                cE('label', { textContent: 'Location:' }),
                cE('div', { id: 'map-pick-area' }, ['Selected: ', cE('span', { id: 'pFLoc-coords', textContent: 'None' })]),
                cE('button', { type: 'button', id: 'pick-loc-map-btn', textContent: 'Pick Location' }),
                cE('button', { type: 'button', id: 'use-gps-loc-btn', textContent: 'Use GPS' }),

                cE('label', { for: 'rep-address', textContent: 'Or Enter Address:' }),
                cE('input', { type: 'text', id: 'rep-address', name: 'address', placeholder: 'e.g., 1600 Amphitheatre Pkwy' }),
                cE('button', { type: 'button', id: 'geocode-address-btn', textContent: 'Geocode Address' }),

                cE('label', { textContent: 'Categories:' }),
                cE('div', { id: 'cats-cont-form' }, categories.map(cat => cE('label', {}, [cE('input', { type: 'checkbox', name: 'category', value: cat }), ` ${sH(cat)}`]))),

                cE('label', { for: 'rep-ftags', textContent: 'Add. Tags (comma-sep):' }),
                cE('input', { type: 'text', id: 'rep-ftags', name: 'freeTags' }),

                cE('label', { for: 'rep-evType', textContent: 'Event Type:' }),
                cE('select', { id: 'rep-evType', name: 'eventType' }, ['Observation', 'Incident', 'Request', 'Offer', 'Other'].map(type => cE('option', { value: type.toLowerCase(), textContent: type }))),

                cE('label', { for: 'rep-stat', textContent: 'Status:' }),
                cE('select', { id: 'rep-stat', name: 'status' }, ['New', 'Active', 'Needs Verification'].map(status => cE('option', { value: status.toLowerCase().replace(' ', '_'), textContent: status }))),

                cE('label', { for: 'rep-photos', textContent: 'Photos (max 5MB each):' }),
                cE('input', { type: 'file', id: 'rep-photos', multiple: true, accept: 'image/*' }),
                cE('div', { id: 'upld-photos-preview' }),

                cE('p', { class: 'warning', textContent: 'Reports are public on Nostr.' }),
                cE('button', { type: 'submit', textContent: 'Submit' }),
                cE('button', { type: 'button', class: 'secondary', textContent: 'Cancel', onclick: () => hideModal('report-form-modal') })
            ])
        ];
    };

    createReportFormStructure().forEach(el => _repFormRoot.appendChild(el));

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
            const previewElement = gE('#upld-photos-preview', _repFormRoot);
            previewElement.innerHTML = 'Processing...';
            _uIMeta = [];
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
                        previewElement.innerHTML += `<p>${sH(file.name)} ready</p>`;
                        showToast(`Image ${file.name} uploaded.`, 'success', 1500);
                    } catch (error) {
                        previewElement.innerHTML += `<p style="color:red;">${sH(file.name)} Err: ${error.message}</p>`;
                        showToast(`Failed to upload ${file.name}: ${error.message}`, 'error');
                    }
                }
                if (_uIMeta.length > 0 && previewElement.innerHTML.startsWith('Processing...')) {
                    previewElement.innerHTML = previewElement.innerHTML.substring(13); // Remove "Processing..."
                }
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

    _pFLoc = null;
    _uIMeta = [];
    if (gE('#pFLoc-coords', _repFormRoot)) gE('#pFLoc-coords', _repFormRoot).textContent = 'None';
    if (gE('#upld-photos-preview', _repFormRoot)) gE('#upld-photos-preview', _repFormRoot).innerHTML = '';
    if (gE('form', _repFormRoot)) gE('form', _repFormRoot).reset();

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

    const createSettingsSections = () => {
        const sections = [
            cE('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => hideModal('settings-modal') }),
            cE('h2', { id: 'settings-modal-heading', textContent: 'Settings' }),
            cE('section', {}, [
                cE('h3', { textContent: 'Relays' }),
                cE('div', { id: 'rly-list' }),
                cE('input', { type: 'url', id: 'new-rly-url', placeholder: 'wss://new.relay.com' }),
                cE('button', { id: 'add-rly-btn', textContent: 'Add Relay' }),
                cE('button', { id: 'save-rlys-btn', textContent: 'Save & Reconnect Relays' })
            ]),
            cE('hr'),
        ];

        // Only show local key management if a local/imported key is used
        if (appState.user && (appState.user.authM === 'local' || appState.user.authM === 'import')) {
            sections.push(
                cE('section', {}, [
                    cE('h3', { textContent: 'Local Key Management' }),
                    cE('button', { id: 'exp-sk-btn', textContent: 'Export Private Key' }),
                    cE('br'),
                    cE('label', { for: 'chg-pass-old', textContent: 'Old Passphrase:' }),
                    cE('input', { type: 'password', id: 'chg-pass-old' }),
                    cE('label', { for: 'chg-pass-new', textContent: 'New Passphrase:' }),
                    cE('input', { type: 'password', id: 'chg-pass-new' }),
                    cE('button', { id: 'chg-pass-btn', textContent: 'Change Passphrase' })
                ]),
                cE('hr')
            );
        }

        sections.push(
            cE('section', {}, [ // Focus Tags Section
                cE('h3', { textContent: 'Focus Tags' }),
                cE('div', { id: 'focus-tag-list' }),
                cE('input', { type: 'text', id: 'new-focus-tag-input', placeholder: '#NewFocusTag' }),
                cE('button', { id: 'add-focus-tag-btn', textContent: 'Add Focus Tag' }),
                cE('button', { id: 'save-focus-tags-btn', textContent: 'Save Focus Tags' })
            ]),
            cE('hr'),
            cE('section', {}, [
                cE('h3', { textContent: 'Categories' }),
                cE('div', { id: 'cat-list' }),
                cE('input', { type: 'text', id: 'new-cat-name', placeholder: 'New Category' }),
                cE('button', { id: 'add-cat-btn', textContent: 'Add Category' }),
                cE('button', { id: 'save-cats-btn', textContent: 'Save Categories' })
            ]),
            cE('hr'),
            cE('section', {}, [ // Map Tiles Section
                cE('h3', { textContent: 'Map Tiles' }),
                cE('label', { for: 'tile-preset-sel', textContent: 'Tile Server Preset:' }),
                cE('select', { id: 'tile-preset-sel' },
                    C.TILE_SERVERS_PREDEFINED.map(p => cE('option', { value: p.name, textContent: p.name }))
                ),
                cE('label', { for: 'tile-url-in', textContent: 'Custom Tile URL Template:' }),
                cE('input', { type: 'url', id: 'tile-url-in', value: appState.settings.tileUrl }),
                cE('button', { id: 'save-tile-btn', textContent: 'Save Tiles' })
            ]),
            cE('hr'),
            cE('section', {}, [
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
            ]),
            cE('hr'),
            cE('section', {}, [ // Mute List Section
                cE('h3', { textContent: 'Mute List' }),
                cE('div', { id: 'mute-list' }),
                cE('input', { type: 'text', id: 'new-mute-pk-input', placeholder: 'npub... or hex pubkey' }),
                cE('button', { id: 'add-mute-btn', textContent: 'Add to Mute List' }),
                cE('button', { id: 'save-mute-list-btn', textContent: 'Save Mute List' })
            ]),
            cE('hr'),
            cE('section', {}, [
                cE('h3', { textContent: 'Data Management' }),
                cE('button', { id: 'clr-reps-btn', textContent: 'Clear Cached Reports' }),
                cE('button', { id: 'exp-setts-btn', textContent: 'Export Settings' }),
                cE('label', { for: 'imp-setts-file', textContent: 'Import Settings:' }),
                cE('input', { type: 'file', id: 'imp-setts-file', accept: '.json' })
            ]),
            cE('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' })
        );
        return sections;
    };

    createSettingsSections().forEach(el => modalContent.appendChild(el));

    // Render functions for lists
    const renderRelays = () => {
        const listElement = gE('#rly-list', modalContent);
        listElement.innerHTML = '';
        appStore.get().relays.forEach((rly, i) => {
            const relayEntry = cE('div', { class: 'relay-entry' }, [
                cE('input', { type: 'url', class: 'rly-url-in', value: rly.url, readOnly: true }),
                cE('label', {}, [cE('input', { type: 'checkbox', class: 'rly-read-cb', checked: rly.read, 'data-idx': i }), 'R']),
                cE('label', {}, [cE('input', { type: 'checkbox', class: 'rly-write-cb', checked: rly.write, 'data-idx': i }), 'W']),
                cE('span', { class: 'rly-stat', textContent: `(${rly.status})` }),
                cE('button', { class: 'remove-relay-btn', 'data-idx': i, textContent: 'X' })
            ]);

            if (rly.nip11) {
                const nip11Details = cE('details', { class: 'nip11-details' }, [
                    cE('summary', { textContent: 'NIP-11 Info' }),
                    cE('p', { innerHTML: `<strong>Name:</strong> ${sH(rly.nip11.name || 'N/A')}` }),
                    cE('p', { innerHTML: `<strong>Description:</strong> ${sH(rly.nip11.description || 'N/A')}` }),
                    cE('p', { innerHTML: `<strong>Pubkey:</strong> ${sH(rly.nip11.pubkey ? formatNpubShort(rly.nip11.pubkey) : 'N/A')}` }),
                    cE('p', { innerHTML: `<strong>Contact:</strong> ${sH(rly.nip11.contact || 'N/A')}` }),
                    cE('p', { innerHTML: `<strong>Supported NIPs:</strong> ${sH((rly.nip11.supported_nips || []).join(', ') || 'N/A')}` })
                ]);
                relayEntry.appendChild(nip11Details);
            } else {
                relayEntry.appendChild(cE('span', { class: 'nip11-info-na', textContent: 'NIP-11 Info N/A' }));
            }
            listElement.appendChild(relayEntry);
        });
    };

    const renderCategories = () => {
        const listElement = gE('#cat-list', modalContent);
        listElement.innerHTML = '';
        appStore.get().settings.cats.forEach((cat, i) => {
            listElement.appendChild(cE('div', { class: 'category-entry' }, [
                cE('input', { type: 'text', class: 'cat-name-in', value: cat, readOnly: true }),
                cE('button', { class: 'remove-category-btn', 'data-idx': i, textContent: 'X' })
            ]));
        });
    };

    const renderFocusTags = () => {
        const listElement = gE('#focus-tag-list', modalContent);
        listElement.innerHTML = '';
        appStore.get().focusTags.forEach((ft, i) => {
            listElement.appendChild(cE('div', { class: 'focus-tag-entry' }, [
                cE('label', {}, [cE('input', { type: 'radio', name: 'active-focus-tag', value: ft.tag, checked: ft.active, 'data-idx': i }), ` ${sH(ft.tag)}`]),
                cE('button', { class: 'remove-focus-tag-btn', 'data-idx': i, textContent: 'X' })
            ]));
        });
    };

    const renderMuteList = () => {
        const listElement = gE('#mute-list', modalContent);
        listElement.innerHTML = '';
        appStore.get().settings.mute.forEach((pk, i) => {
            listElement.appendChild(cE('div', { class: 'mute-entry' }, [
                cE('span', { textContent: formatNpubShort(pk) }),
                cE('button', { class: 'remove-mute-btn', 'data-idx': i, textContent: 'X' })
            ]));
        });
    };

    // Initial render of lists
    renderRelays();
    renderCategories();
    renderFocusTags();
    renderMuteList();

    // Event Listeners for Settings Panel
    const setupRelayListeners = () => {
        gE('#rly-list', modalContent).onclick = e => {
            const target = e.target;
            const index = parseInt(target.dataset.idx);
            let relays = [...appStore.get().relays];
            if (target.classList.contains('remove-relay-btn')) {
                relays.splice(index, 1);
            } else if (target.classList.contains('rly-read-cb')) {
                relays[index].read = target.checked;
            } else if (target.classList.contains('rly-write-cb')) {
                relays[index].write = target.checked;
            }
            appStore.set({ relays: relays });
            renderRelays();
        };

        gE('#add-rly-btn', modalContent).onclick = () => {
            const url = gE('#new-rly-url', modalContent).value.trim();
            if (!url) return showToast("Relay URL cannot be empty.", 'warning');
            if (!isValidUrl(url) || !url.startsWith('wss://')) return showToast("Invalid relay URL. Must be a valid wss:// URL.", 'warning');
            appStore.set(s => ({ relays: [...s.relays, { url, read: true, write: true, status: '?', nip11: null, supportsNip52: false }] }));
            gE('#new-rly-url', modalContent).value = '';
            renderRelays();
        };

        gE('#save-rlys-btn', modalContent).onclick = () => {
            confSvc.setRlys(appStore.get().relays);
            nostrSvc.discAllRlys();
            nostrSvc.connRlys();
            showToast("Relays saved and reconnected.", 'success');
        };
    };

    const setupKeyManagementListeners = () => {
        const expSkBtn = gE('#exp-sk-btn', modalContent);
        if (expSkBtn) {
            expSkBtn.onclick = async () => {
                const privateKey = await idSvc.getSk();
                if (privateKey) {
                    showToast(
                        `Your private key (nsec) has been copied to clipboard.`,
                        'warning',
                        5000, // Show for 5 seconds
                        nip19.nsecEncode(privateKey) // Pass the value to be copied
                    );
                } else {
                    showToast("Could not retrieve private key. Passphrase might be needed.", 'error');
                }
            };
        }

        const chgPassBtn = gE('#chg-pass-btn', modalContent);
        if (chgPassBtn) {
            chgPassBtn.onclick = async () => {
                const oldPass = gE('#chg-pass-old', modalContent).value;
                const newPass = gE('#chg-pass-new', modalContent).value;
                appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
                try {
                    await idSvc.chgPass(oldPass, newPass);
                    gE('#chg-pass-old', modalContent).value = '';
                    gE('#chg-pass-new', modalContent).value = '';
                } catch (e) {
                    showToast(e.message, 'error');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
                }
            };
        }
    };

    const setupFocusTagListeners = () => {
        gE('#focus-tag-list', modalContent).onclick = e => {
            const target = e.target;
            const index = parseInt(target.dataset.idx);
            let focusTags = [...appStore.get().focusTags];
            if (target.classList.contains('remove-focus-tag-btn')) {
                if (focusTags.length === 1) return showToast("Cannot remove the last focus tag.", 'warning');
                const removedTag = focusTags[index].tag;
                focusTags.splice(index, 1);
                if (removedTag === appStore.get().currentFocusTag) { // If removed active tag, set first as active
                    focusTags[0].active = true;
                    confSvc.setCurrentFocusTag(focusTags[0].tag);
                }
                confSvc.setFocusTags(focusTags);
            } else if (target.name === 'active-focus-tag') {
                focusTags.forEach((ft, i) => ft.active = (i === index));
                confSvc.setFocusTags(focusTags);
                confSvc.setCurrentFocusTag(focusTags[index].tag);
            }
            renderFocusTags();
        };

        gE('#add-focus-tag-btn', modalContent).onclick = () => {
            let newTag = gE('#new-focus-tag-input', modalContent).value.trim();
            if (!newTag) return showToast("Focus tag cannot be empty.", 'warning');
            if (!newTag.startsWith('#')) newTag = `#${newTag}`;
            const focusTags = [...appStore.get().focusTags];
            if (focusTags.some(ft => ft.tag === newTag)) return showToast("Tag already exists.", 'warning');
            focusTags.push({ tag: newTag, active: false });
            confSvc.setFocusTags(focusTags);
            gE('#new-focus-tag-input', modalContent).value = '';
            renderFocusTags();
        };

        gE('#save-focus-tags-btn', modalContent).onclick = () => {
            confSvc.setFocusTags(appStore.get().focusTags); // Ensure saved
            nostrSvc.refreshSubs(); // Resubscribe with potentially new active tag
            showToast("Focus tags saved.", 'success');
        };
    };

    const setupCategoryListeners = () => {
        gE('#cat-list', modalContent).onclick = e => {
            if (e.target.classList.contains('remove-category-btn')) {
                const index = parseInt(e.target.dataset.idx);
                const categories = [...appStore.get().settings.cats];
                categories.splice(index, 1);
                appStore.set(s => ({ ...s, settings: { ...s.settings, cats: categories } }));
                renderCategories();
            }
        };

        gE('#add-cat-btn', modalContent).onclick = () => {
            const newCategoryName = gE('#new-cat-name', modalContent).value.trim();
            if (newCategoryName) {
                appStore.set(s => ({ ...s, settings: { ...s.settings, cats: [...s.settings.cats, newCategoryName] } }));
                gE('#new-cat-name', modalContent).value = '';
                renderCategories();
            }
        };

        gE('#save-cats-btn', modalContent).onclick = () => {
            confSvc.setCats(appStore.get().settings.cats);
            showToast("Categories saved.", 'success');
        };
    };

    const setupMapTilesListeners = () => {
        gE('#tile-preset-sel', modalContent).onchange = e => {
            const selectedPresetName = e.target.value;
            const selectedPreset = C.TILE_SERVERS_PREDEFINED.find(p => p.name === selectedPresetName);
            if (selectedPreset) {
                gE('#tile-url-in', modalContent).value = selectedPreset.url;
                confSvc.setTilePreset(selectedPreset.name, selectedPreset.url);
                mapSvc.updTile(selectedPreset.url);
            } else { // Should not happen if options are from predefined list
                gE('#tile-url-in', modalContent).value = '';
                confSvc.setTilePreset('Custom', '');
            }
        };
        // Set initial value for preset selector
        gE('#tile-preset-sel', modalContent).value = appState.settings.tilePreset;
        if (gE('#tile-preset-sel', modalContent).value !== appState.settings.tilePreset) { // If current URL is custom, set preset to Custom
            const customOption = cE('option', { value: 'Custom', textContent: 'Custom' });
            gE('#tile-preset-sel', modalContent).appendChild(customOption);
            gE('#tile-preset-sel', modalContent).value = 'Custom';
        }

        gE('#save-tile-btn', modalContent).onclick = () => {
            const url = gE('#tile-url-in', modalContent).value.trim();
            if (url) {
                confSvc.setTileUrl(url); // This also sets preset to 'Custom'
                mapSvc.updTile(url);
                showToast("Tile server saved.", 'success');
            } else {
                showToast("Tile URL cannot be empty.", 'warning');
            }
        };
    };

    const setupImageHostListeners = () => {
        gE('#img-host-sel', modalContent).onchange = e => {
            const nip96Fields = gE('#nip96-fields', modalContent);
            nip96Fields.style.display = e.target.value === 'nip96' ? 'block' : 'none';
            if (e.target.value !== C.IMG_UPLOAD_NOSTR_BUILD) {
                gE('#nip96-url-in', modalContent).value = appStore.get().settings.nip96Host || '';
            } else {
                gE('#nip96-url-in', modalContent).value = '';
            }
            gE('#nip96-token-in', modalContent).value = appStore.get().settings.nip96Token || '';
        };

        gE('#save-img-host-btn', modalContent).onclick = () => {
            const selectedHost = gE('#img-host-sel', modalContent).value;
            if (selectedHost === 'nip96') {
                const hostUrl = gE('#nip96-url-in', modalContent).value.trim();
                const token = gE('#nip96-token-in', modalContent).value.trim();
                if (!hostUrl) return showToast("NIP-96 URL required.", 'warning');
                if (!isValidUrl(hostUrl) || (!hostUrl.startsWith('http://') && !hostUrl.startsWith('https://'))) {
                    return showToast("Invalid NIP-96 URL. Must be a valid http(s):// URL.", 'warning');
                }
                confSvc.setImgHost(hostUrl, true, token);
            } else {
                confSvc.setImgHost(C.IMG_UPLOAD_NOSTR_BUILD);
            }
            showToast("Image host saved.", 'success');
        };
    };

    const setupMuteListListeners = () => {
        gE('#mute-list', modalContent).onclick = e => {
            if (e.target.classList.contains('remove-mute-btn')) {
                const index = parseInt(e.target.dataset.idx);
                const muteList = [...appStore.get().settings.mute];
                confSvc.rmMute(muteList[index]); // Use the service to update and save
                renderMuteList(); // Re-render after update
            }
        };

        gE('#add-mute-btn', modalContent).onclick = async () => {
            let pubkeyInput = gE('#new-mute-pk-input', modalContent).value.trim();
            if (!pubkeyInput) return showToast("Pubkey cannot be empty.", 'warning');
            appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
            try {
                const pubkeyHex = npubToHex(pubkeyInput); // Convert npub to hex if needed
                if (!isNostrId(pubkeyHex)) throw new Error("Invalid Nostr ID format (must be 64 hex characters).");
                confSvc.addMute(pubkeyHex); // This saves to DB and updates store
                gE('#new-mute-pk-input', modalContent).value = '';
                renderMuteList();
                showToast("Pubkey added to mute list.", 'success');
            } catch (e) {
                showToast(`Error adding pubkey to mute list: ${e.message}`, 'error');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
            }
        };

        gE('#save-mute-list-btn', modalContent).onclick = () => {
            // Mute list is saved immediately by addMute/rmMute, this button just confirms
            showToast("Mute list saved.", 'success');
        };
    };

    const setupDataManagementListeners = () => {
        gE('#clr-reps-btn', modalContent).onclick = async () => {
            showConfirmModal(
                "Clear All Cached Reports?",
                "Are you sure you want to clear ALL cached reports from your device? This action cannot be undone.",
                async () => {
                    await dbSvc.clearReps();
                    appStore.set({ reports: [] });
                    showToast("All cached reports cleared.", 'success');
                },
                () => showToast("Clearing reports cancelled.", 'info')
            );
        };

        gE('#exp-setts-btn', modalContent).onclick = async () => {
            appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
            try {
                const settings = await dbSvc.loadSetts();
                if (settings) {
                    const json = JSON.stringify(settings, null, 2);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const anchor = cE('a', { href: url, download: 'nm-setts.json' });
                    document.body.appendChild(anchor);
                    anchor.click();
                    document.body.removeChild(anchor);
                    URL.revokeObjectURL(url);
                    showToast("Settings exported.", 'success');
                } else {
                    showToast("No settings to export.", 'info');
                }
            } catch (e) {
                showToast(`Error exporting settings: ${e.message}`, 'error');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
            }
        };

        gE('#imp-setts-file', modalContent).onchange = async e => {
            const file = e.target.files[0];
            if (file) {
                appStore.set(s => ({ ui: { ...s.ui, loading: true } })); // Start loading
                const reader = new FileReader();
                reader.onload = async ev => {
                    try {
                        const importedSettings = JSON.parse(ev.target.result);
                        // Basic validation for imported settings
                        if (importedSettings.rls && importedSettings.tileUrl) {
                            await confSvc.save(importedSettings);
                            showToast("Settings imported. Reconnecting relays...", 'success');
                            nostrSvc.discAllRlys();
                            nostrSvc.connRlys();
                            mapSvc.updTile(importedSettings.tileUrl);
                            hideModal('settings-modal');
                            // Reopen settings modal to refresh its content with new settings
                            setTimeout(() => { gE('#settings-btn').click() }, 100);
                        } else {
                            throw new Error("Invalid settings file format.");
                        }
                    } catch (error) {
                        showToast(`Import error: ${error.message}`, 'error');
                    } finally {
                        appStore.set(s => ({ ui: { ...s.ui, loading: false } })); // End loading
                    }
                };
                reader.readAsText(file);
                e.target.value = ''; // Clear file input
            }
        };
    };

    // Call all setup functions
    setupRelayListeners();
    setupKeyManagementListeners();
    setupFocusTagListeners();
    setupCategoryListeners();
    setupMapTilesListeners();
    setupImageHostListeners();
    setupMuteListListeners();
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

    // Fetch profile for NIP-05 display
    const profile = await nostrSvc.fetchProf(report.pk);
    const authorDisplay = profile?.nip05 ? sH(profile.nip05) : formatNpubShort(report.pk);

    detailContainer.innerHTML = `<button id="back-to-list-btn" class="small-button">&lt; List</button><h2 id="detail-title">${sH(report.title || 'Report')}</h2>
    <p><strong>By:</strong> <a href="https://njump.me/${nip19.npubEncode(report.pk)}" target="_blank" rel="noopener noreferrer">${authorDisplay}</a></p>
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

    if (report.lat && report.lon && typeof L !== 'undefined') {
        const miniMap = L.map('mini-map-det').setView([report.lat, report.lon], 13);
        L.tileLayer(confSvc.getTileServer(), { attribution: '&copy; OSM' }).addTo(miniMap);
        // Invalidate size to ensure map renders correctly in a hidden div
        setTimeout(() => { miniMap.invalidateSize(); }, 0);
    }
    loadAndDisplayInteractions(report.id, report.pk, gE(`#interactions-for-${report.id}`, detailContainer));
};

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
let _cFilt = { q: '', fT: '', cat: '', auth: '', tStart: null, tEnd: null }; /* cFilt: currentFilters */

const applyAllFilters = () => {
    const allReports = appStore.get().reports;
    const mutedPubkeys = appStore.get().settings.mute;

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
            gE('#report-form-modal').appendChild(RepFormComp());
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
            _cFilt = { q: '', fT: appStore.get().currentFocusTag, cat: '', auth: '', tStart: null, tEnd: null };
            gE('#search-query-input').value = '';
            gE('#focus-tag-input').value = _cFilt.fT;
            gE('#filter-category').value = '';
            gE('#filter-author').value = '';
            gE('#filter-time-start').value = '';
            gE('#filter-time-end').value = '';
            applyAllFilters();
        };
    };

    // Setup appStore listeners for UI updates
    const setupAppStoreListeners = () => {
        appStore.on((newState, oldState) => {
            updAuthDisp(newState.user?.pk);
            updConnDisp(newState.online);
            updSyncDisp();

            // Re-apply filters if reports, mute list, or current focus tag changes
            if (newState.reports !== oldState?.reports ||
                newState.settings.mute !== oldState?.settings?.mute ||
                newState.currentFocusTag !== oldState?.currentFocusTag) {
                if (newState.currentFocusTag !== _cFilt.fT) {
                    _cFilt.fT = newState.currentFocusTag;
                    gE('#focus-tag-input').value = _cFilt.fT;
                }
                applyAllFilters();
            }

            // Re-populate categories if settings change
            if (newState.settings.cats !== oldState?.settings?.cats) {
                gE('#filter-category').innerHTML = '<option value="">All</option>'; // Clear existing options
                newState.settings.cats.forEach(c => gE('#filter-category').appendChild(cE('option', { value: c, textContent: sH(c) })));
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
        localStorage.setItem(C.ONBOARDING_KEY, 'true'); // Set it after showing
    }
} // End initUI
