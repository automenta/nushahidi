import {createEl} from '../../utils.js';
import {appStore} from '../../store.js';
import {ReportCard} from './ReportCard.js';

export class ReportList {
    constructor() {
        this.listContainer = createEl('div', {class: 'report-list-container'});
        this.listElement = createEl('div', {class: 'report-list'});
        this.listContainer.appendChild(this.listElement);

        this.render(appStore.get());

        this.unsubscribe = appStore.on(newState => {
            if (newState.filteredReports !== newState.filteredReports || newState.ui.showReportList !== newState.ui.showReportList) {
                this.render(newState);
            }
        });
    }

    updateList(reports) {
        this.listElement.innerHTML = '';
        if (reports.length > 0) {
            reports.forEach(report => {
                const reportCard = new ReportCard(report);
                this.listElement.appendChild(reportCard.element);
            });
        } else {
            this.listElement.innerHTML = '<p>No reports match filters.</p>';
        }
    }

    render(state) {
        this.updateList(state.filteredReports || []);
        this.listContainer.style.display = state.ui.showReportList ? 'block' : 'none';
        return this.listContainer;
    }
}
