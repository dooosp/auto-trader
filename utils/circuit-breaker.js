/**
 * 간단 서킷브레이커 (in-memory, endpoint 단위)
 * CLOSED → (N회 연속 실패) → OPEN → (cooldown) → HALF_OPEN → (성공) → CLOSED
 */

function createCircuitBreaker({
  failureThreshold = 5,
  cooldownMs = 30000,
  halfOpenMax = 1,
} = {}) {
  const state = new Map();

  function get(key) {
    if (!state.has(key)) state.set(key, { fails: 0, openUntil: 0, halfOpenTrials: 0 });
    return state.get(key);
  }

  function canRequest(key) {
    const s = get(key);
    const now = Date.now();
    if (s.openUntil > now) return false;
    if (s.openUntil !== 0 && s.openUntil <= now) {
      if (s.halfOpenTrials >= halfOpenMax) return false;
      s.halfOpenTrials += 1;
    }
    return true;
  }

  function success(key) {
    const s = get(key);
    s.fails = 0;
    s.openUntil = 0;
    s.halfOpenTrials = 0;
  }

  function failure(key) {
    const s = get(key);
    s.fails += 1;
    if (s.fails >= failureThreshold) {
      s.openUntil = Date.now() + cooldownMs;
      s.halfOpenTrials = 0;
      console.error(`[CircuitBreaker] OPEN: ${key} (${s.fails}회 연속 실패, ${cooldownMs / 1000}초 대기)`);
    }
  }

  function getState(key) {
    const s = get(key);
    const now = Date.now();
    if (s.fails < failureThreshold) return 'CLOSED';
    if (s.openUntil > now) return 'OPEN';
    return 'HALF_OPEN';
  }

  return { canRequest, success, failure, getState };
}

module.exports = { createCircuitBreaker };
