import {appStore} from '../../store.js';
import {confSvc} from '../../services.js';
import {C, isValidUrl, createEl} from '../../utils.js';
import {withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';

export class ImageHostSection {
    constructor() {
        this.sectionEl = createEl('section');
        this.sectionEl.appendChild(createEl('h3', {textContent: 'Image Host'}));
        this.form = null;
        this.formFields = {};

        this.createFormElements(appStore.get());
        this.sectionEl.appendChild(this.form);

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.settings.imgH !== oldState?.settings?.imgH ||
                newState.settings.nip96H !== oldState?.settings?.nip96H ||
                newState.settings.nip96T !== oldState?.settings?.nip96T) {
                this.updateFormElements(newState);
            }
        });
    }

    createFormElements(appState) {
        const imageHostFormFieldsConfig = [
            {
                label: 'Provider:',
                type: 'select',
                ref: 'imgHostProviderSelect',
                name: 'imgHostProvider',
                value: appState.settings.nip96H ? 'nip96' : (appState.settings.imgH || C.IMG_UPLOAD_NOSTR_BUILD),
                options: [
                    {value: C.IMG_UPLOAD_NOSTR_BUILD, label: 'nostr.build (Default)'},
                    {value: 'nip96', label: 'NIP-96 Server'}
                ]
            },
            {
                type: 'custom-html',
                ref: 'nip96FieldsContainer',
                class: 'nip96-fields',
                content: [
                    { tagName: 'label', attributes: { for: 'nip96-url-in', textContent: 'NIP-96 Server URL:' } },
                    { tagName: 'input', attributes: { type: 'url', id: 'nip96-url-in', name: 'nip96Url', value: appState.settings.nip96H, placeholder: 'https://your.nip96.server', ref: 'nip96Url' } },
                    { tagName: 'label', attributes: { for: 'nip96-token-in', textContent: 'NIP-96 Auth Token (Optional):' } },
                    { tagName: 'input', attributes: { type: 'text', id: 'nip96-token-in', name: 'nip96Token', value: appState.settings.nip96T, ref: 'nip96Token' } }
                ]
            },
            {type: 'button', ref: 'saveImgHostBtn', textContent: 'Save Image Host'}
        ];

        const {form, fields} = renderForm(imageHostFormFieldsConfig, {}, {class: 'image-host-form'});
        this.form = form;
        this.formFields = fields;

        this.formFields.imgHostProviderSelect.onchange = () => {
            this.formFields.nip96FieldsContainer.style.display = this.formFields.imgHostProviderSelect.value === 'nip96' ? '' : 'none';
        };

        this.formFields.saveImgHostBtn.onclick = withToast(async () => {
            const selectedHost = this.formFields.imgHostProviderSelect.value;
            if (selectedHost === 'nip96') {
                const nip96Url = this.formFields.nip96Url.value.trim();
                const nip96Token = this.formFields.nip96Token.value.trim();
                if (!isValidUrl(nip96Url)) throw new Error("Invalid NIP-96 server URL.");
                await confSvc.setImgHost(nip96Url, true, nip96Token);
            } else {
                await confSvc.setImgHost(selectedHost, false);
            }
        }, "Image host settings saved.", "Error saving image host settings");

        this.updateFormElements(appState);
    }

    updateFormElements(appState) {
        this.formFields.imgHostProviderSelect.value = appState.settings.nip96H ? 'nip96' : (appState.settings.imgH || C.IMG_UPLOAD_NOSTR_BUILD);
        this.formFields.nip96FieldsContainer.style.display = appState.settings.nip96H ? '' : 'none';
        this.formFields.nip96Url.value = appState.settings.nip96H;
        this.formFields.nip96Token.value = appState.settings.nip96T;
    }

    get element() {
        return this.sectionEl;
    }
}
