/**
 * Opinet KATEC (TM128 / NHN:128) <-> WGS84, without runtime dependencies.
 *
 * This is NOT EPSG:5179 (UTM-K). Preserve the original GIS_X_COOR/GIS_Y_COOR
 * alongside converted coordinates so that upstream location errors stay auditable.
 *
 * Definition verified against NAVER's official geocoder SDK v1.3.1:
 * https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Service.html
 * https://oapi.map.naver.com/openapi/v3/maps-geocoder.js
 *
 * TM128 uses Bessel 1841, 38 N / 128 E, k=.9999, E0=400000, N0=600000.
 * The datum operation is Molodensky-Badekas with a reference point, NOT the
 * frequently copied 3-parameter shift or a 7-parameter Helmert about (0,0,0).
 * Formula references:
 * https://proj.org/en/stable/operations/projections/tmerc.html
 * https://proj.org/en/stable/operations/transformations/molobadekas.html
 *
 * Coordinates have no elevation; height is assumed zero on the source ellipsoid.
 * GRS80 and WGS84 are treated as the same terrestrial frame for this POI use.
 * Numerical agreement with the official SDK is checked to 0.1 m across Korea;
 * this does not certify the accuracy of individual station coordinates.
 */

const RAD = Math.PI / 180;
const BESSEL = ellipsoid(6377397.155, 299.1528128);
const WGS84 = ellipsoid(6378137, 298.257223563);
const ORIGIN_LAT = 38 * RAD;
const ORIGIN_LNG = 128 * RAD;
const FALSE_EASTING = 400000;
const FALSE_NORTHING = 600000;
const SCALE = 0.9999;

// Operational bounds include South Korea's offshore islands. This regional
// projection deliberately rejects swapped degree inputs and UTM-K metre inputs.
const AREA = Object.freeze({ minLat: 32, maxLat: 40, minLng: 123, maxLng: 133 });

// Korean 1985 -> GRS80, coordinate-frame rotation convention. The reference
// point is essential: these parameters must not be used as a bare +towgs84.
const PIVOT = [-3159521.31, 4068151.32, 3748113.85];
const SHIFT = [-145.907, 505.034, 685.756];
const ARCSEC = RAD / 3600;
const [RX, RY, RZ] = [-1.162, 2.347, 1.592].map((value) => value * ARCSEC);
const DATUM_SCALE = 1 + 6.342e-6;
const DATUM_MATRIX = [
  1, RZ, -RY,
  -RZ, 1, RX,
  RY, -RX, 1,
].map((value) => value * DATUM_SCALE);
const INVERSE_DATUM_MATRIX = invertMatrix(DATUM_MATRIX);

// Sixth-order Krueger coefficients from PROJ's ellipsoidal TM definition.
const n = BESSEL.f / (2 - BESSEL.f);
const powers = Array.from({ length: 7 }, (_, order) => n ** order);
const coefficient = (terms) => terms.reduce((sum, value, order) => sum + value * powers[order + 1], 0);
const ALPHA = [
  coefficient([1 / 2, -2 / 3, 5 / 16, 41 / 180, -127 / 288, 7891 / 37800]),
  coefficient([0, 13 / 48, -3 / 5, 557 / 1440, 281 / 630, -1983433 / 1935360]),
  coefficient([0, 0, 61 / 240, -103 / 140, 15061 / 26880, 167603 / 181440]),
  coefficient([0, 0, 0, 49561 / 161280, -179 / 168, 6601661 / 7257600]),
  coefficient([0, 0, 0, 0, 34729 / 80640, -3418889 / 1995840]),
  coefficient([0, 0, 0, 0, 0, 212378941 / 319334400]),
];
const BETA = [
  coefficient([1 / 2, -2 / 3, 37 / 96, -1 / 360, -81 / 512, 96199 / 604800]),
  coefficient([0, 1 / 48, 1 / 15, -437 / 1440, 46 / 105, -1118711 / 3870720]),
  coefficient([0, 0, 17 / 480, -37 / 840, -209 / 4480, 5569 / 90720]),
  coefficient([0, 0, 0, 4397 / 161280, -11 / 504, -830251 / 7257600]),
  coefficient([0, 0, 0, 0, 4583 / 161280, -108847 / 3991680]),
  coefficient([0, 0, 0, 0, 0, 20648693 / 638668800]),
];
const RECTIFYING_RADIUS = BESSEL.a / (1 + n) * (1 + powers[2] / 4 + powers[4] / 64 + powers[6] / 256);
const SCALED_RADIUS = SCALE * RECTIFYING_RADIUS;
const ORIGIN_XI = forwardSeries(ORIGIN_LAT, 0).xi;

function ellipsoid(a, inverseFlattening) {
  const f = 1 / inverseFlattening;
  return { a, f, e2: f * (2 - f), e: Math.sqrt(f * (2 - f)) };
}

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function assertWgs84(lat, lng, tolerance = 0) {
  finite(lat, 'lat');
  finite(lng, 'lng');
  if (lat < AREA.minLat - tolerance || lat > AREA.maxLat + tolerance || lng < AREA.minLng - tolerance || lng > AREA.maxLng + tolerance) {
    throw new RangeError('Coordinate is outside the supported Korean KATEC area');
  }
}

