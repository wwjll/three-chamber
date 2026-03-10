import RenderLoopController from './RenderLoopController.js';

const runtimeConfig = {
    devAssetOrigin: 'http://localhost:2000/',
    siteBasePath: '/three-chamber'
};

function getAssetURL() {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalHost) {
        // Parcel dev mode serves examples separately, so assets still come from the dedicated server.
        return runtimeConfig.devAssetOrigin;
    }

    // Published bundles and the local preview server expose assets under the same site root.
    const basePath = window.location.hostname.endsWith('github.io')
        ? runtimeConfig.siteBasePath
        : '';

    return `${window.location.origin}${basePath}/assets/`;
}

const renderLoopController = new RenderLoopController();

function getRenderLoopController() {
    // make sure this is singleton instance in one context
    return renderLoopController;
}

export {
    getAssetURL,
    getRenderLoopController
}
