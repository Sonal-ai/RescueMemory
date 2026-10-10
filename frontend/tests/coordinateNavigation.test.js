import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHaversineDistanceMeters,
  calculateAzimuth,
  getCardinal,
  calculateSteeringAngle,
  formatDistance,
  calculateWalkingETA
} from '../src/brain/coordinateNavigation.js';
import { PAYTM_SKYMARK } from '../src/brain/paytmSkymark.js';

test('coordinate-to-coordinate distance correctly calculates Haversine distance in meters', () => {
  // Paytm Skymark: 28.5355, 77.3910
  // Target ~500m away north: 28.5400, 77.3910
  const distNorth = calculateHaversineDistanceMeters(28.5355, 77.3910, 28.5400, 77.3910);
  assert.ok(distNorth > 490 && distNorth < 510, `Expected ~500m, got ${distNorth}`);

  // Same coordinate returns 0m
  const distZero = calculateHaversineDistanceMeters(28.5355, 77.3910, 28.5355, 77.3910);
  assert.equal(distZero, 0);

  // Distance formatting
  assert.equal(formatDistance(450), '450 m');
  assert.equal(formatDistance(1250), '1.3 km');
  assert.equal(formatDistance(null), '-- m');
});

test('azimuth and cardinal algorithm points accurately to target shelter', () => {
  const originLat = PAYTM_SKYMARK.location.lat; // 28.5355
  const originLon = PAYTM_SKYMARK.location.lon; // 77.3910

  // Due North: lat increases, lon constant
  const bearingNorth = calculateAzimuth(originLat, originLon, originLat + 0.01, originLon);
  assert.equal(bearingNorth, 0);
  assert.equal(getCardinal(bearingNorth), 'N');

  // Due East: lat constant, lon increases
  const bearingEast = calculateAzimuth(originLat, originLon, originLat, originLon + 0.01);
  assert.ok(bearingEast >= 89 && bearingEast <= 91, `Expected ~90°, got ${bearingEast}`);
  assert.equal(getCardinal(bearingEast), 'E');

  // Due South: lat decreases, lon constant
  const bearingSouth = calculateAzimuth(originLat, originLon, originLat - 0.01, originLon);
  assert.equal(bearingSouth, 180);
  assert.equal(getCardinal(bearingSouth), 'S');

  // Due West: lat constant, lon decreases
  const bearingWest = calculateAzimuth(originLat, originLon, originLat, originLon - 0.01);
  assert.ok(bearingWest >= 269 && bearingWest <= 271, `Expected ~270°, got ${bearingWest}`);
  assert.equal(getCardinal(bearingWest), 'W');

  // North-East quadrant
  const bearingNE = calculateAzimuth(originLat, originLon, originLat + 0.01, originLon + 0.01);
  assert.ok(bearingNE > 30 && bearingNE < 60, `Expected NE bearing, got ${bearingNE}`);
  assert.equal(getCardinal(bearingNE), 'NE');
});

test('steering angle adjusts target direction relative to device heading', () => {
  const targetBearing = 90; // Target is due East

  // Facing North (0° heading): target is 90° to the right
  assert.equal(calculateSteeringAngle(targetBearing, 0), 90);

  // Facing East (90° heading): target is directly ahead (0°)
  assert.equal(calculateSteeringAngle(targetBearing, 90), 0);

  // Facing South (180° heading): target is 270° (turn left 90°)
  assert.equal(calculateSteeringAngle(targetBearing, 180), 270);

  // If heading is unavailable / null: fallback to target bearing
  assert.equal(calculateSteeringAngle(targetBearing, null), 90);
});

test('walking ETA estimation accurately calculates pedestrian evacuation pace', () => {
  // At ~67 m/min (~4 km/h):
  // 67m should be ~1 min
  assert.equal(calculateWalkingETA(67), '~1 min walk');
  // 350m should be ~6 min
  assert.equal(calculateWalkingETA(350), '~6 min walk');
  // 4200m should be ~1h 3m
  assert.match(calculateWalkingETA(4200), /1h.*walk/);
  // 0m should be < 1 min
  assert.equal(calculateWalkingETA(0), '< 1 min');
});
