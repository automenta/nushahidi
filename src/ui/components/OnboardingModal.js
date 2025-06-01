import {C, createEl} from '../../utils.js';
import {Modal} from '../modals.js';

export class OnboardingModal extends Modal {
    constructor() {
        const contentRenderer = () => {
            const gotItBtn = createEl('button', {textContent: 'Got It!'});
            gotItBtn.addEventListener('click', () => this.hideOnboarding());
            return [
                createEl('h2', {textContent: 'Welcome to NostrMapper!'}),
                createEl('p', {textContent: 'NostrMapper is a decentralized mapping application built on Nostr. Report incidents, observations, and aid requests directly to the Nostr network.'}),
                createEl('p', {textContent: 'Your reports are public and uncensorable. Connect your Nostr identity to start contributing!'}),
                createEl('p', {textContent: 'Key Concepts:'}),
                createEl('ul', {}, [
                    createEl('li', {innerHTML: '<strong>Identity:</strong> Use a NIP-07 browser extension (like Alby) or manage keys locally (backup your private key!).'}),
                    createEl('li', {innerHTML: '<strong>Relays:</strong> Data is published to and read from Nostr relays. Configure your preferred relays in Settings.'}),
                    createEl('li', {innerHTML: '<strong>Focus Tags:</strong> Reports are grouped by a primary "#focus_tag" (e.g., #MyEvent). Set this to scope your view and new reports.'}),
                    createEl('li', {innerHTML: '<strong>Public Data:</strong> Everything you publish to Nostr is public. Be mindful of what you share.'})
                ]),
                gotItBtn
            ];
        };
        super('onboarding-modal', 'Welcome to NostrMapper!', contentRenderer);
    }

    hideOnboarding() {
        localStorage.setItem(C.ONBOARDING_KEY, 'true');
        this.hide();
    }
}
