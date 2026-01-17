/**
 * 기술적 지표 계산 모듈
 * MACD, 볼린저밴드, ATR, 거래량 분석 등
 */

const indicators = {
  // ============================================
  // 이동평균선 (Moving Average)
  // ============================================

  /**
   * 단순 이동평균 (SMA)
   */
  SMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / period;
  },

  /**
   * 지수 이동평균 (EMA)
   * EMA = 현재가 * k + 전일EMA * (1-k), k = 2/(period+1)
   */
  EMA(prices, period) {
    if (prices.length < period) return null;

    const k = 2 / (period + 1);

    // 첫 EMA는 SMA로 시작
    let ema = this.SMA(prices.slice(0, period), period);

    // 이후 EMA 계산
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }

    return ema;
  },

  /**
   * EMA 배열 반환 (MACD 계산용)
   */
  EMAArray(prices, period) {
    if (prices.length < period) return [];

    const k = 2 / (period + 1);
    const emaArray = [];

    // 첫 EMA는 SMA로
    let ema = this.SMA(prices.slice(0, period), period);
    emaArray.push(ema);

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
      emaArray.push(ema);
    }

    return emaArray;
  },

  // ============================================
  // MACD (Moving Average Convergence Divergence)
  // ============================================

  /**
   * MACD 계산
   * @param {Array} prices - 종가 배열
   * @param {number} fastPeriod - 단기 EMA (기본 12)
   * @param {number} slowPeriod - 장기 EMA (기본 26)
   * @param {number} signalPeriod - 시그널 EMA (기본 9)
   */
  MACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod + signalPeriod) {
      return { macd: null, signal: null, histogram: null, trend: 'NEUTRAL' };
    }

    // EMA 계산
    const ema12 = this.EMAArray(prices, fastPeriod);
    const ema26 = this.EMAArray(prices, slowPeriod);

    // MACD 라인 = EMA12 - EMA26
    const macdLine = [];
    const offset = slowPeriod - fastPeriod;

    for (let i = 0; i < ema26.length; i++) {
      macdLine.push(ema12[i + offset] - ema26[i]);
    }

    // 시그널 라인 = MACD의 9일 EMA
    const signalLine = this.EMAArray(macdLine, signalPeriod);

    // 현재 값
    const macd = macdLine[macdLine.length - 1];
    const signal = signalLine[signalLine.length - 1];
    const histogram = macd - signal;

    // 이전 값 (크로스 확인용)
    const prevMacd = macdLine[macdLine.length - 2];
    const prevSignal = signalLine[signalLine.length - 2];

    // 추세 판단
    let trend = 'NEUTRAL';
    let crossover = null;

    if (prevMacd <= prevSignal && macd > signal) {
      trend = 'BULLISH';
      crossover = 'GOLDEN_CROSS';  // 골든크로스 (매수 신호)
    } else if (prevMacd >= prevSignal && macd < signal) {
      trend = 'BEARISH';
      crossover = 'DEAD_CROSS';    // 데드크로스 (매도 신호)
    } else if (macd > signal && macd > 0) {
      trend = 'BULLISH';
    } else if (macd < signal && macd < 0) {
      trend = 'BEARISH';
    }

    return {
      macd: Math.round(macd * 100) / 100,
      signal: Math.round(signal * 100) / 100,
      histogram: Math.round(histogram * 100) / 100,
      trend,
      crossover,
    };
  },

  // ============================================
  // 볼린저 밴드 (Bollinger Bands)
  // ============================================

  /**
   * 표준편차 계산
   */
  standardDeviation(prices, period) {
    if (prices.length < period) return null;

    const slice = prices.slice(-period);
    const mean = slice.reduce((sum, p) => sum + p, 0) / period;
    const squaredDiffs = slice.map(p => Math.pow(p - mean, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / period;

    return Math.sqrt(variance);
  },

  /**
   * 볼린저 밴드 계산
   * @param {Array} prices - 종가 배열
   * @param {number} period - 기간 (기본 20)
   * @param {number} multiplier - 표준편차 배수 (기본 2)
   */
  BollingerBands(prices, period = 20, multiplier = 2) {
    if (prices.length < period) {
      return { upper: null, middle: null, lower: null, width: null, percentB: null, signal: 'NEUTRAL' };
    }

    const middle = this.SMA(prices, period);
    const stdDev = this.standardDeviation(prices, period);
    const upper = middle + (stdDev * multiplier);
    const lower = middle - (stdDev * multiplier);
    const currentPrice = prices[prices.length - 1];

    // 밴드 폭 (변동성 지표)
    const width = ((upper - lower) / middle) * 100;

    // %B (현재가의 밴드 내 위치, 0~1)
    const percentB = (currentPrice - lower) / (upper - lower);

    // 신호 판단
    let signal = 'NEUTRAL';
    if (percentB >= 1) {
      signal = 'OVERBOUGHT';      // 상단 밴드 터치/돌파 (과매수)
    } else if (percentB <= 0) {
      signal = 'OVERSOLD';        // 하단 밴드 터치/돌파 (과매도)
    } else if (percentB > 0.8) {
      signal = 'UPPER_ZONE';      // 상단 구간
    } else if (percentB < 0.2) {
      signal = 'LOWER_ZONE';      // 하단 구간 (매수 기회)
    }

    return {
      upper: Math.round(upper),
      middle: Math.round(middle),
      lower: Math.round(lower),
      width: Math.round(width * 100) / 100,
      percentB: Math.round(percentB * 1000) / 1000,
      signal,
    };
  },

  // ============================================
  // ATR (Average True Range) - 변동성 지표
  // ============================================

  /**
   * True Range 계산
   */
  TrueRange(high, low, prevClose) {
    return Math.max(
      high - low,                    // 당일 고가 - 당일 저가
      Math.abs(high - prevClose),    // 당일 고가 - 전일 종가
      Math.abs(low - prevClose)      // 당일 저가 - 전일 종가
    );
  },

  /**
   * ATR 계산
   * @param {Array} candles - [{high, low, close}, ...] 배열
   * @param {number} period - 기간 (기본 14)
   */
  ATR(candles, period = 14) {
    if (candles.length < period + 1) {
      return { atr: null, atrPercent: null };
    }

    // True Range 배열 계산
    const trArray = [];
    for (let i = 1; i < candles.length; i++) {
      const tr = this.TrueRange(
        candles[i].high,
        candles[i].low,
        candles[i - 1].close
      );
      trArray.push(tr);
    }

    // ATR = TR의 이동평균
    const recentTR = trArray.slice(-period);
    const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / period;

    // ATR% (현재가 대비 변동성)
    const currentPrice = candles[candles.length - 1].close;
    const atrPercent = (atr / currentPrice) * 100;

    return {
      atr: Math.round(atr),
      atrPercent: Math.round(atrPercent * 100) / 100,
    };
  },

  // ============================================
  // 거래량 분석 (Volume Analysis)
  // ============================================

  /**
   * 거래량 분석
   * @param {Array} candles - [{volume, close, open, high, low}, ...] 배열
   * @param {number} period - 평균 기간 (기본 20)
   */
  VolumeAnalysis(candles, period = 20) {
    if (candles.length < period) {
      return { avgVolume: null, volumeRatio: null, signal: 'NEUTRAL' };
    }

    const volumes = candles.map(c => c.volume);
    const avgVolume = this.SMA(volumes.slice(0, -1), period);  // 오늘 제외 평균
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = currentVolume / avgVolume;

    // 오늘 캔들 분석 (양봉/음봉)
    const today = candles[candles.length - 1];
    const isGreenCandle = today.close > today.open;
    const candleBody = Math.abs(today.close - today.open);
    const candleRange = today.high - today.low;
    const bodyRatio = candleBody / candleRange;  // 몸통 비율

    // VSA (Volume Spread Analysis) 신호
    let signal = 'NEUTRAL';
    let vsaPattern = null;

    if (volumeRatio >= 2.0) {
      // 거래량 폭발 (평소의 2배 이상)
      if (isGreenCandle && bodyRatio > 0.6) {
        signal = 'STRONG_BUYING';      // 강한 매수세
        vsaPattern = 'VOLUME_BREAKOUT';
      } else if (!isGreenCandle && bodyRatio > 0.6) {
        signal = 'STRONG_SELLING';     // 강한 매도세
        vsaPattern = 'VOLUME_BREAKDOWN';
      } else {
        signal = 'HIGH_VOLUME';
        vsaPattern = 'CHURNING';       // 혼조 (긴 꼬리)
      }
    } else if (volumeRatio >= 1.5) {
      signal = isGreenCandle ? 'BUYING_PRESSURE' : 'SELLING_PRESSURE';
    } else if (volumeRatio < 0.5) {
      signal = 'LOW_VOLUME';           // 거래량 감소 (관망)
    }

    return {
      avgVolume: Math.round(avgVolume),
      currentVolume,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      isGreenCandle,
      bodyRatio: Math.round(bodyRatio * 100) / 100,
      signal,
      vsaPattern,
    };
  },

  // ============================================
  // RSI (기존 로직 개선)
  // ============================================

  /**
   * RSI 계산
   */
  RSI(prices, period = 14) {
    if (prices.length < period + 1) return null;

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const recentChanges = changes.slice(-period);
    let gains = 0, losses = 0;

    for (const change of recentChanges) {
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return Math.round((100 - (100 / (1 + rs))) * 100) / 100;
  },

  // ============================================
  // 피보나치 되돌림 (Fibonacci Retracement)
  // ============================================

  /**
   * 피보나치 되돌림 레벨 계산
   * @param {number} high - 고점
   * @param {number} low - 저점
   */
  FibonacciLevels(high, low) {
    const diff = high - low;
    return {
      level_0: high,                           // 0% (고점)
      level_236: high - diff * 0.236,          // 23.6%
      level_382: high - diff * 0.382,          // 38.2%
      level_500: high - diff * 0.5,            // 50%
      level_618: high - diff * 0.618,          // 61.8% (황금비)
      level_786: high - diff * 0.786,          // 78.6%
      level_1000: low,                         // 100% (저점)
    };
  },

  /**
   * 현재가의 피보나치 위치 확인
   */
  FibonacciPosition(currentPrice, high, low) {
    const levels = this.FibonacciLevels(high, low);
    const position = (high - currentPrice) / (high - low);

    let zone = 'ABOVE';
    if (position >= 1) zone = 'BELOW';
    else if (position >= 0.618) zone = 'GOLDEN_ZONE';  // 0.5~0.618 (매수 적기)
    else if (position >= 0.5) zone = 'GOLDEN_ZONE';
    else if (position >= 0.382) zone = 'SHALLOW';
    else zone = 'TOP_ZONE';

    return {
      levels,
      position: Math.round(position * 1000) / 1000,
      zone,
      nearestLevel: this.findNearestFibLevel(currentPrice, levels),
    };
  },

  findNearestFibLevel(price, levels) {
    let nearest = null;
    let minDiff = Infinity;

    for (const [name, level] of Object.entries(levels)) {
      const diff = Math.abs(price - level);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = { name, level, diff };
      }
    }
    return nearest;
  },

  // ============================================
  // 종합 분석
  // ============================================

  /**
   * 모든 지표 한번에 계산
   * @param {Array} candles - [{open, high, low, close, volume}, ...] 배열
   */
  analyzeAll(candles) {
    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    // 최근 고점/저점 (20일)
    const recent20 = candles.slice(-20);
    const high20 = Math.max(...recent20.map(c => c.high));
    const low20 = Math.min(...recent20.map(c => c.low));

    return {
      price: currentPrice,
      rsi: this.RSI(closes),
      macd: this.MACD(closes),
      bollingerBands: this.BollingerBands(closes),
      atr: this.ATR(candles),
      volume: this.VolumeAnalysis(candles),
      fibonacci: this.FibonacciPosition(currentPrice, high20, low20),
      ma: {
        ma5: this.SMA(closes, 5),
        ma20: this.SMA(closes, 20),
        ma60: this.SMA(closes, 60),
        ema12: this.EMA(closes, 12),
        ema26: this.EMA(closes, 26),
      }
    };
  }
};

module.exports = indicators;
