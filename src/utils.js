import { nip19 } from 'nostr-tools';
import ngeohash from 'ngeohash';
import { showConfirmModal } from './ui.js'; // New import for renderList

export const C = { // Constants
    NOSTR_KIND_REPORT: 30315,
    NOSTR_KIND_REACTION: 7,
    NOSTR_KIND_NOTE: 1,
    NOSTR_KIND_PROFILE: 0,
    NOSTR_KIND_CONTACTS: 3,
    RELAYS_DEFAULT: ['wss://relay.damus.io', 'wss://relay.snort.social', 'wss://nostr.wine', 'wss://nos.lol'],
    TILE_SERVER_DEFAULT: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    TILE_SERVERS_PREDEFINED: [
        { name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
        { name: 'Stamen Toner', url: 'http://stamen-tiles-{s}.a.ssl.fastly.net/toner/{z}/{x}/{y}.png' },
        { name: 'Stamen Terrain', url: 'http://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}.png' },
        { name: 'ESRI World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' }
    ],
    FOCUS_TAG_DEFAULT: '#NostrMapper_Global',
    DB_NAME: 'NostrMapperDB_vFinal',
    DB_VERSION: 1,
    STORE_REPORTS: 'reports',
    STORE_PROFILES: 'profiles',
    STORE_SETTINGS: 'settings',
    STORE_OFFLINE_QUEUE: 'offlineQueue',
    STORE_DRAWN_SHAPES: 'drawnShapes',
    STORE_FOLLOWED_PUBKEYS: 'followedPubkeys',
    IMG_UPLOAD_NOSTR_BUILD: 'https://nostr.build/api/v2/upload/files',
    IMG_SIZE_LIMIT_BYTES: 5 * 1024 * 1024, // 5MB
    ONBOARDING_KEY: 'nostrmapper_onboarded_v1',
    DB_PRUNE_REPORTS_MAX: 5000, // Max number of reports to keep
    DB_PRUNE_PROFILES_MAX_AGE_DAYS: 30 // Max age for profiles in days
};

export const $ = (selector, parent = document) => parent.querySelector(selector);
export const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

export function createEl(tagName, attributes = {}, children = []) {
    const element = document.createElement(tagName);

    Object.entries(attributes).forEach(([key, value]) => {
        if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.substring(2).toLowerCase(), value);
        } else if (typeof value === 'boolean') {
            value ? element.setAttribute(key, '') : element.removeAttribute(key);
        } else if (key === 'textContent') {
            element.textContent = value;
        } else if (key === 'innerHTML') {
            element.innerHTML = value;
        } else {
            element.setAttribute(key, value);
        }
    });

    (Array.isArray(children) ? children : [children]).forEach(child => {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    });

    return element;
}

export const showModal = (id, focusElId) => {
    const modal = $(`#${id}`);
    if (modal) {
        modal.style.display = 'block';
        modal.setAttribute('aria-hidden', 'false');
        if (focusElId) $(focusElId, modal)?.focus();
    }
    appStore.set(s => ({ ...s, ui: { ...s.ui, modalOpen: id } }));
};

export const hideModal = (id) => {
    const modal = $(`#${id}`);
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    appStore.set(s => ({ ...s.ui, modalOpen: null }));
};

export const sanitizeHTML = s => (s == null ? '' : String(s).replace(/[&<>"']/g, m => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
}));

const CRYPTO = { ALG: 'AES-GCM', IV_L: 12, SALT_L: 16, ITER: 1e5 };

async function deriveKey(passphrase, salt) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: CRYPTO.ITER, hash: 'SHA-256' },
        keyMaterial,
        { name: CRYPTO.ALG, length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

export async function encrypt(data, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(CRYPTO.SALT_L));
    const iv = crypto.getRandomValues(new Uint8Array(CRYPTO.IV_L));
    const key = await deriveKey(passphrase, salt);
    const encryptedData = await crypto.subtle.encrypt(
        { name: CRYPTO.ALG, iv: iv },
        key,
        new TextEncoder().encode(data)
    );

    const result = new Uint8Array(salt.length + iv.length + encryptedData.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encryptedData), salt.length + iv.length);

    return btoa(String.fromCharCode(...result));
}

export async function decrypt(encryptedDataString, passphrase) {
    try {
        const encryptedDataBytes = Uint8Array.from(atob(encryptedDataString), c => c.charCodeAt(0));
        const salt = encryptedDataBytes.slice(0, CRYPTO.SALT_L);
        const iv = encryptedDataBytes.slice(CRYPTO.SALT_L, CRYPTO.SALT_L + CRYPTO.IV_L);
        const data = encryptedDataBytes.slice(CRYPTO.SALT_L + CRYPTO.IV_L);
        const key = await deriveKey(passphrase, salt);
        const decryptedContent = await crypto.subtle.decrypt(
            { name: CRYPTO.ALG, iv: iv },
            key,
            data
        );
        return new TextDecoder().decode(decryptedContent);
    } catch (e) {
        throw new Error('Decryption failed.');
    }
}

