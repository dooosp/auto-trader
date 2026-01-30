---
date: 2026-01-30
tags: [#bugfix, #safety, #overtrade-prevention, #cooldown, #profit-improvement]
project: auto-trader
---

## 해결 문제 (Context)
- 8영업일(1/19~1/27) 76건 매매, 실질 수익률 ~0%. 안전장치 4개(쿨다운, 다중확인, minProfitToSell, maxBuyPerRun)가 모두 작동하지 않는 버그 일괄 수정.

## 최종 핵심 로직 (Solution)

### BUG-1: 쿨다운 미작동 (3가지 원인)
```javascript
// syncPortfolio(): 기존 로컬 메타데이터 보존 병합
const existingMap = {};
for (const h of (existingPortfolio.holdings || [])) {
  existingMap[h.code] = h;
}
// API 데이터에 buyDate, partialSells, highestPrice 병합

// checkAndTrade(): 실행 중 매도 종목 추적
const soldThisRun = new Set();
// 매도 성공 시 soldThisRun.add(code)
// 매수 후보에서 soldThisRun + checkCooldown 이중 필터
```

### BUG-2: requiredSellConditions 기본값 오류
```javascript
// Before: config 값 3이 있어도 || 연산자로 2 사용
multiConfirm.requiredSellConditions || 2
// After: ?? 연산자로 config 값 우선, fallback 3
multiConfirm.requiredSellConditions ?? 3
```

### BUG-3: minProfitToSell 우회
```javascript
// generateSignal() 다중 매도 조건 충족 시에도 최소 익절 게이트 추가
if (profitRate > 0 && profitRate < minProfitToSell) {
  return { action: 'HOLD', reason: '최소 익절 미달...' };
}
// 긴급 매도(ATR 손절, 악재+손실)는 위에서 이미 반환되므로 예외 자동 적용
```

### BUG-4: maxBuyPerRun 초과
```javascript
// 시작 시점 스냅샷으로 슬롯 계산 (매도로 비워진 슬롯 재사용 방지)
const initialHoldingsCount = portfolio.holdings.length;
const availableSlots = config.trading.maxHoldings - initialHoldingsCount;
```

### FIX-5: RSI 매도 임계값 상향
```javascript
// config.js: rsiAbove: 70 → 75
// technical-analyzer.js: 하드코딩 제거 → config 참조
const rsiSellThreshold = trading.sell.rsiAbove || 75;
```

### FIX-6: 일일 매매 빈도 제한
```javascript
// config.js에 dailyMaxBuys: 4, dailyMaxSells: 4 추가
// countTodayTrades(type) 함수 신규 → trades.json에서 당일 건수 카운트
// checkAndTrade()에서 매수/매도 전 일일 제한 체크
```

## 핵심 통찰 (Learning & Decision)

- **Problem:** `||` vs `??` 연산자 차이. `config.requiredSellConditions = 3`이 truthy인데도 `|| 2`가 적용되진 않지만, `0`이나 빈 값일 때 의도치 않은 fallback 발생 가능. 실제로는 config 로딩 경로에서 값이 누락되는 edge case가 원인이었음.
- **Problem:** `syncPortfolio()`가 API 데이터로 전체 덮어쓰기 → 로컬 메타데이터(buyDate 등) 소실 → 쿨다운/보유시간 체크 무력화. GitHub Actions fresh checkout 환경에서 특히 치명적.
- **Problem:** 매도 후 같은 실행에서 슬롯이 비면 즉시 재매수 → 매도-재매수 사이클 반복으로 수수료만 소진.
- **Decision:** in-memory `soldThisRun` Set + `initialHoldingsCount` 스냅샷 조합으로 같은 실행 내 재매수/슬롯 재활용 차단. 일일 제한은 trades.json 기반 카운트.
- **Next Step:** 실전 1~2일 모니터링 필요. 특히 (1) cooldown.json에 매도 종목 정상 기록되는지, (2) 일일 매수 4건 이하인지, (3) profitRate < 3% 비긴급 매도 차단되는지 확인.

## 수정 파일 요약

| 파일 | 수정 내용 |
|------|----------|
| `config.js` | `rsiAbove: 75`, `dailyMaxBuys: 4`, `dailyMaxSells: 4` |
| `technical-analyzer.js` | `?? 3` 수정, minProfitToSell 게이트, RSI config 참조 |
| `trade-executor.js` | syncPortfolio 병합, soldThisRun, 스냅샷 슬롯, countTodayTrades, 일일 제한 |
