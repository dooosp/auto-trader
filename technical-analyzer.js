const config = require('./config');
const stockFetcher = require('./stock-fetcher');
const newsAnalyzer = require('./news-analyzer');
const indicators = require('./indicators');
const mtfAnalyzer = require('./mtf-analyzer');
const marketAnalyzer = require('./market-analyzer');
const srAnalyzer = require('./sr-analyzer');
const candlePatterns = require('./candle-patterns');
const supplyDemand = require('./supply-demand');

const technicalAnalyzer = {
  /**
   * 이동평균선 계산
   * @param {Array<number>} prices - 종가 배열
   * @param {number} period - 기간
   */
  calculateMA(prices, period) {
    if (prices.length < period) {
      return null;
    }

    const recentPrices = prices.slice(-period);
    const sum = recentPrices.reduce((acc, price) => acc + price, 0);
    return sum / period;
  },

  /**
   * 여러 기간의 이동평균선 계산
   * @param {Array<number>} prices - 종가 배열
   */
  calculateAllMAs(prices) {
    const ma5 = this.calculateMA(prices, 5);
    const ma20 = this.calculateMA(prices, 20);
    const ma60 = this.calculateMA(prices, 60);

    return { ma5, ma20, ma60 };
  },

  /**
   * RSI(Relative Strength Index) 계산
   * @param {Array<number>} prices - 종가 배열
   * @param {number} period - 기간 (기본 14일)
   */
  calculateRSI(prices, period = config.analysis.rsiPeriod) {
    if (prices.length < period + 1) {
      return null;
    }

    // 가격 변화 계산
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    // 최근 period+1 개의 데이터만 사용
    const recentChanges = changes.slice(-(period));

    // 상승/하락 분리
    let gains = 0;
    let losses = 0;

    for (const change of recentChanges) {
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) {
      return 100; // 모두 상승
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Math.round(rsi * 100) / 100;
  },

  /**
   * 골든크로스 확인 (5일선이 20일선 상향돌파)
   * @param {Array<number>} prices - 종가 배열
   */
  isGoldenCross(prices) {
    if (prices.length < 21) return false;

    // 현재 이평선
    const currentMA5 = this.calculateMA(prices, 5);
    const currentMA20 = this.calculateMA(prices, 20);

    // 전일 이평선 (마지막 가격 제외)
    const prevPrices = prices.slice(0, -1);
    const prevMA5 = this.calculateMA(prevPrices, 5);
    const prevMA20 = this.calculateMA(prevPrices, 20);

    // 골든크로스: 전일에는 5일선 < 20일선, 현재는 5일선 > 20일선
    return prevMA5 <= prevMA20 && currentMA5 > currentMA20;
  },

  /**
   * 데드크로스 확인 (5일선이 20일선 하향돌파)
   * @param {Array<number>} prices - 종가 배열
   */
  isDeadCross(prices) {
    if (prices.length < 21) return false;

    const currentMA5 = this.calculateMA(prices, 5);
    const currentMA20 = this.calculateMA(prices, 20);

    const prevPrices = prices.slice(0, -1);
    const prevMA5 = this.calculateMA(prevPrices, 5);
    const prevMA20 = this.calculateMA(prevPrices, 20);

    return prevMA5 >= prevMA20 && currentMA5 < currentMA20;
  },

  /**
   * 종합 기술적 분석 (Phase 1: 확장된 지표 포함, Phase 2: MTF 추가)
   * @param {Object} stockData - { current, history, weeklyHistory }
   */
  analyze(stockData) {
    const prices = stockFetcher.extractClosePrices(stockData.history);
    const currentPrice = stockData.current.price;
    const candles = stockData.history;  // [{open, high, low, close, volume}, ...]

    // 기본 이평선
    const mas = this.calculateAllMAs(prices);
    const rsi = this.calculateRSI(prices);
    const goldenCross = this.isGoldenCross(prices);
    const deadCross = this.isDeadCross(prices);

    // Phase 1: 새로운 지표들
    const macd = indicators.MACD(prices);
    const bollinger = indicators.BollingerBands(prices);
    const atr = indicators.ATR(candles);
    const volume = indicators.VolumeAnalysis(candles);

    // 피보나치 (최근 20일 고점/저점 기준)
    const recent20 = candles.slice(-20);
    const high20 = Math.max(...recent20.map(c => c.high));
    const low20 = Math.min(...recent20.map(c => c.low));
    const fibonacci = indicators.FibonacciPosition(currentPrice, high20, low20);

    // 다중 확인 (Confluence) 점수 계산
    const confluenceScore = this.calculateConfluence({
      rsi, macd, bollinger, volume, mas, currentPrice, goldenCross
    });

    // Phase 2: 다중 타임프레임 분석
    let mtf = null;
    if (config.mtf?.enabled && stockData.weeklyHistory && stockData.weeklyHistory.length >= 20) {
      mtf = mtfAnalyzer.analyze(candles, stockData.weeklyHistory);
    }

    // Phase 3: 지지/저항선 + 유동성 스윕 분석
    let sr = null;
    if (config.sr?.enabled) {
      sr = srAnalyzer.analyze(candles);
    }

    // ========================================
    // 수익률 개선: 신규 지표 추가
    // ========================================

    // Stochastic Oscillator
    const stochastic = indicators.Stochastic(candles);

    // Williams %R
    const williamsR = indicators.WilliamsR(candles);

    // VWAP
    const vwap = indicators.VWAP(candles);

    // ATR Squeeze (변동성 수축/확대)
    const atrSqueeze = indicators.ATRSqueeze(candles);

    // 캔들 패턴 인식
    const candlePattern = candlePatterns.analyze(candles);

    return {
      code: stockData.code,
      currentPrice,
      // 기본 이평선
      ma5: mas.ma5,
      ma20: mas.ma20,
      ma60: mas.ma60,
      aboveMA5: currentPrice > mas.ma5,
      aboveMA20: currentPrice > mas.ma20,
      aboveMA60: mas.ma60 ? currentPrice > mas.ma60 : null,
      ma5AboveMA20: mas.ma5 > mas.ma20,
      // RSI
      rsi,
      goldenCross,
      deadCross,
      // MACD
      macd: macd.macd,
      macdSignal: macd.signal,
      macdHistogram: macd.histogram,
      macdTrend: macd.trend,
      macdCrossover: macd.crossover,
      // 볼린저 밴드
      bbUpper: bollinger.upper,
      bbMiddle: bollinger.middle,
      bbLower: bollinger.lower,
      bbPercentB: bollinger.percentB,
      bbSignal: bollinger.signal,
      bbWidth: bollinger.width,
      // ATR (변동성)
      atr: atr.atr,
      atrPercent: atr.atrPercent,
      // 거래량
      volumeRatio: volume.volumeRatio,
      volumeSignal: volume.signal,
      vsaPattern: volume.vsaPattern,
      // 피보나치
      fibZone: fibonacci.zone,
      fibPosition: fibonacci.position,
      // 다중 확인 점수
      confluenceScore,
      // Phase 2: MTF 분석 결과
      mtf,
      // Phase 3: 지지/저항 분석 결과
      sr,
      // 수익률 개선: 신규 지표
      stochastic,
      williamsR,
      vwap,
      atrSqueeze,
      candlePattern,
      // 수급 분석은 비동기이므로 별도 처리 (analyzeWithSupply에서 추가)
      supplyDemand: null,
    };
  },

  /**
   * 다중 확인 (Confluence) 점수 계산
   * 여러 지표가 같은 방향을 가리킬 때 점수 부여
   */
  calculateConfluence({ rsi, macd, bollinger, volume, mas, currentPrice, goldenCross }) {
    let buyScore = 0;
    let sellScore = 0;

    // RSI 신호
    if (rsi < 30) buyScore += 2;
    else if (rsi < 40) buyScore += 1;
    else if (rsi > 70) sellScore += 2;
    else if (rsi > 60) sellScore += 1;

    // MACD 신호
    if (macd.crossover === 'GOLDEN_CROSS') buyScore += 2;
    else if (macd.trend === 'BULLISH') buyScore += 1;
    else if (macd.crossover === 'DEAD_CROSS') sellScore += 2;
    else if (macd.trend === 'BEARISH') sellScore += 1;

    // 볼린저 밴드 신호
    if (bollinger.signal === 'OVERSOLD') buyScore += 2;
    else if (bollinger.signal === 'LOWER_ZONE') buyScore += 1;
    else if (bollinger.signal === 'OVERBOUGHT') sellScore += 2;
    else if (bollinger.signal === 'UPPER_ZONE') sellScore += 1;

    // 거래량 신호
    if (volume.signal === 'STRONG_BUYING') buyScore += 2;
    else if (volume.signal === 'BUYING_PRESSURE') buyScore += 1;
    else if (volume.signal === 'STRONG_SELLING') sellScore += 2;
    else if (volume.signal === 'SELLING_PRESSURE') sellScore += 1;

    // 이평선 정배열
    if (mas.ma5 > mas.ma20 && mas.ma20 > (mas.ma60 || 0)) buyScore += 1;
    if (goldenCross) buyScore += 1;

    // 가격 위치
    if (currentPrice > mas.ma5 && currentPrice > mas.ma20) buyScore += 1;
    else if (currentPrice < mas.ma5 && currentPrice < mas.ma20) sellScore += 1;

    return {
      buy: buyScore,
      sell: sellScore,
      net: buyScore - sellScore,
      signal: buyScore >= 4 ? 'STRONG_BUY' :
              buyScore >= 2 ? 'BUY' :
              sellScore >= 4 ? 'STRONG_SELL' :
              sellScore >= 2 ? 'SELL' : 'NEUTRAL'
    };
  },

  /**
   * 매매 신호 생성 (Phase 1: 다중 지표 기반, Phase 2: MTF + 커플링)
   * 안전장치: 다중 확인 시스템 (여러 조건 동시 충족 필요)
   * @param {Object} stockData - { current, history, weeklyHistory }
   * @param {Object} holding - 보유 정보 (없으면 null)
   * @param {Object} newsSentiment - 뉴스 감정 분석 결과 (선택)
   * @param {Object} marketData - 시장 분석 결과 (Phase 2, 선택)
   * @param {Object} sectorData - 섹터 분석 결과 (Phase 2, 선택)
   */
  generateSignal(stockData, holding = null, newsSentiment = null, marketData = null, sectorData = null) {
    const analysis = this.analyze(stockData);
    const { trading } = config;
    const safety = trading.safety || {};
    const multiConfirm = safety.multiConfirm || {};

    // 뉴스 감정 정보 추가
    analysis.newsSentiment = newsSentiment?.sentiment || 'NEUTRAL';
    analysis.newsScore = newsSentiment?.totalScore || 0;

    // ATR 기반 동적 손절선 계산 (변동성의 2배)
    const atrStopLoss = analysis.atrPercent ? -(analysis.atrPercent * 2) / 100 : trading.sell.stopLoss;
    const dynamicStopLoss = Math.max(atrStopLoss, trading.sell.stopLoss);  // 최소 -2%

    // ========================================
    // 보유 중인 경우 - 매도 조건 체크 (다중 확인 적용)
    // ========================================
    if (holding) {
      const profitRate = (analysis.currentPrice - holding.avgPrice) / holding.avgPrice;

      // === 긴급 매도 조건 (단일 조건으로 즉시 실행) ===

      // 1. ATR 기반 동적 손절 (손실 방지 - 예외 허용)
      if (profitRate <= dynamicStopLoss) {
        return {
          action: 'SELL',
          reason: `[긴급] ATR 손절 (${(profitRate * 100).toFixed(2)}%, ATR: ${analysis.atrPercent}%)`,
          analysis,
          priority: 1,
        };
      }

      // 2. 악재 뉴스 + 손실 시 빠른 탈출 (긴급)
      if (analysis.newsSentiment === 'NEGATIVE' && profitRate <= -0.01) {
        return {
          action: 'SELL',
          reason: `[긴급] 악재 + 손실 (${(profitRate * 100).toFixed(2)}%)`,
          analysis,
          priority: 1,
        };
      }

      // === 다중 확인 매도 조건 (여러 조건 동시 충족 필요) ===
      const sellConditions = [];
      const requiredSellConditions = multiConfirm.enabled ? (multiConfirm.requiredSellConditions || 2) : 1;

      // 조건 1: RSI 과매수 (70 이상)
      if (analysis.rsi >= 70) {
        sellConditions.push(`RSI 과매수(${analysis.rsi})`);
      }

      // 조건 2: 볼린저 밴드 상단 돌파
      if (analysis.bbSignal === 'OVERBOUGHT') {
        sellConditions.push('BB 상단 돌파');
      }

      // 조건 3: MACD 데드크로스
      if (analysis.macdCrossover === 'DEAD_CROSS') {
        sellConditions.push('MACD 데드크로스');
      }

      // 조건 4: 5일선 이탈
      if (!analysis.aboveMA5) {
        sellConditions.push('5일선 이탈');
      }

      // 조건 5: 강한 매도세 (거래량)
      if (analysis.volumeSignal === 'STRONG_SELLING' || analysis.volumeSignal === 'SELLING_PRESSURE') {
        sellConditions.push('매도세 감지');
      }

      // 조건 6: MTF 매도 신호
      if (analysis.mtf?.mtfSignal === 'SELL' || analysis.mtf?.mtfSignal === 'STRONG_SELL') {
        sellConditions.push(`MTF ${analysis.mtf.mtfSignal}`);
      }

      // 조건 7: 유동성 스윕 매도 신호
      if (analysis.sr?.liquiditySweep?.detected && analysis.sr.liquiditySweep.type === 'BEARISH_SWEEP') {
        sellConditions.push('유동성 스윕 매도');
      }

      // 조건 8: 저항선 근처 + 수익
      if (analysis.sr?.proximity?.zone === 'RESISTANCE_ZONE' && profitRate > 0.03) {
        sellConditions.push('저항선 도달');
      }

      // 조건 9: 익절 목표 도달 (기본 10%)
      if (profitRate >= trading.sell.takeProfit) {
        sellConditions.push(`익절 목표(+${(profitRate * 100).toFixed(1)}%)`);
      }

      // 다중 확인: 설정된 개수 이상의 조건이 충족되어야 매도
      if (sellConditions.length >= requiredSellConditions) {
        return {
          action: 'SELL',
          reason: `다중 매도 (${sellConditions.length}/${requiredSellConditions}): ${sellConditions.join(', ')}`,
          analysis,
          priority: 2,
          conditions: sellConditions,
        };
      }

      // 매도 조건 미충족
      const unmetReason = sellConditions.length > 0
        ? `매도 조건 ${sellConditions.length}/${requiredSellConditions}: ${sellConditions.join(', ')}`
        : '매도 조건 미충족';

      return {
        action: 'HOLD',
        reason: unmetReason,
        analysis,
        conditionsMet: sellConditions.length,
        conditionsRequired: requiredSellConditions,
      };
    }

    // ========================================
    // 미보유 - 매수 조건 체크
    // ========================================

    // Phase 2: MTF 필터 (주봉 추세 확인)
    if (config.mtf?.enabled && config.mtf?.strictMode && analysis.mtf) {
      const mtfCheck = mtfAnalyzer.canBuy(analysis.mtf);
      if (!mtfCheck.allowed) {
        return {
          action: 'HOLD',
          reason: `MTF 필터: ${mtfCheck.reason} (${analysis.mtf.weekly.trend})`,
          analysis,
        };
      }
    }

    // Phase 2: 시장/섹터 커플링 필터
    if (config.coupling?.enabled && marketData) {
      const coupling = marketAnalyzer.analyzeCoupling(stockData, marketData, sectorData || {});
      analysis.coupling = coupling;

      const couplingCheck = marketAnalyzer.canBuyByCoupling(coupling);
      if (config.coupling?.strictMode && !couplingCheck.allowed) {
        return {
          action: 'HOLD',
          reason: `커플링 필터: ${couplingCheck.reason}`,
          analysis,
        };
      }
      // 경고만 (strictMode가 false일 때)
      if (couplingCheck.warning) {
        analysis.couplingWarning = couplingCheck.reason;
      }
    }

    // 악재 뉴스면 매수 보류
    if (analysis.newsSentiment === 'NEGATIVE') {
      return {
        action: 'HOLD',
        reason: `악재 뉴스 (점수: ${analysis.newsScore})`,
        analysis,
      };
    }

    // 다중 지표 강한 매도 신호면 매수 보류
    if (analysis.confluenceScore.signal === 'STRONG_SELL' || analysis.confluenceScore.signal === 'SELL') {
      return {
        action: 'HOLD',
        reason: `하락 신호 (매도점수: ${analysis.confluenceScore.sell})`,
        analysis,
      };
    }

    // Phase 3: 지지/저항 필터
    if (config.sr?.enabled && config.sr?.strictMode && analysis.sr) {
      const srCheck = srAnalyzer.canBuy(analysis.sr);
      if (!srCheck.allowed) {
        return {
          action: 'HOLD',
          reason: `S/R 필터: ${srCheck.reason}`,
          analysis,
        };
      }
    }

    // RR Ratio 체크 (손익비 2:1 이상)
    // 예상 수익: 익절선(10%), 예상 손실: ATR 기반 손절선
    const expectedProfit = trading.sell.takeProfit;
    const expectedLoss = Math.abs(dynamicStopLoss);
    const rrRatio = expectedProfit / expectedLoss;

    if (rrRatio < 2) {
      // 손익비가 2:1 미만이면 매수 보류 (변동성 큰 종목)
      // 단, 다중 확인 점수가 높으면 예외
      if (analysis.confluenceScore.buy < 4) {
        return {
          action: 'HOLD',
          reason: `손익비 부족 (RR: ${rrRatio.toFixed(1)}, ATR: ${analysis.atrPercent}%)`,
          analysis,
        };
      }
    }

    // ========================================
    // 매수 조건 체크 (다중 확인 시스템 적용)
    // ========================================
    const buyConditions = [];
    const requiredBuyConditions = multiConfirm.enabled ? (multiConfirm.requiredBuyConditions || 3) : 1;

    // 조건 1: RSI 과매도 (30 이하) 또는 낮은 RSI (40 이하)
    if (analysis.rsi <= 30) {
      buyConditions.push(`RSI 과매도(${analysis.rsi})`);
    } else if (analysis.rsi <= 40) {
      buyConditions.push(`RSI 낮음(${analysis.rsi})`);
    }

    // 조건 2: 볼린저 밴드 하단 (과매도)
    if (analysis.bbSignal === 'OVERSOLD' || analysis.bbSignal === 'LOWER_ZONE') {
      buyConditions.push(`BB 하단(${analysis.bbSignal})`);
    }

    // 조건 3: MACD 골든크로스 또는 상승 추세
    if (analysis.macdCrossover === 'GOLDEN_CROSS') {
      buyConditions.push('MACD 골든크로스');
    } else if (analysis.macdTrend === 'BULLISH') {
      buyConditions.push('MACD 상승추세');
    }

    // 조건 4: 5일선 위에 위치
    if (analysis.aboveMA5) {
      buyConditions.push('5일선 위');
    }

    // 조건 5: 이평선 완전 정배열 (5일 > 20일 > 60일)
    if (analysis.ma5AboveMA20 && analysis.ma20 > (analysis.ma60 || 0)) {
      buyConditions.push('이평선 완전정배열');
    }

    // 조건 6: 거래량 증가 (매수세)
    if (analysis.volumeSignal === 'STRONG_BUYING' || analysis.volumeSignal === 'BUYING_PRESSURE') {
      buyConditions.push(`매수세(${analysis.volumeSignal})`);
    }

    // 조건 7: MTF 매수 신호 (주봉+일봉 정렬)
    if (analysis.mtf?.mtfSignal === 'STRONG_BUY' || analysis.mtf?.mtfSignal === 'BUY') {
      buyConditions.push(`MTF ${analysis.mtf.mtfSignal}`);
    }

    // 조건 8: 유동성 스윕 매수 신호
    if (analysis.sr?.liquiditySweep?.detected && analysis.sr.liquiditySweep.type === 'BULLISH_SWEEP') {
      buyConditions.push('유동성 스윕 반등');
    }

    // 조건 9: 지지선 근처
    if (analysis.sr?.proximity?.zone === 'SUPPORT_ZONE') {
      buyConditions.push('지지선 근처');
    }

    // 조건 10: 피보나치 황금구간
    if (analysis.fibZone === 'GOLDEN_ZONE' || analysis.fibZone === 'BUY_ZONE') {
      buyConditions.push(`피보나치 ${analysis.fibZone}`);
    }

    // 조건 11: 호재 뉴스
    if (analysis.newsSentiment === 'POSITIVE' || analysis.newsScore >= 2) {
      buyConditions.push('호재 뉴스');
    }

    // ========================================
    // 신규 지표 조건 (수익률 개선)
    // ========================================

    // 조건 12: Stochastic 과매도 + 상향돌파
    if (analysis.stochastic) {
      if (analysis.stochastic.signal === 'OVERSOLD') {
        buyConditions.push(`Stoch 과매도(${analysis.stochastic.k})`);
      }
      if (analysis.stochastic.crossover === 'BULLISH_CROSS') {
        buyConditions.push('Stoch 골든크로스');
      }
    }

    // 조건 13: Williams %R 과매도
    if (analysis.williamsR && analysis.williamsR.signal === 'OVERSOLD') {
      buyConditions.push(`Williams %R 과매도(${analysis.williamsR.value})`);
    }

    // 조건 14: VWAP 하단 (저평가)
    if (analysis.vwap) {
      if (analysis.vwap.signal === 'UNDERVALUED') {
        buyConditions.push(`VWAP 저평가(${analysis.vwap.ratio}%)`);
      } else if (analysis.vwap.signal === 'BELOW_VWAP') {
        buyConditions.push('VWAP 하단');
      }
    }

    // 조건 15: ATR Squeeze 신호 (변동성 수축 후 확대)
    if (analysis.atrSqueeze) {
      if (analysis.atrSqueeze.signal === 'SQUEEZE_RELEASE' || analysis.atrSqueeze.signal === 'BREAKOUT') {
        buyConditions.push(`ATR ${analysis.atrSqueeze.signal}`);
      }
    }

    // 조건 16: 캔들 패턴 (상승 신호)
    if (analysis.candlePattern) {
      if (analysis.candlePattern.signal === 'STRONG_BULLISH' || analysis.candlePattern.signal === 'BULLISH') {
        const patternNames = analysis.candlePattern.patterns.map(p => p.name).join(',');
        buyConditions.push(`캔들패턴(${patternNames})`);
      }
    }

    // 조건 17: 수급 분석 (외국인/기관 순매수)
    if (analysis.supplyDemand) {
      if (analysis.supplyDemand.signal === 'STRONG_BUY' || analysis.supplyDemand.signal === 'BUY') {
        buyConditions.push(`수급(${analysis.supplyDemand.signals.join(',')})`);
      }
    }

    // 다중 확인: 설정된 개수 이상의 조건이 충족되어야 매수
    if (buyConditions.length >= requiredBuyConditions) {
      // 우선순위 결정
      let priority = 2;
      if (buyConditions.length >= 5) priority = 1;  // 5개 이상 조건 충족 시 최우선

      return {
        action: 'BUY',
        reason: `다중 매수 (${buyConditions.length}/${requiredBuyConditions}): ${buyConditions.join(', ')}`,
        analysis,
        priority,
        conditions: buyConditions,
      };
    }

    // 매수 조건 미충족
    const unmetReason = buyConditions.length > 0
      ? `매수 조건 ${buyConditions.length}/${requiredBuyConditions}: ${buyConditions.join(', ')}`
      : '매수 조건 미충족';

    return {
      action: 'HOLD',
      reason: unmetReason,
      analysis,
      conditionsMet: buyConditions.length,
      conditionsRequired: requiredBuyConditions,
    };
  },

  /**
   * 수급 분석 포함 종합 분석 (비동기)
   * @param {Object} stockData - 종목 데이터
   * @returns {Object} 수급 분석 포함된 분석 결과
   */
  async analyzeWithSupply(stockData) {
    const analysis = this.analyze(stockData);

    // 수급 분석 추가 (config에서 활성화된 경우)
    if (config.supplyDemand?.enabled !== false) {
      try {
        analysis.supplyDemand = await supplyDemand.analyze(stockData.code);
      } catch (error) {
        console.warn(`수급 분석 실패 [${stockData.code}]:`, error.message);
        analysis.supplyDemand = { score: 0, signal: 'ERROR' };
      }
    }

    return analysis;
  },

  /**
   * watchList 전체 스캔하여 매수 후보 추출 (Phase 2: MTF + 커플링)
   * @param {Array} stockDataList - fetchWatchList 결과
   * @param {Array} currentHoldings - 현재 보유 종목
   * @param {Array} newsDataList - 뉴스 감정 분석 결과 배열
   * @param {Object} marketData - 시장 분석 결과 (Phase 2)
   * @param {Object} sectorData - 섹터 분석 결과 (Phase 2)
   */
  scanForBuyCandidates(stockDataList, currentHoldings = [], newsDataList = [], marketData = null, sectorData = null) {
    const holdingCodes = currentHoldings.map(h => h.code);
    const candidates = [];

    for (const stockData of stockDataList) {
      // 이미 보유 중인 종목은 제외
      if (holdingCodes.includes(stockData.code)) {
        continue;
      }

      // 해당 종목의 뉴스 감정 찾기
      const newsSentiment = newsDataList.find(n => n.code === stockData.code);
      const signal = this.generateSignal(stockData, null, newsSentiment, marketData, sectorData);

      if (signal.action === 'BUY') {
        candidates.push({
          code: stockData.code,
          name: stockFetcher.getStockName(stockData.code),
          signal,
        });
      }
    }

    // 우선순위 순으로 정렬 (Phase 2: MTF 정렬된 종목 우선)
    candidates.sort((a, b) => {
      // MTF STRONG_BUY가 있으면 최우선
      const aMtfBonus = a.signal.analysis?.mtf?.mtfSignal === 'STRONG_BUY' ? -10 : 0;
      const bMtfBonus = b.signal.analysis?.mtf?.mtfSignal === 'STRONG_BUY' ? -10 : 0;

      return (a.signal.priority + aMtfBonus) - (b.signal.priority + bMtfBonus);
    });

    return candidates;
  },

  /**
   * 보유 종목 매도 신호 체크 (Phase 2: MTF + 커플링)
   * @param {Array} holdings - 보유 종목 배열
   * @param {Array} stockDataList - 시세 데이터
   * @param {Array} newsDataList - 뉴스 감정 분석 결과 배열
   * @param {Object} marketData - 시장 분석 결과 (Phase 2)
   * @param {Object} sectorData - 섹터 분석 결과 (Phase 2)
   */
  checkSellSignals(holdings, stockDataList, newsDataList = [], marketData = null, sectorData = null) {
    const sellSignals = [];

    for (const holding of holdings) {
      const stockData = stockDataList.find(s => s.code === holding.code);

      if (!stockData) {
        console.warn(`[Analyzer] 종목 데이터 없음: ${holding.code}`);
        continue;
      }

      // 해당 종목의 뉴스 감정 찾기
      const newsSentiment = newsDataList.find(n => n.code === holding.code);
      const signal = this.generateSignal(stockData, holding, newsSentiment, marketData, sectorData);

      if (signal.action === 'SELL') {
        sellSignals.push({
          code: holding.code,
          name: holding.name,
          quantity: holding.quantity,
          signal,
        });
      }
    }

    // 우선순위 순으로 정렬 (손절이 가장 먼저)
    sellSignals.sort((a, b) => a.signal.priority - b.signal.priority);

    return sellSignals;
  },

  /**
   * 뉴스 분석 수행
   * @param {Array} stockCodes - 종목코드 배열
   */
  async analyzeNews(stockCodes) {
    console.log(`[Analyzer] ${stockCodes.length}개 종목 뉴스 분석 중...`);
    const newsDataList = await newsAnalyzer.analyzeMultipleStocks(stockCodes);

    // 뉴스 요약 출력
    for (const news of newsDataList) {
      if (news.sentiment !== 'NEUTRAL') {
        const stockName = stockFetcher.getStockName(news.code);
        console.log(`  - ${stockName}: ${news.sentiment} (점수: ${news.totalScore})`);
      }
    }

    return newsDataList;
  }
};

module.exports = technicalAnalyzer;
