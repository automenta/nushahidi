import {appStore} from '../../store.js';
import {idSvc} from '../../services.js';
import {createEl, formatNpubShort} from '../../utils.js';
import {showConfirmModal, showModal} from '../modals.js';
import {AuthModal} from './AuthModal.js';
import {ReportFormModal} from './ReportFormModal.js';
import {SettingsModal} from './SettingsModal.js';

export function AppHeader() {
    let headerEl;
    let createReportBtn;
    let authButton;
    let settingsButton;
    let userDisplay;

    const authModalElement = AuthModal();
    const reportFormModalElement = ReportFormModal();
    const settingsModalElement = SettingsModal();

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

            createReportBtn.onclick = () => showModal(reportFormModalElement, 'rep-title');
            settingsButton.onclick = () => showModal(settingsModalElement);

            authButton.onclick = () => {
                state.user ?
                    showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
                    showModal(authModalElement, authModalElement.querySelector('#conn-nip07-btn'));
            };

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
            render(newState);
        }
    });

    return render(appStore.get());
}
