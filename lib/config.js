let _config = {
    updateUrl: '',
    channel: 'production',
    checkOnStart: true,
    autoApply: false,
    publicKey: undefined,
    minAppVersion: undefined,
};
export function configure(options) {
    if (!options.updateUrl) {
        throw new Error('LivePatch: updateUrl is required.\n' +
            'Example: LivePatch.configure({ updateUrl: "https://your-server.com/updates" })');
    }
    _config = { ..._config, ...options };
}
export function getConfig() {
    return { ..._config };
}
export function resetConfig() {
    _config = {
        updateUrl: '',
        channel: 'production',
        checkOnStart: true,
        autoApply: false,
    };
}
