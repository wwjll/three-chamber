const GRIP_ACTIONS = new Set(['hold', 'open', 'closeUntilContact']);

function copyFiniteArray(values, length) {
    if (
        !Array.isArray(values)
        || values.length !== length
        || values.some((value) => !Number.isFinite(value))
    ) {
        return null;
    }
    return values.slice();
}

function normalizeDuration(value, fallback, minimum = 0) {
    return Number.isFinite(value)
        ? Math.max(minimum, value)
        : fallback;
}

function normalizeSequenceKeyframes(keyframes) {
    if (!Array.isArray(keyframes)) {
        return [];
    }

    return keyframes.flatMap((keyframe, index) => {
        if (!keyframe || keyframe.kind !== 'recorded') {
            return [];
        }
        const position = copyFiniteArray(keyframe.position, 3);
        const rotation = copyFiniteArray(keyframe.rotation, 3);
        const chainPose = copyFiniteArray(
            keyframe.chainPose ?? keyframe.joints,
            6,
        );
        if (!position || !rotation || !chainPose) {
            return [];
        }

        return [{
            id: typeof keyframe.id === 'string' && keyframe.id
                ? keyframe.id
                : `keyframe-${index + 1}`,
            label: typeof keyframe.label === 'string' && keyframe.label
                ? keyframe.label
                : `Keyframe ${index + 1}`,
            kind: 'recorded',
            position,
            rotation,
            chainPose,
            durationMs: normalizeDuration(keyframe.durationMs, 500, 1),
            holdMs: normalizeDuration(keyframe.holdMs, 0),
            gripAction: GRIP_ACTIONS.has(keyframe.gripAction)
                ? keyframe.gripAction
                : 'hold',
            gripDurationMs: normalizeDuration(
                keyframe.gripDurationMs,
                450,
                1,
            ),
        }];
    });
}

class IndexedDbSequenceStore {
    constructor({
        indexedDB = globalThis.indexedDB,
        databaseName = 'three-chamber',
        storeName = 'sequences',
        version = 1,
    } = {}) {
        this.indexedDB = indexedDB ?? null;
        this.databaseName = databaseName;
        this.storeName = storeName;
        this.version = version;
        this._databasePromise = null;
        this._saveQueue = Promise.resolve();
    }

    async load(sequenceId) {
        const database = await this._openDatabase();
        if (!database) {
            return null;
        }
        const record = await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                this.storeName,
                'readonly',
            );
            const request = transaction
                .objectStore(this.storeName)
                .get(sequenceId);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
        return record
            ? normalizeSequenceKeyframes(record.keyframes)
            : null;
    }

    save(sequenceId, keyframes) {
        const record = {
            id: sequenceId,
            schemaVersion: 2,
            updatedAt: Date.now(),
            keyframes: normalizeSequenceKeyframes(keyframes),
        };
        this._saveQueue = this._saveQueue
            .catch(() => {})
            .then(() => this._writeRecord(record));
        return this._saveQueue;
    }

    async delete(sequenceId) {
        const database = await this._openDatabase();
        if (!database) {
            return false;
        }
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                this.storeName,
                'readwrite',
            );
            transaction.objectStore(this.storeName).delete(sequenceId);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
        return true;
    }

    async _writeRecord(record) {
        const database = await this._openDatabase();
        if (!database) {
            return false;
        }
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                this.storeName,
                'readwrite',
            );
            transaction.objectStore(this.storeName).put(record);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
        return true;
    }

    _openDatabase() {
        if (!this.indexedDB) {
            return Promise.resolve(null);
        }
        if (this._databasePromise) {
            return this._databasePromise;
        }
        this._databasePromise = new Promise((resolve, reject) => {
            const request = this.indexedDB.open(
                this.databaseName,
                this.version,
            );
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(this.storeName)) {
                    database.createObjectStore(this.storeName, {
                        keyPath: 'id',
                    });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(
                new Error(`IndexedDB "${this.databaseName}" is blocked.`),
            );
        });
        return this._databasePromise;
    }
}

export {
    IndexedDbSequenceStore,
    normalizeSequenceKeyframes,
};
