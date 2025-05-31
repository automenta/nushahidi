import { marked } from 'marked';
import { appStore } from '../store.js';
import { mapSvc, nostrSvc, confSvc } from '../services.js';
import { C, $, $$, createEl, sanitizeHTML, formatNpubShort, npubToHex, showToast } from '../utils.js';
import { showConfirmModal, hideModal, showModal } from './modals.js';
import { renderForm } from './forms.js';
import { RepFormComp } from './reportForm.js';
import { applyAllFilters } from './filters.js';
import { nip19 } from 'nostr-tools';

// Helper for loading state and toasts (duplicated from services.js, but necessary to avoid circular dependency)
const withLoading = (fn) => async (...args) => {
    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
    try {
        return await fn(...args);
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
    }
};

const withToast = (fn, successMsg, errorMsg, onErrorCallback = null) => async (...args) => {
    try {
        const result = await fn(...args);
        if (successMsg) showToast(successMsg, 'success');
        return result;
    } catch (e) {
        showToast(`${errorMsg || 'An error occurred'}: ${e.message}`, 'error');
        if (onErrorCallback) onErrorCallback(e);
        throw e; // Re-throw to allow further error handling if needed
    }
};

const rendRepCard = report => {
    const summary = report.sum || (report.ct ? report.ct.substring(0, 100) + '...' : 'N/A');
    return `<div class="report-card" data-rep-id="${sanitizeHTML(report.id)}" role="button" tabindex="0" aria-labelledby="card-title-${report.id}">
        <h3 id="card-title-${report.id}">${sanitizeHTML(report.title || 'Report')}</h3><p>${sanitizeHTML(summary)}</p>
        <small>By: ${formatNpubShort(report.pk)} | ${new Date(report.at * 1000).toLocaleDateString()}</small>
        <small>Cats: ${report.cat.map(sanitizeHTML).join(', ') || 'N/A'}</small></div>`;
};

async function loadAndDisplayInteractions(reportId, reportPk, container) {
    // Display a spinner while loading
    container.innerHTML = '<h4>Interactions</h4><div class="spinner"></div>';
    await withLoading(withToast(async () => {
        const interactions = await nostrSvc.fetchInteractions(reportId, reportPk);

        const fragment = document.createDocumentFragment();
        fragment.appendChild(createEl('h4', { textContent: 'Interactions' }));

        if (interactions.length === 0) {
            fragment.appendChild(createEl('p', { textContent: 'No interactions yet.' }));
        } else {
            interactions.forEach(i => {
                const interactionUser = formatNpubShort(i.pubkey);
                const interactionTime = new Date(i.created_at * 1000).toLocaleString();
                let interactionItemContent;

                if (i.kind === C.NOSTR_KIND_REACTION) {
                    interactionItemContent = createEl('div', {
                        innerHTML: `<strong>${sanitizeHTML(interactionUser)}</strong> reacted: ${sanitizeHTML(i.content)} <small>(${interactionTime})</small>`
                    });
                } else if (i.kind === C.NOSTR_KIND_NOTE) {
                    const markdownContent = createEl('div', { class: 'markdown-content', innerHTML: marked.parse(sanitizeHTML(i.content)) });
                    interactionItemContent = createEl('div', {}, [
                        createEl('strong', { textContent: interactionUser }),
                        document.createTextNode(' commented: '),
                        markdownContent,
                        createEl('small', { textContent: `(${interactionTime})` })
                    ]);
                }
                if (interactionItemContent) {
                    interactionItemContent.classList.add('interaction-item');
                    fragment.appendChild(interactionItemContent);
                }
            });
        }

        const reactionButtonsDiv = createEl('div', { class: 'reaction-buttons', style: 'margin-top:0.5rem;' });
        reactionButtonsDiv.appendChild(createEl('button', { 'data-report-id': sanitizeHTML(reportId), 'data-report-pk': sanitizeHTML(reportPk), 'data-reaction': '+', textContent: '👍 Like' }));
        reactionButtonsDiv.appendChild(createEl('button', { 'data-report-id': sanitizeHTML(reportId), 'data-report-pk': sanitizeHTML(reportPk), 'data-reaction': '-', textContent: '👎 Dislike' }));

        const commentFormFields = [
            { type: 'textarea', name: 'comment', placeholder: 'Add a public comment...', rows: 2, required: true },
            { type: 'button', buttonType: 'submit', label: 'Post Comment' }
        ];

        const commentForm = renderForm(commentFormFields, {}, {
            id: 'comment-form',
            onSubmit: handleCommentSubmit,
            'data-report-id': sanitizeHTML(reportId),
            'data-report-pk': sanitizeHTML(reportPk),
            style: 'margin-top:0.5rem;'
        });

        // Clear container and append the fragment once
        container.innerHTML = '';
        container.appendChild(fragment);

        $$('.reaction-buttons button', container).forEach(btn => btn.onclick = handleReactionSubmit);

        appStore.set(s => {
            const reportIndex = s.reports.findIndex(rep => rep.id === reportId);
            if (reportIndex > -1) {
                const updatedReports = [...s.reports];
                updatedReports[reportIndex] = { ...updatedReports[reportIndex], interactions: interactions };
                return { reports: updatedReports };
            }
            return {};
        });
    }, null, "Error loading interactions"))();
}

