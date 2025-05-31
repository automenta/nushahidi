import { marked } from 'marked';
import { appStore } from '../store.js';
import { mapSvc, nostrSvc, confSvc } from '../services.js';
import { C, $, $$, createEl, sanitizeHTML, formatNpubShort, npubToHex, showToast } from '../utils.js';
import { showConfirmModal, hideModal, showModal } from './modals.js';
import { renderForm } from './forms.js';
import { RepFormComp } from './reportForm.js';
import { applyAllFilters } from './filters.js'; // Needed for deletion to re-filter
import { nip19 } from 'nostr-tools'; // For njump.me link

const rendRepCard = report => {
    const summary = report.sum || (report.ct ? report.ct.substring(0, 100) + '...' : 'N/A');
    return `<div class="report-card" data-rep-id="${sanitizeHTML(report.id)}" role="button" tabindex="0" aria-labelledby="card-title-${report.id}">
        <h3 id="card-title-${report.id}">${sanitizeHTML(report.title || 'Report')}</h3><p>${sanitizeHTML(summary)}</p>
        <small>By: ${formatNpubShort(report.pk)} | ${new Date(report.at * 1000).toLocaleDateString()}</small>
        <small>Cats: ${report.cat.map(sanitizeHTML).join(', ') || 'N/A'}</small></div>`;
};

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
                    html += `<div class="interaction-item"><strong>${sanitizeHTML(interactionUser)}</strong> reacted: ${sanitizeHTML(i.content)} <small>(${interactionTime})</small></div>`;
                } else if (i.kind === C.NOSTR_KIND_NOTE) { // Text note comment
                    html += `<div class="interaction-item"><strong>${sanitizeHTML(interactionUser)}</strong> commented: <div class="markdown-content">${marked.parse(sanitizeHTML(i.content))}</div> <small>(${interactionTime})</small></div>`;
                }
            });
        }
        // Add reaction buttons
        const reactionButtonsDiv = createEl('div', { class: 'reaction-buttons', style: 'margin-top:0.5rem;' });
        reactionButtonsDiv.appendChild(createEl('button', { 'data-report-id': sanitizeHTML(reportId), 'data-report-pk': sanitizeHTML(reportPk), 'data-reaction': '+', textContent: '👍 Like' }));
        reactionButtonsDiv.appendChild(createEl('button', { 'data-report-id': sanitizeHTML(reportId), 'data-report-pk': sanitizeHTML(reportPk), 'data-reaction': '-', textContent: '👎 Dislike' }));

        // Define comment form fields
        const commentFormFields = [
            { type: 'textarea', name: 'comment', placeholder: 'Add a public comment...', rows: 2, required: true },
            { type: 'button', buttonType: 'submit', label: 'Post Comment' }
        ];

        // Render comment form using renderForm
        const commentForm = renderForm(commentFormFields, {}, {
            id: 'comment-form',
            onSubmit: handleCommentSubmit,
            'data-report-id': sanitizeHTML(reportId),
            'data-report-pk': sanitizeHTML(reportPk),
            style: 'margin-top:0.5rem;'
        });

        container.innerHTML = html; // Set the static HTML content first
        container.appendChild(reactionButtonsDiv); // Append reaction buttons
        container.appendChild(commentForm); // Append the dynamically rendered form

        // Add event listeners for new buttons/forms
        $$('.reaction-buttons button', container).forEach(btn => btn.onclick = handleReactionSubmit);

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
        container.innerHTML = `<h4>Interactions</h4><p style="color:red;">Failed to load interactions: ${sanitizeHTML(e.message)}</p>`;
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
        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
    }
}

/**
 * Generates the HTML content for the report details view.
 * @param {object} report - The report object.
 * @param {object} profile - The author's profile object.
 * @param {boolean} isAuthor - True if the current user is the report author.
 * @param {boolean} isFollowed - True if the author is currently followed.
 * @param {boolean} canFollow - True if the current user can follow/unfollow the author.
 * @returns {string} The HTML string for the report details.
 */
