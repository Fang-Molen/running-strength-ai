// Camera/selection policy shared by action, anatomy and figure viewers.
export const CAMERA_LIMITS = Object.freeze({ minPolar: 62, maxPolar: 90, horizontal: 30 });
/** @param {number} value */
const rad = value => value * Math.PI / 180;
/** @param {*} controls @param {*} camera @param {number} angleDegrees @param {*} target @param {number} distance @param {number} minRatio */
export function placeRestrictedView(controls, camera, angleDegrees, target, distance, minRatio = .7) {
  // Flush residual damping before switching presets, then remove the old preset's limits.
  controls.enableDamping = false; controls.update();
  controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
  controls.minDistance = 0; controls.maxDistance = Infinity;
  controls.minPolarAngle = rad(CAMERA_LIMITS.minPolar); controls.maxPolarAngle = rad(CAMERA_LIMITS.maxPolar);
  controls.enablePan = false; controls.autoRotate = false;
  const a = rad(angleDegrees), center = Math.atan2(Math.sin(a), Math.cos(a));
  controls.target.copy(target);
  camera.position.set(target.x + Math.sin(a) * distance, target.y + distance * .1, target.z + Math.cos(a) * distance);
  controls.update();
  controls.minAzimuthAngle = center - rad(CAMERA_LIMITS.horizontal); controls.maxAzimuthAngle = center + rad(CAMERA_LIMITS.horizontal);
  controls.minDistance = distance * minRatio; controls.maxDistance = distance * 1.3;
  controls.enableDamping = true; controls.update();
}

/** @param {{k:string,g:string|null}[]} muscles @param {string[]} primary @param {string[]} secondary @param {string|null} selectedKey */
export function muscleHighlights(muscles, primary = [], secondary = [], selectedKey = null) {
  const hi = new Array(40).fill(0);
  muscles.forEach((m, i) => {
    if (primary.includes(m.k) || (m.g && primary.includes(m.g))) hi[i + 1] = 2;
    else if (secondary.includes(m.k) || (m.g && secondary.includes(m.g))) hi[i + 1] = 1;
    if (selectedKey && (selectedKey === m.k || selectedKey === m.g)) hi[i + 1] = 3;
  });
  return hi;
}

/** Fit a real bounding box at every permitted orbit angle. Unlike a hardcoded
 * distance this also accounts for narrow/landscape canvases and head/foot room.
 * Returns a horizontal distance for placeRestrictedView's slight elevation.
 * @param {number[]} min @param {number[]} max @param {number} aspect
 * @param {number} verticalFov @param {number} angle */
export function fitAnatomyBounds(min, max, aspect, verticalFov = 30, angle = 0) {
  const center = min.map((v, i) => (v + max[i]) / 2);
  const tanV = Math.tan(rad(verticalFov) / 2) * .84;
  const tanH = tanV * Math.max(.1, aspect);
  let distance = .1;
  for (let yaw = angle - CAMERA_LIMITS.horizontal; yaw <= angle + CAMERA_LIMITS.horizontal; yaw += 5) {
    const a = rad(yaw), sa = Math.sin(a), ca = Math.cos(a);
    for (let elevation = 0; elevation <= 90 - CAMERA_LIMITS.minPolar; elevation += 2) {
      const e = rad(elevation), se = Math.sin(e), ce = Math.cos(e);
      for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
        const p = [x - center[0], y - center[1], z - center[2]];
        const near = p[0] * sa * ce + p[1] * se + p[2] * ca * ce;
        const right = p[0] * ca - p[2] * sa;
        const up = -p[0] * sa * se + p[1] * ce - p[2] * ca * se;
        distance = Math.max(distance, near + Math.max(Math.abs(right) / tanH, Math.abs(up) / tanV));
      }
    }
  }
  return { center, distance: distance * 1.02 };
}
