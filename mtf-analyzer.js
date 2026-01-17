/**
 * 다중 타임프레임 분석 모듈 (Multi-Timeframe Analysis)
 * Phase 2: 일봉 + 주봉 통합 분석
 *
 * 원칙:
 * - 주봉(Weekly): 장기 추세 판단 (상승/하락/횡보)
 * - 일봉(Daily): 중기 추세 확인 및 매매 타이밍
 * - 상위 타임프레임과 일치할 때만 매수 (추세 추종)
 */

const indicators = require('./indicators');

const mtfAnalyzer = {
  /**
   * 주봉 추세 분석
   * @param {Array} weeklyCandles - 주봉 데이터 [{open, high, low, close, volume}, ...]
   */
  analyzeWeeklyTrend(weeklyCandles) {
    if (!weeklyCandles || weeklyCandles.length < 20) {
      return { trend: 'UNKNOWN', strength: 0, details: {} };
    }

    const closes = weeklyCandles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    // 주봉 이동평균선
    const ma5 = indicators.SMA(closes, 5);   // 5주선
    const ma10 = indicators.SMA(closes, 10); // 10주선
    const ma20 = indicators.SMA(closes, 20); // 20주선

    // 주봉 MACD
    const macd = indicators.MACD(closes, 12, 26, 9);

    // 주봉 RSI
    const rsi = indicators.RSI(closes);

    // 추세 판단 점수
    let bullishPoints = 0;
    let bearishPoints = 0;

    // 1. 이평선 정배열/역배열
    if (ma5 > ma10 && ma10 > ma20) {
      bullishPoints += 3; // 강한 상승 추세
    } else if (ma5 > ma10) {
      bullishPoints += 1;
    } else if (ma5 < ma10 && ma10 < ma20) {
      bearishPoints += 3; // 강한 하락 추세
    } else if (ma5 < ma10) {
      bearishPoints += 1;
    }

    // 2. 가격 위치
    if (currentPrice > ma5 && currentPrice > ma10) {
      bullishPoints += 2;
    } else if (currentPrice < ma5 && currentPrice < ma10) {
      bearishPoints += 2;
    }

    // 3. MACD 신호
    if (macd.trend === 'BULLISH') {
      bullishPoints += 2;
      if (macd.crossover === 'GOLDEN_CROSS') bullishPoints += 1;
    } else if (macd.trend === 'BEARISH') {
      bearishPoints += 2;
      if (macd.crossover === 'DEAD_CROSS') bearishPoints += 1;
    }

    // 4. RSI 기반
    if (rsi < 30) {
      bullishPoints += 1; // 과매도 (반등 가능)
    } else if (rsi > 70) {
      bearishPoints += 1; // 과매수 (조정 가능)
    }

    // 추세 결정
    const netScore = bullishPoints - bearishPoints;
    let trend = 'SIDEWAYS';
    let strength = 0;

    if (netScore >= 5) {
      trend = 'STRONG_UPTREND';
      strength = Math.min(netScore / 8, 1);
    } else if (netScore >= 2) {
      trend = 'UPTREND';
      strength = netScore / 8;
    } else if (netScore <= -5) {
      trend = 'STRONG_DOWNTREND';
      strength = Math.min(Math.abs(netScore) / 8, 1);
    } else if (netScore <= -2) {
      trend = 'DOWNTREND';
      strength = Math.abs(netScore) / 8;
    }

    return {
      trend,
      strength: Math.round(strength * 100) / 100,
      bullishPoints,
      bearishPoints,
      netScore,
      details: {
        ma5: Math.round(ma5),
        ma10: Math.round(ma10),
        ma20: Math.round(ma20),
        macd: macd.macd,
        macdSignal: macd.signal,
        macdTrend: macd.trend,
        rsi,
        currentPrice,
        priceVsMA5: currentPrice > ma5 ? 'ABOVE' : 'BELOW',
        priceVsMA10: currentPrice > ma10 ? 'ABOVE' : 'BELOW',
        priceVsMA20: ma20 ? (currentPrice > ma20 ? 'ABOVE' : 'BELOW') : null,
      }
    };
  },

  /**
   * 일봉 추세 분석 (기존 분석과 유사하지만 MTF용 요약)
   * @param {Array} dailyCandles - 일봉 데이터
   */
  analyzeDailyTrend(dailyCandles) {
    if (!dailyCandles || dailyCandles.length < 20) {
      return { trend: 'UNKNOWN', strength: 0, details: {} };
    }

    const closes = dailyCandles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    const ma5 = indicators.SMA(closes, 5);
    const ma20 = indicators.SMA(closes, 20);
    const ma60 = indicators.SMA(closes, 60);
    const macd = indicators.MACD(closes);
    const rsi = indicators.RSI(closes);
    const bollinger = indicators.BollingerBands(closes);

    let bullishPoints = 0;
    let bearishPoints = 0;

    // 이평선 정배열
    if (ma5 > ma20) bullishPoints += 2;
    else bearishPoints += 2;

    if (ma60 && ma20 > ma60) bullishPoints += 1;
    else if (ma60) bearishPoints += 1;

    // 가격 위치
    if (currentPrice > ma5) bullishPoints += 1;
    else bearishPoints += 1;

    // MACD
    if (macd.trend === 'BULLISH') bullishPoints += 2;
    else if (macd.trend === 'BEARISH') bearishPoints += 2;

    if (macd.crossover === 'GOLDEN_CROSS') bullishPoints += 2;
    else if (macd.crossover === 'DEAD_CROSS') bearishPoints += 2;

    // 볼린저 밴드
    if (bollinger.signal === 'OVERSOLD') bullishPoints += 1;
    else if (bollinger.signal === 'OVERBOUGHT') bearishPoints += 1;

    const netScore = bullishPoints - bearishPoints;
    let trend = 'SIDEWAYS';

    if (netScore >= 4) trend = 'UPTREND';
    else if (netScore >= 2) trend = 'MILD_UPTREND';
    else if (netScore <= -4) trend = 'DOWNTREND';
    else if (netScore <= -2) trend = 'MILD_DOWNTREND';

    return {
      trend,
      strength: Math.abs(netScore) / 10,
      bullishPoints,
      bearishPoints,
      netScore,
      details: {
        ma5: Math.round(ma5),
        ma20: Math.round(ma20),
        ma60: ma60 ? Math.round(ma60) : null,
        macd: macd.macd,
        macdCrossover: macd.crossover,
        rsi,
        bbPercentB: bollinger.percentB,
        currentPrice,
      }
    };
  },

  /**
   * 다중 타임프레임 통합 분석
   * @param {Array} dailyCandles - 일봉 데이터
   * @param {Array} weeklyCandles - 주봉 데이터
   */
  analyze(dailyCandles, weeklyCandles) {
    const weekly = this.analyzeWeeklyTrend(weeklyCandles);
    const daily = this.analyzeDailyTrend(dailyCandles);

    // MTF 신호 판단
    let mtfSignal = 'NEUTRAL';
    let mtfScore = 0;
    let alignment = 'NONE';

    // 추세 정렬 확인
    const isWeeklyBullish = weekly.trend.includes('UPTREND');
    const isWeeklyBearish = weekly.trend.includes('DOWNTREND');
    const isDailyBullish = daily.trend.includes('UPTREND');
    const isDailyBearish = daily.trend.includes('DOWNTREND');

    if (isWeeklyBullish && isDailyBullish) {
      // 주봉 + 일봉 모두 상승 추세 (최고 조건)
      alignment = 'BULLISH_ALIGNED';
      mtfSignal = 'STRONG_BUY';
      mtfScore = 3;
    } else if (isWeeklyBullish && !isDailyBearish) {
      // 주봉 상승, 일봉 중립/약한 상승
      alignment = 'WEEKLY_BULLISH';
      mtfSignal = 'BUY';
      mtfScore = 2;
    } else if (isWeeklyBearish && isDailyBearish) {
      // 주봉 + 일봉 모두 하락 추세
      alignment = 'BEARISH_ALIGNED';
      mtfSignal = 'STRONG_SELL';
      mtfScore = -3;
    } else if (isWeeklyBearish && !isDailyBullish) {
      // 주봉 하락, 일봉 중립/약한 하락
      alignment = 'WEEKLY_BEARISH';
      mtfSignal = 'SELL';
      mtfScore = -2;
    } else if (isWeeklyBullish && isDailyBearish) {
      // 주봉 상승, 일봉 하락 (조정 구간 - 매수 대기)
      alignment = 'PULLBACK';
      mtfSignal = 'WAIT_BUY';
      mtfScore = 1;
    } else if (isWeeklyBearish && isDailyBullish) {
      // 주봉 하락, 일봉 상승 (반등 - 주의)
      alignment = 'BOUNCE';
      mtfSignal = 'CAUTION';
      mtfScore = -1;
    }

    // 강도 계산 (주봉 가중치 더 높음)
    const combinedStrength = (weekly.strength * 0.6) + (daily.strength * 0.4);

    return {
      mtfSignal,
      mtfScore,
      alignment,
      combinedStrength: Math.round(combinedStrength * 100) / 100,
      weekly: {
        trend: weekly.trend,
        strength: weekly.strength,
        netScore: weekly.netScore,
        details: weekly.details,
      },
      daily: {
        trend: daily.trend,
        strength: daily.strength,
        netScore: daily.netScore,
        details: daily.details,
      },
      recommendation: this.getRecommendation(mtfSignal, alignment),
    };
  },

  /**
   * MTF 기반 매매 추천
   */
  getRecommendation(signal, alignment) {
    const recommendations = {
      'STRONG_BUY': {
        action: 'BUY',
        message: '주봉/일봉 모두 상승 추세 - 적극 매수 구간',
        confidence: 'HIGH',
      },
      'BUY': {
        action: 'BUY',
        message: '주봉 상승 추세 - 매수 고려',
        confidence: 'MEDIUM',
      },
      'WAIT_BUY': {
        action: 'HOLD',
        message: '주봉 상승, 일봉 조정 - 조정 완료 후 매수 대기',
        confidence: 'MEDIUM',
      },
      'NEUTRAL': {
        action: 'HOLD',
        message: '추세 불명확 - 관망',
        confidence: 'LOW',
      },
      'CAUTION': {
        action: 'HOLD',
        message: '주봉 하락 중 반등 - 매수 주의',
        confidence: 'LOW',
      },
      'SELL': {
        action: 'SELL',
        message: '주봉 하락 추세 - 매도 고려',
        confidence: 'MEDIUM',
      },
      'STRONG_SELL': {
        action: 'SELL',
        message: '주봉/일봉 모두 하락 추세 - 빠른 매도',
        confidence: 'HIGH',
      },
    };

    return recommendations[signal] || recommendations['NEUTRAL'];
  },

  /**
   * 매수 가능 여부 판단 (MTF 기준)
   * @param {Object} mtfAnalysis - analyze() 결과
   */
  canBuy(mtfAnalysis) {
    const allowedSignals = ['STRONG_BUY', 'BUY'];
    return {
      allowed: allowedSignals.includes(mtfAnalysis.mtfSignal),
      reason: mtfAnalysis.recommendation.message,
      signal: mtfAnalysis.mtfSignal,
      alignment: mtfAnalysis.alignment,
    };
  },

  /**
   * 매도 필요 여부 판단 (MTF 기준)
   * @param {Object} mtfAnalysis - analyze() 결과
   */
  shouldSell(mtfAnalysis) {
    const sellSignals = ['STRONG_SELL', 'SELL'];
    return {
      required: sellSignals.includes(mtfAnalysis.mtfSignal),
      urgent: mtfAnalysis.mtfSignal === 'STRONG_SELL',
      reason: mtfAnalysis.recommendation.message,
      signal: mtfAnalysis.mtfSignal,
    };
  },
};

module.exports = mtfAnalyzer;
