/**
 * Highway station source boundary.
 *
 * The official API0312 catalogue is verified, but its request/response
 * specification could not be retrieved. Do not guess endpoint names, fuel
 * fields, pagination, coordinates, or source timestamps from catalogue prose.
 * This boundary intentionally makes no upstream request until that contract
 * has been verified. See HIGHWAY_DATA.md for the exact remaining work.
 */
export const HIGHWAY_SOURCE = Object.freeze({
  name: '한국도로공사',
  url: 'https://data.ex.co.kr/openapi/basicinfo/openApiInfoM?apiId=0312',
  metadataUrl: 'https://www.data.go.kr/data/15076636/openapi.do',
  apiId: '0312',
});

export class HighwayClient {
  constructor({ apiKey = '', quota, fetchImpl = fetch, clock = Date.now } = {}) {
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.quota = quota;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
  }

  // Credentials and implementation readiness are separate facts.
  get configured() { return this.apiKey.length > 0; }
  get implementationReady() { return false; }

  async snapshot() {
    const configured = this.configured;
    return {
      status: configured ? 'error' : 'awaiting_credentials',
      provider: 'ex',
      dataGranularity: 'station',
      implementationReady: false,
      fetchedAt: null,
      stations: [],
      coverage: {
        kind: 'highway_stations',
        complete: false,
        description: '한국도로공사 고속도로 주유소 자료입니다. 현재 가격 자료 연결을 준비하고 있습니다.',
      },
      cache: { hit: false, ageSeconds: null, stale: false },
      source: { ...HIGHWAY_SOURCE },
      warnings: [{
        code: 'EX_SCHEMA_UNVERIFIED',
        message: '고속도로 가격 자료는 아직 연결되지 않았습니다. 현재 가격은 한국도로공사에서 확인해 주세요.',
      }],
      error: configured
        ? { code: 'EX_SCHEMA_UNVERIFIED', message: '고속도로 가격 자료 연결을 준비하고 있습니다. 현재 가격은 한국도로공사에서 확인해 주세요.' }
        : { code: 'EX_CREDENTIALS_REQUIRED', message: '고속도로 가격 자료 연결을 준비하고 있습니다. 현재 가격은 한국도로공사에서 확인해 주세요.' },
    };
  }
}
