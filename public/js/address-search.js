const clean = value => String(value || '').trim();
const validPoint = point => point && [point.lat, point.lng].every(value => Number.isFinite(value)) &&
  Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

export function normalizeAddressSearchResults(items = []) {
  const seen = new Set(), results = [];
  for (const item of Array.isArray(items) ? items : []) {
    const roadAddress = clean(item?.roadAddress);
    const jibunAddress = clean(item?.jibunAddress);
    const address = roadAddress || jibunAddress || clean(item?.address);
    const rawLat = item?.lat ?? item?.y, rawLng = item?.lng ?? item?.x;
    if ([rawLat, rawLng].some(value => value == null || String(value).trim() === '')) continue;
    const point = { lat: Number(rawLat), lng: Number(rawLng) };
    if (!address || !validPoint(point)) continue;
    const key = `${point.lat.toFixed(7)}|${point.lng.toFixed(7)}|${roadAddress}|${jibunAddress}|${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      name: address,
      address,
      roadAddress: roadAddress || null,
      jibunAddress: jibunAddress || null,
      lat: point.lat,
      lng: point.lng,
    });
  }
  return results;
}

export function addressSearchPresentation(item = {}) {
  const roadAddress = clean(item.roadAddress);
  const jibunAddress = clean(item.jibunAddress);
  const fallback = clean(item.address || item.name);
  const primary = roadAddress || jibunAddress || fallback;
  const secondary = roadAddress && jibunAddress && roadAddress !== jibunAddress ? jibunAddress : '';
  return { primary, secondary, kind: roadAddress ? '도로명' : jibunAddress ? '지번' : '주소' };
}
