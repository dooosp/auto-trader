const fs = require('fs');
const path = require('path');
const kisApi = require('./kis-api');
const stockFetcher = require('./stock-fetcher');
const technicalAnalyzer = require('./technical-analyzer');
const marketAnalyzer = require('./market-analyzer');
const exitManager = require('./exit-manager');
const config = require('./config');

const tradeExecutor = {
  /**
   * 쿨다운 데이터 파일 경로
   */
  cooldownPath: './data/cooldown.json',

  /**
   * 데이터 파일 로드 (백업 복구 지원)
   */
  loadData(filePath) {
    const fullPath = path.resolve(__dirname, filePath);
    const backupPath = fullPath + '.backup';

    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error(`[Executor] ⚠️ 데이터 파일 손상 (${filePath}):`, error.message);

      // 백업에서 복구 시도
      if (fs.existsSync(backupPath)) {
        try {
          console.log(`[Executor] 백업 파일에서 복구 시도...`);
          const backupContent = fs.readFileSync(backupPath, 'utf8');
          const data = JSON.parse(backupContent);

          // 복구 성공 시 원본 파일 복원
          fs.writeFileSync(fullPath, backupContent, 'utf8');
          console.log(`[Executor] ✅ 백업에서 복구 완료`);
          return data;
        } catch (backupError) {
          console.error(`[Executor] ❌ 백업 복구 실패:`, backupError.message);
        }
      }

      // 손상 파일 보존
      try {
        const corruptedPath = fullPath + '.corrupted.' + Date.now();
        fs.renameSync(fullPath, corruptedPath);
        console.error(`[Executor] 손상된 파일 보존: ${corruptedPath}`);
      } catch (e) {}
    }

    return null;
  },

  /**
   * 데이터 파일 저장 (자동 백업)
   */
  saveData(filePath, data) {
    const fullPath = path.resolve(__dirname, filePath);
    const backupPath = fullPath + '.backup';
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 기존 파일을 백업
    if (fs.existsSync(fullPath)) {
      try {
        fs.copyFileSync(fullPath, backupPath);
      } catch (e) {
        console.warn(`[Executor] 백업 생성 실패:`, e.message);
      }
    }

    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
  },

  /**
   * 쿨다운 데이터 로드
   */
  loadCooldown() {
    return this.loadData(this.cooldownPath) || { soldStocks: {} };
  },

  /**
   * 쿨다운 데이터 저장
   */
  saveCooldown(cooldownData) {
    this.saveData(this.cooldownPath, cooldownData);
  },

  /**
   * 쿨다운 체크 (매도 후 재매수 금지 시간 확인)
   * @param {string} stockCode - 종목코드
   * @returns {Object} { allowed: boolean, reason: string, hoursLeft: number }
   */
  checkCooldown(stockCode) {
    const safety = config.trading.safety;
    if (!safety?.enabled) {
      return { allowed: true, reason: '' };
    }

    const cooldownData = this.loadCooldown();
    const soldInfo = cooldownData.soldStocks[stockCode];

    if (!soldInfo) {
      return { allowed: true, reason: '' };
    }

    const soldTime = new Date(soldInfo.soldAt);
    const now = new Date();
    const hoursPassed = (now - soldTime) / (1000 * 60 * 60);
    const cooldownHours = safety.cooldownHours || 24;

    if (hoursPassed < cooldownHours) {
      const hoursLeft = Math.ceil(cooldownHours - hoursPassed);
      return {
        allowed: false,
        reason: `쿨다운 중 (${hoursLeft}시간 남음)`,
        hoursLeft,
      };
    }

    // 쿨다운 만료 - 기록 삭제
    delete cooldownData.soldStocks[stockCode];
    this.saveCooldown(cooldownData);

    return { allowed: true, reason: '' };
  },

  /**
   * 쿨다운 기록 (매도 시 호출)
   * @param {string} stockCode - 종목코드
   * @param {string} stockName - 종목명
   */
  recordCooldown(stockCode, stockName) {
    const safety = config.trading.safety;
    if (!safety?.enabled) return;

    const cooldownData = this.loadCooldown();
    cooldownData.soldStocks[stockCode] = {
      name: stockName,
      soldAt: new Date().toISOString(),
    };
    this.saveCooldown(cooldownData);
    console.log(`[Executor] 쿨다운 기록: ${stockName} (${safety.cooldownHours}시간 재매수 금지)`);
  },

  /**
   * 최소 보유 시간 체크
   * @param {Object} holding - 보유 종목 정보
   * @returns {Object} { allowed: boolean, reason: string, hoursLeft: number }
   */
  checkMinHoldingTime(holding) {
    const safety = config.trading.safety;
    if (!safety?.enabled || !holding.buyDate) {
      return { allowed: true, reason: '' };
    }

    const buyTime = new Date(holding.buyDate);
    const now = new Date();
    const hoursHeld = (now - buyTime) / (1000 * 60 * 60);
    const minHoldingHours = safety.minHoldingHours || 2;

    if (hoursHeld < minHoldingHours) {
      const hoursLeft = Math.ceil(minHoldingHours - hoursHeld);
      return {
        allowed: false,
        reason: `최소 보유시간 미충족 (${hoursLeft}시간 남음)`,
        hoursLeft,
      };
    }

    return { allowed: true, reason: '' };
  },

  /**
   * 포트폴리오 로드
   */
  loadPortfolio() {
    return this.loadData(config.dataPath.portfolio) || { holdings: [], lastUpdated: null };
  },

  /**
   * 포트폴리오 저장
   */
  savePortfolio(portfolio) {
    portfolio.lastUpdated = new Date().toISOString();
    this.saveData(config.dataPath.portfolio, portfolio);
  },

  /**
   * 매매 기록 로드
   */
  loadTrades() {
    return this.loadData(config.dataPath.trades) || [];
  },

  /**
   * 매매 기록 저장
   */
  saveTrade(trade) {
    const trades = this.loadTrades();
    trades.push({
      ...trade,
      timestamp: new Date().toISOString(),
    });
    this.saveData(config.dataPath.trades, trades);
  },

  /**
   * 일별 수익률 기록
   */
  saveDailyReturn(returnData) {
    const returns = this.loadData(config.dataPath.dailyReturns) || [];
    const today = new Date().toISOString().slice(0, 10);

    // 오늘 데이터가 있으면 업데이트, 없으면 추가
    const existingIndex = returns.findIndex(r => r.date === today);
    if (existingIndex >= 0) {
      returns[existingIndex] = { date: today, ...returnData };
    } else {
      returns.push({ date: today, ...returnData });
    }

    this.saveData(config.dataPath.dailyReturns, returns);
  },

  /**
   * 매수 실행
   * @param {string} stockCode - 종목코드
   * @param {number} currentPrice - 현재가
   */
  async executeBuy(stockCode, currentPrice) {
    const portfolio = this.loadPortfolio();

    // 최대 보유 종목 수 체크
    if (portfolio.holdings.length >= config.trading.maxHoldings) {
      console.log(`[Executor] 최대 보유 종목 수 (${config.trading.maxHoldings}) 도달`);
      return null;
    }

    // 이미 보유 중인지 체크
    if (portfolio.holdings.find(h => h.code === stockCode)) {
      console.log(`[Executor] 이미 보유 중: ${stockCode}`);
      return null;
    }

    // 업종 분산 체크 (같은 업종 최대 N개)
    const maxPerSector = config.trading.safety?.maxPerSector || 2;
    const stockSector = config.sectorMap[stockCode];
    if (stockSector) {
      const sameSectorCount = portfolio.holdings.filter(h => config.sectorMap[h.code] === stockSector).length;
      if (sameSectorCount >= maxPerSector) {
        console.log(`[Executor] 업종 분산 제한: ${stockSector} 업종 이미 ${sameSectorCount}개 보유`);
        return null;
      }
    }

    // 쿨다운 체크 (매도 후 재매수 금지)
    const cooldownCheck = this.checkCooldown(stockCode);
    if (!cooldownCheck.allowed) {
      console.log(`[Executor] 매수 차단: ${stockCode} - ${cooldownCheck.reason}`);
      return null;
    }

    // 매수 수량 계산
    const quantity = Math.floor(config.trading.buyAmount / currentPrice);
    if (quantity < 1) {
      console.log(`[Executor] 매수 금액 부족: ${stockCode} (현재가: ${currentPrice})`);
      return null;
    }

    try {
      // 매수 주문 실행
      const result = await kisApi.buyStock(stockCode, quantity, 0);  // 시장가

      if (result.success) {
        const stockName = stockFetcher.getStockName(stockCode);

        // 포트폴리오 업데이트
        portfolio.holdings.push({
          code: stockCode,
          name: stockName,
          quantity: quantity,
          avgPrice: currentPrice,
          buyDate: new Date().toISOString(),
          orderNo: result.orderNo,
        });
        this.savePortfolio(portfolio);

        // 매매 기록 저장
        this.saveTrade({
          type: 'BUY',
          code: stockCode,
          name: stockName,
          quantity,
          price: currentPrice,
          amount: quantity * currentPrice,
          orderNo: result.orderNo,
        });

        console.log(`[Executor] 매수 완료: ${stockName} ${quantity}주 @ ${currentPrice.toLocaleString()}원`);
        return { success: true, quantity, price: currentPrice };
      }
    } catch (error) {
      console.error(`[Executor] 매수 실패 (${stockCode}):`, error.message);
    }

    return null;
  },

  /**
   * 매도 실행
   * @param {string} stockCode - 종목코드
   * @param {number} quantity - 수량
   * @param {number} currentPrice - 현재가
   * @param {string} reason - 매도 사유
   */
  async executeSell(stockCode, quantity, currentPrice, reason = '') {
    const portfolio = this.loadPortfolio();
    const holding = portfolio.holdings.find(h => h.code === stockCode);

    if (!holding) {
      console.log(`[Executor] 보유하지 않은 종목: ${stockCode}`);
      return null;
    }

    // 최소 보유 시간 체크 (손절은 예외)
    const profitRate = (currentPrice - holding.avgPrice) / holding.avgPrice;
    const isStopLoss = profitRate <= (config.trading.sell.stopLoss || -0.05);

    if (!isStopLoss) {
      // 최소 익절 필터: 수익률이 0~minProfitToSell 사이면 매도 차단 (수수료 고려)
      const minProfitToSell = config.trading.sell.minProfitToSell || 0.03;
      if (profitRate > 0 && profitRate < minProfitToSell) {
        console.log(`[Executor] 매도 차단: ${holding.name} - 최소 익절 미달 (+${(profitRate * 100).toFixed(1)}% < +${minProfitToSell * 100}%)`);
        return null;
      }

      const holdingTimeCheck = this.checkMinHoldingTime(holding);
      if (!holdingTimeCheck.allowed) {
        console.log(`[Executor] 매도 차단: ${holding.name} - ${holdingTimeCheck.reason}`);
        return null;
      }
    }

    try {
      // 매도 주문 실행
      const result = await kisApi.sellStock(stockCode, quantity, 0);  // 시장가

      if (result.success) {
        const profitRateCalc = ((currentPrice - holding.avgPrice) / holding.avgPrice * 100).toFixed(2);
        const profit = (currentPrice - holding.avgPrice) * quantity;

        // 포트폴리오에서 제거
        portfolio.holdings = portfolio.holdings.filter(h => h.code !== stockCode);
        this.savePortfolio(portfolio);

        // 쿨다운 기록 (재매수 금지)
        this.recordCooldown(stockCode, holding.name);

        // 매매 기록 저장
        this.saveTrade({
          type: 'SELL',
          code: stockCode,
          name: holding.name,
          quantity,
          price: currentPrice,
          amount: quantity * currentPrice,
          avgPrice: holding.avgPrice,
          profit,
          profitRate: parseFloat(profitRateCalc),
          reason,
          orderNo: result.orderNo,
        });

        console.log(`[Executor] 매도 완료: ${holding.name} ${quantity}주 @ ${currentPrice.toLocaleString()}원 (수익률: ${profitRateCalc}%)`);
        return { success: true, quantity, price: currentPrice, profitRate: profitRateCalc, profit };
      }
    } catch (error) {
      console.error(`[Executor] 매도 실패 (${stockCode}):`, error.message);
    }

    return null;
  },

  /**
   * 분할 매도 실행 (Phase 4)
   * @param {string} stockCode - 종목코드
   * @param {number} quantity - 매도 수량
   * @param {number} currentPrice - 현재가
   * @param {string} reason - 매도 사유
   * @param {string} levelId - 분할 매도 레벨 ID
   */
  async executePartialSell(stockCode, quantity, currentPrice, reason, levelId) {
    const portfolio = this.loadPortfolio();
    const holdingIndex = portfolio.holdings.findIndex(h => h.code === stockCode);

    if (holdingIndex === -1) {
      console.log(`[Executor] 보유하지 않은 종목: ${stockCode}`);
      return null;
    }

    const holding = portfolio.holdings[holdingIndex];

    // 매도 수량이 보유 수량보다 많으면 조정
    const sellQuantity = Math.min(quantity, holding.quantity);

    try {
      const result = await kisApi.sellStock(stockCode, sellQuantity, 0);

      if (result.success) {
        const profitRate = ((currentPrice - holding.avgPrice) / holding.avgPrice * 100).toFixed(2);
        const profit = (currentPrice - holding.avgPrice) * sellQuantity;

        // 분할 매도 기록
        if (!holding.partialSells) holding.partialSells = [];
        holding.partialSells.push(levelId);

        // 수량 업데이트
        holding.quantity -= sellQuantity;

        // 수량이 0이면 제거, 아니면 업데이트
        if (holding.quantity <= 0) {
          portfolio.holdings.splice(holdingIndex, 1);
        } else {
          portfolio.holdings[holdingIndex] = holding;
        }

        this.savePortfolio(portfolio);

        // 매매 기록 저장
        this.saveTrade({
          type: 'PARTIAL_SELL',
          code: stockCode,
          name: holding.name,
          quantity: sellQuantity,
          price: currentPrice,
          amount: sellQuantity * currentPrice,
          avgPrice: holding.avgPrice,
          profit,
          profitRate: parseFloat(profitRate),
          reason,
          levelId,
          remainingQuantity: holding.quantity,
          orderNo: result.orderNo,
        });

        console.log(`[Executor] 분할 매도 완료: ${holding.name} ${sellQuantity}주 @ ${currentPrice.toLocaleString()}원 (${levelId}, 잔여: ${holding.quantity}주)`);
        return { success: true, quantity: sellQuantity, price: currentPrice, profitRate, profit };
      }
    } catch (error) {
      console.error(`[Executor] 분할 매도 실패 (${stockCode}):`, error.message);
    }

    return null;
  },

  /**
   * 전체 매매 프로세스 실행 (Phase 2: MTF + 커플링, Phase 3: S/R, Phase 4: 분할매도/트레일링)
   */
  async checkAndTrade() {
    console.log('\n=== 자동매매 프로세스 시작 ===');
    console.log(`시간: ${new Date().toLocaleString('ko-KR')}`);
    console.log(`환경: ${config.kis.useMock ? '모의투자' : '실전투자'}`);
    console.log(`Phase 2: MTF=${config.mtf?.enabled ? '활성' : '비활성'}, 커플링=${config.coupling?.enabled ? '활성' : '비활성'}`);
    console.log(`Phase 3: S/R=${config.sr?.enabled ? '활성' : '비활성'}`);
    console.log(`Phase 4: Exit=${config.exit?.enabled ? '활성' : '비활성'}`);

    // 장 운영 시간 체크 (모의투자는 항상 허용)
    if (!config.kis.useMock && !stockFetcher.isMarketOpen()) {
      console.log('[Executor] 장 운영 시간이 아닙니다.');
      return { executed: false, reason: 'Market closed' };
    }

    const results = {
      buys: [],
      sells: [],
      timestamp: new Date().toISOString(),
      marketAnalysis: null,
    };

    try {
      // 1. 현재 포트폴리오 확인 (함수 내 1회만 로드)
      let portfolio = this.loadPortfolio();
      let portfolioModified = false;
      console.log(`\n[포트폴리오] 보유 종목: ${portfolio.holdings.length}개`);

      // Phase 2: 시장 지수 분석
      let marketData = null;
      let sectorData = null;

      if (config.coupling?.enabled) {
        console.log('\n[Phase 2: 시장 분석]');
        marketData = await marketAnalyzer.analyzeMarket();
        results.marketAnalysis = {
          condition: marketData.marketCondition,
          score: marketData.marketScore,
          recommendation: marketData.recommendation.action,
        };

        // 시장이 강한 약세면 매수 건너뛰기 경고
        if (config.coupling?.blockMarketConditions?.includes(marketData.marketCondition)) {
          console.log(`[Executor] 시장 강한 약세 (${marketData.marketCondition}) - 신규 매수 제한`);
        }
      }

      // 2. watchList 데이터 수집 (Phase 2: 주봉 포함)
      const includeWeekly = config.mtf?.enabled;
      const stockDataList = await stockFetcher.fetchWatchList(includeWeekly);

      // Phase 2: 섹터 강도 분석
      if (config.coupling?.enabled) {
        console.log('\n[Phase 2: 섹터 분석]');
        sectorData = marketAnalyzer.analyzeSectorStrength(stockDataList);
        for (const [sector, data] of Object.entries(sectorData)) {
          console.log(`  - ${data.name}: ${data.strength} (${data.avgChangeRate > 0 ? '+' : ''}${data.avgChangeRate}%)`);
        }
      }

      // 3. 뉴스 감정 분석
      console.log('\n[뉴스 분석]');
      const stockCodes = stockDataList.map(s => s.code);
      const newsDataList = await technicalAnalyzer.analyzeNews(stockCodes);

      // 4. 보유 종목 매도 신호 체크
      if (portfolio.holdings.length > 0) {
        console.log('\n[매도 신호 체크]');

        // 보유 종목 데이터도 수집 (watchList에 없을 수 있음)
        for (const holding of portfolio.holdings) {
          if (!stockDataList.find(s => s.code === holding.code)) {
            const data = includeWeekly
              ? await stockFetcher.fetchStockWithWeekly(holding.code)
              : await stockFetcher.fetchStock(holding.code);
            if (data) stockDataList.push(data);
          }
        }

        // Phase 4: 분할 매도 / 트레일링 스톱 체크 (기존 매도 신호보다 먼저)
        if (config.exit?.enabled) {
          console.log('\n[Phase 4: 청산 전략 체크]');

          for (const holding of portfolio.holdings) {
            const stockData = stockDataList.find(s => s.code === holding.code);
            if (!stockData) continue;

            const currentPrice = stockData.current.price;
            const exitSignal = exitManager.checkExitSignal(holding, currentPrice);

            // highestPrice 업데이트 (트레일링 스톱용) - 메모리에서 수정
            if (exitSignal.trailingStop.highestPrice > (holding.highestPrice || 0)) {
              const idx = portfolio.holdings.findIndex(h => h.code === holding.code);
              if (idx !== -1) {
                portfolio.holdings[idx].highestPrice = exitSignal.trailingStop.highestPrice;
                portfolioModified = true;
              }
            }

            if (exitSignal.action === 'PARTIAL_SELL') {
              // 분할 매도
              console.log(`  - ${holding.name}: ${exitSignal.reason}`);
              const result = await this.executePartialSell(
                holding.code,
                exitSignal.quantity,
                currentPrice,
                exitSignal.reason,
                exitSignal.partialPlan.nextSell.levelId
              );
              if (result) {
                results.sells.push({ code: holding.code, name: holding.name, result, type: 'PARTIAL_SELL' });
              }
              await stockFetcher.delay(1000);
            } else if (exitSignal.action === 'SELL' && exitSignal.exitType === 'TRAILING_STOP') {
              // 트레일링 스톱 (전량 매도)
              console.log(`  - ${holding.name}: ${exitSignal.reason}`);
              const result = await this.executeSell(
                holding.code,
                holding.quantity,
                currentPrice,
                exitSignal.reason
              );
              if (result) {
                results.sells.push({ code: holding.code, name: holding.name, result, type: 'TRAILING_STOP' });
              }
              await stockFetcher.delay(1000);
            }
          }
        }

        // 기존 기술적 분석 기반 매도 신호 (메모리에서 직접 사용)
        const sellSignals = technicalAnalyzer.checkSellSignals(
          portfolio.holdings,
          stockDataList,
          newsDataList,
          marketData,
          sectorData
        );

        for (const signal of sellSignals) {
          console.log(`  - ${signal.name}: ${signal.signal.reason}`);
          const result = await this.executeSell(
            signal.code,
            signal.quantity,
            signal.signal.analysis.currentPrice,
            signal.signal.reason
          );
          if (result) {
            results.sells.push({ ...signal, result });
          }
          await stockFetcher.delay(1000);
        }
      }

      // 5. 매수 후보 스캔
      console.log('\n[매수 신호 체크]');

      // Phase 2: 시장 상태에 따른 매수 제한
      let skipBuying = false;

      if (config.coupling?.enabled && marketData) {
        if (config.coupling?.blockMarketConditions?.includes(marketData.marketCondition)) {
          console.log(`  시장 약세 (${marketData.marketCondition}) - 신규 매수 건너뜀`);
          skipBuying = true;
        }
      }

      if (!skipBuying) {
        const buyCandidates = technicalAnalyzer.scanForBuyCandidates(
          stockDataList,
          portfolio.holdings,
          newsDataList,
          marketData,
          sectorData
        );

        if (buyCandidates.length === 0) {
          console.log('  매수 조건 충족 종목 없음');
        } else {
          // 최대 보유 종목 수 및 1회 실행당 최대 매수 제한 적용
          const availableSlots = config.trading.maxHoldings - portfolio.holdings.length;
          const maxBuyPerRun = config.trading.safety?.maxBuyPerRun || 2;
          const maxBuy = Math.min(availableSlots, maxBuyPerRun);
          const candidatesToBuy = buyCandidates.slice(0, maxBuy);
          console.log(`  매수 후보 ${buyCandidates.length}개 중 최대 ${maxBuy}개 매수`);

          for (const candidate of candidatesToBuy) {
            // Phase 2: MTF/커플링 정보 포함 출력
            let extraInfo = '';
            if (candidate.signal.analysis?.mtf) {
              extraInfo += ` [MTF: ${candidate.signal.analysis.mtf.mtfSignal}]`;
            }
            if (candidate.signal.analysis?.coupling) {
              extraInfo += ` [커플링: ${candidate.signal.analysis.coupling.couplingSignal}]`;
            }

            console.log(`  - ${candidate.name}: ${candidate.signal.reason}${extraInfo}`);
            const result = await this.executeBuy(
              candidate.code,
              candidate.signal.analysis.currentPrice
            );
            if (result) {
              results.buys.push({ ...candidate, result });
            }
            await stockFetcher.delay(1000);
          }
        }
      }

      // 6. 포트폴리오 변경사항 저장 (highestPrice 업데이트 등)
      if (portfolioModified) {
        this.savePortfolio(portfolio);
      }

      // 7. 일별 수익률 기록 (executeBuy/executeSell의 변경사항 반영)
      const finalPortfolio = this.loadPortfolio();
      const balance = await kisApi.getBalance();

      this.saveDailyReturn({
        totalDeposit: balance.summary.totalDeposit,
        totalEvaluation: balance.summary.totalEvaluation,
        totalProfit: balance.summary.totalProfit,
        holdingsCount: finalPortfolio.holdings.length,
        buys: results.buys.length,
        sells: results.sells.length,
        marketCondition: marketData?.marketCondition || null,
      });

      console.log('\n=== 프로세스 완료 ===');
      console.log(`매수: ${results.buys.length}건, 매도: ${results.sells.length}건`);
      if (marketData) {
        console.log(`시장 상태: ${marketData.marketCondition}`);
      }

      return {
        executed: true,
        ...results,
      };

    } catch (error) {
      console.error('[Executor] 프로세스 오류:', error.message);
      return {
        executed: false,
        error: error.message,
      };
    }
  },

  /**
   * 전량 매도 (긴급 매도용)
   */
  async sellAll() {
    console.log('\n=== 긴급 전량 매도 ===');

    const portfolio = this.loadPortfolio();

    if (portfolio.holdings.length === 0) {
      console.log('보유 종목이 없습니다.');
      return { success: true, sold: [] };
    }

    const results = [];

    for (const holding of portfolio.holdings) {
      try {
        const price = await kisApi.getStockPrice(holding.code);
        const result = await this.executeSell(
          holding.code,
          holding.quantity,
          price.price,
          '긴급 매도'
        );
        results.push({ code: holding.code, name: holding.name, result });
        await stockFetcher.delay(1000);
      } catch (error) {
        console.error(`[Executor] 긴급 매도 실패 (${holding.code}):`, error.message);
        results.push({ code: holding.code, name: holding.name, error: error.message });
      }
    }

    console.log('=== 긴급 매도 완료 ===');
    return { success: true, sold: results };
  },

  /**
   * 포트폴리오 동기화 (API에서 실제 잔고 가져와서 로컬 데이터 업데이트)
   */
  async syncPortfolio() {
    console.log('[Executor] 포트폴리오 동기화 중...');

    try {
      const balance = await kisApi.getBalance();

      const portfolio = {
        holdings: balance.holdings.map(h => ({
          code: h.code,
          name: h.name,
          quantity: h.quantity,
          avgPrice: h.avgPrice,
          currentPrice: h.currentPrice,
          profit: h.profit,
          profitRate: h.profitRate,
        })),
        summary: balance.summary,
        lastUpdated: new Date().toISOString(),
      };

      this.savePortfolio(portfolio);
      console.log(`[Executor] 동기화 완료: ${portfolio.holdings.length}개 종목`);

      return portfolio;
    } catch (error) {
      console.error('[Executor] 동기화 실패:', error.message);
      throw error;
    }
  }
};

module.exports = tradeExecutor;
