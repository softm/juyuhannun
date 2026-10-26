import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DailyQuota } from './quota.mjs';
import { OpinetClient } from './opinet.mjs';
import { OpinetBenchmarkClient } from './benchmarks.mjs';
import { HighwayClient } from './highway.mjs';
import { NaverRouteClient } from './route.mjs';
import { StationSnapshotStore } from './station-snapshot.mjs';
import { ServiceError, publicError } from './errors.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const integerEnv = (value, fallback, min, max) => { const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : fallback; };
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2' };

async function readJsonBody(request,{maxBytes=24_000}={}){
  const contentType=String(request.headers?.['content-type']||'').split(';',1)[0].trim().toLowerCase();
  if(contentType!=='application/json')throw new ServiceError('CONTENT_TYPE_REQUIRED','JSON 요청만 지원합니다.',415);
  if(typeof request[Symbol.asyncIterator]!=='function')throw new ServiceError('INVALID_JSON_BODY','요청 본문을 확인해 주세요.',400);
  const chunks=[];let size=0;
  for await(const chunk of request){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buffer.length;if(size>maxBytes)throw new ServiceError('REQUEST_BODY_TOO_LARGE','요청 본문의 크기가 허용 범위를 넘었습니다.',413);chunks.push(buffer);}
  if(!chunks.length)throw new ServiceError('INVALID_JSON_BODY','요청 본문을 입력해 주세요.',400);
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ServiceError('INVALID_JSON_BODY','JSON 요청 형식을 확인해 주세요.',400);}
}

