import assert from 'node:assert/strict';
import test from 'node:test';
import { init, World } from '@dimforge/rapier3d-compat';
import { Actuator } from '../../extend/kinematic/Chain.js';

test('Actuator retains collider handles when its jaw transforms or shape change', async () => {
    await init();
    const world = new World({ x: 0, y: 0, z: 0 });
    try {
        const actuator = new Actuator({ physicsWorld: world });
        const handles = actuator._physicsColliders.map((collider) => collider.handle);
        let created = 0;
        let removed = 0;
        const createCollider = world.createCollider.bind(world);
        const removeCollider = world.removeCollider.bind(world);
        world.createCollider = (...args) => { created++; return createCollider(...args); };
        world.removeCollider = (...args) => { removed++; return removeCollider(...args); };
        const oldPosition = actuator.getPhysicsColliderBoxes()[1].position.y;
        actuator.setOpenRatio(0.5);
        assert.notEqual(actuator.getPhysicsColliderBoxes()[1].position.y, oldPosition);
        assert.deepEqual(actuator._physicsColliders.map((collider) => collider.handle), handles);
        const boxes = actuator.getPhysicsColliderBoxes().map((box) => ({
            ...box,
            halfExtents: { ...box.halfExtents },
            position: { ...box.position },
            quaternion: { ...box.quaternion },
        }));
        boxes[1].position.y = 0.02;
        boxes[1].halfExtents.x = 0.03;
        actuator.setPhysicsColliderBoxes(boxes);
        assert.deepEqual(actuator._physicsColliders.map((collider) => collider.handle), handles);
        world.step();
        assert.ok(Math.abs(actuator.getJawColliders().left.translation().y - 0.02) < 1e-6);
        assert.ok(Math.abs(actuator.getJawColliders().left.halfExtents().x - 0.03) < 1e-6);
        actuator.setOpenRatio(0.25);
        assert.equal(actuator.getPhysicsColliderBoxes()[1].position.y, 0.02);
        assert.equal(created, 0);
        assert.equal(removed, 0);
    } finally {
        world.free();
    }
});
