import {appStore} from '../store.js';
import {C} from '../utils.js';

export const imgSvc = {
    async upload(file) {
        const { imgHost, nip96Host, nip96Token } = appStore.get().settings;

        if (!file.type.startsWith('image/')) throw new Error('Invalid file type. Only images are allowed.');
        if (file.size > C.IMG_SIZE_LIMIT_BYTES) throw new Error(`File too large (max ${C.IMG_SIZE_LIMIT_BYTES / 1024 / 1024}MB).`);

        const uploadUrl = nip96Host || imgHost || C.IMG_UPLOAD_NOSTR_BUILD;
        const headers = nip96Host && nip96Token ? { 'Authorization': `Bearer ${nip96Token}` } : {};
        const body = nip96Host ? (Object.assign(headers, { 'Content-Type': file.type }), file) : (() => {
            const formData = new FormData();
            formData.append('file', file);
            return formData;
        })();

        try {
            const response = await fetch(uploadUrl, { method: 'POST', body, headers });
            if (!response.ok) throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
            const data = await response.json();

            const finalUrl = data.url || data.uri || data.link || (Array.isArray(data.data) && data.data[0]?.url) || data.data?.url || (typeof data === 'string' && data.startsWith('http') ? data : null);
            if (!finalUrl) throw new Error('Image URL not found in response from host.');

            return finalUrl;
        } catch (e) {
            console.error("Image upload error:", e);
            throw new Error(`Image upload failed: ${e.message}`);
        }
    }
};
