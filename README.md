# auto-trader

Automated stock trading system built on Korea Investment & Securities (KIS) API.

## What it does

- Screens stocks using 17 technical indicators + candle pattern recognition
- Analyzes supply/demand flow and support/resistance levels
- Executes trades with configurable entry/exit rules
- Multi-timeframe analysis for signal confirmation
- Circuit breaker + emergency sell for risk management
- Real-time dashboard (Express)

## Architecture

```
stock-screener ─→ technical-analyzer ─→ trade-executor
                    ├─ indicators (17)      ├─ exit-manager
                    ├─ candle-patterns       ├─ emergency-sell
                    ├─ supply-demand         └─ circuit-breaker
                    ├─ sr-analyzer
                    └─ mtf-analyzer
                         │
                    dashboard-server (port 3001)
```

## Stack

- **Runtime**: Node.js
- **API**: Korea Investment & Securities OpenAPI
- **Indicators**: RSI, MACD, Bollinger, Stochastic, ADX, OBV, MFI, VWAP, etc.
- **Web**: Express (dashboard)
- **Scheduling**: node-cron

## Setup

```bash
cp .env.example .env   # Add KIS API credentials
npm install
npm run trade          # Start trading
npm run dashboard      # Start dashboard on :3001
npm run screening      # Run stock screening only
```

## Security

- All API keys via environment variables
- Log sanitization (no credentials in logs)
- Circuit breaker prevents cascade failures
