// Public browser application ID copied from the user's existing Naver map.
// Server credentials belong only in environment variables. See shared/SOURCE.md.
export const APP_CONFIG = Object.freeze({
  naverClientId: "etfcybk8vf",
  // Public, domain-restricted browser key shared with the user's Tojihannun place search.
  // This is not a server credential; VWorld validates the requesting web domain.
  vworldSearchKey: "BC222DE5-514C-4E8A-A143-73DD322834D1",
  apiBase: '',
  dataUrl: './data/stations.json',
  nationwideDataUrl: './data/nationwide/latest.json',
  defaultCenter: { lat: 37.5665, lng: 126.978 },
  defaultZoom: 13,
  mobileDefaultZoom: 14,
  queryRadius: 5000,
  fallbackTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  fallbackAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
});
globalThis.APP_CONFIG = APP_CONFIG;
