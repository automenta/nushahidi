import { appStore } from '../store.js';
import { C } from '../utils.js';

export const imgSvc = {
    async upload(file) {
        const { imgH, nip96H, nip96T } = appStore.get().settings;

        if (!file.type.startsWith('image/')) throw new Error('Invalid file type. Only images are allowed.');
        if (file.size > C.IMG_SIZE_LIMIT_BYTES) throw new Error(`File too large (max ${C.IMG_SIZE_LIMIT_BYTES / 1024 / 1024}MB).`);

        const uploadUrl = nip96H || imgH || C.IMG_UPLOAD_NOSTR_BUILD;
        const headers = nip96H && nip96T ? { 'Authorization': `Bearer ${nip96T}` } : {};
        const body = nip96H ? (Object.assign(headers, { 'Content-Type': file.type }), file) : ((formData) => {
            formData.append('file', file);
            return formData;
        })(new FormData());

        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: nip96H ? headers : {},
            body: nip96H ? body : new FormData(body)
        });

        if (!response.ok) throw new Error(`Image upload failed: ${response.statusText}`);

        const data = await response.json();
        return nip96H ? data.data.url : data.data.link;
    }
};
