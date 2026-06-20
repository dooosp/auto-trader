const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const kisApi = require('../kis-api');
const config = require('../config');
const tradeExecutor = require('../trade-executor');

describe('Graham Gate buy blocking', () => {
  let originalAxiosGet;
  let originalBuyStock;
  let originalSaveTrade;
  let originalLoadPortfolio;
  let originalCheckCooldown;

  beforeEach(() => {
    originalAxiosGet = axios.get;
    originalBuyStock = kisApi.buyStock;
    originalSaveTrade = tradeExecutor.saveTrade;
    originalLoadPortfolio = tradeExecutor.loadPortfolio;
    originalCheckCooldown = tradeExecutor.checkCooldown;

    config.grahamGate.enabled = true;
    config.grahamGate.baseUrl = 'http://graham-gate.test';
    config.grahamGate.persistSnapshots = true;
    config.trading.maxHoldings = 10;

    tradeExecutor.loadPortfolio = () => ({ holdings: [] });
    tradeExecutor.checkCooldown = () => ({ allowed: true, reason: '' });
  });

  afterEach(() => {
    axios.get = originalAxiosGet;
    kisApi.buyStock = originalBuyStock;
    tradeExecutor.saveTrade = originalSaveTrade;
    tradeExecutor.loadPortfolio = originalLoadPortfolio;
    tradeExecutor.checkCooldown = originalCheckCooldown;
  });

  it('rejects BUY before KIS order when Graham Gate fails and records valueSnapshot', async () => {
    const savedTrades = [];
    let buyCalled = false;

    axios.get = async () => ({
      data: {
        grahamGate: {
          passed: false,
          reasons: ['margin of safety below threshold'],
          valueSnapshot: {
            schemaVersion: 'valueSnapshot.v1',
            stockCode: '005930',
            decision: 'REJECT',
            reasons: ['margin of safety below threshold'],
          },
        },
      },
    });
    kisApi.buyStock = async () => {
      buyCalled = true;
      return { success: true, orderNo: 'SHOULD_NOT_ORDER' };
    };
    tradeExecutor.saveTrade = (trade) => savedTrades.push(trade);

    const result = await tradeExecutor.executeBuy('005930', 70000);

    assert.strictEqual(result, null);
    assert.strictEqual(buyCalled, false);
    assert.equal(savedTrades.length, 1);
    assert.equal(savedTrades[0].type, 'VALUE_REJECT');
    assert.equal(savedTrades[0].valueSnapshot.schemaVersion, 'valueSnapshot.v1');
    assert.match(savedTrades[0].reason, /margin of safety/);
  });

  it('fails closed when Graham Gate is unavailable', async () => {
    const savedTrades = [];
    let buyCalled = false;

    axios.get = async () => {
      throw new Error('connection refused');
    };
    kisApi.buyStock = async () => {
      buyCalled = true;
      return { success: true, orderNo: 'SHOULD_NOT_ORDER' };
    };
    tradeExecutor.saveTrade = (trade) => savedTrades.push(trade);

    const result = await tradeExecutor.executeBuy('005930', 70000);

    assert.strictEqual(result, null);
    assert.strictEqual(buyCalled, false);
    assert.equal(savedTrades.length, 1);
    assert.equal(savedTrades[0].type, 'VALUE_REJECT');
    assert.equal(savedTrades[0].valueSnapshot.decision, 'REJECT');
    assert.match(savedTrades[0].reason, /Graham Gate unavailable/);
  });
});
