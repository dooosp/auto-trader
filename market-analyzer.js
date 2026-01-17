/**
 * 시장/지수/섹터 분석 모듈
 * Phase 2: 지수 및 섹터 커플링 분석
 *
 * 원칙:
 * - KOSPI/KOSDAQ 지수가 약세면 개별 종목 매수 주의
 * - 해당 섹터가 약세면 해당 섹터 종목 매수 회피
 * - 지수/섹터 상대강도 계산
 */

const kisApi = require('./kis-api');
const indicators = require('./indicators');

// 종목-섹터 매핑 (watchList 기준)
const STOCK_SECTOR_MAP = {
  '005930': { sector: 'TECH', name: '반도체/전자' },      // 삼성전자
  '035720': { sector: 'TECH', name: '인터넷/플랫폼' },    // 카카오
  '000270': { sector: 'AUTO', name: '자동차' },           // 기아
  '105560': { sector: 'FINANCE', name: '금융' },          // KB금융
  '055550': { sector: 'FINANCE', name: '금융' },          // 신한지주
  '066570': { sector: 'TECH', name: '가전/전자' },        // LG전자
  '086790': { sector: 'FINANCE', name: '금융' },          // 하나금융지주
  '032830': { sector: 'FINANCE', name: '금융' },          // 삼성생명
  '316140': { sector: 'FINANCE', name: '금융' },          // 우리금융지주
  '024110': { sector: 'FINANCE', name: '금융' },          // 기업은행
};

// 업종 코드 (KIS API 기준)
const SECTOR_CODES = {
  'KOSPI': '0001',
  'KOSDAQ': '1001',
  // KIS 업종 지수 코드들 (필요시 추가)
  'FINANCE': '0003',     // 금융업
  'TECH': '0024',        // 전기전자
  'AUTO': '0009',        // 운수장비
};

