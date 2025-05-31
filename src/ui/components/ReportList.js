import {createEl} from '../../utils.js';
import {appStore} from '../../store.js';
import {ReportCard} from './ReportCard.js';

export class ReportList {
    constructor() {
        this.listContainer = createEl('div', {class: 'report-list-container'});
        this.listElement = createEl('div', {class: 'report-list'});
        this.listContainer.appendChild(this.listElement);

        this.render(appStore.get());

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.filteredReports !== oldState?.filteredReports || newState.ui.showReportList !== oldState?.ui?.showReportList) {
                this.render(newState);
            }
        });
    }

    updateList(reports) {
        this.listElement.innerHTML = '';
        reports.length ?
            reports.forEach(report => this.listElement.appendChild(new ReportCard(report).element)) :
            this.listElement.appendChild(createEl('p', {textContent: 'No reports match filters.'}));
    }

    render(state) {
        this.updateList(state.filteredReports || []);
        this.listContainer.style.display = state.ui.showReportList ? 'block' : 'none';
        return this.listContainer;
    }

    get element() {
        return this.listContainer;
    }
}
