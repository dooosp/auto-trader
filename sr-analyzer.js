/**
 * 지지/저항선 + 유동성 스윕 분석 모듈
 * Phase 3: Support/Resistance & Liquidity Sweep
 *
 * 원칙:
 * - 지지선: 여러 번 가격이 하락 후 반등한 가격대
 * - 저항선: 여러 번 가격이 상승 후 하락한 가격대
 * - 유동성 스윕: 이전 고점/저점을 살짝 돌파 후 반전 (스톱헌팅)
 */

const srAnalyzer = {
  /**
   * 지지/저항 레벨 찾기 (피벗 포인트 기반)
   * @param {Array} candles - 캔들 데이터 [{open, high, low, close}, ...]
   * @param {number} lookback - 피벗 판단 기간 (좌우 캔들 수)
   */
  findSRLevels(candles, lookback = 3) {
    if (!candles || candles.length < lookback * 2 + 1) {
      return { supports: [], resistances: [] };
    }

    const supports = [];
    const resistances = [];

    // 피벗 하이/로우 찾기
    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];

      // 피벗 하이 (저항선 후보)
      let isPivotHigh = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i && candles[j].high >= current.high) {
          isPivotHigh = false;
          break;
        }
      }
      if (isPivotHigh) {
        resistances.push({
          price: current.high,
          date: current.date,
          index: i,
          touches: 1,
        });
      }

      // 피벗 로우 (지지선 후보)
      let isPivotLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i && candles[j].low <= current.low) {
          isPivotLow = false;
          break;
        }
      }
      if (isPivotLow) {
        supports.push({
          price: current.low,
          date: current.date,
          index: i,
          touches: 1,
        });
      }
    }

    // 클러스터링 (비슷한 가격대 병합)
    const clusteredSupports = this.clusterLevels(supports);
    const clusteredResistances = this.clusterLevels(resistances);

    return {
      supports: clusteredSupports.slice(0, 5),      // 상위 5개
      resistances: clusteredResistances.slice(0, 5),
    };
  },

  /**
   * 비슷한 가격대 클러스터링
   * @param {Array} levels - 레벨 배열
   * @param {number} tolerance - 허용 오차 (%)
   */
  clusterLevels(levels, tolerance = 0.01) {
    if (levels.length === 0) return [];

    // 가격 순 정렬
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const clusters = [];
    let currentCluster = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prevPrice = currentCluster[0].price;
      const currPrice = sorted[i].price;

      if ((currPrice - prevPrice) / prevPrice <= tolerance) {
        // 같은 클러스터
        currentCluster.push(sorted[i]);
      } else {
        // 새 클러스터
        clusters.push(currentCluster);
        currentCluster = [sorted[i]];
      }
    }
    clusters.push(currentCluster);

    // 클러스터 평균가격 및 터치 횟수
    return clusters
      .map(cluster => ({
        price: Math.round(cluster.reduce((sum, l) => sum + l.price, 0) / cluster.length),
        touches: cluster.length,
        strength: cluster.length >= 3 ? 'STRONG' : cluster.length >= 2 ? 'MODERATE' : 'WEAK',
      }))
      .sort((a, b) => b.touches - a.touches);
  },

  /**
   * 현재 가격이 지지/저항 근처인지 확인
   * @param {number} currentPrice - 현재가
   * @param {Object} srLevels - findSRLevels 결과
   * @param {number} proximityPercent - 근접 판단 % (기본 1%)
   */
  checkProximity(currentPrice, srLevels, proximityPercent = 0.01) {
    const result = {
      nearSupport: null,
      nearResistance: null,
      zone: 'NEUTRAL',  // SUPPORT_ZONE, RESISTANCE_ZONE, NEUTRAL
    };

    // 지지선 근처 확인
    for (const support of srLevels.supports) {
      const distance = (currentPrice - support.price) / support.price;
      if (distance >= -proximityPercent && distance <= proximityPercent * 2) {
        result.nearSupport = {
          ...support,
          distance: Math.round(distance * 10000) / 100, // %
        };
        break;
      }
    }

    // 저항선 근처 확인
    for (const resistance of srLevels.resistances) {
      const distance = (resistance.price - currentPrice) / resistance.price;
      if (distance >= -proximityPercent && distance <= proximityPercent * 2) {
        result.nearResistance = {
          ...resistance,
          distance: Math.round(distance * 10000) / 100, // %
        };
        break;
      }
    }

    // 존 판단
    if (result.nearSupport && !result.nearResistance) {
      result.zone = 'SUPPORT_ZONE';
    } else if (result.nearResistance && !result.nearSupport) {
      result.zone = 'RESISTANCE_ZONE';
    } else if (result.nearSupport && result.nearResistance) {
      result.zone = 'SQUEEZE';  // 지지/저항 사이 좁은 구간
    }

    return result;
  },

  /**
   * 유동성 스윕 감지 (Liquidity Sweep / Stop Hunt)
   * - 이전 고점/저점을 살짝 돌파 후 반전
   * - 스마트 머니가 스톱로스를 털고 반대로 가는 패턴
   *
   * @param {Array} candles - 캔들 데이터
   * @param {number} lookback - 이전 고점/저점 탐색 기간
   */
  detectLiquiditySweep(candles, lookback = 10) {
    if (!candles || candles.length < lookback + 3) {
      return { detected: false, type: null };
    }

    const recent = candles.slice(-3);  // 최근 3개 캔들
    const previous = candles.slice(-(lookback + 3), -3);  // 이전 기간

    // 이전 기간의 고점/저점
    const prevHigh = Math.max(...previous.map(c => c.high));
    const prevLow = Math.min(...previous.map(c => c.low));

    const lastCandle = recent[recent.length - 1];
    const prevCandle = recent[recent.length - 2];

    // 불리시 스윕 (저점 스윕 후 반등)
    // 조건: 이전 저점 아래로 내려갔다가 (스윕) 다시 위로 마감
    const bullishSweep =
      prevCandle.low < prevLow &&                    // 이전 저점 하향 돌파
      lastCandle.close > prevLow &&                   // 다시 위로 마감
      lastCandle.close > lastCandle.open;             // 양봉 마감

    // 베어리시 스윕 (고점 스윕 후 하락)
    // 조건: 이전 고점 위로 올라갔다가 (스윕) 다시 아래로 마감
    const bearishSweep =
      prevCandle.high > prevHigh &&                   // 이전 고점 상향 돌파
      lastCandle.close < prevHigh &&                  // 다시 아래로 마감
      lastCandle.close < lastCandle.open;             // 음봉 마감

    if (bullishSweep) {
      return {
        detected: true,
        type: 'BULLISH_SWEEP',
        signal: 'BUY',
        description: '저점 유동성 스윕 후 반등 - 매수 신호',
        sweptLevel: prevLow,
        sweepCandle: prevCandle,
        confirmCandle: lastCandle,
      };
    }

    if (bearishSweep) {
      return {
        detected: true,
        type: 'BEARISH_SWEEP',
        signal: 'SELL',
        description: '고점 유동성 스윕 후 하락 - 매도 신호',
        sweptLevel: prevHigh,
        sweepCandle: prevCandle,
        confirmCandle: lastCandle,
      };
    }

    return { detected: false, type: null };
  },

  /**
   * 종합 지지/저항 분석
   * @param {Array} candles - 캔들 데이터
   */
  analyze(candles) {
    if (!candles || candles.length < 20) {
      return {
        srLevels: { supports: [], resistances: [] },
        proximity: { zone: 'UNKNOWN' },
        liquiditySweep: { detected: false },
        signal: 'NEUTRAL',
        score: 0,
      };
    }

    const currentPrice = candles[candles.length - 1].close;

    // 지지/저항 레벨 찾기
    const srLevels = this.findSRLevels(candles);

    // 현재 위치 확인
    const proximity = this.checkProximity(currentPrice, srLevels);

    // 유동성 스윕 감지
    const liquiditySweep = this.detectLiquiditySweep(candles);

    // 신호 및 점수 계산
    let signal = 'NEUTRAL';
    let score = 0;

    // 유동성 스윕 신호 (최우선)
    if (liquiditySweep.detected) {
      if (liquiditySweep.type === 'BULLISH_SWEEP') {
        signal = 'STRONG_BUY';
        score = 3;
      } else if (liquiditySweep.type === 'BEARISH_SWEEP') {
        signal = 'STRONG_SELL';
        score = -3;
      }
    }
    // 지지선 근처
    else if (proximity.zone === 'SUPPORT_ZONE') {
      signal = 'BUY';
      score = proximity.nearSupport?.strength === 'STRONG' ? 2 : 1;
    }
    // 저항선 근처
    else if (proximity.zone === 'RESISTANCE_ZONE') {
      signal = 'SELL';
      score = proximity.nearResistance?.strength === 'STRONG' ? -2 : -1;
    }

    return {
      currentPrice,
      srLevels,
      proximity,
      liquiditySweep,
      signal,
      score,
    };
  },

  /**
   * 매수 가능 여부 (지지/저항 기준)
   * @param {Object} srAnalysis - analyze() 결과
   */
  canBuy(srAnalysis) {
    const buySignals = ['STRONG_BUY', 'BUY'];
    const avoidSignals = ['STRONG_SELL', 'SELL'];

    return {
      allowed: !avoidSignals.includes(srAnalysis.signal),
      favorable: buySignals.includes(srAnalysis.signal),
      reason: this.getSignalReason(srAnalysis),
    };
  },

  /**
   * 매도 필요 여부 (지지/저항 기준)
   * @param {Object} srAnalysis - analyze() 결과
   */
  shouldSell(srAnalysis) {
    const sellSignals = ['STRONG_SELL', 'SELL'];

    return {
      required: sellSignals.includes(srAnalysis.signal),
      urgent: srAnalysis.signal === 'STRONG_SELL',
      reason: this.getSignalReason(srAnalysis),
    };
  },

  /**
   * 신호 사유 문자열 생성
   */
  getSignalReason(srAnalysis) {
    if (srAnalysis.liquiditySweep.detected) {
      return srAnalysis.liquiditySweep.description;
    }

    if (srAnalysis.proximity.zone === 'SUPPORT_ZONE') {
      const support = srAnalysis.proximity.nearSupport;
      return `지지선 근처 (${support.price.toLocaleString()}원, 터치 ${support.touches}회)`;
    }

    if (srAnalysis.proximity.zone === 'RESISTANCE_ZONE') {
      const resistance = srAnalysis.proximity.nearResistance;
      return `저항선 근처 (${resistance.price.toLocaleString()}원, 터치 ${resistance.touches}회)`;
    }

    return '지지/저항 영향 없음';
  },
};

module.exports = srAnalyzer;
