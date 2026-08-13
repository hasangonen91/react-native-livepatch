"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configure = configure;
exports.getConfig = getConfig;
exports.resetConfig = resetConfig;
let _config = {
    updateUrl: '',
    channel: 'production',
    checkOnStart: true,
    autoApply: false,
    publicKey: undefined,
    minAppVersion: undefined,
};
function configure(options) {
    if (!options.updateUrl) {
        throw new Error('LivePatch: updateUrl is required.\n' +
            'Example: LivePatch.configure({ updateUrl: "https://your-server.com/updates" })');
    }
    _config = { ..._config, ...options };
}
function getConfig() {
    return { ..._config };
}
function resetConfig() {
    _config = {
        updateUrl: '',
        channel: 'production',
        checkOnStart: true,
        autoApply: false,
    };
}
