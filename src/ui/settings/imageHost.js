import {appStore} from '../../store.js';
import {confSvc} from '../../services.js';
import {C, isValidUrl, createEl} from '../../utils.js';
import {withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';

export const ImageHostSection = () => {
    const sectionEl = document.createElement('section');
    const appState = appStore.get();

    const imageHostFormFields = [
        {
            label: 'Provider:',
            type: 'select',
            id: 'img-host-sel',
            name: 'imgHostProvider',
            value: appState.settings.nip96Host ? 'nip96' : (appState.settings.imgHost || C.IMG_UPLOAD_NOSTR_BUILD),
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
                createEl('input', { type: 'url', id: 'nip96-url-in', name: 'nip96Url', value: appState.settings.nip96Host, placeholder: 'https://your.nip96.server' }),
                createEl('label', { for: 'nip96-token-in', textContent: 'NIP-96 Auth Token (Optional):' }),
                createEl('input', { type: 'text', id: 'nip96-token-in', name: 'nip96Token', value: appState.settings.nip96Token })
            ]
        }
    ];

    const form = renderForm(imageHostFormFields, {}, { id: 'image-host-form' });
    sectionEl.appendChild(form);
    const saveBtn = createEl('button', { type: 'button', id: 'save-img-host-btn', textContent: 'Save Image Host' });
    sectionEl.appendChild(saveBtn);

    const imgHostSel = form.querySelector('#img-host-sel');
    const nip96Fields = form.querySelector('#nip96-fields');
    const nip96UrlIn = form.querySelector('#nip96-url-in');
    const nip96TokenIn = form.querySelector('#nip96-token-in');

    nip96Fields.style.display = appState.settings.nip96Host ? '' : 'none';

    imgHostSel.onchange = () => {
        nip96Fields.style.display = imgHostSel.value === 'nip96' ? '' : 'none';
    };

    saveBtn.onclick = withToast(async () => {
        const selectedHost = imgHostSel.value;
        if (selectedHost === 'nip96') {
            const nip96Url = nip96UrlIn.value.trim();
            const nip96Token = nip96TokenIn.value.trim();
            if (!isValidUrl(nip96Url)) throw new Error("Invalid NIP-96 server URL.");
            await confSvc.setImgHost(nip96Url, true, nip96Token);
        } else {
            await confSvc.setImgHost(selectedHost, false);
        }
    }, "Image host settings saved.", "Error saving image host settings");

    return sectionEl;
};
