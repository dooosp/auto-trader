/**
 * 자동매매 대시보드 서버
 * 포트 3001에서 실행
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const kisApi = require('./kis-api');
const config = require('./config');

const app = express();
const PORT = config.dashboard.port;

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * 데이터 파일 로드 헬퍼
 */
function loadData(filePath) {
  const fullPath = path.resolve(__dirname, filePath);
  try {
    if (fs.existsSync(fullPath)) {
      return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    }
  } catch (error) {
    console.error(`데이터 로드 오류 (${filePath}):`, error.message);
  }
  return null;
}

// API 엔드포인트들

/**
 * 대시보드 요약 정보
 */
app.get('/api/summary', async (req, res) => {
  try {
    const portfolio = loadData(config.dataPath.portfolio) || { holdings: [] };
    const trades = loadData(config.dataPath.trades) || [];
    const dailyReturns = loadData(config.dataPath.dailyReturns) || [];

    // 최근 수익률 계산
    const recentReturns = dailyReturns.slice(-30);
    const latestReturn = recentReturns[recentReturns.length - 1] || {};

    // 오늘 매매 건수
    const today = new Date().toISOString().slice(0, 10);
    const todayTrades = trades.filter(t => t.timestamp?.startsWith(today));

    res.json({
      portfolio: {
        holdingsCount: portfolio.holdings?.length || 0,
        totalDeposit: portfolio.summary?.totalDeposit || 0,
        totalEvaluation: portfolio.summary?.totalEvaluation || 0,
        totalProfit: portfolio.summary?.totalProfit || 0,
        lastUpdated: portfolio.lastUpdated,
      },
      trading: {
        totalTrades: trades.length,
        todayTrades: todayTrades.length,
        todayBuys: todayTrades.filter(t => t.type === 'BUY').length,
        todaySells: todayTrades.filter(t => t.type === 'SELL').length,
      },
      config: {
        useMock: config.kis.useMock,
        buyAmount: config.trading.buyAmount,
        maxHoldings: config.trading.maxHoldings,
        watchListCount: config.watchList.length,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 보유 종목 목록
 */
app.get('/api/holdings', async (req, res) => {
  try {
    // 실시간 잔고 조회
    const balance = await kisApi.getBalance();
    res.json(balance);
  } catch (error) {
    // API 오류 시 로컬 데이터 반환
    const portfolio = loadData(config.dataPath.portfolio) || { holdings: [] };
    res.json({
      holdings: portfolio.holdings || [],
      summary: portfolio.summary || {},
      fromCache: true,
    });
  }
});

/**
 * 매매 기록
 */
app.get('/api/trades', (req, res) => {
  const trades = loadData(config.dataPath.trades) || [];
  const limit = parseInt(req.query.limit) || 50;

  // 최근 순으로 정렬
  const sorted = [...trades].reverse().slice(0, limit);

  res.json({
    trades: sorted,
    total: trades.length,
  });
});

/**
 * 일별 수익률 데이터
 */
app.get('/api/returns', (req, res) => {
  const returns = loadData(config.dataPath.dailyReturns) || [];
  const days = parseInt(req.query.days) || 30;

  const recent = returns.slice(-days);

  res.json({
    returns: recent,
    total: returns.length,
  });
});

/**
 * 감시 종목 목록
 */
app.get('/api/watchlist', (req, res) => {
  res.json({
    watchList: config.watchList,
    total: config.watchList.length,
  });
});

/**
 * 시스템 상태
 */
app.get('/api/status', (req, res) => {
  const stockFetcher = require('./stock-fetcher');

  res.json({
    serverTime: new Date().toISOString(),
    marketOpen: stockFetcher.isMarketOpen(),
    environment: config.kis.useMock ? 'mock' : 'live',
    apiConnected: !!config.kis.appKey,
  });
});

/**
 * 수동 매매 실행 트리거
 */
app.post('/api/trigger-trade', async (req, res) => {
  try {
    const tradeExecutor = require('./trade-executor');

    console.log('[Dashboard] 수동 매매 트리거 실행');
    const result = await tradeExecutor.checkAndTrade();

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 포트폴리오 동기화
 */
app.post('/api/sync', async (req, res) => {
  try {
    const tradeExecutor = require('./trade-executor');

    console.log('[Dashboard] 포트폴리오 동기화');
    const portfolio = await tradeExecutor.syncPortfolio();

    res.json({
      success: true,
      portfolio,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log('========================================');
  console.log('       자동매매 대시보드');
  console.log('========================================');
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`환경: ${config.kis.useMock ? '모의투자' : '실전투자'}`);
  console.log('========================================\n');
});