const _renderReportDetailHtml = (report, profile, isAuthor, isFollowed, canFollow) => {
    const imagesHtml = (report.imgs || []).map(img =>
        `<img src="${sanitizeHTML(img.url)}" alt="report image" style="max-width:100%;margin:.3rem 0;border-radius:4px;">`
    ).join('');
    const descriptionHtml = marked.parse(sanitizeHTML(report.ct || ''));

    const authorDisplay = profile?.name || (profile?.nip05 ? sanitizeHTML(profile.nip05) : formatNpubShort(report.pk));
    const authorPicture = profile?.picture ? `<img src="${sanitizeHTML(profile.picture)}" alt="Profile Picture" class="profile-picture">` : '';
    const authorAbout = profile?.about ? `<p class="profile-about">${sanitizeHTML(profile.about)}</p>` : '';
    const authorNip05 = profile?.nip05 ? `<span class="nip05-verified">${sanitizeHTML(profile.nip05)} ✅</span>` : '';

    return `
        <button id="back-to-list-btn" class="small-button">&lt; List</button>
        ${isAuthor ? `<button id="edit-report-btn" class="small-button edit-button" data-report-id="${sanitizeHTML(report.id)}" style="float:right;">Edit Report</button>` : ''}
        ${isAuthor ? `<button id="delete-report-btn" class="small-button delete-button" data-report-id="${sanitizeHTML(report.id)}" style="float:right; margin-right: 0.5rem;">Delete Report</button>` : ''}
        <h2 id="detail-title">${sanitizeHTML(report.title || 'Report')}</h2>
        <div class="report-author-info">
            ${authorPicture}
            <p><strong>By:</strong> <a href="https://njump.me/${nip19.npubEncode(report.pk)}" target="_blank" rel="noopener noreferrer">${authorDisplay}</a> ${authorNip05}</p>
            ${authorAbout}
            ${canFollow ? `<button id="follow-toggle-btn" class="small-button ${isFollowed ? 'unfollow-button' : 'follow-button'}" data-pubkey="${sanitizeHTML(report.pk)}">${isFollowed ? 'Unfollow' : 'Follow'}</button>` : ''}
        </div>
        <p><strong>Date:</strong> ${new Date(report.at * 1000).toLocaleString()}</p>
        <p><strong>Summary:</strong> ${sanitizeHTML(report.sum || 'N/A')}</p>
        <p><strong>Description:</strong></p><div class="markdown-content" tabindex="0">${descriptionHtml}</div>
        ${imagesHtml ? `<h3>Images:</h3>${imagesHtml}` : ''}
        <p><strong>Location:</strong> ${report.lat?.toFixed(5)}, ${report.lon?.toFixed(5)} (Geohash: ${sanitizeHTML(report.gh || 'N/A')})</p>
        <div id="mini-map-det" style="height:150px;margin-top:.7rem;border:1px solid #ccc"></div>
        <div class="interactions" id="interactions-for-${report.id}">Loading interactions...</div>
    `;
};

/**
 * Sets up event listeners for buttons in the report details view.
 * @param {object} report - The report object.
 * @param {boolean} isAuthor - True if the current user is the report author.
 * @param {boolean} canFollow - True if the current user can follow/unfollow the author.
 * @param {HTMLElement} detailContainer - The report detail container element.
 * @param {HTMLElement} listContainer - The report list container element.
 */
const _setupReportDetailEventListeners = (report, isAuthor, canFollow, detailContainer, listContainer) => {
    $('#back-to-list-btn', detailContainer).onclick = () => { detailContainer.style.display = 'none'; listContainer.style.display = 'block' };

    if (isAuthor) {
        $('#edit-report-btn', detailContainer).onclick = () => {
            $('#report-form-modal').innerHTML = '';
            $('#report-form-modal').appendChild(RepFormComp(report)); // Pass the report for editing
            showModal('report-form-modal', 'rep-title');
        };
        $('#delete-report-btn', detailContainer).onclick = () => {
            showConfirmModal(
                "Delete Report",
                `Are you sure you want to delete the report "${sanitizeHTML(report.title || report.id.substring(0, 8) + '...')}"? This action publishes a deletion event to relays.`,
                async () => {
                    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                    try {
                        await nostrSvc.deleteEv(report.id); // Call the new deleteEv method
                        // The deleteEv method already updates appStore and DB, and shows toast
                        hideModal('report-detail-container'); // Hide detail view after deletion
                        listContainer.style.display = 'block'; // Show list view
                        applyAllFilters(); // Re-apply filters to remove deleted report from list/map
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
        $('#follow-toggle-btn', detailContainer).onclick = handleFollowToggle;
    }
};

export const showReportDetails = async report => {
    const detailContainer = $('#report-detail-container');
    const listContainer = $('#report-list-container');
    if (!detailContainer || !listContainer) return;

    listContainer.style.display = 'none';

    // Fetch profile for NIP-05 display and other details
    const profile = await nostrSvc.fetchProf(report.pk);

    const currentUserPk = appStore.get().user?.pk;
    const isAuthor = currentUserPk && currentUserPk === report.pk;
    const isFollowed = appStore.get().followedPubkeys.some(f => f.pk === report.pk);
    const canFollow = currentUserPk && currentUserPk !== report.pk; // Can follow if logged in and not self

    detailContainer.innerHTML = _renderReportDetailHtml(report, profile, isAuthor, isFollowed, canFollow);

    detailContainer.style.display = 'block';
    detailContainer.focus();

    _setupReportDetailEventListeners(report, isAuthor, canFollow, detailContainer, listContainer);

    if (report.lat && report.lon && typeof L !== 'undefined') {
        const miniMap = L.map('mini-map-det').setView([report.lat, report.lon], 13);
        L.tileLayer(confSvc.getTileServer(), { attribution: '&copy; OSM' }).addTo(miniMap);
        // Invalidate size to ensure map renders correctly in a hidden div
        setTimeout(() => { miniMap.invalidateSize(); }, 0);
    }
    loadAndDisplayInteractions(report.id, report.pk, $(`#interactions-for-${report.id}`, detailContainer));
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

export const rendRepList = reports => {
    const listElement = $('#report-list');
    const listContainer = $('#report-list-container');
    if (!listElement || !listContainer) return;

    listElement.innerHTML = '';
    if (reports.length > 0) {
        reports.forEach(report => {
            const cardWrapper = createEl('div');
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
