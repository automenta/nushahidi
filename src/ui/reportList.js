import {$, createEl, formatNpubShort, sanitizeHTML} from '../utils.js';
import {showReportDetails} from './reportDetails.js';

const renderReportCard = report => `
    <div class="report-card" data-rep-id="${sanitizeHTML(report.id)}" role="button" tabindex="0" aria-labelledby="card-title-${report.id}">
        <h3 id="card-title-${report.id}">${sanitizeHTML(report.title || 'Report')}</h3><p>${sanitizeHTML(report.sum || (report.ct ? report.ct.substring(0, 100) + '...' : 'N/A'))}</p>
        <small>By: ${formatNpubShort(report.pk)} | ${new Date(report.at * 1000).toLocaleDateString()}</small>
        <small>Cats: ${report.cat.map(sanitizeHTML).join(', ') || 'N/A'}</small>
    </div>`;

export const renderReportList = reports => {
    const listElement = $('#report-list');
    const listContainer = $('#report-list-container');
    if (!listElement || !listContainer) return;

    listElement.innerHTML = '';
    if (reports.length > 0) {
        reports.forEach(report => {
            const cardWrapper = createEl('div');
            cardWrapper.innerHTML = renderReportCard(report);
            const cardElement = cardWrapper.firstElementChild;
            cardElement.addEventListener('click', () => showReportDetails(report));
            cardElement.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && showReportDetails(report));
            listElement.appendChild(cardElement);
        });
        listContainer.style.display = 'block';
    } else {
        listElement.innerHTML = '<p>No reports match filters.</p>';
        listContainer.style.display = 'block';
    }
};
