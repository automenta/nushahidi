import { appStore } from '../store.js';
import { C } from '../utils.js';

export const imgSvc = {
    async upload(file) {
        const { imgHost, nip96Host, nip96Token } = appStore.get().settings;

        if (!file.type.startsWith('image/')) {
            throw new Error('Invalid file type. Only images are allowed.');
        }
        if (file.size > C.IMG_SIZE_LIMIT_BYTES) {
            throw new Error(`File too large (max ${C.IMG_SIZE_LIMIT_BYTES / 1024 / 1024}MB).`);
        }

        let uploadUrl = imgHost;
        let headers = {};
        let body;

        if (nip96Host) {
            uploadUrl = nip96Host;
            if (nip96Token) headers['Authorization'] = `Bearer ${nip96Token}`;
            body = file;
            headers['Content-Type'] = file.type;
        } else if (!imgHost || imgHost === C.IMG_UPLOAD_NOSTR_BUILD) {
            uploadUrl = C.IMG_UPLOAD_NOSTR_BUILD;
            const formData = new FormData();
            formData.append('file', file);
            body = formData;
        } else {
            const formData = new FormData();
            formData.append('file', file);
            body = formData;
        }

        try {
            const response = await fetch(uploadUrl, { method: 'POST', body: body, headers });
            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
            }
            const data = await response.json();

            let finalUrl = data.url || data.uri || data.link || (Array.isArray(data.data) && data.data[0]?.url) || (data.data?.url);
            if (!finalUrl && typeof data === 'string' && data.startsWith('http')) finalUrl = data;
            if (!finalUrl) throw new Error('Image URL not found in response from host.');

            return finalUrl;
        } catch (e) {
            console.error("Image upload error:", e);
            throw new Error(`Image upload failed: ${e.message}`);
        }
    }
};
