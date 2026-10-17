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
