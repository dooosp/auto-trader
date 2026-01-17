const config = require('./config');
const stockFetcher = require('./stock-fetcher');
const newsAnalyzer = require('./news-analyzer');

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
   * 종합 기술적 분석
   * @param {Object} stockData - { current, history }
   */
  analyze(stockData) {
    const prices = stockFetcher.extractClosePrices(stockData.history);
    const currentPrice = stockData.current.price;

    const mas = this.calculateAllMAs(prices);
    const rsi = this.calculateRSI(prices);
    const goldenCross = this.isGoldenCross(prices);
    const deadCross = this.isDeadCross(prices);

    return {
      code: stockData.code,
      currentPrice,
      ma5: mas.ma5,
      ma20: mas.ma20,
      ma60: mas.ma60,
      rsi,
      goldenCross,
      deadCross,
      aboveMA5: currentPrice > mas.ma5,
      ma5AboveMA20: mas.ma5 > mas.ma20,
    };
  },

  /**
   * 매매 신호 생성
   * @param {Object} stockData - { current, history }
   * @param {Object} holding - 보유 정보 (없으면 null)
   * @param {Object} newsSentiment - 뉴스 감정 분석 결과 (선택)
   */
  generateSignal(stockData, holding = null, newsSentiment = null) {
    const analysis = this.analyze(stockData);
    const { trading } = config;

    // 뉴스 감정 정보 추가
    analysis.newsSentiment = newsSentiment?.sentiment || 'NEUTRAL';
    analysis.newsScore = newsSentiment?.totalScore || 0;

    // 보유 중인 경우 - 매도 조건 체크
    if (holding) {
      const profitRate = (analysis.currentPrice - holding.avgPrice) / holding.avgPrice;

      // 손절 조건
      if (profitRate <= trading.sell.stopLoss) {
        return {
          action: 'SELL',
          reason: `손절 (${(profitRate * 100).toFixed(2)}%)`,
          analysis,
          priority: 1,
        };
      }

      // 뉴스가 매우 부정적이면 손절 기준 완화 (-1%에도 매도)
      if (analysis.newsSentiment === 'NEGATIVE' && profitRate <= -0.01) {
        return {
          action: 'SELL',
          reason: `악재 뉴스 + 손실 (${(profitRate * 100).toFixed(2)}%, 뉴스: ${analysis.newsScore})`,
          analysis,
          priority: 1,
        };
      }

      // 익절 조건
      if (profitRate >= trading.sell.takeProfit) {
        return {
          action: 'SELL',
          reason: `익절 (${(profitRate * 100).toFixed(2)}%)`,
          analysis,
          priority: 2,
        };
      }

      // RSI 과매수
      if (analysis.rsi && analysis.rsi >= trading.sell.rsiAbove) {
        return {
          action: 'SELL',
          reason: `RSI 과매수 (${analysis.rsi})`,
          analysis,
          priority: 3,
        };
      }

      // 이평선 이탈
      if (!analysis.aboveMA5) {
        return {
          action: 'SELL',
          reason: '5일 이평선 하향 이탈',
          analysis,
          priority: 4,
        };
      }

      return {
        action: 'HOLD',
        reason: '매도 조건 미충족',
        analysis,
      };
    }

    // 미보유 - 매수 조건 체크

    // 뉴스가 부정적이면 매수 보류
    if (analysis.newsSentiment === 'NEGATIVE') {
      return {
        action: 'HOLD',
        reason: `악재 뉴스로 매수 보류 (뉴스점수: ${analysis.newsScore})`,
        analysis,
      };
    }

    // 조건 1: RSI < 30 (과매도) - 뉴스 긍정적이면 RSI < 40으로 완화
    const rsiThreshold = analysis.newsSentiment === 'POSITIVE' ? 40 : trading.buy.rsiBelow;
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
   * watchList 전체 스캔하여 매수 후보 추출
   * @param {Array} stockDataList - fetchWatchList 결과
   * @param {Array} currentHoldings - 현재 보유 종목
   * @param {Array} newsDataList - 뉴스 감정 분석 결과 배열
   */
  scanForBuyCandidates(stockDataList, currentHoldings = [], newsDataList = []) {
    const holdingCodes = currentHoldings.map(h => h.code);
    const candidates = [];

    for (const stockData of stockDataList) {
      // 이미 보유 중인 종목은 제외
      if (holdingCodes.includes(stockData.code)) {
        continue;
      }

      // 해당 종목의 뉴스 감정 찾기
      const newsSentiment = newsDataList.find(n => n.code === stockData.code);
      const signal = this.generateSignal(stockData, null, newsSentiment);

      if (signal.action === 'BUY') {
        candidates.push({
          code: stockData.code,
          name: stockFetcher.getStockName(stockData.code),
          signal,
        });
      }
    }

    // 우선순위 순으로 정렬
    candidates.sort((a, b) => a.signal.priority - b.signal.priority);

    return candidates;
  },

  /**
   * 보유 종목 매도 신호 체크
   * @param {Array} holdings - 보유 종목 배열
   * @param {Array} stockDataList - 시세 데이터
   * @param {Array} newsDataList - 뉴스 감정 분석 결과 배열
   */
  checkSellSignals(holdings, stockDataList, newsDataList = []) {
    const sellSignals = [];

    for (const holding of holdings) {
      const stockData = stockDataList.find(s => s.code === holding.code);

      if (!stockData) {
        console.warn(`[Analyzer] 종목 데이터 없음: ${holding.code}`);
        continue;
      }

      // 해당 종목의 뉴스 감정 찾기
      const newsSentiment = newsDataList.find(n => n.code === holding.code);
      const signal = this.generateSignal(stockData, holding, newsSentiment);

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