function forwardSeries(lat, longitudeDifference) {
  const chi = Math.atan(Math.sinh(
    Math.asinh(Math.tan(lat)) - BESSEL.e * Math.atanh(BESSEL.e * Math.sin(lat)),
  ));
  const tangent = Math.tan(chi);
  const cosine = Math.cos(longitudeDifference);
  const xiPrime = Math.atan2(tangent, cosine);
  const etaPrime = Math.asinh(Math.sin(longitudeDifference) / Math.hypot(tangent, cosine));
  let xi = xiPrime;
  let eta = etaPrime;
  for (let i = 0; i < ALPHA.length; i += 1) {
    const order = 2 * (i + 1);
    xi += ALPHA[i] * Math.sin(order * xiPrime) * Math.cosh(order * etaPrime);
    eta += ALPHA[i] * Math.cos(order * xiPrime) * Math.sinh(order * etaPrime);
  }
  return { xi, eta };
}

function inverseSeries(x, y) {
  const xi = (y - FALSE_NORTHING) / SCALED_RADIUS + ORIGIN_XI;
  const eta = (x - FALSE_EASTING) / SCALED_RADIUS;
  let xiPrime = xi;
  let etaPrime = eta;
  for (let i = 0; i < BETA.length; i += 1) {
    const order = 2 * (i + 1);
    xiPrime -= BETA[i] * Math.sin(order * xi) * Math.cosh(order * eta);
    etaPrime -= BETA[i] * Math.cos(order * xi) * Math.sinh(order * eta);
  }
  const chi = Math.atan2(Math.sin(xiPrime), Math.hypot(Math.sinh(etaPrime), Math.cos(xiPrime)));
  const lng = ORIGIN_LNG + Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime));
  const target = Math.asinh(Math.tan(chi));
  let lat = chi;
  for (let step = 0; step < 12; step += 1) {
    const sin = Math.sin(lat);
    const residual = Math.asinh(Math.tan(lat)) - BESSEL.e * Math.atanh(BESSEL.e * sin) - target;
    const delta = residual * Math.cos(lat) * (1 - BESSEL.e2 * sin * sin) / (1 - BESSEL.e2);
    lat -= delta;
    if (Math.abs(delta) < 1e-14) return { lat, lng };
  }
  throw new RangeError('KATEC inverse projection did not converge');
}

function toCartesian({ lat, lng }, model) {
  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const radius = model.a / Math.sqrt(1 - model.e2 * sin * sin);
  return [radius * cos * Math.cos(lng), radius * cos * Math.sin(lng), radius * (1 - model.e2) * sin];
}

function toGeographic([x, y, z], model) {
  const p = Math.hypot(x, y);
  const lng = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - model.e2));
  for (let step = 0; step < 12; step += 1) {
    const sin = Math.sin(lat);
    const radius = model.a / Math.sqrt(1 - model.e2 * sin * sin);
    const next = Math.atan2(z + model.e2 * radius * sin, p);
    if (Math.abs(next - lat) < 1e-14) return { lat: next, lng };
    lat = next;
  }
  throw new RangeError('Datum conversion did not converge');
}

function multiply(matrix, vector) {
  return [0, 1, 2].map((row) => matrix[3 * row] * vector[0] + matrix[3 * row + 1] * vector[1] + matrix[3 * row + 2] * vector[2]);
}

function invertMatrix([a, b, c, d, e, f, g, h, i]) {
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d].map((value) => value / determinant);
}

function changeDatum(point, fromBessel) {
  const cartesian = toCartesian(point, fromBessel ? BESSEL : WGS84);
  const centred = cartesian.map((value, index) => value - PIVOT[index] - (fromBessel ? 0 : SHIFT[index]));
  const rotated = multiply(fromBessel ? DATUM_MATRIX : INVERSE_DATUM_MATRIX, centred);
  const transformed = rotated.map((value, index) => value + PIVOT[index] + (fromBessel ? SHIFT[index] : 0));
  return toGeographic(transformed, fromBessel ? WGS84 : BESSEL);
}

/** Convert decimal-degree WGS84 coordinates to Opinet KATEC metres. */
export function wgs84ToKatec({ lat, lng } = {}) {
  assertWgs84(lat, lng);
  const bessel = changeDatum({ lat: lat * RAD, lng: lng * RAD }, false);
  const { xi, eta } = forwardSeries(bessel.lat, bessel.lng - ORIGIN_LNG);
  return { x: FALSE_EASTING + SCALED_RADIUS * eta, y: FALSE_NORTHING + SCALED_RADIUS * (xi - ORIGIN_XI) };
}

/** Convert Opinet GIS_X_COOR/GIS_Y_COOR metres to decimal-degree WGS84. */
export function katecToWgs84({ x, y } = {}) {
  finite(x, 'x');
  finite(y, 'y');
  if (Math.abs(x) <= 180 && Math.abs(y) <= 180) {
    throw new RangeError('KATEC expects metre coordinates, not longitude/latitude degrees');
  }
  if (x < -100000 || x > 1000000 || y < -100000 || y > 1000000) {
    throw new RangeError('KATEC metre coordinates are outside the supported range');
  }
  const geographic = changeDatum(inverseSeries(x, y), true);
  const result = { lat: geographic.lat / RAD, lng: geographic.lng / RAD };
  // A two-dimensional datum round trip discards ellipsoidal height. Allow a
  // sub-metre edge tolerance without clamping or otherwise moving the result.
  assertWgs84(result.lat, result.lng, 1e-6);
  return result;
}
