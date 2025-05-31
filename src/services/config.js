import { appStore } from '../store.js';
import { dbSvc } from './db.js';
import { C } from '../utils.js';

const getInitialSettings = () => ({
    rls: C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?' })),
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

const migrateRelaySettings = currentSettings => {
    currentSettings.rls = currentSettings.rls || C.RELAYS_DEFAULT.map(url => ({ url, read: true, write: true, status: '?' }));
    currentSettings.rls.forEach(r => {
        r.status = r.status ?? '?';
        r.nip11 = r.nip11 ?? null;
    });
    return currentSettings.rls;
};

const migrateFocusTags = currentSettings => {
    if (typeof currentSettings.focus === 'string') {
        const tags = [{ tag: currentSettings.focus, active: true }];
        delete currentSettings.focus;
        return tags;
    }
    return currentSettings.focusTags?.length ? currentSettings.focusTags : [{ tag: C.FOCUS_TAG_DEFAULT, active: true }];
};

const migrateTileSettings = currentSettings => {
    const tileUrl = currentSettings.tileUrl || currentSettings.tile || C.TILE_SERVER_DEFAULT;
    const tilePreset = currentSettings.tilePreset || (currentSettings.tile === C.TILE_SERVER_DEFAULT ? 'OpenStreetMap' : 'Custom');
    delete currentSettings.tile;
    return { tileUrl, tilePreset };
};

const updateFollowedPubkeysInDb = async newFollowed => {
    const currentFollowed = await dbSvc.getFollowedPubkeys();
    for (const fp of newFollowed) if (!currentFollowed.some(cf => cf.pk === fp.pk)) await dbSvc.addFollowedPubkey(fp);
    for (const cfp of currentFollowed) if (!newFollowed.some(nfp => nfp.pk === cfp.pk)) await dbSvc.rmFollowedPubkey(cfp.pk);
};

const applySettingsToStore = (settings, followedPubkeys) => {
    const updatedRelays = migrateRelaySettings(settings);
    const updatedFocusTags = migrateFocusTags(settings);
    const { tileUrl, tilePreset } = migrateTileSettings(settings);
    const currentFocusTag = updatedFocusTags.find(t => t.active)?.tag || C.FOCUS_TAG_DEFAULT;

    appStore.set(s => ({
        relays: updatedRelays,
        focusTags: updatedFocusTags,
        currentFocusTag,
        settings: {
            ...s.settings,
            rls: updatedRelays,
            focusTags: updatedFocusTags,
            tileUrl,
            tilePreset,
            cats: settings.cats || getInitialSettings().cats,
            mute: settings.mute || getInitialSettings().mute,
            id: settings.id || getInitialSettings().id,
            imgH: settings.imgH || getInitialSettings().imgH,
            nip96H: settings.nip96H || getInitialSettings().nip96H,
            nip96T: settings.nip96T || getInitialSettings().nip96T
        },
        followedPubkeys: followedPubkeys || []
    }));
};

export const confSvc = {
    async load() {
        const settings = await dbSvc.loadSetts() || getInitialSettings();
        const followedPubkeys = await dbSvc.getFollowedPubkeys();
        applySettingsToStore(settings, followedPubkeys);
        return settings;
    },

    async save(partialSettings) {
        const currentSettings = await dbSvc.loadSetts() || {};
        await dbSvc.saveSetts({ ...currentSettings, ...partialSettings });
        if (partialSettings.followedPubkeys !== undefined) await updateFollowedPubkeysInDb(partialSettings.followedPubkeys);
        await this.load();
    },

    setRlys: rls => confSvc.save({ rls }),
    setFocusTags: tags => confSvc.save({ focusTags: tags }),
    setCurrentFocusTag: tag => confSvc.save({ currentFocusTag: tag }),
    setCats: c => confSvc.save({ cats: c }),
    addMute: pk => {
        const m = appStore.get().settings.mute;
        if (!m.includes(pk)) confSvc.save({ mute: [...m, pk] });
    },
    rmMute: pk => confSvc.save({ mute: appStore.get().settings.mute.filter(mpk => mpk !== pk) }),
    setTilePreset: (preset, url) => confSvc.save({ tilePreset: preset, tileUrl: url }),
    getTileServer: () => appStore.get().settings.tileUrl,
    getCurrentFocusTag: () => appStore.get().currentFocusTag,
    setImgHost: (host, isNip96 = false, token = '') => confSvc.save(isNip96 ? { nip96H: host, nip96T: token, imgH: '' } : { imgH: host, nip96H: '', nip96T: '' }),
    addFollowed: pk => {
        const f = appStore.get().followedPubkeys;
        if (!f.some(fp => fp.pk === pk)) confSvc.save({ followedPubkeys: [...f, { pk, followedAt: Date.now() }] });
    },
    rmFollowed: pk => confSvc.save({ followedPubkeys: appStore.get().followedPubkeys.filter(fp => fp.pk !== pk) }),
    setFollowedPubkeys: f => confSvc.save({ followedPubkeys: f }),
    getId: () => appStore.get().settings.id,
    setId: id => confSvc.save({ id }),
    clearId: () => confSvc.save({ id: null })
};
