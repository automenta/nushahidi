import {appStore} from './store.js';
import {showToast} from './utils.js';

export const withLoading = fn => async (...args) => {
    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
    try {
        return await fn(...args);
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
    }
};

export const withToast = (fn, successMsg, errorMsg, onErrorCallback = null) => async (...args) => {
    try {
        const result = await fn(...args);
        if (successMsg) showToast(successMsg, 'success');
        return result;
    } catch (e) {
        showToast(`${errorMsg || 'An error occurred'}: ${e.message}`, 'error');
        onErrorCallback?.(e);
        throw e;
    }
};
