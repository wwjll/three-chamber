
function getAssetURL() {
    let assetUrl;

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // host the assets directory on your own local server
        assetUrl = "http://localhost:2000/";
    } else {
        assetUrl = "https://wwjll.github.io/three-chamber/assets/"
    }

    return assetUrl;
}


export {
    getAssetURL
}