export async function sha256(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const nsecToHex = s => s.startsWith('nsec') ? nip19.decode(s).data : s;
export const npubToHex = p => p.startsWith('npub') ? nip19.decode(p).data : p;
export const geohashEncode = (lat, lon, prec = 7) => ngeohash.encode(lat, lon, prec);
export const geohashDecode = gStr => ngeohash.decode(gStr);

export function parseReport(event) {
    const tags = event.tags;
    const report = {
        id: event.id,
        pk: event.pubkey,
        at: event.created_at,
        tags: tags,
        ct: event.content,
        title: tags.find(t => t[0] === 'title')?.[1] || '',
        sum: tags.find(t => t[0] === 'summary')?.[1] || '',
        gh: tags.find(t => t[0] === 'g')?.[1],
        cat: tags.filter(t => t[0] === 'l' && t[2] === 'report-category').map(t => t[1]),
        fTags: tags.filter(t => t[0] === 't').map(t => t[1]),
        imgs: tags.filter(t => t[0] === 'image').map(tg => ({ url: tg[1], type: tg[2], dim: tg[3], hHex: tg[4] })),
        evType: tags.find(t => t[0] === 'event_type')?.[1],
        stat: tags.find(t => t[0] === 'status')?.[1] || 'new',
        lat: null,
        lon: null,
        interactions: [],
        d: tags.find(t => t[0] === 'd')?.[1] || null
    };

    if (report.gh) {
        const { latitude, longitude } = geohashDecode(report.gh);
        report.lat = latitude;
        report.lon = longitude;
    }
    return report;
}

export const getGhPrefixes = (bounds, minPrecision = 4, maxPrecision = 6) => {
    if (!bounds) return [];
    const center = bounds.getCenter();
    const prefixes = new Set();
    for (let i = minPrecision; i <= maxPrecision; i++) {
        prefixes.add(ngeohash.encode(center.lat, center.lng, i));
    }
    return Array.from(prefixes);
};

export const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
};

export const getImgDims = file => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
});

export const formatNpubShort = pk => nip19.npubEncode(pk).substring(0, 12) + '...';
export const isNostrId = id => /^[0-9a-f]{64}$/.test(id);

/**
 * Renders a list of items into a specified container with flexible item rendering and actions.
 * @param {string} containerId - The ID of the container element.
 * @param {Array<object>} items - Array of items to render.
 * @param {function(object, number): (string|HTMLElement)} itemRenderer - Function to render a single item's display content.
 *                                                                 Should return a string (HTML) or a DOM element.
 * @param {Array<object>} actionsConfig - Array of action button configurations for each item.
 *   Each action object: {
 *     label: string,
 *     className: string,
 *     onClick: function(item: object, index: number), // Now passes index
 *     confirm?: { title: string, message: string } // Optional confirmation modal config
 *   }
 * @param {string} itemWrapperClass - CSS class for the div wrapping each item.
 * @param {HTMLElement} [scopeElement=document] - The element to scope queries for containerId.
 */
export const renderList = (containerId, items, itemRenderer, actionsConfig, itemWrapperClass, scopeElement = document) => {
    const container = $(`#${containerId}`, scopeElement);
    if (!container) {
        console.warn(`Container with ID ${containerId} not found for list rendering.`);
        return;
    }
    container.innerHTML = '';

    if (items.length === 0) {
        container.textContent = `No ${containerId.replace('-', ' ')}s configured.`;
        return;
    }

    items.forEach((item, index) => { // Added index here
        const itemContent = itemRenderer(item, index); // Pass index to itemRenderer
        const itemDiv = createEl('div', { class: itemWrapperClass });

        if (typeof itemContent === 'string') {
            itemDiv.innerHTML = itemContent;
        } else if (itemContent instanceof Node) {
            itemDiv.appendChild(itemContent);
        } else {
            console.warn('itemRenderer must return a string or HTMLElement.');
            return;
        }

        actionsConfig.forEach(action => {
            const actionBtn = createEl('button', {
                type: 'button', // Ensure it's a button, not submit
                class: action.className,
                textContent: action.label,
                onclick: () => {
                    if (action.confirm) {
                        showConfirmModal(
                            action.confirm.title,
                            action.confirm.message,
                            () => action.onClick(item, index), // Pass index to onClick
                            () => showToast("Action cancelled.", 'info')
                        );
                    } else {
                        action.onClick(item, index); // Pass index to onClick
                    }
                }
            });
            itemDiv.appendChild(actionBtn);
        });
        container.appendChild(itemDiv);
    });
};

// New: Toast Notification System
export function showToast(message, type = 'info', duration = 3000, valueToCopy = null) {
    const toastContainer = $('#toast-container');
    if (!toastContainer) {
        console.warn('Toast container not found. Message:', message);
        return;
    }

    const toast = createEl('div', { class: `toast toast-${type}` });
    toast.appendChild(createEl('span', { textContent: message })); // Wrap message in a span

    if (valueToCopy) {
        const copyButton = createEl('button', {
            class: 'copy-button',
            textContent: 'Copy'
        });
        copyButton.onclick = async () => {
            try {
                await navigator.clipboard.writeText(valueToCopy);
                showToast('Copied to clipboard!', 'success', 1500);
            } catch (err) {
                console.error('Failed to copy:', err);
                showToast('Failed to copy to clipboard.', 'error', 1500);
            }
        };
        toast.appendChild(copyButton);
    }

    toastContainer.appendChild(toast);

    // Force reflow to enable CSS transition
    void toast.offsetWidth;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

// New: URL validation helper
export const isValidUrl = (string) => {
    try {
        new URL(string);
        return true;
    } catch (e) {
        return false;
    }
};

// New: UUID generator for NIP-33 d-tag
export const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};
