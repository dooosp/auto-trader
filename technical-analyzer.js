const config = require('./config');
const stockFetcher = require('./stock-fetcher');
const newsAnalyzer = require('./news-analyzer');
const indicators = require('./indicators');
const mtfAnalyzer = require('./mtf-analyzer');
const marketAnalyzer = require('./market-analyzer');

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
   * @param {Object} stockData - { current, history, weeklyHistory }
   * @param {Object} holding - 보유 정보 (없으면 null)
   * @param {Object} newsSentiment - 뉴스 감정 분석 결과 (선택)
   * @param {Object} marketData - 시장 분석 결과 (Phase 2, 선택)
   * @param {Object} sectorData - 섹터 분석 결과 (Phase 2, 선택)
   */
  generateSignal(stockData, holding = null, newsSentiment = null, marketData = null, sectorData = null) {
    const analysis = this.analyze(stockData);
    const { trading } = config;

    // 뉴스 감정 정보 추가
    analysis.newsSentiment = newsSentiment?.sentiment || 'NEUTRAL';
    analysis.newsScore = newsSentiment?.totalScore || 0;

    // ATR 기반 동적 손절선 계산 (변동성의 2배)
    const atrStopLoss = analysis.atrPercent ? -(analysis.atrPercent * 2) / 100 : trading.sell.stopLoss;
    const dynamicStopLoss = Math.max(atrStopLoss, trading.sell.stopLoss);  // 최소 -2%

    // ========================================
    // 보유 중인 경우 - 매도 조건 체크
    // ========================================
    if (holding) {
      const profitRate = (analysis.currentPrice - holding.avgPrice) / holding.avgPrice;

      // 1. ATR 기반 동적 손절
      if (profitRate <= dynamicStopLoss) {
        return {
          action: 'SELL',
          reason: `ATR 손절 (${(profitRate * 100).toFixed(2)}%, ATR: ${analysis.atrPercent}%)`,
          analysis,
          priority: 1,
        };
      }

      // 2. 악재 뉴스 + 손실 시 빠른 탈출
      if (analysis.newsSentiment === 'NEGATIVE' && profitRate <= -0.01) {
        return {
          action: 'SELL',
          reason: `악재 + 손실 (${(profitRate * 100).toFixed(2)}%)`,
          analysis,
          priority: 1,
        };
      }

      // 3. 다중 지표 강한 매도 신호
      if (analysis.confluenceScore.signal === 'STRONG_SELL') {
        return {
          action: 'SELL',
          reason: `다중 매도 신호 (점수: ${analysis.confluenceScore.sell})`,
          analysis,
          priority: 2,
        };
      }

      // 4. 익절 (1차 목표)
      if (profitRate >= trading.sell.takeProfit) {
        return {
          action: 'SELL',
          reason: `익절 (${(profitRate * 100).toFixed(2)}%)`,
          analysis,
          priority: 2,
        };
      }

      // 5. MACD 데드크로스
      if (analysis.macdCrossover === 'DEAD_CROSS' && profitRate > 0) {
        return {
          action: 'SELL',
          reason: `MACD 데드크로스 + 이익 (${(profitRate * 100).toFixed(2)}%)`,
          analysis,
          priority: 3,
        };
      }

      // 6. RSI 과매수 + 볼린저 상단
      if (analysis.rsi >= 70 && analysis.bbSignal === 'OVERBOUGHT') {
        return {
          action: 'SELL',
          reason: `RSI 과매수 + BB 상단 (RSI: ${analysis.rsi})`,
          analysis,
          priority: 3,
        };
      }

      // 7. 5일선 이탈 + 거래량 급증 (매도세)
      if (!analysis.aboveMA5 && analysis.volumeSignal === 'STRONG_SELLING') {
        return {
          action: 'SELL',
          reason: '5일선 이탈 + 강한 매도세',
          analysis,
          priority: 4,
        };
      }

      // Phase 2: MTF 강한 매도 신호
      if (analysis.mtf?.mtfSignal === 'STRONG_SELL') {
        return {
          action: 'SELL',
          reason: `MTF 강한 매도 (주봉+일봉 하락 정렬)`,
          analysis,
          priority: 2,
        };
      }

      // Phase 2: MTF 매도 + 손실
      if (analysis.mtf?.mtfSignal === 'SELL' && profitRate < 0) {
        return {
          action: 'SELL',
          reason: `MTF 매도 + 손실 (${(profitRate * 100).toFixed(2)}%)`,
          analysis,
          priority: 3,
        };
      }

      return {
        action: 'HOLD',
        reason: '매도 조건 미충족',
        analysis,
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
    // 매수 조건 체크 (다중 확인 기반)
    // ========================================

    // 1. 강한 매수 신호 (다중 확인 점수 4점 이상)
    if (analysis.confluenceScore.signal === 'STRONG_BUY') {
      // Phase 2: MTF 보너스
      let mtfBonus = '';
      if (analysis.mtf?.mtfSignal === 'STRONG_BUY') {
        mtfBonus = ', MTF 정렬';
      }
      return {
        action: 'BUY',
        reason: `강한 매수 신호 (점수: ${analysis.confluenceScore.buy}, RR: ${rrRatio.toFixed(1)}${mtfBonus})`,
        analysis,
        priority: 1,
      };
    }

    // Phase 2: MTF 강한 매수 + 일봉 조건 충족
    if (analysis.mtf?.mtfSignal === 'STRONG_BUY' && analysis.confluenceScore.buy >= 2) {
      return {
        action: 'BUY',
        reason: `MTF 강한 매수 (주봉+일봉 상승 정렬, 점수: ${analysis.confluenceScore.buy})`,
        analysis,
        priority: 1,
      };
    }

    // 2. 피보나치 황금구간 + MACD 골든크로스
    if (analysis.fibZone === 'GOLDEN_ZONE' && analysis.macdCrossover === 'GOLDEN_CROSS') {
      return {
        action: 'BUY',
        reason: `피보나치 황금구간 + MACD 골든크로스`,
        analysis,
        priority: 1,
      };
    }

    // 3. 볼린저 하단 + RSI 과매도 + 거래량 급증 (반등 신호)
    if (analysis.bbSignal === 'OVERSOLD' && analysis.rsi < 30 && analysis.volumeRatio >= 1.5) {
      return {
        action: 'BUY',
        reason: `BB 하단 + RSI 과매도 + 거래량 (RSI: ${analysis.rsi})`,
        analysis,
        priority: 1,
      };
    }

    // 4. 일반 매수 신호 (다중 확인 점수 2점 이상 + 추가 조건)
    if (analysis.confluenceScore.signal === 'BUY') {
      // 추가 필터: 상승 추세 + 뉴스 긍정적
      if (analysis.ma5AboveMA20 && analysis.newsSentiment !== 'NEGATIVE') {
        return {
          action: 'BUY',
          reason: `매수 신호 (점수: ${analysis.confluenceScore.buy})`,
          analysis,
          priority: 2,
        };
      }
    }

    // 5. MACD 골든크로스 + RSI 적정 (기존 로직 유지)
    if (analysis.macdCrossover === 'GOLDEN_CROSS' && analysis.rsi < 50 && analysis.aboveMA5) {
      return {
        action: 'BUY',
        reason: `MACD 골든크로스 (RSI: ${analysis.rsi})`,
        analysis,
        priority: 2,
      };
    }

    // 6. 강한 호재 뉴스 + 기본 조건 충족
    if (analysis.newsScore >= 3 && analysis.aboveMA5 && analysis.rsi < 60) {
      return {
        action: 'BUY',
        reason: `강한 호재 뉴스 (점수: ${analysis.newsScore})`,
        analysis,
        priority: 3,
      };
    }

    // 조건 미충족
    const reasons = [];
    if (analysis.confluenceScore.buy < 2) reasons.push(`매수점수 ${analysis.confluenceScore.buy}`);
    if (analysis.rsi >= 50) reasons.push(`RSI ${analysis.rsi}`);
    if (!analysis.aboveMA5) reasons.push('5일선 하회');

    return {
      action: 'HOLD',
      reason: reasons.join(', ') || '매수 조건 미충족',
      analysis,
    };
  },

  // 기존 호환성 유지 (사용 안함)
  _legacyBuyCondition(analysis, trading, newsSentiment) {
    const rsiThreshold = newsSentiment === 'POSITIVE' ? 40 : trading.buy.rsiBelow;
    const rsiCondition = analysis.rsi && analysis.rsi < rsiThreshold;

    // 조건 2: 현재가 > 5일 이평선
    const aboveMA5 = analysis.aboveMA5;

    // 조건 3: 5일 이평선 > 20일 이평선 (상승 추세)
    const maCondition = analysis.ma5AboveMA20;

    // 모든 조건 충족 시 매수
    if (rsiCondition && aboveMA5 && maCondition) {
      const newsInfo = analysis.newsSentiment === 'POSITIVE' ? ', 호재 뉴스' : '';
      return {
        action: 'BUY',
        reason: `매수 조건 충족 (RSI: ${analysis.rsi}${newsInfo})`,
        analysis,
        priority: 1,
      };
    }

    // 골든크로스 직후 + RSI 적정 범위
    if (analysis.goldenCross && analysis.rsi < 50) {
      return {
        action: 'BUY',
        reason: `골든크로스 발생 (RSI: ${analysis.rsi})`,
        analysis,
        priority: 2,
      };
    }

    // 뉴스가 매우 긍정적이면 (점수 3 이상) 기술적 조건 일부 완화
    if (analysis.newsScore >= 3 && aboveMA5 && analysis.rsi < 50) {
      return {
        action: 'BUY',
        reason: `강한 호재 뉴스 (뉴스점수: ${analysis.newsScore}, RSI: ${analysis.rsi})`,
        analysis,
        priority: 3,
      };
    }

    // 조건 미충족
    const reasons = [];
    if (!rsiCondition) reasons.push(`RSI ${analysis.rsi || 'N/A'}`);
    if (!aboveMA5) reasons.push('5일선 하회');
    if (!maCondition) reasons.push('5일선 < 20일선');

    return {
      action: 'HOLD',
      reason: reasons.join(', '),
      analysis,
    };
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
