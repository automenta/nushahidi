import { appStore } from '../store.js';
import { $, createEl, sanitizeHTML, formatNpubShort } from '../utils.js';
import { showReportDetails } from './reportDetails.js';

const renderReportCard = report => {
    const summary = report.sum || (report.ct ? report.ct.substring(0, 100) + '...' : 'N/A');
    return `<div class="report-card" data-rep-id="${sanitizeHTML(report.id)}" role="button" tabindex="0" aria-labelledby="card-title-${report.id}">
        <h3 id="card-title-${report.id}">${sanitizeHTML(report.title || 'Report')}</h3><p>${sanitizeHTML(summary)}</p>
        <small>By: ${formatNpubShort(report.pk)} | ${new Date(report.at * 1000).toLocaleDateString()}</small>
        <small>Cats: ${report.cat.map(sanitizeHTML).join(', ') || 'N/A'}</small></div>`;
};

export const rendRepList = reports => {
    const listElement = $('#report-list');
    const listContainer = $('#report-list-container');
    if (!listElement || !listContainer) return;

    listElement.innerHTML = '';
    if (reports.length > 0) {
        reports.forEach(report => {
            const cardWrapper = createEl('div');
            cardWrapper.innerHTML = renderReportCard(report);
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
