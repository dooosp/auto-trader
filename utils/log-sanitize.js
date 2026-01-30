/**
 * 로그 새니타이징 유틸리티
 * error.response.data / headers / config.headers 는 절대 로그에 넣지 않음
 */

function sanitizeAxiosError(err) {
  return {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    status: err?.response?.status,
    method: err?.config?.method,
    url: err?.config?.url,
  };
}

function sanitizeErrorMsg(err) {
  const s = sanitizeAxiosError(err);
  const parts = [`${s.name || 'Error'}: ${s.message}`];
  if (s.status) parts.push(`status=${s.status}`);
  if (s.url) parts.push(`url=${s.method?.toUpperCase()} ${s.url}`);
  return parts.join(', ');
}

module.exports = { sanitizeAxiosError, sanitizeErrorMsg };
