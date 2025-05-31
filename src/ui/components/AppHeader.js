import {appStore} from '../../store.js';
import {createEl, formatNpubShort} from '../../utils.js';
import {ConnectionStatus} from './ConnectionStatus.js';

export class AppHeader {
    constructor(props) {
        this.onCreateReport = props.onCreateReport;
        this.onAuthToggle = props.onAuthToggle;
        this.onShowSettings = props.onShowSettings;

        this.headerEl = createEl('header', { class: 'app-header' });
        this.createReportBtn = createEl('button', { textContent: 'Create Report' });
        this.authButton = createEl('button');
        this.settingsButton = createEl('button', { textContent: 'Settings' });
        this.userDisplay = createEl('span', { class: 'user-display' });
        this.connectionStatusComponent = new ConnectionStatus(this.onShowSettings);

        this.createReportBtn.onclick = this.onCreateReport;
        this.settingsButton.onclick = this.onShowSettings;
        this.authButton.onclick = this.onAuthToggle;

        this.headerEl.append(
            createEl('h1', { textContent: 'NostrMapper' }),
            this.createReportBtn,
            this.authButton,
            this.settingsButton,
            this.userDisplay,
            this.connectionStatusComponent.element
        );

        this.render(appStore.get());

        this.unsubscribe = appStore.on(async (newState, oldState) => {
            if (newState.user?.pk !== oldState?.user?.pk) {
                this.updateAuthDisplay(newState.user?.pk);
            }
        });
    }

    updateAuthDisplay(pubkey) {
        if (pubkey) {
            this.userDisplay.textContent = `Connected: ${formatNpubShort(pubkey)}`;
            this.authButton.textContent = 'Logout';
        } else {
            this.userDisplay.textContent = 'Not Connected';
            this.authButton.textContent = 'Connect Identity';
        }
    }

    render(state) {
        this.updateAuthDisplay(state.user?.pk);
        return this.headerEl;
    }

    get element() {
        return this.headerEl;
    }
}
