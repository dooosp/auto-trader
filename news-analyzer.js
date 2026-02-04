const axios = require('axios');
const fs = require('fs');
const path = require('path');

// intelligence-loop 센티먼트 파일 경로
const LOOP_SENTIMENT_PATH = path.join(__dirname, 'data', 'news-sentiment.json');
const LOOP_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

/**
 * intelligence-loop 센티먼트 파일에서 종목 데이터 읽기
 * @param {string} stockCode
 * @returns {Object|null} 센티먼트 데이터 또는 null (만료/없음)
 */
function readLoopSentiment(stockCode) {
  try {
    if (!fs.existsSync(LOOP_SENTIMENT_PATH)) return null;

    const raw = JSON.parse(fs.readFileSync(LOOP_SENTIMENT_PATH, 'utf8'));
    const fileAge = Date.now() - new Date(raw.timestamp).getTime();

    if (fileAge > LOOP_TTL_MS) return null; // 만료

    const stockData = raw.stocks && raw.stocks[stockCode];
    if (!stockData) return null;

    return {
      code: stockCode,
      totalScore: stockData.score,
      newsCount: stockData.articleCount || 0,
      sentiment: stockData.sentiment,
      confidence: stockData.confidence || 0,
      details: (stockData.articles || []).map(a => ({
        title: a.title,
        score: a.impact === 'POSITIVE' ? 1 : a.impact === 'NEGATIVE' ? -1 : 0,
        keywords: [],
      })),
      source: 'intelligence-loop',
      cached: false,
    };
  } catch (_e) {
    return null;
  }
}

// 뉴스 캐시 (30분 TTL)
const newsCache = {
  data: {},      // { stockCode: { sentiment, timestamp } }
  ttl: 30 * 60 * 1000,  // 30분

  get(stockCode) {
    const cached = this.data[stockCode];
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.sentiment;
    }
    return null;
  },

  set(stockCode, sentiment) {
    this.data[stockCode] = { sentiment, timestamp: Date.now() };
  },

  clear() {
    this.data = {};
  },

  getStats() {
    const now = Date.now();
    let valid = 0, expired = 0;
    for (const key in this.data) {
      if (now - this.data[key].timestamp < this.ttl) valid++;
      else expired++;
    }
    return { valid, expired, total: valid + expired };
  }
};