const marketAnalyzer = {
  // 캐시 (API 호출 최소화)
  _cache: {
    index: {},
    sector: {},
    lastUpdate: null,
  },

  /**
   * 캐시 유효성 확인 (5분)
   */
  isCacheValid() {
    if (!this._cache.lastUpdate) return false;
    const elapsed = Date.now() - this._cache.lastUpdate;
    return elapsed < 5 * 60 * 1000; // 5분
  },

  /**
   * 지수 분석 (KOSPI, KOSDAQ)
   */
  async analyzeIndex(indexCode = '0001') {
    try {
      // 현재가
      const current = await kisApi.getIndexPrice(indexCode);

      // 일봉 데이터
      const history = await kisApi.getIndexHistory(indexCode, 60);

      if (!history || history.length < 20) {
        return {
          code: indexCode,
          name: current?.name || 'UNKNOWN',
          trend: 'UNKNOWN',
          strength: 0,
          current: current?.price || 0,
          changeRate: current?.changeRate || 0,
        };
      }

      const closes = history.map(c => c.close);
      const currentPrice = closes[closes.length - 1];

      // 이평선
      const ma5 = indicators.SMA(closes, 5);
      const ma20 = indicators.SMA(closes, 20);
      const ma60 = indicators.SMA(closes, 60);

      // MACD
      const macd = indicators.MACD(closes);

      // RSI
      const rsi = indicators.RSI(closes);

      // 추세 판단
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
      if (macd.trend === 'BULLISH') bullishPoints += 1;
      else if (macd.trend === 'BEARISH') bearishPoints += 1;

      // 당일 등락
      if (current?.changeRate > 0.5) bullishPoints += 1;
      else if (current?.changeRate < -0.5) bearishPoints += 1;

      const netScore = bullishPoints - bearishPoints;
      let trend = 'SIDEWAYS';
      if (netScore >= 3) trend = 'BULLISH';
      else if (netScore >= 1) trend = 'MILD_BULLISH';
      else if (netScore <= -3) trend = 'BEARISH';
      else if (netScore <= -1) trend = 'MILD_BEARISH';

      return {
        code: indexCode,
        name: current?.name || (indexCode === '0001' ? 'KOSPI' : 'KOSDAQ'),
        trend,
        strength: Math.abs(netScore) / 6,
        current: current?.price || currentPrice,
        changeRate: current?.changeRate || 0,
        bullishPoints,
        bearishPoints,
        netScore,
        details: {
          ma5: Math.round(ma5 * 100) / 100,
          ma20: Math.round(ma20 * 100) / 100,
          ma60: ma60 ? Math.round(ma60 * 100) / 100 : null,
          macd: macd.macd,
          macdTrend: macd.trend,
          rsi,
        }
      };
    } catch (error) {
      console.error(`[MarketAnalyzer] 지수 분석 실패 (${indexCode}):`, error.message);
      return {
        code: indexCode,
        trend: 'UNKNOWN',
        strength: 0,
        error: error.message,
      };
    }
  },

  /**
   * 시장 전체 분석 (KOSPI + KOSDAQ)
   */
  async analyzeMarket() {
    console.log('[MarketAnalyzer] 시장 지수 분석 중...');

    const [kospi, kosdaq] = await Promise.all([
      this.analyzeIndex('0001'),  // KOSPI
      this.analyzeIndex('1001'),  // KOSDAQ
    ]);

    // 시장 종합 판단
    let marketCondition = 'NEUTRAL';
    let marketScore = 0;

    const kospiBullish = kospi.trend.includes('BULLISH');
    const kospiBearish = kospi.trend.includes('BEARISH');
    const kosdaqBullish = kosdaq.trend.includes('BULLISH');
    const kosdaqBearish = kosdaq.trend.includes('BEARISH');

    if (kospiBullish && kosdaqBullish) {
      marketCondition = 'STRONG_BULLISH';
      marketScore = 3;
    } else if (kospiBullish || kosdaqBullish) {
      marketCondition = 'BULLISH';
      marketScore = 2;
    } else if (kospiBearish && kosdaqBearish) {
      marketCondition = 'STRONG_BEARISH';
      marketScore = -3;
    } else if (kospiBearish || kosdaqBearish) {
      marketCondition = 'BEARISH';
      marketScore = -2;
    }

    // 캐시 업데이트
    this._cache.index = { kospi, kosdaq };
    this._cache.lastUpdate = Date.now();

    console.log(`  - KOSPI: ${kospi.trend} (${kospi.changeRate > 0 ? '+' : ''}${kospi.changeRate}%)`);
    console.log(`  - KOSDAQ: ${kosdaq.trend} (${kosdaq.changeRate > 0 ? '+' : ''}${kosdaq.changeRate}%)`);
    console.log(`  - 시장 상태: ${marketCondition}`);

    return {
      marketCondition,
      marketScore,
      kospi,
      kosdaq,
      recommendation: this.getMarketRecommendation(marketCondition),
    };
  },

  /**
   * 시장 상태에 따른 추천
   */
  getMarketRecommendation(condition) {
    const recommendations = {
      'STRONG_BULLISH': {
        action: 'AGGRESSIVE_BUY',
        message: 'KOSPI/KOSDAQ 모두 강세 - 적극 매수 가능',
        riskLevel: 'LOW',
        positionSize: 1.0,  // 정상 포지션
      },
      'BULLISH': {
        action: 'BUY',
        message: '시장 상승 추세 - 매수 가능',
        riskLevel: 'MEDIUM_LOW',
        positionSize: 0.8,
      },
      'NEUTRAL': {
        action: 'SELECTIVE_BUY',
        message: '시장 중립 - 선별적 매수',
        riskLevel: 'MEDIUM',
        positionSize: 0.6,
      },
      'BEARISH': {
        action: 'CAUTION',
        message: '시장 약세 - 매수 주의',
        riskLevel: 'MEDIUM_HIGH',
        positionSize: 0.3,
      },
      'STRONG_BEARISH': {
        action: 'AVOID',
        message: 'KOSPI/KOSDAQ 모두 약세 - 매수 회피',
        riskLevel: 'HIGH',
        positionSize: 0,
      },
    };

    return recommendations[condition] || recommendations['NEUTRAL'];
  },

  /**
   * 종목의 섹터 정보 가져오기
   */
  getStockSector(stockCode) {
    return STOCK_SECTOR_MAP[stockCode] || { sector: 'UNKNOWN', name: '기타' };
  },

  /**
   * 섹터 강도 분석 (간단 버전 - 같은 섹터 종목들의 평균 수익률)
   * @param {Array} stockDataList - 종목 시세 데이터 배열
   */
  analyzeSectorStrength(stockDataList) {
    const sectorPerformance = {};

    for (const stock of stockDataList) {
      const sectorInfo = this.getStockSector(stock.code);
      const sector = sectorInfo.sector;

      if (!sectorPerformance[sector]) {
        sectorPerformance[sector] = {
          name: sectorInfo.name,
          stocks: [],
          totalChangeRate: 0,
          count: 0,
        };
      }

      sectorPerformance[sector].stocks.push({
        code: stock.code,
        changeRate: stock.current?.changeRate || 0,
      });
      sectorPerformance[sector].totalChangeRate += (stock.current?.changeRate || 0);
      sectorPerformance[sector].count++;
    }

    // 평균 계산 및 강도 판단
    const sectorAnalysis = {};
    for (const [sector, data] of Object.entries(sectorPerformance)) {
      const avgChangeRate = data.totalChangeRate / data.count;
      let strength = 'NEUTRAL';

      if (avgChangeRate > 1) strength = 'STRONG';
      else if (avgChangeRate > 0) strength = 'MILD_STRONG';
      else if (avgChangeRate < -1) strength = 'WEAK';
      else if (avgChangeRate < 0) strength = 'MILD_WEAK';

      sectorAnalysis[sector] = {
        name: data.name,
        avgChangeRate: Math.round(avgChangeRate * 100) / 100,
        strength,
        stockCount: data.count,
        stocks: data.stocks,
      };
    }

    return sectorAnalysis;
  },

  /**
   * 종목별 상대강도 계산 (RS - Relative Strength)
   * @param {Object} stock - 종목 데이터
   * @param {Object} marketData - 시장 분석 결과
   */
  calculateRelativeStrength(stock, marketData) {
    const stockChange = stock.current?.changeRate || 0;
    const kospiChange = marketData.kospi?.changeRate || 0;

    // 상대강도 = 종목 수익률 - 지수 수익률
    const rs = stockChange - kospiChange;

    let rsRating = 'NEUTRAL';
    if (rs > 1) rsRating = 'OUTPERFORM';      // 시장 대비 1% 이상 강세
    else if (rs > 0) rsRating = 'MILD_OUTPERFORM';
    else if (rs < -1) rsRating = 'UNDERPERFORM';  // 시장 대비 1% 이상 약세
    else if (rs < 0) rsRating = 'MILD_UNDERPERFORM';

    return {
      value: Math.round(rs * 100) / 100,
      rating: rsRating,
      stockChange,
      indexChange: kospiChange,
    };
  },

  /**
   * 종합 커플링 분석 (종목 + 시장 + 섹터)
   * @param {Object} stockData - 개별 종목 데이터
   * @param {Object} marketData - 시장 분석 결과 (analyzeMarket 결과)
   * @param {Object} sectorData - 섹터 분석 결과 (analyzeSectorStrength 결과)
   */
  analyzeCoupling(stockData, marketData, sectorData) {
    const stockCode = stockData.code;
    const sectorInfo = this.getStockSector(stockCode);
    const sector = sectorInfo.sector;

    // 상대강도
    const rs = this.calculateRelativeStrength(stockData, marketData);

    // 섹터 강도
    const sectorStrength = sectorData[sector] || { strength: 'UNKNOWN', avgChangeRate: 0 };

    // 커플링 점수 계산
    let couplingScore = 0;
    let couplingSignal = 'NEUTRAL';

    // 1. 시장 상태 (가중치 40%)
    if (marketData.marketScore >= 2) couplingScore += 2;
    else if (marketData.marketScore >= 0) couplingScore += 1;
    else if (marketData.marketScore <= -2) couplingScore -= 2;
    else if (marketData.marketScore < 0) couplingScore -= 1;

    // 2. 섹터 강도 (가중치 30%)
    if (sectorStrength.strength === 'STRONG') couplingScore += 1.5;
    else if (sectorStrength.strength === 'MILD_STRONG') couplingScore += 0.5;
    else if (sectorStrength.strength === 'WEAK') couplingScore -= 1.5;
    else if (sectorStrength.strength === 'MILD_WEAK') couplingScore -= 0.5;

    // 3. 상대강도 (가중치 30%)
    if (rs.rating === 'OUTPERFORM') couplingScore += 1.5;
    else if (rs.rating === 'MILD_OUTPERFORM') couplingScore += 0.5;
    else if (rs.rating === 'UNDERPERFORM') couplingScore -= 1.5;
    else if (rs.rating === 'MILD_UNDERPERFORM') couplingScore -= 0.5;

    // 커플링 신호 결정
    if (couplingScore >= 3) couplingSignal = 'STRONG_FAVORABLE';
    else if (couplingScore >= 1) couplingSignal = 'FAVORABLE';
    else if (couplingScore <= -3) couplingSignal = 'STRONG_UNFAVORABLE';
    else if (couplingScore <= -1) couplingSignal = 'UNFAVORABLE';

    return {
      stockCode,
      couplingSignal,
      couplingScore: Math.round(couplingScore * 100) / 100,
      market: {
        condition: marketData.marketCondition,
        score: marketData.marketScore,
      },
      sector: {
        name: sectorInfo.name,
        code: sector,
        strength: sectorStrength.strength,
        avgChangeRate: sectorStrength.avgChangeRate,
      },
      relativeStrength: rs,
      recommendation: this.getCouplingRecommendation(couplingSignal),
    };
  },

  /**
   * 커플링 기반 매매 추천
   */
  getCouplingRecommendation(signal) {
    const recommendations = {
      'STRONG_FAVORABLE': {
        action: 'BUY',
        message: '시장/섹터/상대강도 모두 유리 - 매수 적극 권장',
        confidence: 'HIGH',
        filter: 'PASS',
      },
      'FAVORABLE': {
        action: 'BUY',
        message: '시장 환경 양호 - 매수 가능',
        confidence: 'MEDIUM',
        filter: 'PASS',
      },
      'NEUTRAL': {
        action: 'HOLD',
        message: '시장 중립 - 기술적 분석에 따라 결정',
        confidence: 'LOW',
        filter: 'PASS',
      },
      'UNFAVORABLE': {
        action: 'CAUTION',
        message: '시장 환경 불리 - 매수 주의',
        confidence: 'MEDIUM',
        filter: 'WARN',
      },
      'STRONG_UNFAVORABLE': {
        action: 'AVOID',
        message: '시장/섹터/상대강도 모두 불리 - 매수 회피',
        confidence: 'HIGH',
        filter: 'BLOCK',
      },
    };

    return recommendations[signal] || recommendations['NEUTRAL'];
  },

  /**
   * 매수 가능 여부 판단 (커플링 기준)
   * @param {Object} couplingAnalysis - analyzeCoupling() 결과
   */
  canBuyByCoupling(couplingAnalysis) {
    const blockedSignals = ['STRONG_UNFAVORABLE'];
    const warnedSignals = ['UNFAVORABLE'];

    return {
      allowed: !blockedSignals.includes(couplingAnalysis.couplingSignal),
      warning: warnedSignals.includes(couplingAnalysis.couplingSignal),
      reason: couplingAnalysis.recommendation.message,
      signal: couplingAnalysis.couplingSignal,
    };
  },
};

module.exports = marketAnalyzer;
