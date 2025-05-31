import {createEl, sanitizeHTML} from '../../utils.js';

export class ImagePreviewItem {
    constructor(imageMetadata, onRemove) {
        this.imageMetadata = imageMetadata;
        this.onRemove = onRemove;
        this.element = this.render();
    }

    render() {
        const removeBtn = createEl('button', {
            type: 'button',
            class: 'remove-image-btn',
            textContent: 'x',
            onclick: this.onRemove
        });
        return createEl('div', {class: 'uploaded-image-item'}, [
            createEl('span', {textContent: sanitizeHTML(this.imageMetadata.url.substring(this.imageMetadata.url.lastIndexOf('/') + 1))}),
            removeBtn
        ]);
    }
}
