import {C, createEl, formatNpubShort, sanitizeHTML} from '../../utils.js';
import {marked} from 'marked';

export class InteractionItem {
    constructor(interaction) {
        this.interaction = interaction;
        this.element = this.render();
    }

    render() {
        const interactionUser = formatNpubShort(this.interaction.pubkey);
        const interactionTime = new Date(this.interaction.created_at * 1000).toLocaleString();
        const contentSnippet = this.interaction.content.substring(0, 50) + (this.interaction.content.length > 50 ? '...' : '');
        const eventIdSnippet = this.interaction.id.substring(0, 8);
        const contentHtml = this.interaction.kind === C.NOSTR_KIND_REACTION ?
            `<strong>${sanitizeHTML(interactionUser)}</strong> reacted: ${sanitizeHTML(this.interaction.content)} <small>(${interactionTime})</small>` :
            `<strong>${sanitizeHTML(interactionUser)}</strong> commented: ${marked.parse(sanitizeHTML(this.interaction.content))} <small>(${interactionTime})</small>`;

        return createEl('div', {class: 'interaction-item', innerHTML: contentHtml});
    }
}
