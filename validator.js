/**
 * 입력 검증 모듈
 * KIS API 호출 전 stockCode, quantity, price 검증
 */

function assertStockCode(stockCode) {
  if (typeof stockCode !== 'string') throw new Error(`stockCode must be string, got ${typeof stockCode}`);
  const code = stockCode.trim();
  if (!/^\d{6}$/.test(code)) throw new Error(`stockCode must be 6 digits, got "${code}"`);
  return code;
}

function assertQuantity(qty) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`quantity must be positive integer, got ${qty}`);
  if (n > 100000) throw new Error(`quantity too large: ${n}`);
  return n;
}

function assertPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) throw new Error(`price must be non-negative number, got ${price}`);
  return n;
}

module.exports = { assertStockCode, assertQuantity, assertPrice };
