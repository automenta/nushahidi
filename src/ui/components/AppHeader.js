import {appStore} from '../../store.js';
import {createEl, formatNpubShort} from '../../utils.js';

export function AppHeader(props) {
    const { onCreateReport, onAuthToggle, onShowSettings } = props;
    let headerEl;
    let createReportBtn;
    let authButton;
    let settingsButton;
    let userDisplay;

    const updateAuthDisplay = (pubkey) => {
        if (pubkey) {
            userDisplay.textContent = `Connected: ${formatNpubShort(pubkey)}`;
            authButton.textContent = 'Logout';
        } else {
            userDisplay.textContent = 'Not Connected';
            authButton.textContent = 'Connect Identity';
        }
    };

    const render = (state) => {
        if (!headerEl) {
            headerEl = createEl('header', { class: 'app-header' });
            createReportBtn = createEl('button', { textContent: 'Create Report' });
            authButton = createEl('button');
            settingsButton = createEl('button', { textContent: 'Settings' });
            userDisplay = createEl('span', { class: 'user-display' });

            createReportBtn.onclick = onCreateReport;
            settingsButton.onclick = onShowSettings;
            authButton.onclick = onAuthToggle;

            headerEl.append(
                createEl('h1', { textContent: 'NostrMapper' }),
                createReportBtn,
                authButton,
                settingsButton,
                userDisplay
            );
        }
        updateAuthDisplay(state.user?.pk);
        return headerEl;
    };

    appStore.on((newState, oldState) => {
        if (newState.user?.pk !== oldState?.user?.pk) {
            updateAuthDisplay(newState.user?.pk);
        }
    });

    return render(appStore.get());
}
