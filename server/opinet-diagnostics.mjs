// Diagnostics contain only fixed field names, structural metadata and bounded
// numeric codes. Never serialize a provider value, field name, URL or message.
const ENDPOINTS = new Set([
  'aroundAll.do', 'detailById.do', 'lowTop10.do', 'areaCode.do',
  'avgAllPrice.do', 'avgSidoPrice.do', 'avgSigunPrice.do',
]);
const ERROR_FIELDS = Object.freeze(['ERROR', 'CODE', 'RESULT_CODE', 'errorCode', 'resultCode']);
const ABSENT = Symbol('absent');
const ACCESSOR = Symbol('accessor');

function field(value, name) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return ABSENT;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor) return ABSENT;
  // Reading a diagnostic must not invoke a provider-controlled getter.
  return Object.hasOwn(descriptor, 'value') ? descriptor.value : ACCESSOR;
}

function typeOf(value) {
  if (value === ABSENT) return 'absent';
  if (value === ACCESSOR) return 'accessor';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'object': return 'object';
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'undefined': return 'undefined';
    default: return 'other';
  }
}

function shape(value) {
  const type = typeOf(value);
  const count = type === 'array' ? field(value, 'length') : null;
  return { present: value !== ABSENT, type, arrayCount: Number.isSafeInteger(count) && count >= 0 ? count : null };
}

function numericCode(value, apiKey) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d{1,3}$/.test(value)) return null;
  const code = Number(value);
  if (!Number.isInteger(code) || code < 0 || code > 999) return null;
  // Even a short numeric value is suppressed if it matches the configured key
  // or a numeric fragment of it. Unknown strings are never copied or coerced.
  if (typeof apiKey === 'string' && apiKey && (apiKey.includes(String(value)) || apiKey.includes(String(code)))) return null;
  return code;
}

function errorFields(value, apiKey) {
  return Object.fromEntries(ERROR_FIELDS.map(name => {
    const item = field(value, name);
    return [name, { present: item !== ABSENT, numericCode: numericCode(item, apiKey) }];
  }));
}

function credentialFormat(apiKey) {
  const value = typeof apiKey === 'string' ? apiKey : '';
  return {
    surroundingQuotes: /^['"]|['"]$/.test(value),
    whitespace: /\s/.test(value),
    assignment: /^(?:OPINET_API_KEY|certkey)\s*=/i.test(value),
    url: /^https?:\/\//i.test(value),
  };
}

/** Emit one bounded JSON line, using no extra requests. Failures are inert. */
export function logOpinetDiagnostic({ endpoint, httpStatus, payload, apiKey = '', enabled = process.env.OPINET_DIAGNOSTICS === '1', write = line => console.info(line) } = {}) {
  if (enabled !== true) return false;
  try {
    const result = field(payload, 'RESULT');
    const oil = field(result, 'OIL');
    const response = field(payload, 'response');
    const responseHeader = field(response, 'header');
    const header = field(payload, 'header');
    const record = {
      event: 'opinet_response_shape',
      endpoint: ENDPOINTS.has(endpoint) ? endpoint : 'unsupported',
      httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
      credentialFormat: credentialFormat(apiKey),
      payloadType: typeOf(payload),
      RESULT: shape(result), OIL: shape(oil),
      response: shape(response), responseHeader: shape(responseHeader), header: shape(header),
      errorFields: {
        root: errorFields(payload, apiKey), result: errorFields(result, apiKey),
        rootError: errorFields(field(payload, 'ERROR'), apiKey),
        resultError: errorFields(field(result, 'ERROR'), apiKey),
        response: errorFields(response, apiKey),
        responseHeader: errorFields(responseHeader, apiKey), header: errorFields(header, apiKey),
      },
    };
    write(JSON.stringify(record));
    return true;
  } catch {
    // Do not log the diagnostic exception: it may itself contain a secret.
    return false;
  }
}
