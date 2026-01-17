/**
 * 긴급 매도 스크립트
 * 모든 보유 종목을 시장가로 즉시 매도
 *
 * 사용법:
 *   node emergency-sell.js          # 대화형 확인
 *   node emergency-sell.js --force  # 확인 없이 즉시 실행
 */

const readline = require('readline');
const tradeExecutor = require('./trade-executor');
const kisApi = require('./kis-api');
const config = require('./config');

async function main() {
  console.log('========================================');
  console.log('       긴급 매도 시스템');
  console.log('========================================');
  console.log(`실행 시간: ${new Date().toLocaleString('ko-KR')}`);
  console.log(`환경: ${config.kis.useMock ? '모의투자' : '실전투자'}`);
  console.log('----------------------------------------\n');

  // 환경변수 체크
  if (!config.kis.appKey || !config.kis.appSecret || !config.kis.account) {
    console.error('[오류] 필수 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  try {
    // 현재 잔고 조회
    console.log('[1단계] 현재 보유 종목 조회...\n');
    const balance = await kisApi.getBalance();

    if (balance.holdings.length === 0) {
      console.log('보유 종목이 없습니다.');
      console.log('\n========================================');
      process.exit(0);
    }

    // 보유 종목 표시
    console.log('보유 종목:');
    console.log('----------------------------------------');
    let totalValue = 0;
    let totalProfit = 0;

    for (const holding of balance.holdings) {
      const value = holding.currentPrice * holding.quantity;
      totalValue += value;
      totalProfit += holding.profit;
      console.log(`  ${holding.name} (${holding.code})`);
      console.log(`    수량: ${holding.quantity}주`);
      console.log(`    평균단가: ${holding.avgPrice.toLocaleString()}원`);
      console.log(`    현재가: ${holding.currentPrice.toLocaleString()}원`);
      console.log(`    평가손익: ${holding.profit.toLocaleString()}원 (${holding.profitRate}%)`);
      console.log('');
    }

    console.log('----------------------------------------');
    console.log(`총 평가금액: ${totalValue.toLocaleString()}원`);
    console.log(`총 평가손익: ${totalProfit.toLocaleString()}원`);
    console.log('----------------------------------------\n');

    // --force 옵션 체크
    const forceMode = process.argv.includes('--force');

    if (!forceMode) {
      // 사용자 확인
      const confirmed = await askConfirmation(
        `위 ${balance.holdings.length}개 종목을 모두 시장가로 매도하시겠습니까? (yes/no): `
      );

      if (!confirmed) {
        console.log('\n취소되었습니다.');
        process.exit(0);
      }
    }

    // 긴급 매도 실행
    console.log('\n[2단계] 긴급 매도 실행...\n');
    const result = await tradeExecutor.sellAll();

    // 결과 출력
    console.log('\n----------------------------------------');
    console.log('매도 결과:');

    for (const item of result.sold) {
      if (item.result) {
        console.log(`  [성공] ${item.name}: ${item.result.quantity}주 @ ${item.result.price?.toLocaleString()}원`);
      } else {
        console.log(`  [실패] ${item.name}: ${item.error}`);
      }
    }

    console.log('\n========================================');
    console.log('       긴급 매도 완료');
    console.log('========================================');

    process.exit(0);

  } catch (error) {
    console.error('\n[오류 발생]');
    console.error(error.message);
    process.exit(1);
  }
}

/**
 * 사용자 확인 받기
 */
function askConfirmation(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

// Cloudflare Worker 또는 외부에서 HTTP로 호출할 경우
// Express 서버로 실행하는 옵션
if (process.argv.includes('--server')) {
  const express = require('express');
  const app = express();
  const PORT = process.env.EMERGENCY_PORT || 3002;

  // 간단한 인증 (토큰 기반)
  const AUTH_TOKEN = process.env.EMERGENCY_TOKEN || 'change-this-token';

  app.post('/emergency-sell', async (req, res) => {
    const token = req.headers['x-auth-token'];

    if (token !== AUTH_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const result = await tradeExecutor.sellAll();
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`긴급 매도 서버 시작: http://localhost:${PORT}`);
    console.log('POST /emergency-sell (X-Auth-Token 헤더 필요)');
  });

} else {
  main();
}
