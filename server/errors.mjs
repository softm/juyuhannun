export class ServiceError extends Error {
  constructor(code, message, httpStatus = 502) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function publicError(error) {
  return error instanceof ServiceError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
}

export async function readJsonResponse(response, provider, maxBytes = 2_000_000) {
  const providerName = { OPINET: '오피넷', EX: '한국도로공사', NAVER: '경로 제공사' }[provider] ?? '데이터 제공사';
  if (!response.ok) throw new ServiceError(`${provider}_HTTP_${response.status}`, `${providerName}가 요청에 응답하지 못했습니다.`, response.status === 429 ? 429 : 502);
  const reader = response.body?.getReader();
  if (!reader) throw new ServiceError(`${provider}_INVALID_RESPONSE`, '데이터 제공사의 응답 본문이 없습니다.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ServiceError(`${provider}_RESPONSE_TOO_LARGE`, '데이터 제공사의 응답 크기가 허용 범위를 넘었습니다.'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(`${provider}_INVALID_RESPONSE`, '데이터 제공사의 응답 형식을 확인할 수 없습니다.');
  }
}
