import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';

export class GlobalLoadingSpinner {
    constructor() {
        this.spinnerEl = createEl('div', {class: 'global-spinner'});
        this.spinnerEl.appendChild(createEl('div', {class: 'spinner'}));
        this.spinnerEl.appendChild(createEl('p', {textContent: 'Loading...'}));

        this.render(appStore.get().ui.loading);

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.ui.loading !== oldState?.ui?.loading) {
                this.render(newState.ui.loading);
            }
        });
    }

    render(loading) {
        this.spinnerEl.style.display = loading ? 'flex' : 'none';
        return this.spinnerEl;
    }
}
