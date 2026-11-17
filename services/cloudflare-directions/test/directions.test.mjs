/** SOFTM-FIREBASE-TEST START 날짜:20261026 : 기존 프록시 계약과 보안 경계를 배포 전에 고정 */
import assert from "node:assert/strict";
import {beforeEach, test} from "node:test";
import {createDirectionsHandler, resetRateLimitsForTest} from "../directions-core.mjs";

class FakeResponse {
  constructor() {
    this.headers = new Map();
    this.statusCode = 200;
    this.body = null;
    this.ended = false;
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value);
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  json(value) {
    this.body = value;
    return this;
  }

  end() {
    this.ended = true;
    return this;
  }
}

function request(overrides = {}) {
  return {
    method: "POST",
    headers: {origin: "https://softm.github.io", "x-forwarded-for": "203.0.113.10"},
    ip: "203.0.113.10",
    body: {
      start: {lat: 37.48145, lng: 126.84805},
      goal: {lat: 37.4782, lng: 126.8644},
      waypoints: [],
      option: "traoptimal",
    },
    ...overrides,
  };
}

beforeEach(() => resetRateLimitsForTest());

test("허용 Origin의 preflight와 보안 헤더를 반환한다", async () => {
  const handler = createDirectionsHandler({fetchImpl: async () => assert.fail("upstream called"), getApiSecret: () => "secret"});
  const res = new FakeResponse();
  await handler(request({method: "OPTIONS", body: null}), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://softm.github.io");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-care-directions-version"), "20261026-2");
});

test("허용되지 않은 Origin은 상류 호출 전에 거부한다", async () => {
  const handler = createDirectionsHandler({fetchImpl: async () => assert.fail("upstream called"), getApiSecret: () => "secret"});
  const res = new FakeResponse();
  await handler(request({headers: {origin: "https://example.com"}}), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /허용되지 않은/);
});

test("좌표와 경유지 입력을 검증한다", async () => {
  const handler = createDirectionsHandler({fetchImpl: async () => assert.fail("upstream called"), getApiSecret: () => "secret"});
  const res = new FakeResponse();
  await handler(request({body: {start: {lat: 0, lng: 0}, goal: {lat: 37.5, lng: 127}}}), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /좌표/);
});

test("기존 summary/path/section 응답 계약을 유지한다", async () => {
  const upstreamRoute = {
    summary: {distance: 1933, duration: 605927, tollFare: 0},
    path: [[126.84805, 37.48145], [126.8644, 37.4782]],
    section: [{distance: 1933}],
  };
  let requestedUrl = "";
  const handler = createDirectionsHandler({
    getApiSecret: () => "secret",
    createTimeoutSignal: () => undefined,
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      assert.equal(options.headers["x-ncp-apigw-api-key"], "secret");
      return {
        ok: true,
        status: 200,
        json: async () => ({code: 0, route: {traoptimal: [upstreamRoute]}}),
      };
    },
  });
  const res = new FakeResponse();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, upstreamRoute);
  assert.match(requestedUrl, /option=traoptimal/);
  assert.match(requestedUrl, /start=126\.8480500%2C37\.4814500/);
});

test("비밀키 누락과 과도한 연속 요청을 명확히 구분한다", async () => {
  const missingSecret = createDirectionsHandler({fetchImpl: async () => assert.fail("upstream called"), getApiSecret: () => ""});
  const unavailable = new FakeResponse();
  await missingSecret(request(), unavailable);
  assert.equal(unavailable.statusCode, 503);

  resetRateLimitsForTest();
  const rateHandler = createDirectionsHandler({
    now: () => 1_000,
    getApiSecret: () => "secret",
    createTimeoutSignal: () => undefined,
    fetchImpl: async () => ({ok: true, status: 200, json: async () => ({code: 0, route: {traoptimal: [{summary: {}, path: [], section: []}]}})}),
  });
  for (let index = 0; index < 30; index += 1) await rateHandler(request(), new FakeResponse());
  const limited = new FakeResponse();
  await rateHandler(request(), limited);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.code, "DIRECTIONS_RATE_LIMITED");
  assert.equal(limited.body.retryAfterMs, 60_000);
  assert.equal(limited.headers.get("retry-after"), "60");
});

/** SOFTM-DIRECTIONS-RETRY START 날짜:20261026 : 상류 일시 장애 재시도와 좌표 오류 비재시도를 구분 */
test("네이버 일시 장애는 한 번 재시도한 뒤 기존 경로 응답을 반환한다", async () => {
  let calls = 0;
  const waits = [];
  const route = {summary: {distance: 2000, duration: 600000, tollFare: 0}, path: [[126.8, 37.4], [126.9, 37.5]], section: []};
  const handler = createDirectionsHandler({
    getApiSecret: () => "secret",
    createTimeoutSignal: () => undefined,
    wait: async milliseconds => waits.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return {ok: false, status: 503, json: async () => ({error: {errorCode: "500"}})};
      return {ok: true, status: 200, json: async () => ({code: 0, route: {traoptimal: [route]}})};
    },
  });
  const res = new FakeResponse();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, route);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [350]);
});

test("도로에서 먼 좌표는 재시도하지 않고 사용자가 고칠 수 있는 안내를 반환한다", async () => {
  let calls = 0;
  const handler = createDirectionsHandler({
    getApiSecret: () => "secret",
    createTimeoutSignal: () => undefined,
    wait: async () => assert.fail("waited"),
    fetchImpl: async () => {
      calls += 1;
      return {ok: false, status: 400, json: async () => ({code: 2})};
    },
  });
  const res = new FakeResponse();
  await handler(request(), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 2);
  assert.equal(res.body.retryable, false);
  assert.match(res.body.error, /도로에서 너무 멉니다/);
  assert.equal(calls, 1);
});

test("반복된 상류 장애는 내부 상세를 숨기고 재시도 가능 상태로 반환한다", async () => {
  let calls = 0;
  const handler = createDirectionsHandler({
    getApiSecret: () => "secret",
    createTimeoutSignal: () => undefined,
    wait: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return {ok: false, status: 504, json: async () => ({error: {errorCode: "510", message: "Endpoint Timeout"}})};
    },
  });
  const res = new FakeResponse();
  await handler(request(), res);
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.code, 510);
  assert.equal(res.body.retryable, true);
  assert.equal(res.body.retryAfterMs, 800);
  assert.match(res.body.error, /일시적으로 응답하지 않습니다/);
  assert.equal(calls, 2);
});
/** SOFTM-DIRECTIONS-RETRY END */
/** SOFTM-FIREBASE-TEST END */
