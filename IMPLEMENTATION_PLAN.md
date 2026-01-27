# IMPLEMENTATION_PLAN: 수익률 개선 + 대시보드 UI

> **Status:** Phase 4 진행 중 (대시보드 UI)
> **Protocol:** Standard (기존 프로젝트 기능 추가)
> **Created:** 2026-01-27
> **수익률 개선:** ✅ 완료
> **대시보드 UI:** 🔄 진행 중

---

## 1. 목표

auto-trader의 **매수 진입 정확도**와 **종목 선별력**을 향상시켜 수익률을 개선한다.

---

## 2. 개선 범위

### 2.1 캔들 패턴 인식 (신규 모듈)

**목적:** 반전/지속 신호를 캔들 패턴으로 포착

| 패턴 | 의미 | 신호 |
|------|------|------|
| 망치형 (Hammer) | 하락 후 반전 | 매수 +2점 |
| 역망치형 (Inverted Hammer) | 하락 후 반전 가능 | 매수 +1점 |
| 상승장악형 (Bullish Engulfing) | 강한 반전 | 매수 +3점 |
| 모닝스타 (Morning Star) | 3봉 반전 | 매수 +3점 |
| 도지 (Doji) | 추세 전환 경고 | 주의 신호 |
| 하락장악형 (Bearish Engulfing) | 하락 반전 | 매도 신호 |

**파일:** `candle-patterns.js` (신규)

**연동:** `technical-analyzer.js`에서 호출

---

### 2.2 추가 모멘텀 지표

**목적:** RSI 외 추가 확인으로 진입 신뢰도 향상

#### Stochastic Oscillator
```
%K = (현재가 - N일 최저) / (N일 최고 - N일 최저) × 100
%D = %K의 M일 이동평균

매수 신호: %K < 20 (과매도) + %K가 %D 상향돌파
매도 신호: %K > 80 (과매수) + %K가 %D 하향돌파
```

#### Williams %R
```
%R = (N일 최고 - 현재가) / (N일 최고 - N일 최저) × -100

매수 신호: %R < -80 (과매도)
매도 신호: %R > -20 (과매수)
```

**파일:** `indicators.js`에 추가

---

### 2.3 VWAP (거래량 가중 평균가)

**목적:** 기관 매매 기준가 활용

```
VWAP = Σ(가격 × 거래량) / Σ(거래량)

매수 신호: 현재가 < VWAP (저평가 구간)
매도 신호: 현재가 > VWAP × 1.03 (고평가 구간)
```

**파일:** `indicators.js`에 추가

---

### 2.4 ATR 기반 변동성 진입

**목적:** 변동성 수축 후 확대 시점 포착 (Squeeze)

```
ATR 비율 = 현재 ATR / 20일 평균 ATR

변동성 수축: ATR 비율 < 0.7 (준비 단계)
변동성 확대: ATR 비율 > 1.2 (진입 신호)

매수 조건: 수축 → 확대 + 상승 방향
```

**파일:** `indicators.js`, `technical-analyzer.js` 수정

---

### 2.5 외국인/기관 수급 분석

**목적:** 세력 매매 방향 추종

```
3일 연속 순매수 → 매수 가점 +2
3일 연속 순매도 → 매수 감점 -2
당일 대량 순매수 (거래량 상위 5%) → 매수 가점 +1
```

**데이터 소스:** 한국투자증권 API (투자자별 매매동향)

**파일:** `supply-demand.js` (신규)

---

### 2.6 매수 신호 점수 체계 개편

**현재:**
```javascript
// 5개 조건 동시 충족 필요 (boolean)
rsi_oversold && golden_cross && ma_up && volume_increase && news_positive
```

**개선:**
```javascript
// 점수 기반 시스템 (threshold: 7점 이상)
const score = {
  rsi_oversold: 2,        // RSI < 30
  stoch_oversold: 1,      // Stochastic < 20
  williams_oversold: 1,   // Williams %R < -80
  golden_cross: 2,        // 골든크로스
  candle_bullish: 2,      // 상승 캔들 패턴
  below_vwap: 1,          // VWAP 하단
  atr_squeeze: 1,         // 변동성 수축 후 확대
  foreign_buying: 2,      // 외국인 순매수
  institution_buying: 2,  // 기관 순매수
  volume_surge: 1,        // 거래량 급증
  news_positive: 1        // 뉴스 긍정
};

// 총점 16점 만점, 7점 이상 매수 고려
// 10점 이상: 적극 매수
// 7-9점: 일반 매수
```

**파일:** `technical-analyzer.js` 수정

---

## 3. 파일 변경 계획

