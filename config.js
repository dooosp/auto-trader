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
    buyAmount: parseInt(process.env.BUY_AMOUNT) || 500000,  // 1회 매수 금액 (50만원)
    maxHoldings: parseInt(process.env.MAX_HOLDINGS) || 15,  // 최대 보유 종목 수

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
    },

    // 매매 안전장치
    safety: {
      enabled: true,                    // 안전장치 활성화
      cooldownHours: 24,                // 같은 종목 매도 후 재매수 금지 시간 (24시간)
      minHoldingHours: 2,               // 최소 보유 시간 (2시간) - 이 시간 전에는 매도 금지

      // 다중 확인 설정
      multiConfirm: {
        enabled: true,                  // 다중 확인 활성화
        requiredBuyConditions: 3,       // 매수 시 최소 충족 조건 수
        requiredSellConditions: 2,      // 매도 시 최소 충족 조건 수
      },

      // 가격 변동폭 필터
      priceChange: {
        enabled: true,
        minChangePercent: 1.0,          // 최소 1% 변동 시에만 매매 고려
      },
    }
  },

  // 기술적 분석 설정
  analysis: {
    rsiPeriod: 14,            // RSI 기간
    maPeriods: [5, 20, 60],   // 이동평균 기간
    historyDays: 60,          // 조회할 일봉 수
  },

  // Phase 2: 다중 타임프레임 설정
  mtf: {
    enabled: true,            // MTF 분석 활성화
    weeklyWeeks: 52,          // 주봉 조회 기간 (52주 = 1년)
    // MTF 매수 허용 신호
    allowedBuySignals: ['STRONG_BUY', 'BUY'],
    // MTF 필수 적용 여부 (false면 참고용으로만 사용)
    strictMode: true,
  },

  // Phase 2: 시장/섹터 커플링 설정
  coupling: {
    enabled: true,            // 커플링 분석 활성화
    // 매수 차단 시장 상태
    blockMarketConditions: ['STRONG_BEARISH'],
    // 매수 경고 시장 상태
    warnMarketConditions: ['BEARISH'],
    // 커플링 필수 적용 여부
    strictMode: false,        // false면 경고만, true면 차단
    // 캐시 유효 시간 (분)
    cacheMinutes: 5,
  },

  // Phase 3: 지지/저항선 + 유동성 스윕 설정
  sr: {
    enabled: true,              // 지지/저항 분석 활성화
    pivotLookback: 3,           // 피벗 판단 기간 (좌우 캔들 수)
    clusterTolerance: 0.01,     // 클러스터링 허용 오차 (1%)
    proximityPercent: 0.01,     // 근접 판단 % (1%)
    liquiditySweepLookback: 10, // 유동성 스윕 탐색 기간
    strictMode: false,          // true면 저항선 근처 매수 차단
  },

  // Phase 4: 청산 전략 설정
  exit: {
    enabled: true,              // 분할 매도/트레일링 활성화
    // 분할 매도 레벨
    partialSellLevels: [
      { profitRate: 0.05, sellRatio: 0.3 },   // +5%에서 30% 매도
      { profitRate: 0.10, sellRatio: 0.3 },   // +10%에서 30% 매도
      { profitRate: 0.15, sellRatio: 0.4 },   // +15%에서 나머지 40% 매도
    ],
    // 트레일링 스톱
    trailingStop: {
      activationProfit: 0.05,   // 트레일링 활성화 수익률 (+5%)
      trailingPercent: 0.03,    // 고점 대비 하락 허용 % (3%)
      minProfit: 0.02,          // 최소 보존 수익률 (+2%)
    },
  },

  // 자동 스크리닝 설정
  screening: {
    enabled: true,              // 자동 스크리닝 활성화
    maxWatchList: 20,           // watchList 최대 개수
    minPrice: 1000,             // 최소 가격 (1,000원)
    maxPrice: 500000,           // 최대 가격 (50만원)
    minVolume: 100000,          // 최소 거래량
    minScore: 2,                // 최소 스크리닝 점수
    // 항상 유지할 고정 종목
    fixedStocks: [
      '005930',  // 삼성전자
      '000660',  // SK하이닉스
      '035420',  // NAVER
    ],
  },

  // 섹터 매핑 (종목코드 -> 섹터)
  sectorMap: {
    '005930': 'TECH',      // 삼성전자
    '000660': 'TECH',      // SK하이닉스
    '035420': 'TECH',      // NAVER
    '035720': 'TECH',      // 카카오
    '036570': 'TECH',      // 엔씨소프트
    '005380': 'AUTO',      // 현대차
    '000270': 'AUTO',      // 기아
    '105560': 'FINANCE',   // KB금융
    '055550': 'FINANCE',   // 신한지주
    '086790': 'FINANCE',   // 하나금융지주
    '316140': 'FINANCE',   // 우리금융지주
    '066570': 'TECH',      // LG전자
    '006400': 'TECH',      // 삼성SDI
    '207940': 'BIO',       // 삼성바이오로직스
    '068270': 'BIO',       // 셀트리온
    '051910': 'CHEMICAL',  // LG화학
    '096770': 'ENERGY',    // SK이노베이션
    '032830': 'FINANCE',   // 삼성생명
    '024110': 'FINANCE',   // 기업은행
    '003550': 'TECH',      // LG
  },

  // 감시 종목 (20개 - 자동 스크리닝으로 갱신됨)
  watchList: [
    // 대형 우량주 (고정)
    { code: '005930', name: '삼성전자' },
    { code: '000660', name: 'SK하이닉스' },
    { code: '035420', name: 'NAVER' },
    // IT/플랫폼
    { code: '035720', name: '카카오' },
    { code: '036570', name: '엔씨소프트' },
    // 자동차
    { code: '005380', name: '현대차' },
    { code: '000270', name: '기아' },
    // 금융
    { code: '105560', name: 'KB금융' },
    { code: '055550', name: '신한지주' },
    { code: '086790', name: '하나금융지주' },
    { code: '316140', name: '우리금융지주' },
    // 전자/가전
    { code: '066570', name: 'LG전자' },
    { code: '006400', name: '삼성SDI' },
    // 바이오
    { code: '207940', name: '삼성바이오로직스' },
    { code: '068270', name: '셀트리온' },
    // 에너지/화학
    { code: '051910', name: 'LG화학' },
    { code: '096770', name: 'SK이노베이션' },
    // 기타 대형주
    { code: '032830', name: '삼성생명' },
    { code: '024110', name: '기업은행' },
    { code: '003550', name: 'LG' },
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
