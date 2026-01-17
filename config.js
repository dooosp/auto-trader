require('dotenv').config();

const config = {
  // 한국투자증권 API 설정
  kis: {
    appKey: process.env.KIS_APP_KEY,
    appSecret: process.env.KIS_APP_SECRET,
    account: process.env.KIS_ACCOUNT,
    useMock: process.env.USE_MOCK === 'true',
    get baseUrl() {
      return this.useMock
        ? 'https://openapivts.koreainvestment.com:29443'
        : 'https://openapi.koreainvestment.com:9443';
    }
  },

  // 매매 설정
  trading: {
    buyAmount: parseInt(process.env.BUY_AMOUNT) || 100000,  // 1회 매수 금액
    maxHoldings: parseInt(process.env.MAX_HOLDINGS) || 5,   // 최대 보유 종목 수

    // 매수 조건
    buy: {
      rsiBelow: 30,           // RSI < 30 (과매도)
      maShortPeriod: 5,       // 5일 이평선
      maLongPeriod: 20,       // 20일 이평선
    },

    // 매도 조건
    sell: {
      rsiAbove: 70,           // RSI > 70 (과매수)
      stopLoss: -0.02,        // 손절: -2%
      takeProfit: 0.10,       // 익절: +10%
    }
  },

  // 기술적 분석 설정
  analysis: {
    rsiPeriod: 14,            // RSI 기간
    maPeriods: [5, 20, 60],   // 이동평균 기간
    historyDays: 60,          // 조회할 일봉 수
  },

  // 감시 종목 (10만원 이하 매수 가능한 대형주 10개)
  watchList: [
    { code: '005930', name: '삼성전자' },      // ~5만원대
    { code: '035720', name: '카카오' },        // ~4만원대
    { code: '000270', name: '기아' },          // ~9만원대
    { code: '105560', name: 'KB금융' },        // ~8만원대
    { code: '055550', name: '신한지주' },      // ~5만원대
    { code: '066570', name: 'LG전자' },        // ~9만원대
    { code: '086790', name: '하나금융지주' },  // ~6만원대
    { code: '032830', name: '삼성생명' },      // ~8만원대
    { code: '316140', name: '우리금융지주' },  // ~1만원대
    { code: '024110', name: '기업은행' },      // ~1만원대
  ],

  // 장 운영 시간 (KST)
  marketHours: {
    open: { hour: 9, minute: 0 },
    close: { hour: 15, minute: 30 },
  },

  // 대시보드 설정
  dashboard: {
    port: 3001,
  },

  // 데이터 파일 경로
  dataPath: {
    trades: './data/trades.json',
    portfolio: './data/portfolio.json',
    dailyReturns: './data/daily-returns.json',
  }
};

module.exports = config;
