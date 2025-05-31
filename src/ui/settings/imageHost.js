import {appStore} from '../../store.js';
import {confSvc} from '../../services.js';
import {C, isValidUrl, createEl} from '../../utils.js';
import {withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';

export class ImageHostSection {
    constructor() {
        this.sectionEl = createEl('section');
        this.form = null;
        this.imgHostSel = null;
        this.nip96Fields = null;
        this.nip96UrlIn = null;
        this.nip96TokenIn = null;
        this.saveBtn = null;

        this.render(appStore.get());

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.settings.imgH !== oldState?.settings?.imgH ||
                newState.settings.nip96H !== oldState?.settings?.nip96H ||
                newState.settings.nip96T !== oldState?.settings?.nip96T) {
                this.render(newState);
            }
        });
    }

    render(appState) {
        const imageHostFormFields = [
            {
                label: 'Provider:',
                type: 'select',
                id: 'img-host-sel',
                name: 'imgHostProvider',
                value: appState.settings.nip96H ? 'nip96' : (appState.settings.imgH || C.IMG_UPLOAD_NOSTR_BUILD),
                options: [
                    { value: C.IMG_UPLOAD_NOSTR_BUILD, label: 'nostr.build (Default)' },
                    { value: 'nip96', label: 'NIP-96 Server' }
                ]
            },
            {
                type: 'custom-html',
                id: 'nip96-fields',
                class: 'nip96-fields',
                content: [
                    createEl('label', { for: 'nip96-url-in', textContent: 'NIP-96 Server URL:' }),
                    createEl('input', { type: 'url', id: 'nip96-url-in', name: 'nip96Url', value: appState.settings.nip96H, placeholder: 'https://your.nip96.server' }),
                    createEl('label', { for: 'nip96-token-in', textContent: 'NIP-96 Auth Token (Optional):' }),
                    createEl('input', { type: 'text', id: 'nip96-token-in', name: 'nip96Token', value: appState.settings.nip96T })
                ]
            }
        ];

        const { form, fields } = renderForm(imageHostFormFields, {}, { id: 'image-host-form' });

        if (!this.form) {
            this.form = form;
            this.sectionEl.appendChild(this.form);
            this.saveBtn = createEl('button', { type: 'button', id: 'save-img-host-btn', textContent: 'Save Image Host' });
            this.sectionEl.appendChild(this.saveBtn);
        } else {
            this.form.replaceWith(form);
            this.form = form;
        }

        this.imgHostSel = fields['img-host-sel'];
        this.nip96Fields = fields['nip96-fields'];
        this.nip96UrlIn = fields['nip96-url-in'];
        this.nip96TokenIn = fields['nip96-token-in'];
        this.saveBtn = this.saveBtn || this.sectionEl.querySelector('#save-img-host-btn');

        this.imgHostSel.onchange = () => {
            this.nip96Fields.style.display = this.imgHostSel.value === 'nip96' ? '' : 'none';
        };

        this.saveBtn.onclick = withToast(async () => {
            const selectedHost = this.imgHostSel.value;
            if (selectedHost === 'nip96') {
                const nip96Url = this.nip96UrlIn.value.trim();
                const nip96Token = this.nip96TokenIn.value.trim();
                if (!isValidUrl(nip96Url)) throw new Error("Invalid NIP-96 server URL.");
                await confSvc.setImgHost(nip96Url, true, nip96Token);
            } else {
                await confSvc.setImgHost(selectedHost, false);
            }
        }, "Image host settings saved.", "Error saving image host settings");

        this.imgHostSel.value = appState.settings.nip96H ? 'nip96' : (appState.settings.imgH || C.IMG_UPLOAD_NOSTR_BUILD);
        this.nip96Fields.style.display = appState.settings.nip96H ? '' : 'none';
        this.nip96UrlIn.value = appState.settings.nip96H;
        this.nip96TokenIn.value = appState.settings.nip96T;

        return this.sectionEl;
    }

    get element() {
        return this.sectionEl;
    }
}
