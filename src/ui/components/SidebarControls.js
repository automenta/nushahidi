import {createEl} from '../../utils.js';

export class SidebarControls {
    constructor(props) {
        this.onCreateReport = props.onCreateReport;
        this.onShowSettings = props.onShowSettings;

        this.element = createEl('div', {class: 'sidebar-controls'}, [
            createEl('button', {textContent: 'New Report', onclick: this.onCreateReport}),
            createEl('button', {textContent: 'Settings', onclick: this.onShowSettings})
        ]);
    }
}
