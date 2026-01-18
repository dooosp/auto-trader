/**
 * 종목 스크리너 모듈
 * 매일 전체 종목 스캔 → watchList 자동 갱신
 */

const fs = require('fs');
const path = require('path');
const kisApi = require('./kis-api');
const indicators = require('./indicators');
const config = require('./config');

const stockScreener = {
  /**
   * 지연 함수
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * 후보 종목 수집 (거래량 + 시가총액 상위)
   */
  async collectCandidates() {
    console.log('[Screener] 후보 종목 수집 중...');

    const candidates = new Map();  // 중복 제거용

    // 1. 거래량 상위 50개
    console.log('  - 거래량 상위 조회...');
    try {
      const volumeRanking = await kisApi.getVolumeRanking('J', 50);
      await this.delay(500);

      for (const stock of volumeRanking) {
        if (stock.code && stock.name) {
          candidates.set(stock.code, {
            ...stock,
            source: 'volume',
          });
        }
      }
      console.log(`    ${volumeRanking.length}개 수집`);
    } catch (error) {
      console.log(`    거래량 조회 실패 (주말/휴일): ${error.message}`);
    }

    // 2. 상승률 상위 30개
    console.log('  - 상승률 상위 조회...');
    try {
      const riseRanking = await kisApi.getChangeRateRanking('J', '0', 30);
      await this.delay(500);

      for (const stock of riseRanking) {
        if (stock.code && stock.name && !candidates.has(stock.code)) {
          candidates.set(stock.code, {
            ...stock,
            source: 'rise',
          });
        }
      }
      console.log(`    ${riseRanking.length}개 수집`);
    } catch (error) {
      console.log(`    상승률 조회 실패 (주말/휴일): ${error.message}`);
    }

    console.log(`[Screener] 총 ${candidates.size}개 고유 종목 수집 완료`);
    return Array.from(candidates.values());
  },

  /**
   * 종목 필터링 (기본 조건)
   * @param {Array} candidates - 후보 종목
   */
  filterBasic(candidates) {
    const screeningConfig = config.screening || {};
    const minPrice = screeningConfig.minPrice || 1000;
    const maxPrice = screeningConfig.maxPrice || 500000;
    const minVolume = screeningConfig.minVolume || 100000;

    return candidates.filter(stock => {
      // 가격 필터
      if (stock.price < minPrice || stock.price > maxPrice) return false;

      // 거래량 필터
      if (stock.volume < minVolume) return false;

      // 관리/정리매매 종목 제외 (이름에 특수문자 포함)
      if (/[*#]/.test(stock.name)) return false;

      // 스팩, 리츠, ETF 제외
      if (/스팩|리츠|ETF|ETN|인버스|레버리지/.test(stock.name)) return false;

      // 우선주 제외
      if (/우$|우B$|우C$/.test(stock.name)) return false;

      return true;
    });
  },

  /**
   * 기술적 분석으로 점수 계산
   * @param {Object} stock - 종목 정보
   */
  async analyzeStock(stock) {
    try {
      // 일봉 데이터 조회
      const history = await kisApi.getStockHistory(stock.code, 60);

      if (!history || history.length < 20) {
        return { ...stock, score: 0, reason: '데이터 부족' };
      }

      const closes = history.map(c => c.close);
      const currentPrice = closes[closes.length - 1];

      let score = 0;
      const signals = [];

      // 1. RSI 점수 (과매도 = 좋음)
      const rsi = indicators.RSI(closes);
      if (rsi < 30) {
        score += 3;
        signals.push(`RSI 과매도(${rsi})`);
      } else if (rsi < 40) {
        score += 2;
        signals.push(`RSI 낮음(${rsi})`);
      } else if (rsi > 70) {
        score -= 2;
        signals.push(`RSI 과매수(${rsi})`);
      }

      // 2. 이평선 정배열
      const ma5 = indicators.SMA(closes, 5);
      const ma20 = indicators.SMA(closes, 20);
      const ma60 = indicators.SMA(closes, 60);

      if (ma5 > ma20 && ma20 > (ma60 || ma20)) {
        score += 2;
        signals.push('이평선 정배열');
      }

      if (currentPrice > ma5) {
        score += 1;
        signals.push('5일선 위');
      }

      // 3. MACD 신호
      const macd = indicators.MACD(closes);
      if (macd.crossover === 'GOLDEN_CROSS') {
        score += 3;
        signals.push('MACD 골든크로스');
      } else if (macd.trend === 'BULLISH') {
        score += 1;
        signals.push('MACD 상승');
      }

      // 4. 볼린저 밴드
      const bollinger = indicators.BollingerBands(closes);
      if (bollinger.signal === 'OVERSOLD') {
        score += 2;
        signals.push('BB 과매도');
      } else if (bollinger.signal === 'LOWER_ZONE') {
        score += 1;
        signals.push('BB 하단');
      }

      // 5. 거래량 급증
      const volumeAnalysis = indicators.VolumeAnalysis(history);
      if (volumeAnalysis.volumeRatio >= 2) {
        score += 2;
        signals.push(`거래량 ${volumeAnalysis.volumeRatio.toFixed(1)}배`);
      } else if (volumeAnalysis.volumeRatio >= 1.5) {
        score += 1;
        signals.push(`거래량 증가`);
      }

      // 6. 당일 등락률 보너스
      if (stock.changeRate > 0 && stock.changeRate < 5) {
        score += 1;  // 적당한 상승
      } else if (stock.changeRate > 10) {
        score -= 1;  // 급등 종목 주의
      }

      return {
        ...stock,
        score,
        signals,
        rsi,
        ma5,
        ma20,
        macdTrend: macd.trend,
      };
    } catch (error) {
      return { ...stock, score: 0, reason: error.message };
    }
  },

  /**
   * 전체 스크리닝 실행
   */
  async runScreening() {
    console.log('\n========================================');
    console.log('       종목 스크리닝 시작');
    console.log('========================================');
    console.log(`시간: ${new Date().toLocaleString('ko-KR')}`);

    const startTime = Date.now();

    try {
      // 1. 후보 종목 수집
      const candidates = await this.collectCandidates();

      // 2. 기본 필터링
      console.log('\n[Screener] 기본 필터링...');
      const filtered = this.filterBasic(candidates);
      console.log(`  ${candidates.length}개 → ${filtered.length}개`);

      // 3. 기술적 분석 (상위 40개만)
      console.log('\n[Screener] 기술적 분석 중...');
      const toAnalyze = filtered.slice(0, 40);
      const analyzed = [];

      for (let i = 0; i < toAnalyze.length; i++) {
        const stock = toAnalyze[i];
        process.stdout.write(`\r  분석 중: ${i + 1}/${toAnalyze.length} (${stock.name})`);

        const result = await this.analyzeStock(stock);
        analyzed.push(result);

        await this.delay(300);  // API 호출 제한
      }
      console.log('\n  분석 완료');

      // 4. 점수순 정렬
      analyzed.sort((a, b) => b.score - a.score);

      // 5. 상위 20개 선정
      const screeningConfig = config.screening || {};
      const maxWatchList = screeningConfig.maxWatchList || 20;
      const selected = analyzed.filter(s => s.score >= 2).slice(0, maxWatchList);

      console.log(`\n[Screener] 상위 ${selected.length}개 종목 선정:`);
      selected.forEach((stock, i) => {
        console.log(`  ${i + 1}. ${stock.name} (${stock.code}) - 점수: ${stock.score}, ${stock.signals?.join(', ') || ''}`);
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n[Screener] 스크리닝 완료 (${elapsed}초 소요)`);

      return selected;
    } catch (error) {
      console.error('[Screener] 스크리닝 실패:', error.message);
      return [];
    }
  },

  /**
   * watchList 갱신
   * @param {Array} newStocks - 스크리닝 결과
   */
  async updateWatchList(newStocks) {
    console.log('\n[Screener] watchList 갱신 중...');

    // 기존 watchList 로드
    const currentWatchList = config.watchList || [];
    const currentCodes = currentWatchList.map(s => s.code);

    // 고정 종목 (항상 유지)
    const screeningConfig = config.screening || {};
    const fixedStocks = screeningConfig.fixedStocks || [
      '005930',  // 삼성전자
      '000660',  // SK하이닉스
      '035420',  // NAVER
    ];

    // 새 watchList 구성
    const newWatchList = [];

    // 1. 고정 종목 먼저 추가
    for (const code of fixedStocks) {
      const existing = currentWatchList.find(s => s.code === code);
      const fromNew = newStocks.find(s => s.code === code);
      if (existing) {
        newWatchList.push(existing);
      } else if (fromNew) {
        newWatchList.push({ code: fromNew.code, name: fromNew.name });
      }
    }

    // 2. 스크리닝 결과 추가 (중복 제외)
    for (const stock of newStocks) {
      if (!newWatchList.find(s => s.code === stock.code)) {
        newWatchList.push({ code: stock.code, name: stock.name });
      }

      if (newWatchList.length >= 20) break;
    }

    // 3. 부족하면 기존 종목으로 채움
    for (const stock of currentWatchList) {
      if (!newWatchList.find(s => s.code === stock.code)) {
        newWatchList.push(stock);
      }

      if (newWatchList.length >= 20) break;
    }

    // 변경 사항 분석
    const added = newWatchList.filter(s => !currentCodes.includes(s.code));
    const removed = currentWatchList.filter(s => !newWatchList.find(ns => ns.code === s.code));

    console.log(`  기존: ${currentWatchList.length}개`);
    console.log(`  신규: ${newWatchList.length}개`);
    console.log(`  추가: ${added.map(s => s.name).join(', ') || '없음'}`);
    console.log(`  제외: ${removed.map(s => s.name).join(', ') || '없음'}`);

    // config.js 파일 업데이트
    await this.saveWatchList(newWatchList);

    return {
      watchList: newWatchList,
      added,
      removed,
    };
  },

  /**
   * watchList를 별도 파일로 저장 (동적 갱신용)
   * @param {Array} watchList
   */
  async saveWatchList(watchList) {
    const dataPath = path.resolve(__dirname, 'data/watchlist.json');
    const dir = path.dirname(dataPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = {
      watchList,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[Screener] watchList 저장 완료: ${dataPath}`);
  },

  /**
   * 저장된 watchList 로드
   */
  loadWatchList() {
    const dataPath = path.resolve(__dirname, 'data/watchlist.json');

    try {
      if (fs.existsSync(dataPath)) {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        return data.watchList || [];
      }
    } catch (error) {
      console.error('[Screener] watchList 로드 실패:', error.message);
    }

    return config.watchList || [];
  },

  /**
   * 스크리닝 + watchList 갱신 실행
   */
  async run() {
    const selected = await this.runScreening();

    if (selected.length > 0) {
      const result = await this.updateWatchList(selected);
      return result;
    }

    return { watchList: config.watchList, added: [], removed: [] };
  },
};

module.exports = stockScreener;
