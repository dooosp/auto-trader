const kisApi = require('./kis-api');
const config = require('./config');

const stockFetcher = {
  /**
   * 단일 종목 데이터 수집 (현재가 + 일봉)
   * @param {string} stockCode - 종목코드
   */
  async fetchStock(stockCode) {
    try {
      // API 호출 제한으로 순차 호출 + 간격 추가
      const currentPrice = await kisApi.getStockPrice(stockCode);
      await this.delay(300);
      const history = await kisApi.getStockHistory(stockCode, config.analysis.historyDays);

      return {
        code: stockCode,
        current: currentPrice,
        history: history,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[Fetcher] 종목 데이터 수집 실패 (${stockCode}):`, error.message);
      return null;
    }
  },

  /**
   * 단일 종목 데이터 수집 (현재가 + 일봉 + 주봉) - Phase 2
   * @param {string} stockCode - 종목코드
   */
  async fetchStockWithWeekly(stockCode) {
    try {
      const currentPrice = await kisApi.getStockPrice(stockCode);
      await this.delay(300);
      const dailyHistory = await kisApi.getStockHistory(stockCode, config.analysis.historyDays);
      await this.delay(300);

      // 주봉 데이터 (MTF 분석용)
      let weeklyHistory = [];
      if (config.mtf?.enabled) {
        const weeks = config.mtf?.weeklyWeeks || 52;
        weeklyHistory = await kisApi.getWeeklyHistory(stockCode, weeks);
      }

      return {
        code: stockCode,
        current: currentPrice,
        history: dailyHistory,          // 일봉 (기존 호환성)
        dailyHistory: dailyHistory,     // 일봉 (명시적)
        weeklyHistory: weeklyHistory,   // 주봉 (Phase 2)
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[Fetcher] 종목 데이터 수집 실패 (${stockCode}):`, error.message);
      return null;
    }
  },

  /**
   * 여러 종목 데이터 수집 (API 호출 제한 고려)
   * @param {Array} stockCodes - 종목코드 배열
   * @param {number} delayMs - 호출 간 지연 시간 (ms)
   */
  async fetchMultipleStocks(stockCodes, delayMs = 500) {
    const results = [];

    for (const code of stockCodes) {
      const data = await this.fetchStock(code);
      if (data) {
        results.push(data);
      }
      // API 호출 제한 방지를 위한 지연
      await this.delay(delayMs);
    }

    return results;
  },

  /**
   * watchList 종목 전체 데이터 수집
   * @param {boolean} includeWeekly - 주봉 데이터 포함 여부 (Phase 2)
   */
  async fetchWatchList(includeWeekly = false) {
    const mtfEnabled = config.mtf?.enabled && includeWeekly;
    console.log(`[Fetcher] watchList ${config.watchList.length}개 종목 데이터 수집 시작...`);
    if (mtfEnabled) console.log('[Fetcher] Phase 2: 주봉 데이터 포함');

    const startTime = Date.now();
    const results = [];

    for (const stock of config.watchList) {
      const data = mtfEnabled
        ? await this.fetchStockWithWeekly(stock.code)
        : await this.fetchStock(stock.code);

      if (data) {
        results.push(data);
      }
      await this.delay(500);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Fetcher] 수집 완료: ${results.length}개 종목, ${elapsed}초 소요`);

    return results;
  },

  /**
   * 종목명 조회
   * @param {string} stockCode - 종목코드
   */
  getStockName(stockCode) {
    const stock = config.watchList.find(s => s.code === stockCode);
    return stock ? stock.name : stockCode;
  },

  /**
   * 종가 배열 추출 (기술적 분석용)
   * @param {Array} history - 일봉 데이터
   */
  extractClosePrices(history) {
    return history.map(item => item.close);
  },

  /**
   * 현재 장 운영 시간인지 확인
   */
  isMarketOpen() {
    const now = new Date();
    const kstOffset = 9 * 60; // KST = UTC+9
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const kstMinutes = utcMinutes + kstOffset;

    const { open, close } = config.marketHours;
    const openMinutes = open.hour * 60 + open.minute;
    const closeMinutes = close.hour * 60 + close.minute;

    // 주말 체크 (0=일, 6=토)
    const kstDay = new Date(now.getTime() + kstOffset * 60000).getUTCDay();
    if (kstDay === 0 || kstDay === 6) {
      return false;
    }

    return kstMinutes >= openMinutes && kstMinutes <= closeMinutes;
  },

  /**
   * 장 시작까지 남은 시간 (분)
   */
  getMinutesToMarketOpen() {
    const now = new Date();
    const kstOffset = 9 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const kstMinutes = utcMinutes + kstOffset;

    const { open } = config.marketHours;
    const openMinutes = open.hour * 60 + open.minute;

    if (kstMinutes < openMinutes) {
      return openMinutes - kstMinutes;
    } else {
      // 내일 장 시작까지
      return (24 * 60 - kstMinutes) + openMinutes;
    }
  },

  /**
   * 지연 함수
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * 포트폴리오 종목 현재가 업데이트
   * @param {Array} holdings - 보유 종목 배열
   */
  async updateHoldingsPrices(holdings) {
    const updated = [];

    for (const holding of holdings) {
      try {
        const price = await kisApi.getStockPrice(holding.code);
        updated.push({
          ...holding,
          currentPrice: price.price,
          changeRate: price.changeRate,
          updatedAt: new Date().toISOString(),
        });
        await this.delay(200);
      } catch (error) {
        updated.push(holding);
      }
    }

    return updated;
  }
};

module.exports = stockFetcher;
