import { createEl, formatNpubShort } from '../../../utils.js';

export class FollowedPubkeyItem {
    constructor(followedPubkey) {
        this.followedPubkey = followedPubkey;
        this.element = this.render();
    }

    render() {
        return createEl('span', { textContent: formatNpubShort(this.followedPubkey.pk) });
    }
}
