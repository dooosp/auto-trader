/**
 * GitHub Actions에서 실행되는 자동매매 스크립트
 * 매시간 실행되어 매매 조건을 체크하고 실행
 */

const tradeExecutor = require('./trade-executor');
const config = require('./config');

async function main() {
  console.log('========================================');
  console.log('       자동매매 시스템 (GitHub Actions)');
  console.log('========================================');
  console.log(`실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`환경: ${config.kis.useMock ? '모의투자' : '실전투자'}`);
  console.log('----------------------------------------\n');

  // 환경변수 체크
  if (!config.kis.appKey || !config.kis.appSecret || !config.kis.account) {
    console.error('[오류] 필수 환경변수가 설정되지 않았습니다.');
    console.error('필요한 환경변수: KIS_APP_KEY, KIS_APP_SECRET, KIS_ACCOUNT');
    process.exit(1);
  }

  try {
    // 1. 포트폴리오 동기화
    console.log('[1단계] 포트폴리오 동기화...');
    await tradeExecutor.syncPortfolio();

    // 2. 자동매매 실행
    console.log('\n[2단계] 매매 조건 체크 및 실행...');
    const result = await tradeExecutor.checkAndTrade();

    // 3. 결과 출력
    console.log('\n----------------------------------------');
    console.log('실행 결과:');

    if (result.executed) {
      console.log(`  - 매수 체결: ${result.buys?.length || 0}건`);
      console.log(`  - 매도 체결: ${result.sells?.length || 0}건`);

      if (result.buys?.length > 0) {
        console.log('\n  [매수 내역]');
        for (const buy of result.buys) {
          console.log(`    ${buy.name}: ${buy.result.quantity}주 @ ${buy.result.price.toLocaleString()}원`);
        }
      }

      if (result.sells?.length > 0) {
        console.log('\n  [매도 내역]');
        for (const sell of result.sells) {
          console.log(`    ${sell.name}: ${sell.result.quantity}주 @ ${sell.result.price.toLocaleString()}원 (${sell.result.profitRate}%)`);
        }
      }
    } else {
      console.log(`  - 실행되지 않음: ${result.reason || result.error}`);
    }

    console.log('\n========================================');
    console.log('       자동매매 완료');
    console.log('========================================');

    // GitHub Actions 출력 (GITHUB_OUTPUT 환경변수가 있을 때만)
    if (process.env.GITHUB_OUTPUT) {
      const fs = require('fs');
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `executed=${result.executed}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `buys=${result.buys?.length || 0}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `sells=${result.sells?.length || 0}\n`);
    }

    process.exit(0);

  } catch (error) {
    console.error('\n[오류 발생]');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
