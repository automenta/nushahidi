import {marked} from 'marked';
import {appStore} from '../../store.js';
import {confSvc, nostrSvc} from '../../services.js';
import {C, createEl, formatNpubShort, sanitizeHTML, showToast} from '../../utils.js';
import {Modal, showConfirmModal} from '../modals.js';
import {renderForm} from '../forms.js';
import {applyAllFilters} from './FilterControls.js';
import {nip19} from 'nostr-tools';
import {withLoading, withToast} from '../../decorators.js';
import {InteractionItem} from './InteractionItem.js';

export class ReportDetailsModal extends Modal {
    constructor(report, reportFormModal) {
        const contentRenderer = () => {
            this.modalContentContainer = createEl('div', {class: 'report-detail-container'});
            this.renderContent(report, this.modalContentContainer);
            return this.modalContentContainer;
        };
        super('report-detail-modal', report.title || 'Report Details', contentRenderer);
        this.report = report;
        this.reportFormModal = reportFormModal;
        this.modalContentContainer = null;

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.ui.reportIdToView === this.report.id && newState.reports !== oldState?.reports) {
                const updatedReport = newState.reports.find(r => r.id === this.report.id);
                if (updatedReport) {
                    this.report = updatedReport;
                    this.renderContent(this.report, this.modalContentContainer);
                }
            }
        });
    }

    hide() {
        super.hide();
        this.unsubscribe();
    }

    async renderContent(report, container) {
        const profilePromise = nostrSvc.fetchProf(report.pk);
        const profile = await profilePromise;
        const currentUserPk = appStore.get().user?.pk;
        const isAuthor = currentUserPk && currentUserPk === report.pk;
        const isFollowed = appStore.get().followedPubkeys.some(f => f.pk === report.pk);
        const canFollow = currentUserPk && currentUserPk !== report.pk;

        container.innerHTML = this.renderReportDetailHtml(report, profile, isAuthor, isFollowed, canFollow);

        this.setupReportDetailEventListeners(report, isAuthor, canFollow, container);
        this.initializeMiniMap(report, container.querySelector('.mini-map-det'));
        this.loadAndDisplayInteractions(report.id, report.pk, container.querySelector('.interactions'));
    }

    async submitInteraction(kind, content, reportId, reportPk) {
        if (!appStore.get().user) throw new Error("Please connect your Nostr identity to interact.");

        await nostrSvc.pubEv({
            kind,
            content,
            tags: [['e', reportId], ['p', reportPk], ['t', appStore.get().currentFocusTag.substring(1) || 'NostrMapper_Global']]
        });
    }

    handleReactionSubmit = async event => {
        const btn = event.target;
        const {reportId, reportPk, reaction} = btn.dataset;
        await withLoading(withToast(async () => {
            await this.submitInteraction(C.NOSTR_KIND_REACTION, reaction, reportId, reportPk);
        }, "Reaction sent!", "Error sending reaction", () => btn.disabled = false))();
    };

    handleCommentSubmit = async event => {
        event.preventDefault();
        const form = event.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const {reportId, reportPk} = form.dataset;
        const commentText = form.elements.comment.value.trim();
        if (!commentText) throw new Error("Comment cannot be empty.");

        await withLoading(withToast(async () => {
            await this.submitInteraction(C.NOSTR_KIND_NOTE, commentText, reportId, reportPk);
        }, "Comment sent!", "Error sending comment", () => submitBtn.disabled = false))();
        form.reset();
    };

    renderReportImages(images) {
        return (images || []).map(img =>
            `<img src="${sanitizeHTML(img.url)}" alt="report image" style="max-width:100%;margin:.3rem 0;border-radius:4px;">`
        ).join('');
    }

    renderAuthorInfo(rep, profile, isFollowed, canFollow) {
        const authorDisplay = profile?.name || (profile?.nip05 ? sanitizeHTML(profile.nip05) : formatNpubShort(rep.pk));
        const authorPicture = profile?.picture ? `<img src="${sanitizeHTML(profile.picture)}" alt="Profile Picture" class="profile-picture">` : '';
        const authorAbout = profile?.about ? `<p class="profile-about">${sanitizeHTML(profile.about)}</p>` : '';
        const authorNip05 = profile?.nip05 ? `<span class="nip05-verified">${sanitizeHTML(profile.nip05)} ✅</span>` : '';

        return `
            <div class="report-author-info">
                ${authorPicture}
                <p><strong>By:</strong> <a href="https://njump.me/${nip19.npubEncode(rep.pk)}" target="_blank" rel="noopener noreferrer">${authorDisplay}</a> ${authorNip05}</p>
                ${canFollow ? `<button class="small-button ${isFollowed ? 'unfollow-button' : 'follow-button'}" data-pubkey="${sanitizeHTML(rep.pk)}">${isFollowed ? 'Unfollow' : 'Follow'}</button>` : ''}
                ${authorAbout}
            </div>
        `;
    }

    renderReportDetailHtml(rep, profile, isAuthor, isFollowed, canFollow) {
        return `
            <button class="small-button back-to-list-btn">&lt; List</button>
            ${isAuthor ? `<button class="small-button edit-button" data-report-id="${sanitizeHTML(rep.id)}" style="float:right;">Edit Report</button>` : ''}
            ${isAuthor ? `<button class="small-button delete-button" data-report-id="${sanitizeHTML(rep.id)}" style="float:right; margin-right: 0.5rem;">Delete Report</button>` : ''}
            <h2 class="detail-title">${sanitizeHTML(rep.title || 'Report')}</h2>
            ${this.renderAuthorInfo(rep, profile, isFollowed, canFollow)}
            <p><strong>Date:</strong> ${new Date(rep.at * 1000).toLocaleString()}</p>
            <p><strong>Summary:</strong> ${sanitizeHTML(rep.sum || 'N/A')}</p>
            <p><strong>Description:</strong></p><div class="markdown-content" tabindex="0">${marked.parse(sanitizeHTML(rep.ct || ''))}</div>
            ${this.renderReportImages(rep.imgs) ? `<h3>Images:</h3>${this.renderReportImages(rep.imgs)}` : ''}
            <p><strong>Location:</strong> ${rep.lat?.toFixed(5)}, ${rep.lon?.toFixed(5)} (Geohash: ${sanitizeHTML(rep.gh || 'N/A')})</p>
            <div class="mini-map-det" style="height:150px;margin-top:.7rem;border:1px solid #ccc"></div>
            <div class="interactions">Loading interactions...</div>
        `;
    }

    setupReportDetailEventListeners(rep, isAuthor, canFollow, detailContainer) {
        detailContainer.querySelector('.back-to-list-btn').onclick = () => {
            this.hide();
            appStore.set(s => ({ui: {...s.ui, showReportList: true, reportIdToView: null}}));
        };

        if (isAuthor) {
            detailContainer.querySelector('.edit-button').onclick = () => {
                this.reportFormModal.show('.nstr-rep-form #field-title', rep);
            };
            detailContainer.querySelector('.delete-button').onclick = () => {
                showConfirmModal(
                    "Delete Report",
                    `Are you sure you want to delete the report "${sanitizeHTML(rep.title || rep.id.substring(0, 8) + '...')}"? This action publishes a deletion event to relays.`,
                    withLoading(withToast(async () => {
                        await nostrSvc.deleteEv(rep.id);
                        this.hide();
                        appStore.set(s => ({ui: {...s.ui, showReportList: true, reportIdToView: null}}));
                        applyAllFilters();
                    }, null, "Failed to delete report")),
                    () => showToast("Report deletion cancelled.", 'info')
                );
            };
        }

        if (canFollow) detailContainer.querySelector('.follow-button')?.addEventListener('click', this.handleFollowToggle);
    }

    handleFollowToggle = async event => {
        const btn = event.target;
        const pubkeyToToggle = btn.dataset.pubkey;
        const isCurrentlyFollowed = appStore.get().followedPubkeys.some(f => f.pk === pubkeyToToggle);

        if (!appStore.get().user) throw new Error("Please connect your Nostr identity to follow users.");

        await withLoading(withToast(async () => {
            isCurrentlyFollowed ? await confSvc.rmFollowed(pubkeyToToggle) : confSvc.addFollowed(pubkeyToToggle);
            const updatedReport = appStore.get().reports.find(r => r.id === this.report.id);
            if (updatedReport) {
                this.report = updatedReport;
                this.renderContent(this.report, this.modalContentContainer);
            }
            return isCurrentlyFollowed ? `Unfollowed ${formatNpubShort(pubkeyToToggle)}.` : `Followed ${formatNpubShort(pubkeyToToggle)}!`;
        }, null, "Error toggling follow status", () => btn.disabled = false))();
    };

    renderInteractionsContent(interactions, container) {
        container.innerHTML = '';
        container.appendChild(createEl('h4', {textContent: 'Interactions'}));

        if (!interactions.length) {
            container.appendChild(createEl('p', {textContent: 'No interactions yet.'}));
        } else {
            interactions.forEach(i => {
                const interactionItem = new InteractionItem(i);
                container.appendChild(interactionItem.element);
            });
        }
    }

    setupInteractionControls(reportId, reportPk, container) {
        const reactionButtonsDiv = createEl('div', {class: 'reaction-buttons', style: 'margin-top:0.5rem;'});
        reactionButtonsDiv.appendChild(createEl('button', {'data-report-id': sanitizeHTML(reportId), 'data-report-pk': sanitizeHTML(reportPk), 'data-reaction': '+', textContent: '👍 Like'}));
        reactionButtonsDiv.appendChild(createEl('button', {'data-report-id': sanitizeHTML(reportId), 'data-report-pk': sanitizeHTML(reportPk), 'data-reaction': '-', textContent: '👎 Dislike'}));

        const commentFormFields = [
            {type: 'textarea', name: 'comment', placeholder: 'Add a public comment...', rows: 2, required: true},
            {type: 'button', buttonType: 'submit', label: 'Post Comment'}
        ];

        const {form: commentForm} = renderForm(commentFormFields, {}, {
            onSubmit: this.handleCommentSubmit,
            'data-report-id': sanitizeHTML(reportId),
            'data-report-pk': sanitizeHTML(reportPk),
            class: 'comment-form',
            style: 'margin-top:0.5rem;'
        });

        container.appendChild(reactionButtonsDiv);
        container.appendChild(commentForm);

        reactionButtonsDiv.querySelectorAll('button').forEach(btn => btn.onclick = this.handleReactionSubmit);
    }

    async loadAndDisplayInteractions(reportId, reportPk, container) {
        container.innerHTML = '<h4>Interactions</h4><div class="spinner"></div>';
        await withLoading(withToast(async () => {
            const interactions = await nostrSvc.fetchInteractions(reportId, reportPk);

            this.renderInteractionsContent(interactions, container);
            this.setupInteractionControls(reportId, reportPk, container);

            appStore.set(s => {
                const reportIndex = s.reports.findIndex(rep => rep.id === reportId);
                if (reportIndex > -1) {
                    const updatedReports = [...s.reports];
                    updatedReports[reportIndex] = {...updatedReports[reportIndex], interactions};
                    return {reports: updatedReports};
                }
                return {};
            });
        }, null, "Error loading interactions"))();
    }

    initializeMiniMap(rep, miniMapEl) {
        if (rep.lat && rep.lon && typeof L !== 'undefined' && miniMapEl) {
            const miniMap = L.map(miniMapEl).setView([rep.lat, rep.lon], 13);
            L.tileLayer(confSvc.getTileServer(), {attribution: '&copy; OSM'}).addTo(miniMap);
            setTimeout(() => miniMap.invalidateSize(), 0);
        }
    }
}
