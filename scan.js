const { writeGlobalSignals, getOfflineUsers, getUserTrades, updateTrade, createTrade } = require("./firebase");
const { runScanForMode, MODES } = require("./signals");

const MODE_LIST = ["LOOSE", "MEDIUM", "STRICT"];

// ═══ AUTOTRADE — paper trade logic for offline users ═══
function computeLeverage(mode, entry, stop) {
  const stopPct = Math.abs(entry - stop) / entry * 100;
  let base = mode.defaultLeverage || 8;
  if (stopPct > 4) base *= 0.75;
  const safeMax = stopPct > 0.001 ? 0.9 / (2 * (stopPct / 100)) : 20;
  return Math.max(3, Math.min(Math.round(Math.min(base, safeMax, 20)), 20));
}

async function runAutotradeForUser(user, signals) {
  const trades = await getUserTrades(user.uid);
  const openTrades = trades.filter(t => !t.closed_at);
  const openCoins = new Set(openTrades.map(t => t.coin));
  const mode = MODES[user.mode] || MODES.MEDIUM;
  
  // 1. Check exits on open trades
  for (const t of openTrades) {
    const sig = signals.coins[t.coin];
    const live = sig?.price;
    if (!live) continue;
    const side = t.side || "LONG";
    
    if ((side === "LONG" && live <= t.stop) || (side === "SHORT" && live >= t.stop)) {
      const pnl = side === "LONG"
        ? (t.stop - t.entry) / t.entry * t.notional_usd
        : (t.entry - t.stop) / t.entry * t.notional_usd;
      await updateTrade(user.uid, t.id, {
        closed_at: Date.now(),
        close_price: t.stop,
        close_reason: "stop",
        total_pnl: pnl + (t.partial_pnl || 0),
      });
      continue;
    }
    if ((side === "LONG" && live >= t.tp2) || (side === "SHORT" && live <= t.tp2)) {
      const pnl = side === "LONG"
        ? (t.tp2 - t.entry) / t.entry * t.notional_usd
        : (t.entry - t.tp2) / t.entry * t.notional_usd;
      await updateTrade(user.uid, t.id, {
        closed_at: Date.now(),
        close_price: t.tp2,
        close_reason: "tp2",
        total_pnl: pnl + (t.partial_pnl || 0),
      });
    }
  }
  
  // 2. Open new trades from signals
  const candidates = Object.values(signals.coins).filter(s =>
    (s.signal === "BUY" || s.signal === "SELL") &&
    (s.confidence === "CERTAIN" || s.confidence === "CONFIDENT")
  );
  
  let opened = 0;
  for (const sig of candidates) {
    if (opened >= 3) break; // cap new trades per cycle
    if (openCoins.has(sig.coin)) continue;
    
    const side = sig.signal === "BUY" ? "LONG" : "SHORT";
    const live = sig.price;
    const stop = sig.stop;
    if (!live || !stop) continue;
    
    const stopDistPct = Math.abs(live - stop) / live * 100;
    if (stopDistPct > (mode.autoMaxStopPct || 6)) continue;
    if (stopDistPct < 0.4) continue;
    
    const lev = computeLeverage(mode, live, stop);
    const margin = user.auto_margin || 50;
    const notional = Math.max(11, margin * lev);
    
    await createTrade(user.uid, {
      id: `cron_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      coin: sig.coin,
      side,
      entry: live,
      stop: stop,
      tp1: sig.tp1,
      tp2: sig.tp2,
      initial_risk: Math.abs(live - stop),
      margin_usd: margin,
      notional_usd: notional,
      leverage: lev,
      original_margin_usd: margin,
      original_notional_usd: notional,
      opened_at: Date.now(),
      closed_at: null,
      breakeven_set: false,
      tp1_hit: false,
      partial_pnl: 0,
      scalp: false,
      auto: true,
      env_at_open: "PAPER",
      mode_at_open: user.mode,
      trigger_tf: sig.trigger_tf || "",
      highest_tf: sig.highest_tf || "",
      confidence_at_open: sig.confidence,
      setup_at_open: sig.setup || "",
    });
    opened++;
    console.log(`  ✅ ${side} ${sig.coin} @ ${live.toFixed(4)} (${sig.confidence})`);
  }
  
  return opened;
}

// ═══ MAIN ═══
async function main() {
  console.log("⏰ Scan started:", new Date().toISOString());
  
  // 1. Compute signals for all 3 modes
  const signalsByMode = {};
  for (const mode of MODE_LIST) {
    try {
      signalsByMode[mode] = await runScanForMode(mode);
      const count = Object.keys(signalsByMode[mode].coins).length;
      console.log(`✅ ${mode}: ${count} signal(s)`);
    } catch (e) {
      console.error(`❌ ${mode} scan failed:`, e.message);
    }
  }
  
  // 2. Write to Firestore (frontend reads these)
  if (Object.keys(signalsByMode).length > 0) {
    await writeGlobalSignals(signalsByMode);
  }
  
  // 3. Process offline users with autotrade
  const offlineUsers = await getOfflineUsers();
  console.log(`📴 Offline users: ${offlineUsers.length}`);
  
  let totalOpened = 0;
  for (const user of offlineUsers) {
    try {
      const signals = signalsByMode[user.mode];
      if (!signals) continue;
      const opened = await runAutotradeForUser(user, signals);
      totalOpened += opened;
      console.log(`  👤 ${user.uid.slice(0,8)}... opened ${opened} trade(s)`);
    } catch (e) {
      console.error(`  ❌ User ${user.uid} failed:`, e.message);
    }
  }
  
  console.log(`✅ Scan complete. Total trades opened for offline users: ${totalOpened}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
