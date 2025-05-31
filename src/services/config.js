import { appStore } from '../store.js';
import { C } from '../utils.js';
import { dbSvc } from './db.js';

const _getInitialSettings = () => ({
    rls: C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?', nip11: null })),
    tileUrl: C.TILE_SERVER_DEFAULT,
    tilePreset: 'OpenStreetMap',
    focusTags: [{ tag: C.FOCUS_TAG_DEFAULT, active: true }],
    cats: ['Incident', 'Observation', 'Aid'],
    mute: [],
    id: null,
    imgH: C.IMG_UPLOAD_NOSTR_BUILD,
    nip96H: '',
    nip96T: ''
});

const _migrateRelaySettings = (currentSettings) => {
    currentSettings.rls = currentSettings.rls || C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?', nip11: null }));
    currentSettings.rls.forEach(r => {
        if (r.status === undefined) r.status = '?';
        if (r.nip11 === undefined) r.nip11 = null;
    });
    return currentSettings.rls;
};

const _migrateFocusTags = (currentSettings) => {
    if (typeof currentSettings.focus === 'string') {
        const tags = [{ tag: currentSettings.focus, active: true }];
        delete currentSettings.focus;
        return tags;
    } else if (!currentSettings.focusTags || currentSettings.focusTags.length === 0) {
        return [{ tag: C.FOCUS_TAG_DEFAULT, active: true }];
    }
    return currentSettings.focusTags;
};

const _migrateTileSettings = (currentSettings) => {
    const tileUrl = currentSettings.tileUrl || currentSettings.tile || C.TILE_SERVER_DEFAULT;
    const tilePreset = currentSettings.tilePreset || (currentSettings.tile === C.TILE_SERVER_DEFAULT ? 'OpenStreetMap' : 'Custom');
    delete currentSettings.tile;
    return { tileUrl, tilePreset };
};

const _updateFollowedPubkeysInDb = async (newFollowed) => {
    const currentFollowed = await dbSvc.getFollowedPubkeys();

    for (const fp of newFollowed) {
        if (!currentFollowed.some(cf => cf.pk === fp.pk)) {
            await dbSvc.addFollowedPubkey(fp.pk);
        }
    }
    for (const cfp of currentFollowed) {
        if (!newFollowed.some(nfp => nfp.pk === cfp.pk)) {
            await dbSvc.rmFollowedPubkey(cfp.pk);
        }
    }
};

export const confSvc = {
    async load() {
        let settings = await dbSvc.loadSetts();
        let followedPubkeys = await dbSvc.getFollowedPubkeys();

        settings = settings || _getInitialSettings();

        const updatedRelays = _migrateRelaySettings(settings);
        const updatedFocusTags = _migrateFocusTags(settings);
        const { tileUrl, tilePreset } = _migrateTileSettings(settings);
        const currentFocusTag = updatedFocusTags.find(t => t.active)?.tag || C.FOCUS_TAG_DEFAULT;

        followedPubkeys = followedPubkeys || [];

        appStore.set({
            relays: updatedRelays,
            focusTags: updatedFocusTags,
            currentFocusTag: currentFocusTag,
            followedPubkeys: followedPubkeys,
            settings: {
                ...appStore.get().settings,
                tileUrl: tileUrl,
                tilePreset: tilePreset,
                cats: settings.cats,
                mute: settings.mute,
                imgHost: settings.imgH,
                nip96Host: settings.nip96H,
                nip96Token: settings.nip96T
            },
            user: settings.id ? { pk: settings.id.pk, authM: settings.id.authM } : null
        });
        return settings;
    },

    async save(partialSettings) {
        const currentSettings = await dbSvc.loadSetts() || {};
        const updatedSettings = { ...currentSettings, ...partialSettings };
        await dbSvc.saveSetts(updatedSettings);

        if (partialSettings.followedPubkeys !== undefined) {
            await _updateFollowedPubkeysInDb(partialSettings.followedPubkeys);
        }

        const appStoreUpdate = {
            relays: updatedSettings.rls || appStore.get().relays,
            focusTags: updatedSettings.focusTags || appStore.get().focusTags,
            currentFocusTag: updatedSettings.currentFocusTag || appStore.get().currentFocusTag,
            followedPubkeys: partialSettings.followedPubkeys !== undefined ? partialSettings.followedPubkeys : appStore.get().followedPubkeys,
            settings: {
                ...appStore.get().settings,
                tileUrl: updatedSettings.tileUrl || appStore.get().settings.tileUrl,
                tilePreset: updatedSettings.tilePreset || appStore.get().settings.tilePreset,
                cats: updatedSettings.cats || appStore.get().settings.cats,
                mute: updatedSettings.mute || appStore.get().settings.mute,
                imgHost: updatedSettings.imgH || appStore.get().settings.imgHost,
                nip96Host: updatedSettings.nip96H || appStore.get().settings.nip96Host,
                nip96Token: updatedSettings.nip96T || appStore.get().settings.nip96T
            },
            user: updatedSettings.id ? { pk: updatedSettings.id.pk, authM: updatedSettings.id.authM } : appStore.get().user
        };
        appStore.set(appStoreUpdate);
    },

    setRlys: rls => confSvc.save({ rls }),
    setFocusTags: tags => confSvc.save({ focusTags: tags }),
    setCurrentFocusTag: tag => confSvc.save({ currentFocusTag: tag }),
    setCats: c => confSvc.save({ cats: c }),
    addMute: pk => { const m = appStore.get().settings.mute; if (!m.includes(pk)) confSvc.save({ mute: [...m, pk] }) },
    rmMute: pk => confSvc.save({ mute: appStore.get().settings.mute.filter(p => p !== pk) }),
    saveId: id => confSvc.save({ id }),
    getId: async () => (await dbSvc.loadSetts())?.id,
    clearId: () => { appStore.set({ user: null }); confSvc.save({ id: null }) },
    setTileUrl: url => confSvc.save({ tileUrl: url, tilePreset: 'Custom' }),
    setTilePreset: (preset, url) => confSvc.save({ tilePreset: preset, tileUrl: url }),
    getTileServer: () => appStore.get().settings.tileUrl,
    getCurrentFocusTag: () => appStore.get().currentFocusTag,
    setImgHost: (host, isNip96 = false, token = '') => confSvc.save(isNip96 ? { nip96H: host, nip96T: token, imgH: '' } : { imgH: host, nip96H: '', nip96T: '' }),
    addFollowed: pk => { const f = appStore.get().followedPubkeys; if (!f.some(fp => fp.pk === pk)) confSvc.save({ followedPubkeys: [...f, { pk, followedAt: Date.now() }] }) },
    rmFollowed: pk => confSvc.save({ followedPubkeys: appStore.get().followedPubkeys.filter(fp => fp.pk !== pk) }),
    setFollowedPubkeys: f => confSvc.save({ followedPubkeys: f }),
};
