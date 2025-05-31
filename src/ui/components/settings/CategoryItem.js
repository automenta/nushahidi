import { createEl, sanitizeHTML } from '../../../utils.js';

export class CategoryItem {
    constructor(category) {
        this.category = category;
        this.element = this.render();
    }

    render() {
        return createEl('span', { textContent: sanitizeHTML(this.category) });
    }
}
