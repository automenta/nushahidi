import {appStore} from '../store.js';
import {confSvc, nostrSvc} from '../services.js';
import {createEl, showToast, sanitizeHTML, formatNpubShort} from '../utils.js';
import {showConfirmModal} from '../modals.js';
import {withLoading, withToast} from '../decorators.js';
import {C} from '../utils.js';

export function getSettingItems(listId) {
    switch (listId) {
        case 'rly-list': return appStore.get().relays;
        case 'followed-list': return appStore.get().followedPubkeys;
        case 'focus-tag-list': return appStore.get().focusTags;
        case 'cat-list': return appStore.get().settings.cats;
        case 'mute-list': return appStore.get().settings.mute;
        default: return [];
    }
}

export const renderRelayItem = r => createEl('span', { textContent: `${sanitizeHTML(r.url)} (${r.read ? 'R' : ''}${r.write ? 'W' : ''}) - ${sanitizeHTML(r.status)}` });

export const handleRelayRemove = r => {
    const updatedRelays = appStore.get().relays.filter(rl => rl.url !== r.url);
    confSvc.setRlys(updatedRelays);
    nostrSvc.discAllRlys();
    nostrSvc.connRlys();
};

export const renderFocusTagItem = ft => createEl('div', {}, [
    createEl('span', { textContent: `${sanitizeHTML(ft.tag)}${ft.active ? ' (Active)' : ''}` }),
    createEl('label', {}, [
        createEl('input', {
            type: 'radio',
            name: 'activeFocusTag',
            value: ft.tag,
            checked: ft.active,
            onchange: () => handleFocusTagRadioChange(ft.tag)
        }),
        ` Set Active`
    ])
]);

export const handleFocusTagRadioChange = tag => {
    const updatedTags = appStore.get().focusTags.map(t => ({ ...t, active: t.tag === tag }));
    confSvc.setFocusTags(updatedTags);
    confSvc.setCurrentFocusTag(tag);
    nostrSvc.refreshSubs();
};

export const handleFocusTagRemove = t => {
    const updatedTags = appStore.get().focusTags.filter(ft => ft.tag !== t.tag);
    confSvc.setFocusTags(updatedTags);
    if (t.active && updatedTags.length) {
        confSvc.setCurrentFocusTag(updatedTags[0].tag);
        updatedTags[0].active = true;
    } else if (!updatedTags.length) {
        confSvc.setCurrentFocusTag(C.FOCUS_TAG_DEFAULT);
        confSvc.setFocusTags([{ tag: C.FOCUS_TAG_DEFAULT, active: true }]);
    }
};

export const renderCategoryItem = c => createEl('span', { textContent: sanitizeHTML(c) });

export const handleCategoryRemove = c => confSvc.setCats(appStore.get().settings.cats.filter(cat => cat !== c));

export const renderMutePubkeyItem = pk => createEl('span', { textContent: formatNpubShort(pk) });

export const handleMutePubkeyRemove = pk => confSvc.rmMute(pk);

export const renderFollowedPubkeyItem = f => createEl('span', { textContent: formatNpubShort(f.pk) });

export const handleFollowedPubkeyRemove = f => confSvc.rmFollowed(f.pk);
