const clean = value => String(value || '').trim();
const compact = value => clean(value).replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
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

export function normalizePlaceSearchResults(items = []) {
  const seen = new Set(), results = [];
  for (const item of Array.isArray(items) ? items : []) {
    const title = clean(item?.title);
    const roadAddress = clean(item?.address?.road || item?.roadAddress);
    const jibunAddress = clean(item?.address?.parcel || item?.jibunAddress);
    const address = roadAddress || jibunAddress || title;
    const placeCategory = clean(item?.category || item?.placeCategory);
    const rawLat = item?.lat ?? item?.point?.y ?? item?.y;
    const rawLng = item?.lng ?? item?.point?.x ?? item?.x;
    if ([rawLat, rawLng].some(value => value == null || String(value).trim() === '')) continue;
    const point = { lat: Number(rawLat), lng: Number(rawLng) };
    if (!title || !address || !validPoint(point)) continue;
    const key = `${compact(title)}|${compact(jibunAddress || roadAddress || address)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      name: title,
      title,
      address,
      roadAddress: roadAddress || null,
      jibunAddress: jibunAddress || null,
      category: 'place',
      placeCategory: placeCategory || null,
      lat: point.lat,
      lng: point.lng,
    });
  }
  return results;
}

function locationRank(item, normalizedQuery) {
  const isPlace = item?.category === 'place';
  const title = compact(item?.title || item?.name);
  const address = compact(item?.roadAddress || item?.jibunAddress || item?.address);
  let rank = isPlace ? 100 : 90;
  if (title && normalizedQuery) {
    if (title === normalizedQuery) rank += 320;
    else if (title.startsWith(normalizedQuery)) rank += 260;
    else if (title.includes(normalizedQuery) || normalizedQuery.includes(title)) rank += 210;
  }
  if (address && normalizedQuery) {
    if (address === normalizedQuery) rank += 210;
    else if (address.includes(normalizedQuery) || normalizedQuery.includes(address)) rank += 80;
  }
  if (isPlace) {
    const category = clean(item.placeCategory);
    if (/철도|지하철|공항|항만|여객터미널/.test(category)) rank += 45;
    if (/아파트단지|건물|주거용공동주택/.test(category)) rank += 25;
    if (/기상관측소/.test(category)) rank -= 120;
    if (/버스터미널|정류장/.test(category)) rank -= 180;
  }
  return rank;
}

export function mergeLocationSearchResults(groups = [], query = '') {
  const normalizedQuery = compact(query);
  const candidates = (Array.isArray(groups) ? groups : [groups])
    .flatMap(group => Array.isArray(group) ? group : [])
    .filter(item => validPoint(item) && clean(item?.name || item?.address));
  const ranked = candidates.map((item, index) => ({ item, index, rank: locationRank(item, normalizedQuery) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  const seen = new Set(), results = [];
  for (const { item } of ranked) {
    const isPlace = item.category === 'place';
    const address = compact(item.jibunAddress || item.roadAddress || item.address);
    const key = isPlace
      ? `place|${compact(item.title || item.name)}|${address}`
      : `address|${item.lat.toFixed(7)}|${item.lng.toFixed(7)}|${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
    if (results.length >= 12) break;
  }
  return results;
}

export function addressSearchPresentation(item = {}) {
  if (item.category === 'place') {
    const primary = clean(item.title || item.name || item.address);
    const placeAddress = clean(item.roadAddress || item.jibunAddress || item.address);
    const secondary = [placeAddress && placeAddress !== primary ? placeAddress : '', clean(item.placeCategory)]
      .filter(Boolean).join(' · ');
    return { primary, secondary, kind: '장소' };
  }
  const roadAddress = clean(item.roadAddress);
  const jibunAddress = clean(item.jibunAddress);
  const fallback = clean(item.address || item.name);
  const primary = roadAddress || jibunAddress || fallback;
  const secondary = roadAddress && jibunAddress && roadAddress !== jibunAddress ? jibunAddress : '';
  return { primary, secondary, kind: roadAddress ? '도로명' : jibunAddress ? '지번' : '주소' };
}
