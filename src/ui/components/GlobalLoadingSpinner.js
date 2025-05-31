import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';

export function GlobalLoadingSpinner() {
    let spinnerEl;

    const render = (loading) => {
        if (!spinnerEl) {
            spinnerEl = createEl('div', { class: 'spinner-overlay' });
            spinnerEl.appendChild(createEl('div', { class: 'spinner' }));
        }
        spinnerEl.style.display = loading ? 'flex' : 'none';
        return spinnerEl;
    };

    appStore.on((newState, oldState) => {
        if (newState.ui.loading !== oldState?.ui?.loading) {
            render(newState.ui.loading);
        }
    });

    return render(appStore.get().ui.loading);
}
