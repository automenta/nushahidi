import {createEl, formatNpubShort} from '../../../utils.js';

export class MutePubkeyItem {
    constructor(pubkey) {
        this.pubkey = pubkey;
        this.element = this.render();
    }

    render() {
        return createEl('span', {textContent: formatNpubShort(this.pubkey)});
    }
}
