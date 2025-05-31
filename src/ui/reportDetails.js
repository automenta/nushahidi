import {marked} from 'marked';
import {appStore} from '../store.js';
import {confSvc, nostrSvc} from '../services.js';
import {$, $$, C, createEl, formatNpubShort, sanitizeHTML, showToast} from '../utils.js';
import {hideModal, showConfirmModal} from './modals.js';
import {renderForm} from './forms.js';
import {RepFormComp} from './reportForm.js';
import {applyAllFilters} from './filters.js';
import { nip19 } from 'nostr-tools';
import {withLoading, withToast} from '../decorators.js';

async function handleReactionSubmit(event) {
    const btn = event.target;
    const { reportId, reportPk, reaction } = btn.dataset;
    if (!appStore.get().user) {
        showToast("Please connect your Nostr identity to react.", 'warning');
        return;
    }

    await withLoading(withToast(async () => {
        btn.disabled = true;
        await nostrSvc.pubEv({
            kind: C.NOSTR_KIND_REACTION,
            content: reaction,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
        await showReportDetails(appStore.get().reports.find(r => r.id === reportId));
    }, "Reaction sent!", "Error sending reaction", () => { btn.disabled = false; }))();
}

async function handleCommentSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const { reportId, reportPk } = form.dataset;
    const commentText = form.elements.comment.value.trim();
    if (!commentText) {
        showToast("Comment cannot be empty.", 'warning');
        return;
    }
    if (!appStore.get().user) {
        showToast("Please connect your Nostr identity to comment.", 'warning');
        return;
    }

    await withLoading(withToast(async () => {
        submitBtn.disabled = true;
        await nostrSvc.pubEv({
            kind: C.NOSTR_KIND_NOTE,
            content: commentText,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
        form.reset();
        await showReportDetails(appStore.get().reports.find(r => r.id === reportId));
    }, "Comment sent!", "Error sending comment", () => { submitBtn.disabled = false; }))();
}

const renderReportImages = images => (images || []).map(img =>
    `<img src="${sanitizeHTML(img.url)}" alt="report image" style="max-width:100%;margin:.3rem 0;border-radius:4px;">`
).join('');

const renderAuthorInfo = (report, profile, isFollowed, canFollow) => {
    const authorDisplay = profile?.name || (profile?.nip05 ? sanitizeHTML(profile.nip05) : formatNpubShort(report.pk));
    const authorPicture = profile?.picture ? `<img src="${sanitizeHTML(profile.picture)}" alt="Profile Picture" class="profile-picture">` : '';
    const authorAbout = profile?.about ? `<p class="profile-about">${sanitizeHTML(profile.about)}</p>` : '';
    const authorNip05 = profile?.nip05 ? `<span class="nip05-verified">${sanitizeHTML(profile.nip05)} ✅</span>` : '';

    return `
        <div class="report-author-info">
            ${authorPicture}
            <p><strong>By:</strong> <a href="https://njump.me/${nip19.npubEncode(report.pk)}" target="_blank" rel="noopener noreferrer">${authorDisplay}</a> ${authorNip05}</p>
            ${authorAbout}
            ${canFollow ? `<button id="follow-toggle-btn" class="small-button ${isFollowed ? 'unfollow-button' : 'follow-button'}" data-pubkey="${sanitizeHTML(report.pk)}">${isFollowed ? 'Unfollow' : 'Follow'}</button>` : ''}
        </div>
    `;
};

const renderReportDetailHtml = (report, profile, isAuthor, isFollowed, canFollow) => `
    <button id="back-to-list-btn" class="small-button">&lt; List</button>
    ${isAuthor ? `<button id="edit-report-btn" class="small-button edit-button" data-report-id="${sanitizeHTML(report.id)}" style="float:right;">Edit Report</button>` : ''}
    ${isAuthor ? `<button id="delete-report-btn" class="small-button delete-button" data-report-id="${sanitizeHTML(report.id)}" style="float:right; margin-right: 0.5rem;">Delete Report</button>` : ''}
    <h2 id="detail-title">${sanitizeHTML(report.title || 'Report')}</h2>
    ${renderAuthorInfo(report, profile, isFollowed, canFollow)}
    <p><strong>Date:</strong> ${new Date(report.at * 1000).toLocaleString()}</p>
    <p><strong>Summary:</strong> ${sanitizeHTML(report.sum || 'N/A')}</p>
    <p><strong>Description:</strong></p><div class="markdown-content" tabindex="0">${marked.parse(sanitizeHTML(report.ct || ''))}</div>
    ${renderReportImages(report.imgs) ? `<h3>Images:</h3>${renderReportImages(report.imgs)}` : ''}
    <p><strong>Location:</strong> ${report.lat?.toFixed(5)}, ${report.lon?.toFixed(5)} (Geohash: ${sanitizeHTML(report.gh || 'N/A')})</p>
    <div id="mini-map-det" style="height:150px;margin-top:.7rem;border:1px solid #ccc"></div>
    <div class="interactions" id="interactions-for-${report.id}">Loading interactions...</div>
`;

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

    if (canFollow) $('#follow-toggle-btn', detailContainer).onclick = handleFollowToggle;
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
        isCurrentlyFollowed ? await confSvc.rmFollowed(pubkeyToToggle) : confSvc.addFollowed(pubkeyToToggle);
        return isCurrentlyFollowed ? `Unfollowed ${formatNpubShort(pubkeyToToggle)}.` : `Followed ${formatNpubShort(pubkeyToToggle)}!`;
    }, null, "Error toggling follow status", () => { btn.disabled = false; }))();

    await showReportDetails(appStore.get().reports.find(r => r.pk === pubkeyToToggle));
}

