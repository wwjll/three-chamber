import * as TWEEN from '@tweenjs/tween.js/dist/tween.esm.js';

const DEFAULT_CONFIG = {
    distance: 1000,
    duration: 1.0,
    easingName: 'Linear',
    easingType: 'In',
    frameRate: 30,
    allowQueue: true
};

const DEFAULT_CALLBACKS = {
    onStart: null,
    onFinish: null,
    onStep: null
};

class TowerMotionController {
    constructor(options = {}) {
        this.config = { ...DEFAULT_CONFIG };
        this.callbacks = { ...DEFAULT_CALLBACKS };

        this.floors = [];
        this.floorNumbers = [];
        this.floorsStatus = 'normal';
        this.lastFloorIndex = Number.POSITIVE_INFINITY;

        this.status = 'idle';
        this.activeAnimation = null;
        this.pendingLevels = [];

        if (options.callbacks) {
            this.setCallbacks(options.callbacks);
        }
        this.setConfig(options);

        if (options.floors?.length > 0) {
            this.bindFloors(options.floors, options.floorNumbers);
        }
    }

    bindFloors(floors = [], floorNumbers = null) {
        /*
         * Expected floors input:
         * - floors: Array<Object3D>, each item is one floor group.
         * - floor.userData format (recommended):
         *   - userData.name: string like "Floor.3" (used to infer floor number if floorNumbers is not provided).
         *   - userData.originY: number, original Y position of this floor.
         *   - userData.status: "normal" | "rised", current motion status.
         *   - userData.progress: number in [0, 1], normalized animation progress.
         * The controller will initialize/overwrite originY/status/progress to ensure deterministic animation state.
         */
        this.floors = floors;
        this.floorNumbers = floorNumbers?.length > 0
            ? floorNumbers.slice()
            : this.floors.map((floor, index) => {
                const rawName = floor?.userData?.name;
                if (typeof rawName === 'string' && rawName.includes('.')) {
                    const parsed = Number(rawName.split('.')[1]);
                    if (Number.isFinite(parsed)) return parsed;
                }
                return index;
            });

        this.floors.forEach((floor) => {
            if (!floor.userData) {
                floor.userData = {};
            }
            floor.userData.originY = floor.position.y;
            floor.userData.status = 'normal';
            floor.userData.progress = 0;
        });

        this.reset();
        return this;
    }

    setConfig(partial = {}) {
        this.config.distance = partial.distance ?? this.config.distance;
        this.config.frameRate = Math.max(
            1,
            partial.frameRate ?? this.config.frameRate,
        );
        this.config.duration = Math.max(
            1e-4,
            partial.duration ?? this.config.duration,
        );
        if (partial.scale !== undefined) {
            const safeScale = Math.max(1e-6, partial.scale);
            this.config.duration = 1 / (this.config.frameRate * safeScale);
        }
        this.config.easingName = partial.easingName ?? this.config.easingName;
        this.config.easingType = partial.easingType ?? this.config.easingType;
        this.config.allowQueue = partial.allowQueue ?? this.config.allowQueue;
        return this;
    }

    setCallbacks(callbacks = {}) {
        Object.assign(this.callbacks, callbacks);
        return this;
    }

    getFrameDuration() {
        return 1 / this.config.frameRate;
    }

    isAnimating() {
        return this.status === 'animating' && !!this.activeAnimation;
    }

    moveToLevel(level, options = {}) {
        const { force = false, queue = this.config.allowQueue } = options;
        const floorIndex = this.floorNumbers.indexOf(level);
        if (floorIndex < 0) return false;

        if (this.isAnimating() && !force) {
            if (queue) {
                this.pendingLevels.push(level);
            }
            return false;
        }

        return this._startForFloorIndex(floorIndex, level);
    }

    update(deltaSec = this.getFrameDuration()) {
        if (!this.isAnimating()) {
            return { changed: false, finished: false };
        }

        const delta = Math.max(0, deltaSec);
        const { floorGroups, direction, distance, duration, easingEval } = this.activeAnimation;
        const length = floorGroups.length;
        const progressStep = delta / duration;

        if (direction === 'up') {
            floorGroups.forEach((floor, index) => {
                const { progress, originY } = floor.userData;
                if (progress >= 1) return;

                const eased = easingEval(progress);
                floor.position.y = originY + distance * eased;

                // Apply per-floor weighted speed and clamp to [0, 1] normalized progress.
                const nextProgress = Math.min(1, progress + progressStep * (0.4 + 2 * (index + 1) / length));
                floor.userData.progress = nextProgress;
                if (nextProgress >= 1) {
                    floor.position.y = originY + distance;
                    floor.userData.status = 'rised';
                }
            });
        } else {
            floorGroups.forEach((floor, index) => {
                const { progress, originY } = floor.userData;
                if (progress >= 1) return;

                const eased = easingEval(progress);
                floor.position.y = originY + distance * (1 - eased);

                const nextProgress = Math.min(1, progress + progressStep * (0.4 + 2 * (length - index) / length));
                floor.userData.progress = nextProgress;
                if (nextProgress >= 1) {
                    floor.position.y = originY;
                    floor.userData.status = 'normal';
                }
            });
        }

        const finished = floorGroups.every((floor) => floor.userData.progress === 1);
        this.callbacks.onStep?.({
            finished,
            direction,
            groupCount: floorGroups.length
        });

        if (finished) {
            this._finishActiveAnimation();
        }

        return { changed: true, finished };
    }

