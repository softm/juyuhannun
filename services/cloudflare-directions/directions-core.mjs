/** SOFTM-FIREBASE-DIRECTIONS START 날짜:20261026 : 공용 길찾기에서 비밀키 보호와 호출량 상한을 함께 유지 */
export const ALLOWED_ORIGINS = new Set([
  "https://homecare.designboard.net",
  "https://softm.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export const NAVER_MAPS_API_KEY_ID = "etfcybk8vf";

const ALLOWED_OPTIONS = new Set([
  "trafast",
  "tracomfort",
  "traoptimal",
  "traavoidtoll",
  "traavoidcaronly",
]);
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const MAX_BODY_BYTES = 16_384;
const UPSTREAM_TIMEOUT_MS = 6_000;
const buckets = new Map();

/** SOFTM-DIRECTIONS-RETRY START 날짜:20261026 : 좌표 오류는 즉시 안내하고 네이버 일시 장애만 제한적으로 재시도 */
const UPSTREAM_RETRY_DELAY_MS = 350;
const ROUTE_FAILURE_MESSAGES = new Map([
  [1, "출발지와 목적지가 같습니다. 서로 다른 위치를 선택해 주세요."],
  [2, "출발지 또는 목적지가 도로에서 너무 멉니다. 도로 주변 위치를 다시 선택해 주세요."],
  [3, "선택한 출발지와 목적지 사이의 자동차 경로를 찾지 못했습니다."],
  [4, "경유할 위치가 도로에서 너무 멉니다."],
  [5, "경로가 너무 깁니다. 출발지와 목적지를 다시 확인해 주세요."],
]);

function providerCode(data) {
  const raw = data?.code ?? data?.error?.errorCode ?? data?.errorCode;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function providerMessage(status, code) {
  if (ROUTE_FAILURE_MESSAGES.has(code)) return ROUTE_FAILURE_MESSAGES.get(code);
  if (status === 429) return "현재 경로 요청이 많습니다. 잠시 후 다시 시도해 주세요.";
  if (status >= 500) return "경로 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.";
  if ([200, 210].includes(code) || status === 401 || status === 403) return "경로 서비스를 잠시 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  return "자동차 경로를 확인하지 못했습니다. 출발지와 목적지를 다시 확인해 주세요.";
}

function retryableFailure(status, code) {
  if (ROUTE_FAILURE_MESSAGES.has(code)) return false;
  if (status >= 500) return true;
  return status === 429 && code !== 400;
}
/** SOFTM-DIRECTIONS-RETRY END */

function setResponseHeaders(req, res) {
  const origin = req.headers?.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Care-Directions-Version", "20261026-2"); // SOFTM-DIRECTIONS-RETRY 날짜:20261026 : 운영 응답에서 일시 장애 복구 버전을 확인
}

function validPoint(point) {
  return point
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && point.lat >= 32
    && point.lat <= 40
    && point.lng >= 123
    && point.lng <= 133;
}

function coordinate(point) {
  return `${point.lng.toFixed(7)},${point.lat.toFixed(7)}`;
}

function requestKey(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "");
  return forwarded.split(",")[0].trim() || String(req.ip || "unknown");
}

function rateLimited(req, now) {
  if (buckets.size > 5_000) {
    for (const [key, value] of buckets) {
      if (now - value.startedAt >= WINDOW_MS) buckets.delete(key);
    }
  }
  const key = requestKey(req);
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    buckets.set(key, {startedAt: now, count: 1});
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS;
}

function bodyTooLarge(req) {
  const declared = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return true;
  try {
    return Buffer.byteLength(JSON.stringify(req.body || {}), "utf8") > MAX_BODY_BYTES;
  } catch {
    return true;
  }
}

export function resetRateLimitsForTest() {
  buckets.clear();
}

export function createDirectionsHandler({
  fetchImpl = globalThis.fetch,
  getApiSecret,
  now = Date.now,
  createTimeoutSignal = () => AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (typeof getApiSecret !== "function") throw new TypeError("API secret provider is required");

  return async function directionsHandler(req, res) {
    setResponseHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();

    const origin = req.headers?.origin || "";
    if (!ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({error: "허용되지 않은 호출 출처입니다."});
    }
    if (req.method !== "POST") {
      return res.status(405).json({error: "POST 요청만 지원합니다."});
    }
    if (bodyTooLarge(req)) {
      return res.status(413).json({error: "요청 데이터가 너무 큽니다."});
    }
    if (rateLimited(req, now())) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({error: "경로 요청이 잠시 몰렸습니다. 1분 후 다시 시도해 주세요.", code: "DIRECTIONS_RATE_LIMITED", retryable: false, retryAfterMs: 60_000});
    }

    const apiSecret = getApiSecret();
    if (!apiSecret) {
      return res.status(503).json({error: "경로 서비스를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.", code: "DIRECTIONS_NOT_CONFIGURED", retryable: false});
    }

    const {start, goal, waypoints = [], option = "traoptimal"} = req.body || {};
    if (!validPoint(start) || !validPoint(goal)) {
      return res.status(400).json({error: "출발지 또는 도착지 좌표가 올바르지 않습니다."});
    }
    if (!Array.isArray(waypoints) || waypoints.length > 15 || !waypoints.every(validPoint)) {
      return res.status(400).json({error: "경유지는 올바른 좌표로 최대 15곳까지 지정할 수 있습니다."});
    }

    const routeOption = ALLOWED_OPTIONS.has(option) ? option : "traoptimal";
    const params = new URLSearchParams({
      start: coordinate(start),
      goal: coordinate(goal),
      option: routeOption,
      lang: "ko",
    });
    if (waypoints.length) params.set("waypoints", waypoints.map(coordinate).join("|"));

    /** SOFTM-DIRECTIONS-RETRY START 날짜:20261026 : 사용자 재입력으로 해결되지 않는 일시 장애만 함수 안에서 한 번 복구 */
    const url = `https://maps.apigw.ntruss.com/map-direction-15/v1/driving?${params}`;
    const headers = {
      "x-ncp-apigw-api-key-id": NAVER_MAPS_API_KEY_ID,
      "x-ncp-apigw-api-key": apiSecret,
    };
    let lastFailure = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const upstream = await fetchImpl(url, {headers, signal: createTimeoutSignal()});
        const data = await upstream.json().catch(() => ({}));
        if (upstream.ok && data.code === 0) {
          const route = data.route?.[routeOption]?.[0];
          if (!route) return res.status(502).json({error: "도로경로 결과가 없습니다.", code: "DIRECTIONS_EMPTY_ROUTE", retryable: true, retryAfterMs: 800});
          return res.status(200).json({summary: route.summary, path: route.path, section: route.section || []});
        }
        const status = upstream.status || 502;
        const code = providerCode(data);
        const retryable = retryableFailure(status, code);
        lastFailure = {status, error: providerMessage(status, code), code: code ?? "NAVER_DIRECTIONS_ERROR", retryable, retryAfterMs: retryable ? 800 : undefined};
        if (!retryable || attempt === 1) break;
      } catch {
        lastFailure = {status: 502, error: "경로 서버 연결이 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.", code: "DIRECTIONS_UPSTREAM_UNAVAILABLE", retryable: true, retryAfterMs: 800};
        if (attempt === 1) break;
      }
      await wait(UPSTREAM_RETRY_DELAY_MS);
    }
    return res.status(lastFailure.status).json({error: lastFailure.error, code: lastFailure.code, retryable: lastFailure.retryable, ...(lastFailure.retryAfterMs ? {retryAfterMs: lastFailure.retryAfterMs} : {})});
    /** SOFTM-DIRECTIONS-RETRY END */
  };
}
/** SOFTM-FIREBASE-DIRECTIONS END */
