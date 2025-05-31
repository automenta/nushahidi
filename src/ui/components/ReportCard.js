import {createEl, formatNpubShort, sanitizeHTML} from '../../utils.js';
import {appStore} from '../../store.js';

export class ReportCard {
    constructor(report) {
        this.report = report;
        this.element = this.render();
        this.setupEventListeners();
    }

    render() {
        return createEl('div', {
            class: 'report-card',
            role: 'button',
            tabindex: '0',
            'aria-labelledby': `card-title-${sanitizeHTML(this.report.id)}`,
            innerHTML: `
                <h3 id="card-title-${sanitizeHTML(this.report.id)}">${sanitizeHTML(this.report.title || 'Report')}</h3><p>${sanitizeHTML(this.report.sum || (this.report.ct ? this.report.ct.substring(0, 100) + '...' : 'N/A'))}</p>
                <small>By: ${formatNpubShort(this.report.pk)} | ${new Date(this.report.at * 1000).toLocaleDateString()}</small>
                <small>Cats: ${this.report.cat.map(sanitizeHTML).join(', ') || 'N/A'}</small>
            `
        });
    }

    setupEventListeners() {
        this.element.addEventListener('click', () => this.showReportDetails());
        this.element.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') this.showReportDetails();
        });
    }

    showReportDetails() {
        appStore.set(s => ({ui: {...s.ui, reportIdToView: this.report.id, showReportList: false}}));
    }
}
