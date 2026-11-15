// ═══ CONFIG — copy verbatim from app.js ═══
const BYBIT_API = "https://api.bybit.com";
const BIQUOTE_API = "https://biquote.io/api";
const IV_MS = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };
const BYBIT_IV = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };

const CRYPTO_UNIVERSE = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","LINK","AVAX","LTC","BCH","SUI","NEAR","APT","ARB","OP","INJ","TIA","SEI","ATOM","DOT","AAVE","PEPE","WIF","UNI","HYPE","ENA","WLD","ONDO","FET","RENDER","JUP","PYTH","STRK","W","LDO"];
const FOREX_UNIVERSE = ["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD","EURGBP","EURJPY","GBPJPY","EURAUD","EURCAD","AUDJPY","CADJPY","CHFJPY","GBPAUD","GBPCAD","AUDCAD","AUDCHF","NZDJPY"];
const COMMODITY_UNIVERSE = ["XAUUSD","XAGUSD","XPTUSD","XPDUSD","WTIUSD","BRENTUSD","NATGAS","COPPER"];

// ═══ MODES — copy verbatim ═══
const MODES = { /* ... your full MODES object ... */ };

// ═══ INDICATORS — copy verbatim ═══
function ema(vals, n) { /* ... */ }
function emaSeries(vals, n) { /* ... */ }
function wilderLast(vals, n) { /* ... */ }
function wilderSeries(vals, n) { /* ... */ }
function rsi(cs, n = 14) { /* ... */ }
function atr(cs, n = 14) { /* ... */ }
function adx(cs, n = 14) { /* ... */ }
function volRatio(cs) { /* ... */ }
function trendOf(t) { /* ... */ }

// ═══ CANDLE FETCHING — copy verbatim ═══
async function fetchBybitCandles(symbol, interval, lookback = 250) { /* ... */ }
async function fetchBiquoteCandles(symbol, interval, lookback = 250) { /* ... */ }
async function fetchCandles(coin, interval, lookback = 320) {
  if (getAssetClass(coin) === "CRYPTO") return fetchBybitCandles(coin, interval, lookback);
  return fetchBiquoteCandles(coin, interval, lookback);
}
function getAssetClass(sym) {
  if (FOREX_UNIVERSE.includes(sym)) return "FOREX";
  if (COMMODITY_UNIVERSE.includes(sym)) return "COMMODITY";
  return "CRYPTO";
}

// ═══ TF BUILDER + SIGNAL ENGINE — copy verbatim ═══
function tf(candles, livePrice) { /* ... */ }
function computeBullScore(...) { /* ... */ }
function computeBearScore(...) { /* ... */ }
function checkFastTrigger(...) { /* ... */ }
function signalFrom(candlesByTf, livePrice, meta = null) { /* ... your full signal engine ... */ }

// ═══ ORCHESTRATOR — new code ═══
async function runScanForMode(modeName) {
  const mode = MODES[modeName];
  if (!mode) throw new Error(`Unknown mode: ${modeName}`);
  
  // Temporarily override STATE.mode for signalFrom to use
  global.STATE = global.STATE || {};
  global.STATE.mode = modeName;
  global.STATE.news = { sentiment: {} };
  global.STATE.oiHistory = {};
  global.STATE.bookCache = {};
  
  const universe = [
    ...CRYPTO_UNIVERSE.map(c => ({ coin: c, assetClass: "CRYPTO" })),
    ...FOREX_UNIVERSE.map(c => ({ coin: c, assetClass: "FOREX" })),
    ...COMMODITY_UNIVERSE.map(c => ({ coin: c, assetClass: "COMMODITY" })),
  ];
  
  const results = {};
  
  // Process in batches of 5 to avoid rate limits
  for (let i = 0; i < universe.length; i += 5) {
    const batch = universe.slice(i, i + 5);
    await Promise.all(batch.map(async (m) => {
      try {
        const candles = {};
        await Promise.all(["5m", "15m", "1h", "4h", "1d"].map(async (iv) => {
          try { candles[iv] = await fetchCandles(m.coin, iv, 250); } catch(e) {}
        }));
        
        const live = candles["5m"]?.[candles["5m"].length - 1]?.c || 0;
        if (!live) return;
        
        const sig = signalFrom(candles, live, m);
        if (sig && sig.signal !== "NEUTRAL") {
          results[m.coin] = { ...sig, coin: m.coin, assetClass: m.assetClass };
        }
      } catch (e) {
        console.error(`  ${m.coin}: ${e.message}`);
      }
    }));
    // Small delay between batches
    await new Promise(r => setTimeout(r, 200));
  }
  
  return {
    coins: results,
    watchlist: Object.keys(results),
    lastScan: Date.now(),
    mode: modeName,
  };
}

module.exports = {
  MODES,
  runScanForMode,
  fetchCandles,
};
