const pathDiagnosticModes = Object.freeze({
    radiance: 0,
    pathLength: 1,
    termination: 2,
    event: 3,
    pdf: 4,
    throughput: 5,
    contribution: 6,
    failure: 7,
});

const pathTerminationReasons = Object.freeze({
    0: 'None',
    1: 'Environment',
    2: 'Maximum depth',
    3: 'Invalid BSDF',
    4: 'Zero throughput',
    5: 'Russian roulette',
    6: 'Non-finite value',
});

const bsdfEventFlags = Object.freeze({
    1: 'Diffuse',
    2: 'Glossy',
    4: 'Reflection',
});

const pathFailureFlags = Object.freeze({
    1: 'Ray',
    2: 'Surface',
    4: 'BSDF',
    8: 'PDF',
    16: 'Throughput',
    32: 'Contribution',
    64: 'Radiance',
    128: 'Extreme value',
});

function decodeFlags(value, labels) {
    const flags = Math.round(value);
    const names = Object.entries(labels)
        .filter(([flag]) => (flags & Number(flag)) !== 0)
        .map(([, label]) => label);
    return names.length > 0 ? names : ['None'];
}

function clientPointToRenderTargetPixel(clientX, clientY, bounds, targetWidth, targetHeight) {
    const normalizedX = (clientX - bounds.left) / bounds.width;
    const normalizedY = (clientY - bounds.top) / bounds.height;
    return {
        x: Math.max(0, Math.min(Math.floor(normalizedX * targetWidth), targetWidth - 1)),
        y: Math.max(0, Math.min(Math.floor((1 - normalizedY) * targetHeight), targetHeight - 1)),
    };
}

export {
    bsdfEventFlags,
    clientPointToRenderTargetPixel,
    decodeFlags,
    pathDiagnosticModes,
    pathFailureFlags,
    pathTerminationReasons,
};