const newsAnalyzer = {
  // 긍정 키워드
  positiveKeywords: [
    '급등', '상승', '호재', '실적 개선', '흑자', '성장', '신고가', '돌파',
    '수주', '계약', '매출 증가', '이익 증가', '배당', '자사주', '목표가 상향',
    '투자의견 상향', '매수 추천', '기대', '호실적', '사상 최대', '반등',
    '강세', '매수세', '외국인 매수', '기관 매수', '골든크로스'
  ],

  // 부정 키워드
  negativeKeywords: [
    '급락', '하락', '악재', '실적 악화', '적자', '감소', '신저가', '폭락',
    '손실', '매출 감소', '이익 감소', '무배당', '목표가 하향', '리콜',
    '투자의견 하향', '매도 추천', '우려', '부진', '최악', '약세',
    '매도세', '외국인 매도', '기관 매도', '데드크로스', '공매도'
  ],

  /**
   * 네이버 금융에서 종목 뉴스 가져오기
   * @param {string} stockCode - 종목코드
   * @param {number} count - 가져올 뉴스 수
   */
  async fetchNews(stockCode, count = 5) {
    const url = `https://m.stock.naver.com/api/news/stock/${stockCode}?pageSize=${count}`;

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 5000
      });

      // 응답이 배열 형태 [{items: [...]}, {items: [...]}]
      const data = response.data || [];
      const articles = [];

      for (const group of data) {
        if (group.items && group.items.length > 0) {
          articles.push(...group.items);
        }
      }

      return articles.slice(0, count).map(article => ({
        title: (article.title || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
        source: article.officeName,
        date: article.datetime,
        url: article.linkUrl
      }));
    } catch (error) {
      console.error(`[News] 뉴스 조회 실패 (${stockCode}):`, error.message);
      return [];
    }
  },

  /**
   * 뉴스 제목에서 감정 점수 계산
   * @param {string} title - 뉴스 제목
   */
  analyzeSentiment(title) {
    let score = 0;
    let matchedKeywords = [];

    // 긍정 키워드 체크
    for (const keyword of this.positiveKeywords) {
      if (title.includes(keyword)) {
        score += 1;
        matchedKeywords.push(`+${keyword}`);
      }
    }

    // 부정 키워드 체크
    for (const keyword of this.negativeKeywords) {
      if (title.includes(keyword)) {
        score -= 1;
        matchedKeywords.push(`-${keyword}`);
      }
    }

    return { score, matchedKeywords };
  },

  /**
   * 종목의 뉴스 감정 점수 종합 (캐시 적용)
   * @param {string} stockCode - 종목코드
   */
  async getNewsSentiment(stockCode) {
    // 캐시 확인
    const cached = newsCache.get(stockCode);
    if (cached) {
      return cached;
    }

    // intelligence-loop 센티먼트 우선 읽기
    const loopData = readLoopSentiment(stockCode);
    if (loopData) {
      newsCache.set(stockCode, loopData);
      return loopData;
    }

    // fallback: 기존 키워드 매칭
    const news = await this.fetchNews(stockCode, 5);

    if (news.length === 0) {
      const result = {
        code: stockCode,
        totalScore: 0,
        newsCount: 0,
        sentiment: 'NEUTRAL',
        details: [],
        cached: false
      };
      newsCache.set(stockCode, result);
      return result;
    }

    let totalScore = 0;
    const details = [];

    for (const article of news) {
      const { score, matchedKeywords } = this.analyzeSentiment(article.title);
      totalScore += score;

      details.push({
        title: article.title,
        score,
        keywords: matchedKeywords
      });
    }

    // 감정 판단
    let sentiment = 'NEUTRAL';
    if (totalScore >= 2) sentiment = 'POSITIVE';
    else if (totalScore <= -2) sentiment = 'NEGATIVE';

    const result = {
      code: stockCode,
      totalScore,
      newsCount: news.length,
      sentiment,
      details,
      cached: false
    };

    // 캐시 저장
    newsCache.set(stockCode, result);

    return result;
  },

  /**
   * 뉴스 캐시 통계
   */
  getCacheStats() {
    return newsCache.getStats();
  },

  /**
   * 뉴스 캐시 초기화
   */
  clearCache() {
    newsCache.clear();
  },

  /**
   * 여러 종목의 뉴스 감정 분석
   * @param {Array} stockCodes - 종목코드 배열
   */
  async analyzeMultipleStocks(stockCodes) {
    const results = [];

    for (const code of stockCodes) {
      const sentiment = await this.getNewsSentiment(code);
      results.push(sentiment);
      // API 부하 방지
      await this.delay(300);
    }

    return results;
  },

  /**
   * 지연 함수
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * 테스트 함수
   */
  async test(stockCode = '005930') {
    console.log(`\n=== 뉴스 감정 분석 테스트 (${stockCode}) ===\n`);

    const result = await this.getNewsSentiment(stockCode);

    console.log(`종목: ${stockCode}`);
    console.log(`뉴스 수: ${result.newsCount}개`);
    console.log(`총 점수: ${result.totalScore}`);
    console.log(`감정: ${result.sentiment}\n`);

    console.log('--- 뉴스 상세 ---');
    for (const detail of result.details) {
      console.log(`[${detail.score >= 0 ? '+' : ''}${detail.score}] ${detail.title}`);
      if (detail.keywords.length > 0) {
        console.log(`    키워드: ${detail.keywords.join(', ')}`);
      }
    }

    return result;
  }
};

// 직접 실행 시 테스트
if (require.main === module) {
  newsAnalyzer.test();
}

module.exports = newsAnalyzer;
