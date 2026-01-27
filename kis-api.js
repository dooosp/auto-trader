const axios = require('axios');
const config = require('./config');

let accessToken = null;
let tokenExpiry = null;

const kisApi = {
  /**
   * OAuth 토큰 발급
   */
  async getAccessToken() {
    // 토큰이 유효하면 재사용
    if (accessToken && tokenExpiry && new Date() < tokenExpiry) {
      return accessToken;
    }

    const url = `${config.kis.baseUrl}/oauth2/tokenP`;
    const body = {
      grant_type: 'client_credentials',
      appkey: config.kis.appKey,
      appsecret: config.kis.appSecret,
    };

    try {
      const response = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' }
      });

      accessToken = response.data.access_token;
      // 토큰 유효시간 설정 (보통 24시간, 안전하게 23시간으로 설정)
      tokenExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);

      console.log('[KIS] 토큰 발급 성공');
      return accessToken;
    } catch (error) {
      console.error('[KIS] 토큰 발급 실패:', error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 공통 헤더 생성
   */
  async getHeaders(trId) {
    const token = await this.getAccessToken();
    return {
      'Content-Type': 'application/json; charset=utf-8',
      'authorization': `Bearer ${token}`,
      'appkey': config.kis.appKey,
      'appsecret': config.kis.appSecret,
      'tr_id': trId,
    };
  },

  /**
   * 현재가 조회
   * @param {string} stockCode - 종목코드 (6자리)
   */
  async getStockPrice(stockCode) {
    const trId = config.kis.useMock ? 'FHKST01010100' : 'FHKST01010100';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price`;

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: 'J',  // 주식
          FID_INPUT_ISCD: stockCode,
        }
      });

      const data = response.data.output;
      return {
        code: stockCode,
        price: parseInt(data.stck_prpr),           // 현재가
        change: parseInt(data.prdy_vrss),          // 전일 대비
        changeRate: parseFloat(data.prdy_ctrt),    // 전일 대비율
        volume: parseInt(data.acml_vol),           // 누적 거래량
        high: parseInt(data.stck_hgpr),            // 최고가
        low: parseInt(data.stck_lwpr),             // 최저가
        open: parseInt(data.stck_oprc),            // 시가
      };
    } catch (error) {
      console.error(`[KIS] 현재가 조회 실패 (${stockCode}):`, error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 일봉 데이터 조회 (이평선 계산용)
   * @param {string} stockCode - 종목코드
   * @param {number} days - 조회 일수 (기본 60일)
   */
  async getStockHistory(stockCode, days = 60) {
    const trId = config.kis.useMock ? 'FHKST03010100' : 'FHKST03010100';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`;

    // 날짜 계산
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days * 1.5); // 주말/공휴일 고려

    const formatDate = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: stockCode,
          FID_INPUT_DATE_1: formatDate(startDate),
          FID_INPUT_DATE_2: formatDate(endDate),
          FID_PERIOD_DIV_CODE: 'D',  // 일봉
          FID_ORG_ADJ_PRC: '0',      // 수정주가
        }
      });

      const output = response.data.output2 || [];

      // 최신 데이터가 먼저 오므로 역순 정렬 후 필요한 일수만 반환
      return output
        .slice(0, days)
        .reverse()
        .map(item => ({
          date: item.stck_bsop_date,
          open: parseInt(item.stck_oprc),
          high: parseInt(item.stck_hgpr),
          low: parseInt(item.stck_lwpr),
          close: parseInt(item.stck_clpr),
          volume: parseInt(item.acml_vol),
        }));
    } catch (error) {
      console.error(`[KIS] 일봉 조회 실패 (${stockCode}):`, error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 매수 주문
   * @param {string} stockCode - 종목코드
   * @param {number} quantity - 수량
   * @param {number} price - 가격 (0이면 시장가)
   */
  async buyStock(stockCode, quantity, price = 0) {
    const trId = config.kis.useMock ? 'VTTC0802U' : 'TTTC0802U';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/trading/order-cash`;

    const [accountPrefix, accountSuffix] = config.kis.account.split('-');

    const body = {
      CANO: accountPrefix,
      ACNT_PRDT_CD: accountSuffix,
      PDNO: stockCode,
      ORD_DVSN: price === 0 ? '01' : '00',  // 01: 시장가, 00: 지정가
      ORD_QTY: String(quantity),
      ORD_UNPR: String(price),
    };

    try {
      const response = await axios.post(url, body, {
        headers: await this.getHeaders(trId),
      });

      if (response.data.rt_cd === '0') {
        console.log(`[KIS] 매수 주문 성공: ${stockCode} ${quantity}주`);
        return {
          success: true,
          orderNo: response.data.output.ODNO,
          message: response.data.msg1,
        };
      } else {
        throw new Error(response.data.msg1);
      }
    } catch (error) {
      console.error(`[KIS] 매수 주문 실패 (${stockCode}):`, error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 매도 주문
   * @param {string} stockCode - 종목코드
   * @param {number} quantity - 수량
   * @param {number} price - 가격 (0이면 시장가)
   */
  async sellStock(stockCode, quantity, price = 0) {
    const trId = config.kis.useMock ? 'VTTC0801U' : 'TTTC0801U';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/trading/order-cash`;

    const [accountPrefix, accountSuffix] = config.kis.account.split('-');

    const body = {
      CANO: accountPrefix,
      ACNT_PRDT_CD: accountSuffix,
      PDNO: stockCode,
      ORD_DVSN: price === 0 ? '01' : '00',  // 01: 시장가, 00: 지정가
      ORD_QTY: String(quantity),
      ORD_UNPR: String(price),
    };

    try {
      const response = await axios.post(url, body, {
        headers: await this.getHeaders(trId),
      });

      if (response.data.rt_cd === '0') {
        console.log(`[KIS] 매도 주문 성공: ${stockCode} ${quantity}주`);
        return {
          success: true,
          orderNo: response.data.output.ODNO,
          message: response.data.msg1,
        };
      } else {
        throw new Error(response.data.msg1);
      }
    } catch (error) {
      console.error(`[KIS] 매도 주문 실패 (${stockCode}):`, error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 잔고 조회
   */
  async getBalance() {
    const trId = config.kis.useMock ? 'VTTC8434R' : 'TTTC8434R';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/trading/inquire-balance`;

    const [accountPrefix, accountSuffix] = config.kis.account.split('-');

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          CANO: accountPrefix,
          ACNT_PRDT_CD: accountSuffix,
          AFHR_FLPR_YN: 'N',
          OFL_YN: '',
          INQR_DVSN: '02',
          UNPR_DVSN: '01',
          FUND_STTL_ICLD_YN: 'N',
          FNCG_AMT_AUTO_RDPT_YN: 'N',
          PRCS_DVSN: '00',
          CTX_AREA_FK100: '',
          CTX_AREA_NK100: '',
        }
      });

      const output1 = response.data.output1 || [];  // 보유 종목
      const output2 = response.data.output2?.[0] || {};  // 계좌 요약

      return {
        holdings: output1.map(item => ({
          code: item.pdno,
          name: item.prdt_name,
          quantity: parseInt(item.hldg_qty),
          avgPrice: parseInt(item.pchs_avg_pric),
          currentPrice: parseInt(item.prpr),
          profit: parseInt(item.evlu_pfls_amt),
          profitRate: parseFloat(item.evlu_pfls_rt),
        })),
        summary: {
          totalDeposit: parseInt(output2.dnca_tot_amt || 0),      // 예수금 총액
          totalEvaluation: parseInt(output2.tot_evlu_amt || 0),   // 총 평가금액
          totalProfit: parseInt(output2.evlu_pfls_smtl_amt || 0), // 총 평가손익
        }
      };
    } catch (error) {
      console.error('[KIS] 잔고 조회 실패:', error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 주문 내역 조회
   */
  async getOrders() {
    const trId = config.kis.useMock ? 'VTTC8001R' : 'TTTC8001R';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/trading/inquire-daily-ccld`;

    const [accountPrefix, accountSuffix] = config.kis.account.split('-');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          CANO: accountPrefix,
          ACNT_PRDT_CD: accountSuffix,
          INQR_STRT_DT: today,
          INQR_END_DT: today,
          SLL_BUY_DVSN_CD: '00',  // 전체
          INQR_DVSN: '00',
          PDNO: '',
          CCLD_DVSN: '00',
          ORD_GNO_BRNO: '',
          ODNO: '',
          INQR_DVSN_3: '00',
          INQR_DVSN_1: '',
          CTX_AREA_FK100: '',
          CTX_AREA_NK100: '',
        }
      });

      const output = response.data.output1 || [];

      return output.map(item => ({
        orderNo: item.odno,
        code: item.pdno,
        name: item.prdt_name,
        orderType: item.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
        quantity: parseInt(item.ord_qty),
        price: parseInt(item.ord_unpr),
        executedQty: parseInt(item.tot_ccld_qty),
        executedPrice: parseInt(item.avg_prvs),
        status: item.ord_qty === item.tot_ccld_qty ? 'FILLED' : 'PARTIAL',
        time: item.ord_tmd,
      }));
    } catch (error) {
      console.error('[KIS] 주문 내역 조회 실패:', error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 주봉 데이터 조회 (다중 타임프레임 분석용)
   * @param {string} stockCode - 종목코드
   * @param {number} weeks - 조회 주 수 (기본 52주)
   */
  async getWeeklyHistory(stockCode, weeks = 52) {
    const trId = config.kis.useMock ? 'FHKST03010100' : 'FHKST03010100';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`;

    // 날짜 계산 (주봉은 더 긴 기간 필요)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - weeks * 7 * 1.2); // 여유 있게 설정

    const formatDate = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: stockCode,
          FID_INPUT_DATE_1: formatDate(startDate),
          FID_INPUT_DATE_2: formatDate(endDate),
          FID_PERIOD_DIV_CODE: 'W',  // 주봉
          FID_ORG_ADJ_PRC: '0',
        }
      });

      const output = response.data.output2 || [];

      return output
        .slice(0, weeks)
        .reverse()
        .map(item => ({
          date: item.stck_bsop_date,
          open: parseInt(item.stck_oprc),
          high: parseInt(item.stck_hgpr),
          low: parseInt(item.stck_lwpr),
          close: parseInt(item.stck_clpr),
          volume: parseInt(item.acml_vol),
        }));
    } catch (error) {
      console.error(`[KIS] 주봉 조회 실패 (${stockCode}):`, error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 지수 현재가 조회 (KOSPI, KOSDAQ)
   * @param {string} indexCode - 지수코드 ('0001': KOSPI, '1001': KOSDAQ)
   */
  async getIndexPrice(indexCode) {
    const trId = 'FHPUP02100000';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-index-price`;

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: 'U',
          FID_INPUT_ISCD: indexCode,
        }
      });

      const data = response.data.output;
      return {
        code: indexCode,
        name: indexCode === '0001' ? 'KOSPI' : 'KOSDAQ',
        price: parseFloat(data.bstp_nmix_prpr),           // 현재 지수
        change: parseFloat(data.bstp_nmix_prdy_vrss),     // 전일 대비
        changeRate: parseFloat(data.bstp_nmix_prdy_ctrt), // 전일 대비율
        volume: parseInt(data.acml_vol || 0),             // 누적 거래량
        high: parseFloat(data.bstp_nmix_hgpr),            // 고가
        low: parseFloat(data.bstp_nmix_lwpr),             // 저가
      };
    } catch (error) {
      console.error(`[KIS] 지수 조회 실패 (${indexCode}):`, error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 지수 일봉 데이터 조회
   * @param {string} indexCode - 지수코드
   * @param {number} days - 조회 일수
   */
  async getIndexHistory(indexCode, days = 60) {
    const trId = 'FHPUP02110000';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-index-daily-price`;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days * 1.5);

    const formatDate = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: 'U',
          FID_INPUT_ISCD: indexCode,
          FID_INPUT_DATE_1: formatDate(startDate),
          FID_INPUT_DATE_2: formatDate(endDate),
          FID_PERIOD_DIV_CODE: 'D',
        }
      });

      const output = response.data.output2 || [];

      return output
        .slice(0, days)
        .reverse()
        .map(item => ({
          date: item.stck_bsop_date,
          open: parseFloat(item.bstp_nmix_oprc),
          high: parseFloat(item.bstp_nmix_hgpr),
          low: parseFloat(item.bstp_nmix_lwpr),
          close: parseFloat(item.bstp_nmix_prpr),
          volume: parseInt(item.acml_vol || 0),
        }));
    } catch (error) {
      console.error(`[KIS] 지수 일봉 조회 실패 (${indexCode}):`, error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * 업종별 현재가 조회 (섹터 분석용)
   * @param {string} sectorCode - 업종코드
   */
  async getSectorPrice(sectorCode) {
    const trId = 'FHPUP02100000';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-index-price`;

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: 'U',
          FID_INPUT_ISCD: sectorCode,
        }
      });

      const data = response.data.output;
      return {
        code: sectorCode,
        price: parseFloat(data.bstp_nmix_prpr),
        change: parseFloat(data.bstp_nmix_prdy_vrss),
        changeRate: parseFloat(data.bstp_nmix_prdy_ctrt),
      };
    } catch (error) {
      console.error(`[KIS] 업종 조회 실패 (${sectorCode}):`, error.response?.data || error.message);
      return null; // 섹터 조회 실패는 무시
    }
  },

  /**
   * 거래량 상위 종목 조회 (스크리닝용)
   * @param {string} market - 시장 ('J': 전체, '0': 코스피, '1': 코스닥)
   * @param {number} count - 조회 개수
   */
  async getVolumeRanking(market = 'J', count = 50) {
    const trId = 'FHPST01710000';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/volume-rank`;

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: market,
          FID_COND_SCR_DIV_CODE: '20101',  // 거래량
          FID_INPUT_ISCD: '0000',          // 전체
          FID_DIV_CLS_CODE: '0',           // 전체
          FID_BLNG_CLS_CODE: '0',          // 전체
          FID_TRGT_CLS_CODE: '111111111',  // 전체
          FID_TRGT_EXLS_CLS_CODE: '000000', // 제외 없음
          FID_INPUT_PRICE_1: '0',          // 최소 가격
          FID_INPUT_PRICE_2: '0',          // 최대 가격
          FID_VOL_CNT: '0',                // 최소 거래량
          FID_INPUT_DATE_1: '',
        }
      });

      const output = response.data.output || [];

      return output.slice(0, count).map(item => ({
        code: item.mksc_shrn_iscd,           // 종목코드
        name: item.hts_kor_isnm,             // 종목명
        price: parseInt(item.stck_prpr),     // 현재가
        changeRate: parseFloat(item.prdy_ctrt), // 등락률
        volume: parseInt(item.acml_vol),     // 거래량
        tradingValue: parseInt(item.acml_tr_pbmn), // 거래대금
      }));
    } catch (error) {
      console.error(`[KIS] 거래량 상위 조회 실패:`, error.response?.data || error.message);
      return [];
    }
  },

  /**
   * 등락률 상위 종목 조회 (스크리닝용)
   * @param {string} market - 시장
   * @param {string} type - '0': 상승률, '1': 하락률
   * @param {number} count - 조회 개수
   */
  async getChangeRateRanking(market = 'J', type = '0', count = 50) {
    const trId = 'FHPST01700000';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/ranking/fluctuation`;

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: market,
          FID_COND_SCR_DIV_CODE: '20170',
          FID_INPUT_ISCD: '0000',
          FID_DIV_CLS_CODE: type,          // 0: 상승, 1: 하락
          FID_BLNG_CLS_CODE: '0',
          FID_TRGT_CLS_CODE: '111111111',
          FID_TRGT_EXLS_CLS_CODE: '000000',
          FID_INPUT_PRICE_1: '0',
          FID_INPUT_PRICE_2: '0',
          FID_VOL_CNT: '0',
        }
      });

      const output = response.data.output || [];

      return output.slice(0, count).map(item => ({
        code: item.stck_shrn_iscd,
        name: item.hts_kor_isnm,
        price: parseInt(item.stck_prpr),
        changeRate: parseFloat(item.prdy_ctrt),
        volume: parseInt(item.acml_vol),
      }));
    } catch (error) {
      console.error(`[KIS] 등락률 상위 조회 실패:`, error.response?.data || error.message);
      return [];
    }
  },

  /**
   * 시가총액 상위 종목 조회 (스크리닝용)
   * @param {string} market - 시장
   * @param {number} count - 조회 개수
   */
  async getMarketCapRanking(market = 'J', count = 100) {
    const trId = 'FHPST01740000';
    const url = `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/capture-uplowprice`;

    try {
      const response = await axios.get(url, {
        headers: await this.getHeaders(trId),
        params: {
          FID_COND_MRKT_DIV_CODE: market,
          FID_COND_SCR_DIV_CODE: '20174',
          FID_INPUT_ISCD: '0000',
          FID_DIV_CLS_CODE: '0',
          FID_BLNG_CLS_CODE: '0',
          FID_TRGT_CLS_CODE: '111111111',
          FID_TRGT_EXLS_CLS_CODE: '000000',
          FID_INPUT_PRICE_1: '0',
          FID_INPUT_PRICE_2: '0',
          FID_VOL_CNT: '0',
        }
      });

      const output = response.data.output || [];

      return output.slice(0, count).map(item => ({
        code: item.stck_shrn_iscd || item.mksc_shrn_iscd,
        name: item.hts_kor_isnm,
        price: parseInt(item.stck_prpr || 0),
        changeRate: parseFloat(item.prdy_ctrt || 0),
        volume: parseInt(item.acml_vol || 0),
      }));
    } catch (error) {
      console.error(`[KIS] 시가총액 상위 조회 실패:`, error.response?.data || error.message);
      return [];
    }
  },

  /**
   * API 연결 테스트
   */
  async testConnection() {
    console.log('=== 한국투자증권 API 연결 테스트 ===');
    console.log(`환경: ${config.kis.useMock ? '모의투자' : '실전투자'}`);
    console.log(`URL: ${config.kis.baseUrl}`);

    try {
      // 1. 토큰 발급 테스트
      console.log('\n1. 토큰 발급 테스트...');
      await this.getAccessToken();
      console.log('   성공!');

      // 2. 시세 조회 테스트 (삼성전자)
      console.log('\n2. 시세 조회 테스트 (005930 삼성전자)...');
      const price = await this.getStockPrice('005930');
      console.log(`   현재가: ${price.price.toLocaleString()}원`);
      console.log(`   등락률: ${price.changeRate}%`);

      // 3. 잔고 조회 테스트
      console.log('\n3. 잔고 조회 테스트...');
      const balance = await this.getBalance();
      console.log(`   예수금: ${balance.summary.totalDeposit.toLocaleString()}원`);
      console.log(`   보유 종목 수: ${balance.holdings.length}개`);

      console.log('\n=== 테스트 완료 ===');
      return true;
    } catch (error) {
      console.error('\n테스트 실패:', error.message);
      return false;
    }
  },

  // ============================================
  // 투자자별 매매동향 (수급 분석)
  // ============================================

  /**
   * 종목별 투자자 매매동향 조회
   * @param {string} stockCode - 종목코드
   * @param {number} days - 조회 일수 (기본 5)
   * @returns {Object} 투자자별 순매수 정보
   */
  async getInvestorTrend(stockCode, days = 5) {
    try {
      const headers = await this.getHeaders('FHKST01010900');
      const params = {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
      };

      const response = await axios.get(
        `${config.kis.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-investor`,
        { headers, params }
      );

      if (response.data.rt_cd !== '0') {
        console.warn(`투자자 동향 조회 실패 [${stockCode}]:`, response.data.msg1);
        return null;
      }

      const data = response.data.output;
      if (!data || data.length === 0) return null;

      // 최근 N일 데이터 집계
      const recentData = data.slice(0, days);

      let foreignNet = 0;   // 외국인 순매수
      let institutionNet = 0; // 기관 순매수
      let individualNet = 0;  // 개인 순매수

      for (const day of recentData) {
        foreignNet += parseInt(day.frgn_ntby_qty || 0);      // 외국인 순매수량
        institutionNet += parseInt(day.orgn_ntby_qty || 0);  // 기관 순매수량
        individualNet += parseInt(day.prsn_ntby_qty || 0);   // 개인 순매수량
      }

      return {
        stockCode,
        days,
        foreign: {
          netBuy: foreignNet,
          trend: foreignNet > 0 ? 'BUY' : foreignNet < 0 ? 'SELL' : 'NEUTRAL',
        },
        institution: {
          netBuy: institutionNet,
          trend: institutionNet > 0 ? 'BUY' : institutionNet < 0 ? 'SELL' : 'NEUTRAL',
        },
        individual: {
          netBuy: individualNet,
          trend: individualNet > 0 ? 'BUY' : individualNet < 0 ? 'SELL' : 'NEUTRAL',
        },
      };
    } catch (error) {
      console.error(`투자자 동향 조회 오류 [${stockCode}]:`, error.message);
      return null;
    }
  }
};

module.exports = kisApi;
