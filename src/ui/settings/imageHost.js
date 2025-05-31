import {appStore} from '../../store.js';
import {confSvc} from '../../services.js';
import {C, isValidUrl, createEl} from '../../utils.js';
import {withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';

export const ImageHostSection = () => {
    let sectionEl;
    let form;
    let imgHostSel;
    let nip96Fields;
    let nip96UrlIn;
    let nip96TokenIn;
    let saveBtn;

    const render = (appState) => {
        if (!sectionEl) {
            sectionEl = document.createElement('section');
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

            form = renderForm(imageHostFormFields, {}, { id: 'image-host-form' });
            sectionEl.appendChild(form);
            saveBtn = createEl('button', { type: 'button', id: 'save-img-host-btn', textContent: 'Save Image Host' });
            sectionEl.appendChild(saveBtn);

            imgHostSel = form.querySelector('#img-host-sel');
            nip96Fields = form.querySelector('#nip96-fields');
            nip96UrlIn = form.querySelector('#nip96-url-in');
            nip96TokenIn = form.querySelector('#nip96-token-in');

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
        }

        imgHostSel.value = appState.settings.nip96Host ? 'nip96' : (appState.settings.imgHost || C.IMG_UPLOAD_NOSTR_BUILD);
        nip96Fields.style.display = appState.settings.nip96Host ? '' : 'none';
        nip96UrlIn.value = appState.settings.nip96Host;
        nip96TokenIn.value = appState.settings.nip96Token;

        return sectionEl;
    };

    appStore.on((newState, oldState) => {
        if (newState.settings.imgHost !== oldState?.settings?.imgHost ||
            newState.settings.nip96Host !== oldState?.settings?.nip96Host ||
            newState.settings.nip96Token !== oldState?.settings?.nip96Token) {
            render(newState);
        }
    });

    return render(appStore.get());
};