function renderInteractionItem(interaction) {
    const interactionUser = formatNpubShort(interaction.pubkey);
    const interactionTime = new Date(interaction.created_at * 1000).toLocaleString();
    const contentHtml = interaction.kind === C.NOSTR_KIND_REACTION ?
        `<strong>${sanitizeHTML(interactionUser)}</strong> reacted: ${sanitizeHTML(interaction.content)} <small>(${interactionTime})</small>` :
        `<strong>${sanitizeHTML(interactionUser)}</strong> commented: ${marked.parse(sanitizeHTML(interaction.content))} <small>(${interactionTime})</small>`;

    return createEl('div', { class: 'interaction-item', innerHTML: contentHtml });
}

function renderInteractionsContent(interactions) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(createEl('h4', { textContent: 'Interactions' }));

    if (!interactions.length) fragment.appendChild(createEl('p', { textContent: 'No interactions yet.' }));
    else interactions.forEach(i => fragment.appendChild(renderInteractionItem(i)));
    return fragment;
}

function setupInteractionControls(reportId, reportPk, container) {
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

    container.appendChild(reactionButtonsDiv);
    container.appendChild(commentForm);

    $$('.reaction-buttons button', container).forEach(btn => btn.onclick = handleReactionSubmit);
}

async function loadAndDisplayInteractions(reportId, reportPk, container) {
    container.innerHTML = '<h4>Interactions</h4><div class="spinner"></div>';
    await withLoading(withToast(async () => {
        const interactions = await nostrSvc.fetchInteractions(reportId, reportPk);

        container.innerHTML = '';
        container.appendChild(renderInteractionsContent(interactions));
        setupInteractionControls(reportId, reportPk, container);

        appStore.set(s => {
            const reportIndex = s.reports.findIndex(rep => rep.id === reportId);
            if (reportIndex > -1) {
                const updatedReports = [...s.reports];
                updatedReports[reportIndex] = { ...updatedReports[reportIndex], interactions };
                return { reports: updatedReports };
            }
            return {};
        });
    }, null, "Error loading interactions"))();
}

function initializeMiniMap(report) {
    if (report.lat && report.lon && typeof L !== 'undefined') {
        const miniMap = L.map('mini-map-det').setView([report.lat, report.lon], 13);
        L.tileLayer(confSvc.getTileServer(), { attribution: '&copy; OSM' }).addTo(miniMap);
        setTimeout(() => miniMap.invalidateSize(), 0);
    }
}

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
    initializeMiniMap(report);
    await loadAndDisplayInteractions(report.id, report.pk, $(`#interactions-for-${report.id}`, detailContainer));
};