export function createApp({ env = process.env, fetchImpl = fetch, projectRoot = PROJECT_ROOT, clock = Date.now, opinetClient, routeClient, benchmarkClient, highwayClient, stationSnapshotStore } = {}) {
  const opinetQuota = new DailyQuota({ ledgerPath: resolve(projectRoot, env.OPINET_QUOTA_LEDGER || '.cache/opinet-quota.json'), limit: integerEnv(env.OPINET_DAILY_LIMIT, 300, 1, 300), clock });
  const routeQuota = new DailyQuota({ ledgerPath: resolve(projectRoot, env.NAVER_QUOTA_LEDGER || '.cache/naver-quota.json'), limit: integerEnv(env.NAVER_DAILY_LIMIT, 200, 1, 10_000), provider: 'NAVER', clock });
  const opinet = opinetClient ?? new OpinetClient({ apiKey: env.OPINET_API_KEY || '', quota: opinetQuota, fetchImpl, clock, ttlMs: integerEnv(env.OPINET_CACHE_TTL_SECONDS, 600, 30, 3600) * 1000, detailLimit: integerEnv(env.OPINET_DETAIL_LIMIT, 8, 0, 20) });
  const benchmarks = benchmarkClient ?? new OpinetBenchmarkClient({ client: opinet });
  const highwayQuota = new DailyQuota({ ledgerPath: resolve(projectRoot, env.EX_QUOTA_LEDGER || '.cache/ex-quota.json'), limit: integerEnv(env.EX_DAILY_LIMIT, 1000, 1, 10_000), provider: 'EX', clock });
  const highway = highwayClient ?? new HighwayClient({ apiKey: env.EX_API_KEY || '', quota: highwayQuota, fetchImpl, clock });
  const routes = routeClient ?? new NaverRouteClient({ apiKeyId: env.NAVER_MAPS_API_KEY_ID || env.NAVER_CLIENT_ID || '', apiKey: env.NAVER_MAPS_API_KEY || env.NAVER_CLIENT_SECRET || '', quota: routeQuota, fetchImpl, clock, recommendationConcurrency: integerEnv(env.NAVER_RECOMMENDATION_CONCURRENCY,3,1,3), recommendationLimit: integerEnv(env.NAVER_RECOMMENDATION_LIMIT,8,1,12) });
  const stationSnapshots=stationSnapshotStore??new StationSnapshotStore({projectRoot,clock});
  const publicRoot = resolve(projectRoot, 'public');
  const allowedOrigins = new Set((env.API_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
  const localPort = integerEnv(env.PORT, 8787, 1, 65535);
  const trustedSameOrigins = new Set([`http://localhost:${localPort}`, `http://127.0.0.1:${localPort}`]);
  const rateWindows = new Map();
  const recommendationRateWindows = new Map();
  const recommendationRateLimit=integerEnv(env.ROUTE_RECOMMENDATION_RATE_PER_MINUTE,12,1,60);

  const json = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };

  return async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'geolocation=(self)');
    let requestPath='';
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      requestPath=pathname;
      const origin = request.headers.origin;
      if (pathname.startsWith('/api/') && origin && !allowedOrigins.has(origin) && !trustedSameOrigins.has(origin)) {
        throw new ServiceError('ORIGIN_NOT_ALLOWED', '허용된 서비스 화면에서만 API를 조회할 수 있습니다.', 403);
      }
      if (origin && allowedOrigins.has(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      const recommendationsPath=pathname==='/api/route/recommendations';
      if(recommendationsPath&&request.method!=='POST')throw new ServiceError('METHOD_NOT_ALLOWED','이 경로는 POST 요청만 지원합니다.',405);
      if(!recommendationsPath&&request.method!=='GET'&&request.method!=='HEAD')throw new ServiceError('METHOD_NOT_ALLOWED','GET 요청만 지원합니다.',405);
      if (pathname.startsWith('/api/')) {
        // Short-lived abuse guard. IPs and request coordinates are never logged or persisted.
        const ip = request.socket.remoteAddress || 'local'; const minute = Math.floor(clock() / 60_000);
        if (rateWindows.size > 1000) rateWindows.clear();
        const window = rateWindows.get(ip)?.minute === minute ? rateWindows.get(ip) : { minute, count: 0 };
        window.count += 1; rateWindows.set(ip, window);
        if (window.count > 120) throw new ServiceError('REQUEST_RATE_EXCEEDED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.', 429);
        if(recommendationsPath){
          const routeWindow=recommendationRateWindows.get(ip)?.minute===minute?recommendationRateWindows.get(ip):{minute,count:0};
          routeWindow.count+=1;recommendationRateWindows.set(ip,routeWindow);
          if(recommendationRateWindows.size>1000)recommendationRateWindows.clear();
          if(routeWindow.count>recommendationRateLimit)throw new ServiceError('ROUTE_RATE_EXCEEDED','경로 조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);
          const body=await readJsonBody(request);
          if(!routes.configured){json(response,200,await routes.recommendations({request:body,stations:[],coverage:null}));return;}
          const snapshot=await stationSnapshots.load();
          json(response,200,await routes.recommendations({request:body,stations:snapshot.stations,coverage:snapshot.coverage,snapshotRevision:snapshot.revision}));return;
        }
        if (pathname === '/api/health') {
          const quota = await opinetQuota.snapshot().catch(() => null);
          json(response, 200, { status: 'ok', service: 'juyuhannun', providers: { opinet: { configured: opinet.configured, quota }, highway: { configured: highway.configured }, naver: { configured: routes.configured } }, source: 'https://www.opinet.co.kr/', serverTime: new Date(clock()).toISOString() });
          return;
        }
        if (pathname === '/api/stations') {
          const result = await opinet.nearby({ lat: url.searchParams.get('lat'), lng: url.searchParams.get('lng'), radius: url.searchParams.get('radius') ?? 3000, fuel: url.searchParams.get('fuel') ?? 'B027' });
          json(response, 200, result); return;
        }
        if (pathname === '/api/benchmarks') {
          const option = url.searchParams.get('includeSigun');
          if (option !== null && !['true', 'false'].includes(option)) throw new ServiceError('INVALID_BENCHMARK_OPTION', '시군구 조회 옵션을 확인해 주세요.', 400);
          json(response, 200, await benchmarks.snapshot({ fuel: url.searchParams.get('fuel'), sido: url.searchParams.get('sido'), includeSigun: option === 'true' })); return;
        }
        if (pathname === '/api/highway-stations') {
          const stationCatalog = await stationSnapshots.load().then(snapshot => snapshot.stations).catch(() => []);
          json(response, 200, await highway.snapshot({ stationCatalog })); return;
        }
        const detailMatch = pathname.match(/^\/api\/stations\/([^/]+)$/);
        if (detailMatch) { json(response, 200, await opinet.detail(detailMatch[1], url.searchParams.get('fuel') ?? 'B027')); return; }
        if (pathname === '/api/route/predict') {
          json(response, 200, await routes.predict({ origin: url.searchParams.get('origin'), heading: url.searchParams.get('heading'), distanceMeters: url.searchParams.get('distanceMeters') })); return;
        }
        if (pathname === '/api/route') {
          json(response, 200, await routes.route({ origin: url.searchParams.get('origin'), destination: url.searchParams.get('destination'), via: url.searchParams.get('via'), option: url.searchParams.get('option') })); return;
        }
        throw new ServiceError('API_NOT_FOUND', '요청한 API를 찾을 수 없습니다.', 404);
      }
      if (pathname.split('/').some(part => part.startsWith('.'))) throw new ServiceError('NOT_FOUND', '파일을 찾을 수 없습니다.', 404);
      const asset = resolve(publicRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!asset.startsWith(`${publicRoot}${sep}`) || !MIME[extname(asset)]) throw new ServiceError('NOT_FOUND', '파일을 찾을 수 없습니다.', 404);
      const info = await stat(asset).catch(() => null);
      if (!info?.isFile()) throw new ServiceError('NOT_FOUND', '파일을 찾을 수 없습니다.', 404);
      const body = request.method === 'HEAD' ? null : await readFile(asset);
      response.writeHead(200, { 'Content-Type': MIME[extname(asset)], 'Content-Length': info.size, 'Cache-Control': pathname.includes('/data/') || pathname.endsWith('config.json') ? 'no-store' : 'no-cache' });
      response.end(body);
    } catch (error) {
      const safeError = error instanceof URIError ? new ServiceError('INVALID_URL', '올바르지 않은 요청 주소입니다.', 400) : error;
      const provider = requestPath === '/api/highway-stations' ? 'ex' : requestPath.startsWith('/api/route') ? 'naver' : 'opinet';
      json(response, safeError instanceof ServiceError ? safeError.httpStatus : 500, { status: 'error', provider, fetchedAt: null, stations: [], warnings: [], error: publicError(safeError) });
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = integerEnv(process.env.PORT, 8787, 1, 65535);
  const host = process.env.HOST || '127.0.0.1';
  createServer(createApp()).listen(port, host, () => {
    console.log(`주유한눈: http://${host}:${port}`);
    console.log('위치·가격 조회 URL과 인증키는 로그에 기록하지 않습니다.');
  });
}
