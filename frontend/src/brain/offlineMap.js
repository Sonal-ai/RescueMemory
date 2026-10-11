// These bounds describe bundled cartography, never the user's GPS position.
const zoom = 14;
const latitude = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** zoom))) * 180 / Math.PI;
const longitude = x => x / 2 ** zoom * 360 - 180;
export const OFFLINE_MAP_TILES = [11713, 11714, 11715].flatMap(x => [6835, 6836, 6837].map(y => ({
  url: `/offline_tiles/${zoom}/${x}/${y}.png`,
  bounds: [[latitude(y + 1), longitude(x)], [latitude(y), longitude(x + 1)]],
})));
export const OFFLINE_MAP_BOUNDS = [[latitude(6838), longitude(11713)], [latitude(6835), longitude(11716)]];
export const OFFLINE_MAP_CENTER = {
  lat: (OFFLINE_MAP_BOUNDS[0][0] + OFFLINE_MAP_BOUNDS[1][0]) / 2,
  lon: (OFFLINE_MAP_BOUNDS[0][1] + OFFLINE_MAP_BOUNDS[1][1]) / 2,
};
export function inOfflineMap(point) {
  return point && point.lat >= OFFLINE_MAP_BOUNDS[0][0] && point.lat <= OFFLINE_MAP_BOUNDS[1][0]
    && point.lon >= OFFLINE_MAP_BOUNDS[0][1] && point.lon <= OFFLINE_MAP_BOUNDS[1][1];
}
export function mapStartCenter(point, offline) {
  return point && (!offline || inOfflineMap(point)) ? point : OFFLINE_MAP_CENTER;
}
