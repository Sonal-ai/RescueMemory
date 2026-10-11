import { Capacitor, registerPlugin } from '@capacitor/core';
const satelliteGps = registerPlugin('OfflineGps');
export const hasSatelliteGps = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('OfflineGps');
export async function loadLocationPlugin() {
  return hasSatelliteGps() ? { Geolocation: satelliteGps } : import('@capacitor/geolocation');
}
