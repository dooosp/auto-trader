/**
 * 캔들 패턴 인식 모듈
 * 반전/지속 신호를 캔들 패턴으로 포착
 */

const candlePatterns = {
  // ============================================
  // 유틸리티 함수
  // ============================================

  /**
   * 캔들 기본 속성 계산
   */
  getCandleInfo(candle) {
    const { open, high, low, close } = candle;
    const body = Math.abs(close - open);
    const range = high - low;
    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const isGreen = close > open;

    return {
      body,
      range,
      upperShadow,
      lowerShadow,
      isGreen,
      bodyRatio: range > 0 ? body / range : 0,
      upperRatio: range > 0 ? upperShadow / range : 0,
      lowerRatio: range > 0 ? lowerShadow / range : 0,
    };
  },

  /**
   * 평균 캔들 크기 (ATR 대용)
   */
  getAvgRange(candles, period = 10) {
    const ranges = candles.slice(-period).map(c => c.high - c.low);
    return ranges.reduce((a, b) => a + b, 0) / ranges.length;
  },

  // ============================================
  // 반전 패턴 (Reversal Patterns)
  // ============================================

  /**
   * 망치형 (Hammer) - 하락 후 반전 신호
   * 특징: 작은 몸통, 긴 아래꼬리, 짧은 윗꼬리
   */
  isHammer(candle, avgRange) {
    const info = this.getCandleInfo(candle);

    return (
      info.bodyRatio < 0.3 &&        // 몸통 작음
      info.lowerRatio > 0.5 &&       // 아래꼬리 길음
      info.upperRatio < 0.1 &&       // 윗꼬리 짧음
      info.range >= avgRange * 0.8   // 캔들 크기 충분
    );
  },

  /**
   * 역망치형 (Inverted Hammer) - 하락 후 반전 가능
   * 특징: 작은 몸통, 긴 윗꼬리, 짧은 아래꼬리
   */
  isInvertedHammer(candle, avgRange) {
    const info = this.getCandleInfo(candle);

    return (
      info.bodyRatio < 0.3 &&
      info.upperRatio > 0.5 &&
      info.lowerRatio < 0.1 &&
      info.range >= avgRange * 0.8
    );
  },

  /**
   * 상승장악형 (Bullish Engulfing) - 강한 반전
   * 특징: 음봉 후 양봉이 음봉을 완전히 감쌈
   */
  isBullishEngulfing(prev, curr) {
    const prevInfo = this.getCandleInfo(prev);
    const currInfo = this.getCandleInfo(curr);

    return (
      !prevInfo.isGreen &&           // 전일 음봉
      currInfo.isGreen &&            // 오늘 양봉
      curr.open < prev.close &&      // 갭다운 시작
      curr.close > prev.open &&      // 전일 시가 돌파
      currInfo.body > prevInfo.body * 1.2  // 몸통 크기 우위
    );
  },

  /**
   * 하락장악형 (Bearish Engulfing) - 하락 반전
   */
  isBearishEngulfing(prev, curr) {
    const prevInfo = this.getCandleInfo(prev);
    const currInfo = this.getCandleInfo(curr);

    return (
      prevInfo.isGreen &&
      !currInfo.isGreen &&
      curr.open > prev.close &&
      curr.close < prev.open &&
      currInfo.body > prevInfo.body * 1.2
    );
  },

  /**
   * 모닝스타 (Morning Star) - 3봉 반전
   * 특징: 긴 음봉 → 작은 몸통(도지/스피닝탑) → 긴 양봉
   */
  isMorningStar(candles) {
    if (candles.length < 3) return false;

    const [first, second, third] = candles.slice(-3);
    const firstInfo = this.getCandleInfo(first);
    const secondInfo = this.getCandleInfo(second);
    const thirdInfo = this.getCandleInfo(third);

    return (
      !firstInfo.isGreen &&          // 첫날 음봉
      firstInfo.bodyRatio > 0.5 &&   // 첫날 몸통 큼
      secondInfo.bodyRatio < 0.3 &&  // 둘째날 몸통 작음 (별)
      thirdInfo.isGreen &&           // 셋째날 양봉
      thirdInfo.bodyRatio > 0.5 &&   // 셋째날 몸통 큼
      third.close > (first.open + first.close) / 2  // 첫날 중간 이상 회복
    );
  },

  /**
   * 도지 (Doji) - 추세 전환 경고
   * 특징: 시가 ≈ 종가 (몸통 거의 없음)
   */
  isDoji(candle) {
    const info = this.getCandleInfo(candle);
    return info.bodyRatio < 0.1 && info.range > 0;
  },

  // ============================================
  // 패턴 종합 분석
  // ============================================

  /**
   * 모든 패턴 검사
   * @param {Array} candles - 최근 캔들 배열 (최소 5개 권장)
   * @returns {Object} 패턴 분석 결과
   */
  analyze(candles) {
    if (candles.length < 3) {
      return { patterns: [], signal: 'NEUTRAL', score: 0 };
    }

    const avgRange = this.getAvgRange(candles);
    const curr = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    const patterns = [];
    let score = 0;

    // 망치형 (하락장에서)
    if (this.isHammer(curr, avgRange)) {
      patterns.push({ name: 'HAMMER', type: 'BULLISH', strength: 2 });
      score += 2;
    }

    // 역망치형
    if (this.isInvertedHammer(curr, avgRange)) {
      patterns.push({ name: 'INVERTED_HAMMER', type: 'BULLISH', strength: 1 });
      score += 1;
    }

    // 상승장악형
    if (this.isBullishEngulfing(prev, curr)) {
      patterns.push({ name: 'BULLISH_ENGULFING', type: 'BULLISH', strength: 3 });
      score += 3;
    }

    // 하락장악형
    if (this.isBearishEngulfing(prev, curr)) {
      patterns.push({ name: 'BEARISH_ENGULFING', type: 'BEARISH', strength: 3 });
      score -= 3;
    }

    // 모닝스타
    if (this.isMorningStar(candles)) {
      patterns.push({ name: 'MORNING_STAR', type: 'BULLISH', strength: 3 });
      score += 3;
    }

    // 도지
    if (this.isDoji(curr)) {
      patterns.push({ name: 'DOJI', type: 'NEUTRAL', strength: 0 });
      // 도지는 경고 신호, 점수 없음
    }

    // 종합 신호 판단
    let signal = 'NEUTRAL';
    if (score >= 3) signal = 'STRONG_BULLISH';
    else if (score >= 1) signal = 'BULLISH';
    else if (score <= -3) signal = 'STRONG_BEARISH';
    else if (score <= -1) signal = 'BEARISH';

    return {
      patterns,
      signal,
      score,
    };
  },
};

module.exports = candlePatterns;
