/**
 * 로컬 개발/테스트용 스케줄러
 * node-cron을 사용하여 매시간 자동매매 실행
 */

const cron = require('node-cron');
const tradeExecutor = require('./trade-executor');
const stockFetcher = require('./stock-fetcher');
const config = require('./config');

console.log('========================================');
console.log('       자동매매 스케줄러 (로컬)');
console.log('========================================');
console.log(`시작 시간: ${new Date().toLocaleString('ko-KR')}`);
console.log(`환경: ${config.kis.useMock ? '모의투자' : '실전투자'}`);
console.log('----------------------------------------');
console.log('스케줄: 평일 9시~15시, 매시간 정각');
console.log('----------------------------------------\n');

// 환경변수 체크
if (!config.kis.appKey || !config.kis.appSecret || !config.kis.account) {
  console.error('[오류] 필수 환경변수가 설정되지 않았습니다.');
  console.error('.env 파일을 확인해주세요.');
  process.exit(1);
}

/**
 * 매매 작업 실행
 */
async function runTradingJob() {
  console.log(`\n[스케줄러] 매매 작업 시작 - ${new Date().toLocaleString('ko-KR')}`);

  try {
    // 장 운영 시간 체크 (모의투자는 항상 실행)
    if (!config.kis.useMock && !stockFetcher.isMarketOpen()) {
      console.log('[스케줄러] 장 운영 시간이 아닙니다. 건너뜀.');
      return;
    }

    // 포트폴리오 동기화 및 매매 실행
    await tradeExecutor.syncPortfolio();
    const result = await tradeExecutor.checkAndTrade();

    console.log(`[스케줄러] 작업 완료 - 매수: ${result.buys?.length || 0}, 매도: ${result.sells?.length || 0}`);

  } catch (error) {
    console.error('[스케줄러] 오류:', error.message);
  }
}

// 매시간 정각에 실행 (평일만)
// cron: 분 시 일 월 요일
// '0 9-15 * * 1-5' = 평일 9시~15시 매시간 정각
cron.schedule('0 9-15 * * 1-5', runTradingJob, {
  timezone: 'Asia/Seoul'
});

// 15시 30분에도 실행 (장 마감 직전)
cron.schedule('30 15 * * 1-5', runTradingJob, {
  timezone: 'Asia/Seoul'
});

console.log('[스케줄러] 대기 중...');
console.log('Ctrl+C로 종료\n');

// 시작 시 즉시 실행 옵션
if (process.argv.includes('--now')) {
  console.log('[스케줄러] --now 옵션: 즉시 실행');
  runTradingJob();
}

// 프로세스 종료 처리
process.on('SIGINT', () => {
  console.log('\n[스케줄러] 종료됨');
  process.exit(0);
});
