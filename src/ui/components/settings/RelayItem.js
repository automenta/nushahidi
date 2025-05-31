import {createEl, sanitizeHTML} from '../../../utils.js';

export class RelayItem {
    constructor(relay) {
        this.relay = relay;
        this.element = this.render();
    }

    render() {
        return createEl('span', {textContent: `${sanitizeHTML(this.relay.url)} (${this.relay.read ? 'R' : ''}${this.relay.write ? 'W' : ''}) - ${sanitizeHTML(this.relay.status)}`});
    }
}
