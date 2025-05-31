import {appStore} from '../../store.js';
import {confSvc, dbSvc} from '../../services.js';
import {showToast, createEl} from '../../utils.js';
import {withLoading, withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';
import {showConfirmModal} from '../modals.js';

export class DataManagementSection {
    constructor() {
        this.sectionEl = createEl('section');
        this.form = null;
        this.clearReportsBtn = null;
        this.exportSettingsBtn = null;
        this.importSettingsFile = null;

        this.render();
    }

    render() {
        const dataManagementFormFields = [
            {type: 'button', ref: 'clearReportsBtn', label: 'Clear Cached Reports'},
            {type: 'button', ref: 'exportSettingsBtn', label: 'Export Settings'},
            {label: 'Import Settings:', type: 'file', ref: 'importSettingsFile', name: 'importSettingsFile', accept: '.json'}
        ];

        const {form, fields} = renderForm(dataManagementFormFields, {}, {class: 'data-management-form'});

        if (!this.form) {
            this.form = form;
            this.sectionEl.appendChild(this.form);
        } else {
            this.form.replaceWith(form);
            this.form = form;
        }

        this.clearReportsBtn = fields.clearReportsBtn;
        this.exportSettingsBtn = fields.exportSettingsBtn;
        this.importSettingsFile = fields.importSettingsFile;

        this.clearReportsBtn.onclick = () => {
            showConfirmModal(
                "Clear Cached Reports",
                "Are you sure you want to clear all cached reports from your local database? This will not delete them from relays.",
                withLoading(withToast(async () => {
                    await dbSvc.clearReps();
                    appStore.set({reports: []});
                }, "Cached reports cleared.", "Error clearing reports")),
                () => showToast("Clearing reports cancelled.", 'info')
            );
        };

        this.exportSettingsBtn.onclick = withLoading(withToast(async () => {
            const exportData = {settings: await dbSvc.loadSetts(), followedPubkeys: await dbSvc.getFollowedPubkeys()};
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "nostrmapper_settings.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        }, "Settings exported.", "Error exporting settings"));

        this.importSettingsFile.onchange = async e => {
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
                            setTimeout(() => {
                                if (confirm("Settings imported. Reload page now?")) window.location.reload();
                            }, 2000);
                        }, null, "Error importing settings")),
                        () => showToast("Import cancelled.", 'info')
                    );
                } catch (err) {
                    showToast(`Failed to parse settings file: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        return this.sectionEl;
    }
}
