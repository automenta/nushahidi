import { appStore } from '../../store.js';
import { confSvc } from '../../services.js';
import { C, createEl, showToast, npubToHex } from '../../utils.js';
// Import createAddLogicHandler from the new settingsUtils.js
import { createAddLogicHandler } from './settingsUtils.js';

// The specific add logic handlers remain here, using the imported createAddLogicHandler
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