async function handleReactionSubmit(event) {
    const btn = event.target;
    const reportId = btn.dataset.reportId;
    const reportPk = btn.dataset.reportPk;
    const reactionContent = btn.dataset.reaction;
    if (!appStore.get().user) return showToast("Please connect your Nostr identity to react.", 'warning');

    await withLoading(withToast(async () => {
        btn.disabled = true;
        await nostrSvc.pubEv({
            kind: C.NOSTR_KIND_REACTION,
            content: reactionContent,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
        const report = appStore.get().reports.find(r => r.id === reportId);
        if (report) showReportDetails(report);
    }, "Reaction sent!", "Error sending reaction", () => {
        btn.disabled = false;
    }))();
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

    await withLoading(withToast(async () => {
        submitBtn.disabled = true;
        await nostrSvc.pubEv({
            kind: C.NOSTR_KIND_NOTE,
            content: commentText,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
        form.reset();
        const report = appStore.get().reports.find(r => r.id === reportId);
        if (report) showReportDetails(report);
    }, "Comment sent!", "Error sending comment", () => {
        submitBtn.disabled = false;
    }))();
}

const renderReportDetailHtml = (report, profile, isAuthor, isFollowed, canFollow) => {
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

const setupReportDetailEventListeners = (report, isAuthor, canFollow, detailContainer, listContainer) => {
    $('#back-to-list-btn', detailContainer).onclick = () => { detailContainer.style.display = 'none'; listContainer.style.display = 'block' };

    if (isAuthor) {
        $('#edit-report-btn', detailContainer).onclick = () => {
            $('#report-form-modal').innerHTML = '';
            $('#report-form-modal').appendChild(RepFormComp(report));
            showModal('report-form-modal', 'rep-title');
        };
        $('#delete-report-btn', detailContainer).onclick = () => {
            showConfirmModal(
                "Delete Report",
                `Are you sure you want to delete the report "${sanitizeHTML(report.title || report.id.substring(0, 8) + '...')}"? This action publishes a deletion event to relays.`,
                withLoading(withToast(async () => {
                    await nostrSvc.deleteEv(report.id);
                    hideModal('report-detail-container');
                    listContainer.style.display = 'block';
                    applyAllFilters();
                }, null, "Failed to delete report")),
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

    const profile = await nostrSvc.fetchProf(report.pk);

    const currentUserPk = appStore.get().user?.pk;
    const isAuthor = currentUserPk && currentUserPk === report.pk;
    const isFollowed = appStore.get().followedPubkeys.some(f => f.pk === report.pk);
    const canFollow = currentUserPk && currentUserPk !== report.pk;

    detailContainer.innerHTML = renderReportDetailHtml(report, profile, isAuthor, isFollowed, canFollow);

    detailContainer.style.display = 'block';
    detailContainer.focus();

    setupReportDetailEventListeners(report, isAuthor, canFollow, detailContainer, listContainer);

    if (report.lat && report.lon && typeof L !== 'undefined') {
        const miniMap = L.map('mini-map-det').setView([report.lat, report.lon], 13);
        L.tileLayer(confSvc.getTileServer(), { attribution: '&copy; OSM' }).addTo(miniMap);
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

    await withLoading(withToast(async () => {
        btn.disabled = true;
        if (isCurrentlyFollowed) {
            confSvc.rmFollowed(pubkeyToToggle);
            return `Unfollowed ${formatNpubShort(pubkeyToToggle)}.`;
        } else {
            confSvc.addFollowed(pubkeyToToggle);
            return `Followed ${formatNpubShort(pubkeyToToggle)}!`;
        }
    }, null, "Error toggling follow status", () => {
        btn.disabled = false;
    }))();

    // Re-render report details to update follow button state
    const report = appStore.get().reports.find(r => r.pk === pubkeyToToggle);
    if (report) showReportDetails(report);
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
