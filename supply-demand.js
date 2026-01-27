/**
 * 수급 분석 모듈
 * 외국인/기관 매매 동향 분석
 */

const kisApi = require('./kis-api');

const supplyDemand = {
  // 캐시 (API 호출 최소화)
  cache: new Map(),
  cacheTTL: 30 * 60 * 1000,  // 30분

  /**
   * 캐시 확인
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    return null;
  },

  /**
   * 캐시 저장
   */
  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  },

  /**
   * 종목 수급 분석
   * @param {string} stockCode - 종목코드
   * @param {number} days - 분석 기간 (기본 5일)
   * @returns {Object} 수급 분석 결과
   */
  async analyze(stockCode, days = 5) {
    // 캐시 확인
    const cacheKey = `supply_${stockCode}_${days}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const trend = await kisApi.getInvestorTrend(stockCode, days);

      if (!trend) {
        return { score: 0, signal: 'UNKNOWN', details: null };
      }

      let score = 0;
      const signals = [];

      // 외국인 분석 (+2 / -2)
      if (trend.foreign.trend === 'BUY') {
        score += 2;
        signals.push('FOREIGN_BUY');
      } else if (trend.foreign.trend === 'SELL') {
        score -= 2;
        signals.push('FOREIGN_SELL');
      }

      // 기관 분석 (+2 / -2)
      if (trend.institution.trend === 'BUY') {
        score += 2;
        signals.push('INSTITUTION_BUY');
      } else if (trend.institution.trend === 'SELL') {
        score -= 2;
        signals.push('INSTITUTION_SELL');
      }

      // 동시 순매수 보너스
      if (trend.foreign.trend === 'BUY' && trend.institution.trend === 'BUY') {
        score += 1;  // 쌍끌이 보너스
        signals.push('DOUBLE_BUY');
      }

      // 종합 신호 판단
      let signal = 'NEUTRAL';
      if (score >= 4) signal = 'STRONG_BUY';
      else if (score >= 2) signal = 'BUY';
      else if (score <= -4) signal = 'STRONG_SELL';
      else if (score <= -2) signal = 'SELL';

      const result = {
        score,
        signal,
        signals,
        details: {
          foreign: trend.foreign,
          institution: trend.institution,
          individual: trend.individual,
        },
        days,
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`수급 분석 오류 [${stockCode}]:`, error.message);
      return { score: 0, signal: 'ERROR', details: null };
    }
  },

  /**
   * 여러 종목 일괄 분석
   * @param {Array} stockCodes - 종목코드 배열
   * @param {number} days - 분석 기간
   * @returns {Object} 종목코드별 분석 결과
   */
  async analyzeMultiple(stockCodes, days = 5) {
    const results = {};

    for (const code of stockCodes) {
      results[code] = await this.analyze(code, days);
      // API 과부하 방지
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return results;
  },

  /**
   * 캐시 초기화
   */
  clearCache() {
    this.cache.clear();
  },
};

module.exports = supplyDemand;
