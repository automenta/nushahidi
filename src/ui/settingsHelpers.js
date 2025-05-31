import { appStore } from '../store.js';
import { confSvc } from '../services.js'; // Only need confSvc here
import { C, $, createEl, sanitizeHTML, formatNpubShort, npubToHex, showToast, isValidUrl } from '../utils.js';
import { renderList } from './forms.js';

// Helper to create list rendering functions
export const createListSectionRenderer = (containerId, itemRenderer, actionsConfig, itemWrapperClass) => (modalContent) => {
    renderList(containerId, appStore.get()[containerId.replace('-list', '')] || appStore.get().settings[containerId.replace('-list', '')], itemRenderer, actionsConfig, itemWrapperClass, modalContent);
};

// Factory for addLogic functions
export const createAddLogicHandler = (confSvcMethod, itemExistsChecker, successMsg, warningMsg, errorMsg) => async (inputValue) => {
    if (!inputValue) {
        showToast("Input cannot be empty.", 'warning');
        return false;
    }
    try {
        if (itemExistsChecker && itemExistsChecker(inputValue)) {
            showToast(warningMsg || "Item already exists.", 'info');
            return false;
        }
        await confSvcMethod(inputValue);
        showToast(successMsg || "Item added.", 'success');
        return true;
    } catch (e) {
        showToast(`${errorMsg || 'Error adding item'}: ${e.message}`, 'error');
        return false;
    }
};

// Specific addLogic functions using the factory
export const addRelayLogic = createAddLogicHandler(
    async (url) => confSvc.setRlys([...appStore.get().relays, { url, read: true, write: true, status: '?' }]),
    (url) => appStore.get().relays.some(r => r.url === url),
    "Relay added.",
    "Relay already exists.",
    "Error adding relay"
);

export const addCategoryLogic = createAddLogicHandler(
    (cat) => confSvc.setCats([...appStore.get().settings.cats, cat]),
    (cat) => appStore.get().settings.cats.includes(cat),
    "Category added.",
    "Category already exists.",
    "Error adding category"
);

export const addFocusTagLogic = createAddLogicHandler(
    async (tag) => {
        if (!tag.startsWith('#')) tag = '#' + tag;
        confSvc.setFocusTags([...appStore.get().focusTags, { tag, active: false }]);
    },
    (tag) => appStore.get().focusTags.some(t => t.tag === (tag.startsWith('#') ? tag : '#' + tag)),
    "Focus tag added.",
    "Focus tag already exists.",
    "Error adding focus tag"
);

export const addMutePubkeyLogic = createAddLogicHandler(
    async (pk) => confSvc.addMute(npubToHex(pk)),
    (pk) => appStore.get().settings.mute.includes(npubToHex(pk)),
    "Pubkey added to mute list.",
    "Pubkey already muted.",
    "Error adding pubkey to mute list"
);

export const addFollowedPubkeyLogic = createAddLogicHandler(
    async (pk) => confSvc.addFollowed(npubToHex(pk)),
    (pk) => appStore.get().followedPubkeys.some(f => f.pk === npubToHex(pk)),
    "User added to followed list.",
    "User already followed.",
    "Error adding user to followed list"
);