    pause() {
        if (this.isAnimating()) {
            this.status = 'paused';
        }
        return this;
    }

    resume() {
        if (this.status === 'paused' && this.activeAnimation) {
            this.status = 'animating';
        }
        return this;
    }

    stop(clearQueue = false) {
        this.activeAnimation = null;
        this.status = 'idle';
        if (clearQueue) {
            this.pendingLevels.length = 0;
        }
        return this;
    }

    reset(groups = this.floors) {
        this.stop(false);
        this.floorsStatus = 'normal';
        this.lastFloorIndex = Number.POSITIVE_INFINITY;

        groups.forEach((floor) => {
            floor.position.y = floor.userData.originY;
            floor.userData.status = 'normal';
            floor.userData.progress = 0;
        });
        return this;
    }

    getSnapshot() {
        return {
            status: this.status,
            floorsStatus: this.floorsStatus,
            isAnimating: this.isAnimating(),
            pendingCount: this.pendingLevels.length,
            hasActiveAnimation: !!this.activeAnimation
        };
    }

    getOperableLevels() {
        const uniqueLevels = Array.from(
            new Set(this.floorNumbers.filter((level) => Number.isFinite(level)))
        ).sort((a, b) => a - b);

        return uniqueLevels;
    }

    _startForFloorIndex(floorIndex, level) {
        if (
            this.floors.every((floor) => floor.userData.status === 'normal')
        ) {
            this.reset();
        }

        let direction = 'up';
        let groups = [];

        if (this.floorsStatus === 'normal') {
            groups = this._selectGroups(floorIndex, 'up');
            if (groups.length > 0) {
                this.floorsStatus = 'expanded';
                direction = 'up';
            }
        } else if (this.floorsStatus === 'expanded') {
            direction = level < this.floorNumbers[this.lastFloorIndex] ? 'up' : 'down';
            groups = this._selectGroups(floorIndex, direction);
        }

        this.lastFloorIndex = floorIndex;
        this._startAnimation(groups, direction);
        return true;
    }

    _startAnimation(floorGroups, direction) {
        floorGroups.forEach((floor) => {
            floor.userData.progress = 0;
        });

        if (floorGroups.length === 0) {
            this.status = 'idle';
            this.activeAnimation = null;
            return;
        }

        this.status = 'animating';
        this.activeAnimation = {
            floorGroups,
            direction,
            distance: this.config.distance,
            duration: this.config.duration,
            easingEval: this._resolveEasing(this.config.easingName, this.config.easingType)
        };

        this.callbacks.onStart?.({
            direction,
            groupCount: floorGroups.length
        });
    }

    _finishActiveAnimation() {
        this.activeAnimation = null;
        this.status = 'idle';

        this.callbacks.onFinish?.();

        if (this.pendingLevels.length > 0) {
            const nextLevel = this.pendingLevels.shift();
            this.moveToLevel(nextLevel, { force: true, queue: false });
        }
    }

    _selectGroups(floorIndex, direction) {
        if (direction === 'up') {
            return this.floors.filter((floor, index) => {
                return floor.userData.status === 'normal' && index > floorIndex;
            });
        }

        if (direction === 'down') {
            return this.floors.filter((floor, index) => {
                return floor.userData.status === 'rised' && index <= floorIndex;
            });
        }

        return [];
    }

    _resolveEasing(easingName, easingType) {
        let easingEval = (t) => t;
        let easingGroup = TWEEN.Easing[easingName];

        if (easingName === 'generatePow') {
            easingGroup = easingGroup();
        }
        if (easingGroup?.[easingType]) {
            easingEval = easingGroup[easingType].bind(easingGroup);
        } else if (easingGroup?.None) {
            easingEval = easingGroup.None.bind(easingGroup);
        }
        return easingEval;
    }

    static getEasingNames() {
        const names = [];
        for (const name in TWEEN.Easing) {
            names.push(name);
        }
        return names;
    }
}

export { TowerMotionController, TowerMotionController as default };
