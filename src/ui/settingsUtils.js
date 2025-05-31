import {appStore} from '../store.js';
import {confSvc, nostrSvc} from '../services.js';
import {$, createEl, showToast} from '../utils.js';
import {renderForm, renderList, setupAddRemoveListSection} from './forms.js';
import {showConfirmModal} from './modals.js';
import {withLoading, withToast} from '../decorators.js';

export function renderConfigurableListSetting(wrapper, config) {
    wrapper.appendChild(createEl('section', {}, [
        createEl('h3', { textContent: config.title }),
        createEl('div', { id: config.listId }),
        config.formFields ? renderForm(config.formFields, {}, { id: config.formId }) : null
    ].filter(Boolean)));
    wrapper.appendChild(createEl('hr'));

    const listRenderer = () => {
        const items = appStore.get()[config.listId === 'rly-list' ? 'relays' : config.listId === 'followed-list' ? 'followedPubkeys' : `settings.${config.listId.replace('-list', '')}`.split('.').reduce((o, i) => o[i], appStore.get())];
        renderList(config.listId, items || [], config.itemRenderer, config.actionsConfig, config.itemWrapperClass, wrapper);
    };

    if (config.addInputId && config.addBtnId && config.addLogic) {
        setupAddRemoveListSection({
            modalContent: wrapper,
            addInputId: config.addInputId,
            addBtnId: config.addBtnId,
            addLogic: config.addLogic,
            listRenderer,
            saveBtnId: config.saveBtnId,
            onSaveCallback: config.onSaveCallback
        });
    } else if (config.saveBtnId && config.onSaveCallback) {
        const saveBtn = $(`#${config.saveBtnId}`, wrapper);
        if (saveBtn) saveBtn.onclick = () => {
            config.onSaveCallback?.();
            showToast("Settings saved.", 'success');
        };
    }

    listRenderer();

    config.uniqueListenersSetup?.(wrapper);
}

export const setupFollowedListUniqueListeners = modalContent => {
    $('#import-contacts-btn', modalContent).onclick = withLoading(withToast(async () => {
        if (!appStore.get().user) throw new Error("Please connect your Nostr identity to import contacts.");
        const contacts = await nostrSvc.fetchContacts();
        if (!contacts.length) return "No NIP-02 contact list found on relays for your account.";

        const currentFollowed = appStore.get().followedPubkeys.map(f => f.pk);
        const newFollowed = contacts.filter(c => !currentFollowed.includes(c.pubkey)).map(c => ({ pk: c.pubkey, followedAt: Date.now() }));
        if (!newFollowed.length) return "No new contacts found to import.";

        await confSvc.setFollowedPubkeys([...appStore.get().followedPubkeys, ...newFollowed]);
        return `Imported ${newFollowed.length} contacts from Nostr.`;
    }, null, "Error importing contacts"));

    $('#publish-contacts-btn', modalContent).onclick = () => {
        if (!appStore.get().user) {
            showToast("Please connect your Nostr identity to publish contacts.", 'warning');
            return;
        }
        showConfirmModal(
            "Publish Contacts",
            "This will publish your current followed list as a NIP-02 contact list (Kind 3 event) to your connected relays. This will overwrite any existing Kind 3 event for your pubkey. Continue?",
            withLoading(withToast(async () => {
                const contactsToPublish = appStore.get().followedPubkeys.map(f => ({ pubkey: f.pk, relay: '', petname: '' }));
                await nostrSvc.pubContacts(contactsToPublish);
            }, null, "Error publishing contacts")),
            () => showToast("Publish contacts cancelled.", 'info')
        );
    };
};
