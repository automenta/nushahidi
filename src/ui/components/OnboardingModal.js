import {appStore} from '../../store.js';
import {createEl, C} from '../../utils.js';
import {Modal} from '../modals.js';

export class OnboardingModal extends Modal {
    constructor() {
        let onboardingModalElement;
        const contentRenderer = (contentRoot, modalRoot) => {
            const gotItBtn = createEl('button', { textContent: 'Got It!' });
            gotItBtn.addEventListener('click', () => this.hideOnboarding());
            modalRoot.querySelector('.close-btn')?.addEventListener('click', () => this.hideOnboarding());
            return [
                createEl('p', { textContent: 'NostrMapper is a decentralized mapping application built on Nostr. Report incidents, observations, and aid requests directly to the Nostr network.' }),
                createEl('p', { textContent: 'Your reports are public and uncensorable. Connect your Nostr identity to start contributing!' }),
                gotItBtn
            ];
        };
        super('onboarding-info', 'Welcome to NostrMapper!', contentRenderer);
    }

    hideOnboarding() {
        localStorage.setItem(C.ONBOARDING_KEY, 'true');
        this.hide();
    }
}
