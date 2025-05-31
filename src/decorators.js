import { appStore } from './store.js';
import { showToast } from './utils.js';

/**
 * A higher-order function that wraps an async function to show a global loading spinner
 * during its execution.
 * @param {Function} fn The async function to wrap.
 * @returns {Function} A new async function that includes loading state management.
 */
export const withLoading = (fn) => async (...args) => {
    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
    try {
        return await fn(...args);
    } finally {
        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
    }
};

/**
 * A higher-order function that wraps an async function to display toasts
 * for success or error messages.
 * @param {Function} fn The async function to wrap.
 * @param {string} [successMsg] Message to show on successful execution.
 * @param {string} [errorMsg] Message to show on error.
 * @param {Function} [onErrorCallback] Optional callback to execute on error.
 * @returns {Function} A new async function that includes toast notifications.
 */
export const withToast = (fn, successMsg, errorMsg, onErrorCallback = null) => async (...args) => {
    try {
        const result = await fn(...args);
        if (successMsg) showToast(successMsg, 'success');
        return result;
    } catch (e) {
        showToast(`${errorMsg || 'An error occurred'}: ${e.message}`, 'error');
        if (onErrorCallback) onErrorCallback(e);
        throw e; // Re-throw to allow further error handling if needed
    }
};
