// GARGANTUA — cinematic camera path + smooth preset flight.

import * as THREE from 'three';

// Slow, looping, hand-off feeling orbit around the black hole.
// Layered sines -> organic wandering radius / height / angle, plus a slow dive.
export class CinematicCamera {
  update(camera, t) {
    const a = t * 0.11;          // medium wander
    const b = t * 0.043;         // slow dive cycle
    const c = t * 0.017;         // very slow macro

    const radius =
      9.0 + 6.0 * Math.sin(a) + 5.0 * Math.sin(b * 2.0) + 4.0 * Math.sin(c * 2.0);
    const R = THREE.MathUtils.clamp(radius, 6.5, 30.0);
    const ang = t * 0.05 + 0.8 * Math.sin(c * 1.3) + 0.35 * Math.sin(a * 0.5);
    const y = 1.5 + 3.2 * Math.sin(a * 1.2 + 1.7) + 2.2 * Math.sin(c * 2.7);

    camera.position.set(R * Math.cos(ang), y, R * Math.sin(ang));
    camera.lookAt(0, 0.8 * Math.sin(b * 1.1), 0);
    camera.updateMatrixWorld(true);
  }
}

// Eased flight from the current camera pose to a target pose.
export class PresetFlight {
  constructor() {
    this.active = false;
    this.t = 0;
    this.dur = 1.6;
    this.fromPos = new THREE.Vector3();
    this.fromTarget = new THREE.Vector3();
    this.toPos = new THREE.Vector3();
    this.toTarget = new THREE.Vector3();
    this.onDone = null;
  }

  start(camera, targetPos, targetLook, onDone) {
    this.fromPos.copy(camera.position);
    this.fromTarget.copy(camera.target ? camera.target : new THREE.Vector3());
    this.toPos.copy(targetPos);
    this.toTarget.copy(targetLook);
    this.t = 0;
    this.active = true;
    this.onDone = onDone || null;
  }

  update(camera, controls, dt) {
    if (!this.active) return false;
    this.t += dt;
    const k = this.t / this.dur;
    const e = k < 1 ? 1 - Math.pow(1 - k, 3) : 1; // easeOutCubic
    camera.position.lerpVectors(this.fromPos, this.toPos, e);
    if (controls) controls.target.lerpVectors(this.fromTarget, this.toTarget, e);
    camera.lookAt(controls ? controls.target : this.toTarget);
    camera.updateMatrixWorld(true);
    if (k >= 1) {
      this.active = false;
      if (this.onDone) this.onDone();
      return true;
    }
    return true;
  }
}