| 파일 | 작업 | 예상 라인 |
|------|------|----------|
| `candle-patterns.js` | 신규 생성 | ~150줄 |
| `supply-demand.js` | 신규 생성 | ~120줄 |
| `indicators.js` | Stochastic, Williams %R, VWAP 추가 | +80줄 |
| `technical-analyzer.js` | 점수 체계 개편, 신규 지표 연동 | +50줄 |
| `config.js` | 새 지표 설정 추가 | +20줄 |
| `kis-api.js` | 투자자별 매매동향 API 추가 | +40줄 |

**총 변경량:** 약 460줄 (신규 270줄 + 수정 190줄)

---

## 4. 구현 순서

```
Step 1: indicators.js 확장
        └─ Stochastic, Williams %R, VWAP 추가

Step 2: candle-patterns.js 생성
        └─ 6개 캔들 패턴 인식 로직

Step 3: kis-api.js 확장
        └─ 투자자별 매매동향 API 연동

Step 4: supply-demand.js 생성
        └─ 외국인/기관 수급 분석 로직

Step 5: technical-analyzer.js 개편
        └─ 점수 기반 시스템으로 전환
        └─ 신규 지표들 연동

Step 6: config.js 설정 추가
        └─ 새 지표 임계값 설정

Step 7: 테스트 및 검증
        └─ 각 지표 단위 테스트
        └─ 통합 테스트
```

---

## 5. Edge Cases

### 5.1 데이터 부족
- **문제:** 일봉 데이터 부족 시 지표 계산 불가
- **대응:** 최소 20일 데이터 필요, 부족 시 해당 지표 스킵

### 5.2 API 실패
- **문제:** 투자자별 매매동향 API 실패
- **대응:** 수급 점수 0점 처리, 다른 지표로만 판단

### 5.3 점수 시스템 전환
- **문제:** 기존 boolean 시스템과 호환성
- **대응:** 기존 로직 유지하면서 점수 시스템 병행 운영 후 전환

### 5.4 캔들 패턴 오인식
- **문제:** 노이즈로 인한 거짓 패턴
- **대응:** 거래량 동반 확인 필수, 단독 신호 불가

---

## 6. 자가 비판 (Devil's Advocate)

### 취약점 1: 과최적화 위험
- **문제:** 지표를 너무 많이 추가하면 진입 기회 감소
- **대응:** 점수 임계값 조정 가능하게 설계 (config.js)

### 취약점 2: 수급 데이터 지연
- **문제:** 투자자별 매매동향은 전일 기준 (T+1)
- **대응:** 참고 지표로만 활용, 핵심 조건에서 제외 가능

### 취약점 3: 캔들 패턴의 한계
- **문제:** 단기 노이즈에 취약
- **대응:** MTF 분석과 결합 (주봉 추세 확인 후 일봉 패턴 적용)

### 취약점 4: 백테스팅 부재
- **문제:** 새 전략 검증 없이 실전 적용
- **대응:** 모의투자(USE_MOCK=true)로 2주간 테스트 권장

---

## 7. 롤백 계획

문제 발생 시:
1. `config.js`에서 새 지표 비활성화
   ```javascript
   candlePatterns: { enabled: false },
   supplyDemand: { enabled: false },
   newScoreSystem: { enabled: false }
   ```
2. 기존 boolean 시스템으로 자동 복귀

---

## 8. 테스트 계획

### Unit Test
- [ ] Stochastic 계산 정확도
- [ ] Williams %R 계산 정확도
- [ ] VWAP 계산 정확도
- [ ] 각 캔들 패턴 인식 정확도
- [ ] 수급 점수 계산

### Integration Test
- [ ] 점수 시스템 + 기존 시스템 병행
- [ ] 모의투자 환경 1주일 운영
- [ ] 매수 신호 발생 빈도 확인 (너무 적지 않은지)

### 성공 기준
- 매수 신호 발생 빈도: 기존 대비 70~130% 범위
- 신호 정확도: 매수 후 3일 내 +1% 달성 비율 60% 이상

---

## 9. 예상 효과

| 지표 | 기대 효과 |
|------|----------|
| 캔들 패턴 | 반전 타이밍 포착 → 진입 정확도 +15% |
| Stochastic/Williams %R | 다중 확인 → 거짓 신호 -20% |
| VWAP | 저평가 구간 진입 → 평균 매수가 개선 |
| ATR Squeeze | 큰 움직임 전 진입 → 수익폭 확대 |
| 외국인/기관 수급 | 세력 추종 → 승률 +10% |

---

## 승인 요청

위 설계대로 진행해도 될까요?

- [ ] **승인** - 구현 시작
- [ ] **수정 요청** - 특정 부분 변경
- [ ] **보류** - 추가 검토 필요
