/**
 * Coordinate-to-Coordinate Geodesic & Navigation Algorithms
 * Provides exact Haversine distance, Azimuth forward bearing,
 * Cardinal direction, Relative steering angle, and Walking ETA.
 */

export function calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth mean radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function calculateAzimuth(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return Math.round(((theta * 180) / Math.PI + 360) % 360);
}

export function getCardinal(bearing) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((bearing % 360) / 45)) % 8;
  return directions[index];
}

export function calculateSteeringAngle(bearing, heading) {
  if (heading == null) return bearing;
  return Math.round(((bearing - heading + 360) % 360));
}

export function formatDistance(meters) {
  if (meters == null || Number.isNaN(meters)) return '-- m';
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${meters} m`;
}

export function calculateWalkingETA(meters) {
  if (!meters || meters <= 0) return '< 1 min';
  // Average walking pace in emergency/disaster conditions: ~4 km/h = ~67 m/min
  const mins = Math.max(1, Math.ceil(meters / 67));
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m walk` : `${hrs}h walk`;
  }
  return `~${mins} min walk`;
}
