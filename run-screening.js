#!/usr/bin/env node
/**
 * 스크리닝 실행 스크립트
 * 매일 장 시작 전 08:30에 실행하여 watchList 갱신
 */

const stockScreener = require('./stock-screener');
const kisApi = require('./kis-api');

async function main() {
  console.log('========================================');
  console.log('     자동 스크리닝 시작');
  console.log('========================================');
  console.log(`실행 시간: ${new Date().toLocaleString('ko-KR')}`);
  console.log('');

  try {
    // 1. KIS API 인증 토큰 획득
    console.log('[Init] KIS API 토큰 획득 중...');
    await kisApi.getAccessToken();
    console.log('[Init] 토큰 획득 완료\n');

    // 2. 스크리닝 실행
    const result = await stockScreener.run();

    // 3. 결과 출력
    console.log('\n========================================');
    console.log('       스크리닝 결과');
    console.log('========================================');
    console.log(`최종 watchList: ${result.watchList.length}개`);
    console.log('');

    if (result.added.length > 0) {
      console.log('✅ 새로 추가된 종목:');
      result.added.forEach(s => console.log(`   - ${s.name} (${s.code})`));
      console.log('');
    }

    if (result.removed.length > 0) {
      console.log('❌ 제외된 종목:');
      result.removed.forEach(s => console.log(`   - ${s.name} (${s.code})`));
      console.log('');
    }

    console.log('현재 watchList:');
    result.watchList.forEach((s, i) => {
      console.log(`   ${String(i + 1).padStart(2)}. ${s.name} (${s.code})`);
    });

    console.log('\n========================================');
    console.log('     스크리닝 완료');
    console.log('========================================');

    process.exit(0);
  } catch (error) {
    console.error('\n[Error] 스크리닝 실패:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
