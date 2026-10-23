// Adapted from 돌봄한눈 CareMarkerLabels (cadd491): scale, area budget and stable priority.
// At zoom 10+ the map is already at a regional driving scale where the price itself
// is more useful than a generic dot. Keep dots only for wider province/nation views.
export const markerScale = zoom => zoom < 10 ? 'dot' : zoom < 16 ? 'pin' : zoom < 18 ? 'name' : 'detail';
export function labelBudget(zoom, width, height) {
  const area = Math.max(0, width) * Math.max(0, height);
  if (!area) return 0;
  const spacing = zoom < 12 ? 50000 : zoom < 14 ? 35000 : zoom < 16 ? 24000 : 16000;
  const limit = zoom < 12 ? 6 : zoom < 14 ? 12 : zoom < 16 ? 24 : 40;
  return Math.max(1, Math.min(limit, Math.floor(area / spacing)));
}
export const markerDensityLimit = (width, height) => Math.max(12, Math.min(80, Math.floor(width * height / 9000)));
export function visibleStations(stations, bounds, selectedId = null) {
  const rows = new Map();
  for (const station of stations) {
    const lat = station?.lat ?? station?.location?.lat, lng = station?.lng ?? station?.location?.lng;
    if (station?.id == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    if (bounds && (lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east)) continue;
    rows.set(String(station.id), station);
  }
  const selected = selectedId == null ? null : rows.get(String(selectedId));
  return selected ? [selected, ...[...rows.values()].filter(row => String(row.id) !== String(selectedId))] : [...rows.values()];
}
export function labelCandidates(ids, selectedId, retained, budget) {
  return [...ids].sort((a, b) => Number(b === selectedId) - Number(a === selectedId) ||
    Number(retained.has(b)) - Number(retained.has(a)) || a.localeCompare(b)).slice(0, Math.max(1, budget * 3));
}
