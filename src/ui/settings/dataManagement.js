import {appStore} from '../../store.js';
import {confSvc, dbSvc} from '../../services.js';
import {showToast, createEl} from '../../utils.js';
import {withLoading, withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';
import {showConfirmModal} from '../modals.js';

export const DataManagementSection = () => {
    let sectionEl;
    let form;
    let clearReportsBtn;
    let exportSettingsBtn;
    let importSettingsFile;

    const render = () => {
        if (!sectionEl) {
            sectionEl = createEl('section');
            const dataManagementFormFields = [
                { type: 'button', id: 'clr-reps-btn', label: 'Clear Cached Reports' },
                { type: 'button', id: 'exp-setts-btn', label: 'Export Settings' },
                { label: 'Import Settings:', type: 'file', id: 'imp-setts-file', name: 'importSettingsFile', accept: '.json' }
            ];

            form = renderForm(dataManagementFormFields, {}, { id: 'data-management-form' });
            sectionEl.appendChild(form);

            clearReportsBtn = form.querySelector('#clr-reps-btn');
            exportSettingsBtn = form.querySelector('#exp-setts-btn');
            importSettingsFile = form.querySelector('#imp-setts-file');

            clearReportsBtn.onclick = () => {
                showConfirmModal(
                    "Clear Cached Reports",
                    "Are you sure you want to clear all cached reports from your local database? This will not delete them from relays.",
                    withLoading(withToast(async () => {
                        await dbSvc.clearReps();
                        appStore.set({ reports: [] });
                    }, "Cached reports cleared.", "Error clearing reports")),
                    () => showToast("Clearing reports cancelled.", 'info')
                );
            };

            exportSettingsBtn.onclick = withLoading(withToast(async () => {
                const exportData = { settings: await dbSvc.loadSetts(), followedPubkeys: await dbSvc.getFollowedPubkeys() };
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", "nostrmapper_settings.json");
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.remove();
            }, "Settings exported.", "Error exporting settings"));

            importSettingsFile.onchange = async e => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async event => {
                    try {
                        const importedData = JSON.parse(event.target.result);
                        if (!importedData.settings || !importedData.followedPubkeys) throw new Error("Invalid settings file format.");

                        showConfirmModal(
                            "Import Settings",
                            "Are you sure you want to import settings? This will overwrite your current settings and followed users.",
                            withLoading(withToast(async () => {
                                await dbSvc.saveSetts(importedData.settings);
                                await dbSvc.clearFollowedPubkeys();
                                for (const fp of importedData.followedPubkeys) await dbSvc.addFollowedPubkey(fp.pk);
                                await confSvc.load();
                                showToast("Settings imported successfully! Please refresh the page.", 'success', 5000);
                                setTimeout(() => { if (confirm("Settings imported. Reload page now?")) window.location.reload(); }, 2000);
                            }, null, "Error importing settings")),
                            () => showToast("Import cancelled.", 'info')
                        );
                    } catch (err) {
                        showToast(`Failed to parse settings file: ${err.message}`, 'error');
                    }
                };
                reader.readAsText(file);
            };
        }
        return sectionEl;
    };
    return render();
};
