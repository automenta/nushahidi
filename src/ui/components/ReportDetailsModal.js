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

        this.elements = {}; // Store references to dynamically created elements for granular updates

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.ui.reportIdToView === this.report.id && newState.reports !== oldState?.reports) {
                const updatedReport = newState.reports.find(r => r.id === this.report.id);
                if (updatedReport) {
                    this.report = updatedReport;
                    this.updateContent(this.report); // Call updateContent for granular updates
                }
            }
        });
    }

    hide() {
        super.hide();
        this.unsubscribe();
    }

    async renderContent(report, container) {
        const profile = await nostrSvc.fetchProf(report.pk);
        const currentUserPk = appStore.get().user?.pk;
        const isAuthor = currentUserPk && currentUserPk === report.pk;
        const isFollowed = appStore.get().followedPubkeys.some(f => f.pk === report.pk);
        const canFollow = currentUserPk && currentUserPk !== report.pk;

        container.innerHTML = ''; // Clear existing content

        this.elements.backToListBtn = createEl('button', {class: 'small-button back-to-list-btn', textContent: '< List'});
        container.appendChild(this.elements.backToListBtn);

        if (isAuthor) {
            this.elements.editButton = createEl('button', {class: 'small-button edit-button', 'data-report-id': sanitizeHTML(report.id), textContent: 'Edit Report', style: 'float:right;'});
            this.elements.deleteButton = createEl('button', {class: 'small-button delete-button', 'data-report-id': sanitizeHTML(report.id), textContent: 'Delete Report', style: 'float:right; margin-right: 0.5rem;'});
            container.appendChild(this.elements.deleteButton);
            container.appendChild(this.elements.editButton);
        }

        this.elements.titleEl = createEl('h2', {class: 'detail-title', textContent: sanitizeHTML(report.title || 'Report')});
        container.appendChild(this.elements.titleEl);

        this.elements.authorInfoDiv = createEl('div', {class: 'report-author-info'});
        container.appendChild(this.elements.authorInfoDiv);
        this.updateAuthorInfo(report, profile, isFollowed, canFollow);

        this.elements.dateEl = createEl('p', {innerHTML: `<strong>Date:</strong> ${new Date(report.at * 1000).toLocaleString()}`});
        container.appendChild(this.elements.dateEl);

        this.elements.summaryEl = createEl('p', {innerHTML: `<strong>Summary:</strong> ${sanitizeHTML(report.sum || 'N/A')}`});
        container.appendChild(this.elements.summaryEl);

        this.elements.descriptionEl = createEl('div', {class: 'markdown-content', tabindex: '0'});
        this.elements.descriptionEl.innerHTML = marked.parse(sanitizeHTML(report.ct || ''));
        container.appendChild(createEl('p', {textContent: 'Description:'}));
        container.appendChild(this.elements.descriptionEl);

        this.elements.imagesContainer = createEl('div');
        container.appendChild(this.elements.imagesContainer);
        this.updateReportImages(report.imgs);

        this.elements.locationEl = createEl('p', {innerHTML: `<strong>Location:</strong> ${report.lat?.toFixed(5)}, ${report.lon?.toFixed(5)} (Geohash: ${sanitizeHTML(report.gh || 'N/A')})`});
        container.appendChild(this.elements.locationEl);

        this.elements.miniMapDiv = createEl('div', {class: 'mini-map-det', style: 'height:150px;margin-top:.7rem;border:1px solid #ccc'});
        container.appendChild(this.elements.miniMapDiv);
        this.initializeMiniMap(report, this.elements.miniMapDiv);

        this.elements.interactionsDiv = createEl('div', {class: 'interactions', textContent: 'Loading interactions...'});
        container.appendChild(this.elements.interactionsDiv);

        this.setupReportDetailEventListeners(report, isAuthor, canFollow, container);
        this.loadAndDisplayInteractions(report.id, report.pk, this.elements.interactionsDiv);
    }

    async updateContent(report) {
        const profile = await nostrSvc.fetchProf(report.pk);
        const currentUserPk = appStore.get().user?.pk;
        const isAuthor = currentUserPk && currentUserPk === report.pk;
        const isFollowed = appStore.get().followedPubkeys.some(f => f.pk === report.pk);
        const canFollow = currentUserPk && currentUserPk !== report.pk;

        this.elements.titleEl.textContent = sanitizeHTML(report.title || 'Report');
        this.updateAuthorInfo(report, profile, isFollowed, canFollow);
        this.elements.dateEl.innerHTML = `<strong>Date:</strong> ${new Date(report.at * 1000).toLocaleString()}`;
        this.elements.summaryEl.innerHTML = `<strong>Summary:</strong> ${sanitizeHTML(report.sum || 'N/A')}`;
        this.elements.descriptionEl.innerHTML = marked.parse(sanitizeHTML(report.ct || ''));
        this.updateReportImages(report.imgs);
        this.elements.locationEl.innerHTML = `<strong>Location:</strong> ${report.lat?.toFixed(5)}, ${report.lon?.toFixed(5)} (Geohash: ${sanitizeHTML(report.gh || 'N/A')})`;

        // Re-setup event listeners for dynamic elements like follow/unfollow button
        this.setupReportDetailEventListeners(report, isAuthor, canFollow, this.modalContentContainer);
        this.loadAndDisplayInteractions(report.id, report.pk, this.elements.interactionsDiv);
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

    updateReportImages(images) {
        this.elements.imagesContainer.innerHTML = '';
        if (images && images.length) {
            this.elements.imagesContainer.appendChild(createEl('h3', {textContent: 'Images:'}));
            images.forEach(img => {
                this.elements.imagesContainer.appendChild(createEl('img', {src: sanitizeHTML(img.url), alt: 'report image', style: 'max-width:100%;margin:.3rem 0;border-radius:4px;'}));
            });
        }
    }

    updateAuthorInfo(rep, profile, isFollowed, canFollow) {
        const authorDisplay = profile?.name || (profile?.nip05 ? sanitizeHTML(profile.nip05) : formatNpubShort(rep.pk));
        const authorPicture = profile?.picture ? `<img src="${sanitizeHTML(profile.picture)}" alt="Profile Picture" class="profile-picture">` : '';
        const authorAbout = profile?.about ? `<p class="profile-about">${sanitizeHTML(profile.about)}</p>` : '';
        const authorNip05 = profile?.nip05 ? `<span class="nip05-verified">${sanitizeHTML(profile.nip05)} ✅</span>` : '';

        this.elements.authorInfoDiv.innerHTML = `
            ${authorPicture}
            <p><strong>By:</strong> <a href="https://njump.me/${nip19.npubEncode(rep.pk)}" target="_blank" rel="noopener noreferrer">${authorDisplay}</a> ${authorNip05}</p>
        `;
        if (canFollow) {
            const followButton = createEl('button', {
                class: `small-button ${isFollowed ? 'unfollow-button' : 'follow-button'}`,
                'data-pubkey': sanitizeHTML(rep.pk),
                textContent: isFollowed ? 'Unfollow' : 'Follow'
            });
            followButton.addEventListener('click', this.handleFollowToggle);
            this.elements.authorInfoDiv.appendChild(followButton);
        }
        if (authorAbout) {
            this.elements.authorInfoDiv.appendChild(createEl('div', {innerHTML: authorAbout}));
        }
    }

    setupReportDetailEventListeners(rep, isAuthor, canFollow, detailContainer) {
        this.elements.backToListBtn.onclick = () => {
            this.hide();
            appStore.set(s => ({ui: {...s.ui, showReportList: true, reportIdToView: null}}));
        };

        if (isAuthor) {
            this.elements.editButton.onclick = () => {
                this.reportFormModal.show('.nstr-rep-form #field-title', rep);
            };
            this.elements.deleteButton.onclick = () => {
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

        // Re-attach follow/unfollow listener as the button might be re-rendered
        const followBtn = detailContainer.querySelector('.follow-button, .unfollow-button');
        if (followBtn) {
            followBtn.removeEventListener('click', this.handleFollowToggle); // Remove old listener if exists
            followBtn.addEventListener('click', this.handleFollowToggle);
        }
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
                this.updateContent(this.report); // Use updateContent for granular refresh
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
        // Clear existing controls before adding new ones
        const existingReactionButtons = container.querySelector('.reaction-buttons');
        if (existingReactionButtons) existingReactionButtons.remove();
        const existingCommentForm = container.querySelector('.comment-form');
        if (existingCommentForm) existingCommentForm.remove();

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
            // Check if map already exists on this element
            if (miniMapEl._leaflet_id) {
                miniMapEl._leaflet_id = null; // Clear the ID to allow re-initialization
                // If there's a way to destroy the map instance, do it here.
                // L.map(element).remove() is usually used, but we don't have a direct reference to the old map instance here.
                // For simplicity, we'll rely on re-initializing, which Leaflet handles by replacing the content.
            }
            const miniMap = L.map(miniMapEl).setView([rep.lat, rep.lon], 13);
            L.tileLayer(confSvc.getTileServer(), {attribution: '&copy; OSM'}).addTo(miniMap);
            L.marker([rep.lat, rep.lon]).addTo(miniMap); // Add marker to mini-map
            setTimeout(() => miniMap.invalidateSize(), 0);
        }
    }
}
