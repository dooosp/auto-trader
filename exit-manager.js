/**
 * 청산 관리 모듈 (Exit Manager)
 * Phase 4: 분할 매도 + 트레일링 스톱
 *
 * 원칙:
 * - 분할 매도: 목표가 도달 시 일부만 매도, 나머지는 추가 수익 추구
 * - 트레일링 스톱: 수익 구간에서 손절선을 따라 올림
 */

const config = require('./config');

const exitManager = {
  /**
   * 분할 매도 계획 생성
   * @param {Object} holding - 보유 종목 정보
   * @param {number} currentPrice - 현재가
   */
  createPartialSellPlan(holding, currentPrice) {
    const avgPrice = holding.avgPrice;
    const totalQuantity = holding.quantity;
    const profitRate = (currentPrice - avgPrice) / avgPrice;

    const exitConfig = config.exit || {};
    const partialSellLevels = exitConfig.partialSellLevels || [
      { profitRate: 0.05, sellRatio: 0.3 },   // +5%에서 30% 매도
      { profitRate: 0.10, sellRatio: 0.3 },   // +10%에서 30% 매도
      { profitRate: 0.15, sellRatio: 0.4 },   // +15%에서 나머지 40% 매도
    ];

    // 이미 실현된 분할 매도 기록
    const soldLevels = holding.partialSells || [];

    const plan = {
      holding,
      currentPrice,
      profitRate: Math.round(profitRate * 10000) / 100,  // %
      levels: [],
      nextSell: null,
    };

    let remainingRatio = 1;
    for (const level of partialSellLevels) {
      const levelId = `L${Math.round(level.profitRate * 100)}`;
      const alreadySold = soldLevels.includes(levelId);

      if (!alreadySold) {
        remainingRatio -= level.sellRatio;
      }

      const targetPrice = Math.round(avgPrice * (1 + level.profitRate));
      const quantity = Math.floor(totalQuantity * level.sellRatio);

      plan.levels.push({
        id: levelId,
        profitRate: level.profitRate * 100,
        targetPrice,
        sellRatio: level.sellRatio,
        quantity,
        triggered: profitRate >= level.profitRate,
        alreadySold,
      });

      // 아직 매도 안 했고 조건 충족된 첫 번째 레벨
      if (!alreadySold && profitRate >= level.profitRate && !plan.nextSell) {
        plan.nextSell = {
          levelId,
          quantity: Math.max(1, quantity),  // 최소 1주
          targetPrice,
          profitRate: level.profitRate * 100,
          reason: `분할 매도 ${levelId} (+${level.profitRate * 100}% 도달)`,
        };
      }
    }

    return plan;
  },

  /**
   * 트레일링 스톱 계산
   * @param {Object} holding - 보유 종목 정보
   * @param {number} currentPrice - 현재가
   * @param {Array} priceHistory - 보유 기간 중 가격 이력 (옵션)
   */
  calculateTrailingStop(holding, currentPrice, priceHistory = []) {
    const avgPrice = holding.avgPrice;
    const profitRate = (currentPrice - avgPrice) / avgPrice;

    const exitConfig = config.exit || {};
    const trailingConfig = exitConfig.trailingStop || {
      activationProfit: 0.05,   // 트레일링 활성화 수익률 (+5%)
      trailingPercent: 0.03,    // 고점 대비 하락 허용 % (3%)
      minProfit: 0.02,          // 최소 보존 수익률 (+2%)
    };

    // 보유 기간 중 최고가 (기록이 없으면 현재가 사용)
    const highestPrice = holding.highestPrice || Math.max(currentPrice, avgPrice);
    const newHighest = Math.max(highestPrice, currentPrice);

    // 트레일링 스톱 가격
    const trailingStopPrice = Math.round(newHighest * (1 - trailingConfig.trailingPercent));

    // 최소 보존 가격 (손실 방지)
    const minProfitPrice = Math.round(avgPrice * (1 + trailingConfig.minProfit));

    // 최종 스톱 가격 (둘 중 높은 것)
    const effectiveStopPrice = Math.max(trailingStopPrice, minProfitPrice);

    // 트레일링 스톱 활성화 여부
    const isActive = profitRate >= trailingConfig.activationProfit;

    // 트리거 여부 (현재가가 스톱 가격 이하)
    const isTriggered = isActive && currentPrice <= effectiveStopPrice;

    return {
      isActive,
      isTriggered,
      currentPrice,
      avgPrice,
      profitRate: Math.round(profitRate * 10000) / 100,
      highestPrice: newHighest,
      trailingStopPrice,
      minProfitPrice,
      effectiveStopPrice,
      config: trailingConfig,
      reason: isTriggered
        ? `트레일링 스톱 (고점 ${newHighest.toLocaleString()}원 대비 ${trailingConfig.trailingPercent * 100}% 하락)`
        : null,
    };
  },

  /**
   * 청산 신호 종합 판단
   * @param {Object} holding - 보유 종목 정보
   * @param {number} currentPrice - 현재가
   */
  checkExitSignal(holding, currentPrice) {
    const partialPlan = this.createPartialSellPlan(holding, currentPrice);
    const trailingStop = this.calculateTrailingStop(holding, currentPrice);

    let action = 'HOLD';
    let quantity = 0;
    let reason = '';
    let priority = 99;
    let exitType = null;

    // 1. 트레일링 스톱 트리거 (전량 매도)
    if (trailingStop.isTriggered) {
      action = 'SELL';
      quantity = holding.quantity;
      reason = trailingStop.reason;
      priority = 1;
      exitType = 'TRAILING_STOP';
    }
    // 2. 분할 매도 트리거
    else if (partialPlan.nextSell) {
      action = 'PARTIAL_SELL';
      quantity = partialPlan.nextSell.quantity;
      reason = partialPlan.nextSell.reason;
      priority = 2;
      exitType = 'PARTIAL_SELL';
    }

    return {
      action,
      exitType,
      quantity,
      reason,
      priority,
      partialPlan,
      trailingStop,
      // 업데이트할 보유 정보 (highestPrice 갱신용)
      updatedHolding: {
        ...holding,
        highestPrice: trailingStop.highestPrice,
      },
    };
  },

  /**
   * 분할 매도 완료 기록
   * @param {Object} holding - 보유 종목
   * @param {string} levelId - 완료된 레벨 ID
   */
  recordPartialSell(holding, levelId) {
    if (!holding.partialSells) {
      holding.partialSells = [];
    }
    if (!holding.partialSells.includes(levelId)) {
      holding.partialSells.push(levelId);
    }
    return holding;
  },

  /**
   * 청산 전략 요약 출력
   * @param {Object} exitSignal - checkExitSignal 결과
   */
  getSummary(exitSignal) {
    const { partialPlan, trailingStop } = exitSignal;

    let summary = `현재 수익률: ${partialPlan.profitRate}%\n`;

    // 분할 매도 상태
    summary += '분할 매도:\n';
    for (const level of partialPlan.levels) {
      const status = level.alreadySold ? '완료' : level.triggered ? '대기' : '미도달';
      summary += `  - ${level.id}: +${level.profitRate}% (${level.quantity}주) [${status}]\n`;
    }

    // 트레일링 스톱 상태
    const tsStatus = trailingStop.isActive
      ? `활성 (스톱: ${trailingStop.effectiveStopPrice.toLocaleString()}원)`
      : `비활성 (+${trailingStop.config.activationProfit * 100}% 이상 필요)`;
    summary += `트레일링 스톱: ${tsStatus}\n`;

    if (exitSignal.action !== 'HOLD') {
      summary += `\n>>> ${exitSignal.reason} - ${exitSignal.quantity}주 매도`;
    }

    return summary;
  },
};

module.exports = exitManager;
