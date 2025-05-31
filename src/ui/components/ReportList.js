import {createEl, formatNpubShort, sanitizeHTML} from '../../utils.js';
import {appStore} from '../../store.js';

export function ReportList() {
    let listContainer;
    let listElement;

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
                    appStore.set(s => ({ ui: { ...s.ui, reportIdToView: report.id, showReportList: false } }));
                });
                cardElement.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        appStore.set(s => ({ ui: { ...s.ui, reportIdToView: report.id, showReportList: false } }));
                    }
                });
                listElement.appendChild(cardElement);
            });
        } else {
            listElement.innerHTML = '<p>No reports match filters.</p>';
        }
    };

    const render = (state) => {
        if (!listContainer) {
            listContainer = createEl('div', { class: 'report-list-container' });
            listElement = createEl('div', { class: 'report-list' });
            listContainer.appendChild(listElement);
        }
        updateList(state.filteredReports || []);
        listContainer.style.display = state.ui.showReportList ? 'block' : 'none';
        return listContainer;
    };

    appStore.on(newState => {
        if (newState.filteredReports !== appStore.get().filteredReports || newState.ui.showReportList !== appStore.get().ui.showReportList) {
            render(newState);
        }
    });

    return render(appStore.get());
}
