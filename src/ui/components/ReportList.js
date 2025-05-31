import {$, createEl, formatNpubShort, sanitizeHTML} from '../../utils.js';
import {ReportDetailsModal} from './ReportDetailsModal.js';
import {showModal} from '../modals.js';
import {appStore} from '../../store.js';

export function ReportList() {
    const listContainer = createEl('div', { id: 'report-list-container' });
    const listElement = createEl('div', { id: 'report-list' });
    listContainer.appendChild(listElement);

    const renderReportCard = report => `
        <div class="report-card" data-rep-id="${sanitizeHTML(report.id)}" role="button" tabindex="0" aria-labelledby="card-title-${report.id}">
            <h3 id="card-title-${report.id}">${sanitizeHTML(report.title || 'Report')}</h3><p>${sanitizeHTML(report.sum || (report.ct ? report.ct.substring(0, 100) + '...' : 'N/A'))}</p>
            <small>By: ${formatNpubShort(report.pk)} | ${new Date(report.at * 1000).toLocaleDateString()}</small>
            <small>Cats: ${report.cat.map(sanitizeHTML).join(', ') || 'N/A'}</small>
        </div>`;

    const updateList = reports => {
        listElement.innerHTML = '';
        if (reports.length > 0) {
            reports.forEach(report => {
                const cardWrapper = createEl('div');
                cardWrapper.innerHTML = renderReportCard(report);
                const cardElement = cardWrapper.firstElementChild;
                cardElement.addEventListener('click', () => {
                    const reportDetailsModalElement = ReportDetailsModal(report);
                    showModal(reportDetailsModalElement, 'detail-title');
                    appStore.set(s => ({ ui: { ...s.ui, showReportList: false } }));
                });
                cardElement.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        const reportDetailsModalElement = ReportDetailsModal(report);
                        showModal(reportDetailsModalElement, 'detail-title');
                        appStore.set(s => ({ ui: { ...s.ui, showReportList: false } }));
                    }
                });
                listElement.appendChild(cardElement);
            });
        } else {
            listElement.innerHTML = '<p>No reports match filters.</p>';
        }
    };

    appStore.on(newState => {
        if (newState.filteredReports !== appStore.get().filteredReports) {
            updateList(newState.filteredReports);
        }
        if (newState.ui.showReportList !== appStore.get().ui.showReportList) {
            listContainer.style.display = newState.ui.showReportList ? 'block' : 'none';
        }
    });

    // Initial render
    updateList(appStore.get().filteredReports || []);
    listContainer.style.display = appStore.get().ui.showReportList ? 'block' : 'none';


    return listContainer;
}
