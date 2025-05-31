import { createEl, sanitizeHTML } from '../../../utils.js';
import { appStore } from '../../../store.js';
import { confSvc, nostrSvc } from '../../../services.js';

export class FocusTagItem {
    constructor(focusTag) {
        this.focusTag = focusTag;
        this.element = this.render();
    }

    handleRadioChange = () => {
        const updatedTags = appStore.get().focusTags.map(t => ({ ...t, active: t.tag === this.focusTag.tag }));
        confSvc.setFocusTags(updatedTags);
        confSvc.setCurrentFocusTag(this.focusTag.tag);
        nostrSvc.refreshSubs();
    };

    render() {
        return createEl('div', {}, [
            createEl('span', { textContent: `${sanitizeHTML(this.focusTag.tag)}${this.focusTag.active ? ' (Active)' : ''}` }),
            createEl('label', {}, [
                createEl('input', {
                    type: 'radio',
                    name: 'activeFocusTag',
                    value: this.focusTag.tag,
                    checked: this.focusTag.active,
                    onchange: this.handleRadioChange
                }),
                ` Set Active`
            ])
        ]);
    }
}
