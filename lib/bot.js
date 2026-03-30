// Core trading bot logic - momentum + volume strategy
const BASE = 'https://paper-api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';

// Sector-diversified watchlist — affordable stocks suited for a small account
const WATCHLIST = [
    // Energy
    'SWN', 'CLNE', 'BTU',
    // Pharma / Biotech
    'NVAX', 'ADMA', 'AMRN',
    // Minerals / Mining
    'KGC', 'HL', 'AG',
    // Defense
    'KTOS', 'SWBI',
    // Logistics
    'MRTN', 'ATSG',
    // Food & Farm
    'DENN', 'ARCO',
    // Tech
    'SOUN', 'IONQ', 'ARLO', 'CRSR',
  ];

const PROFIT_TARGET = 0.02;
const STOP_LOSS = 0.01;
const VOLUME_MULTIPLIER = 1.5;
const MA_PERIOD = 9;
const MAX_POSITION_PCT = 0.20;
const MAX_POSITIONS = 4;
const DAILY_LOSS_LIMIT = 0.05;

export const botState = {
    running: false,
    log: [],
    positions: {},
    trades: [],
    startEquity: null,
    lastRun: null,
};

function headers(apiKey, secretKey) {
    return {
          'APCA-API-KEY-ID': apiKey,
          'APCA-API-SECRET-KEY': secretKey,
          'Content-Type': 'application/json',
    };
}

async function getAccount(apiKey, secretKey) {
    const res = await fetch(`${BASE}/v2/account`, { headers: headers(apiKey, secretKey) });
    return res.json();
}

async function getBars(symbol, apiKey, secretKey) {
    const end = new Date();
    const start = new Date(end.getTime() - 4 * 60 * 60 * 1000);
    const url = `${DATA_BASE}/v2/stocks/${symbol}/bars?timeframe=1Min&start=${start.toISOString()}&end=${end.toISOString()}&limit=60&feed=iex`;
    const res = await fetch(url, { headers: headers(apiKey, secretKey) });
    const data = await res.json();
    return data.bars || [];
}

async function getPositions(apiKey, secretKey) {
    const res = await fetch(`${BASE}/v2/positions`, { headers: headers(apiKey, secretKey) });
    return res.json();
}

async function placeOrder(symbol, qty, side, apiKey, secretKey) {
    const body = { symbol, qty: qty.toString(), side, type: 'market', time_in_force: 'day' };
    const res = await fetch(`${BASE}/v2/orders`, {
          method: 'POST',
          headers: headers(apiKey, secretKey),
          body: JSON.stringify(body),
    });
    return res.json();
}

async function closePosition(symbol, apiKey, secretKey) {
    const res = await fetch(`${BASE}/v2/positions/${symbol}`, {
          method: 'DELETE',
          headers: headers(apiKey, secretKey),
    });
    if (res.status === 204) return { success: true };
    return res.json();
}

function calcMA(bars, period) {
    if (bars.length < period) return null;
    const slice = bars.slice(-period);
    return slice.reduce((sum, b) => sum + b.c, 0) / period;
}

function calcAvgVolume(bars) {
    if (bars.length < 2) return 0;
    const slice = bars.slice(0, -1);
    return slice.reduce((sum, b) => sum + b.v, 0) / slice.length;
}

function isMarketOpen() {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = et.getHours();
    const minutes = et.getMinutes();
    const day = et.getDay();
    if (day === 0 || day === 6) return false;
    const totalMins = hours * 60 + minutes;
    return totalMins >= 570 && totalMins < 960;
}

function isNearClose() {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = et.getHours();
    const minutes = et.getMinutes();
    const totalMins = hours * 60 + minutes;
    return totalMins >= 945;
}

export async function runBotCycle(apiKey, secretKey, addLog) {
    if (!isMarketOpen()) {
          addLog('Market is closed. Bot is standing by.', 'info');
          return;
    }

  const account = await getAccount(apiKey, secretKey);
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);

  if (!botState.startEquity) botState.startEquity = equity;

  const dayPnlPct = (equity - botState.startEquity) / botState.startEquity;
    if (dayPnlPct <= -DAILY_LOSS_LIMIT) {
          addLog(`Daily loss limit hit (${(dayPnlPct*100).toFixed(2)}%). Halting all trading.`, 'danger');
          botState.running = false;
          return;
    }

  const openPositions = await getPositions(apiKey, secretKey);
    const posMap = {};
    if (Array.isArray(openPositions)) {
          openPositions.forEach(p => { posMap[p.symbol] = p; });
    }

  for (const [symbol, pos] of Object.entries(posMap)) {
        const pnlPct = parseFloat(pos.unrealized_plpc);
        if (isNearClose()) {
                addLog(`Near close — closing ${symbol} (end of day rule)`, 'info');
                const eodResult = await closePosition(symbol, apiKey, secretKey);
                if (eodResult.success || eodResult.id) {
                          addLog(`Closed ${symbol} at end of day | ID: ${eodResult.id || 'ok'}`, 'success');
                          botState.trades.push({ symbol, qty: parseFloat(pos.qty), side: 'sell', price: parseFloat(pos.current_price), time: new Date().toISOString() });
                } else {
                          addLog(`Close failed for ${symbol}: ${JSON.stringify(eodResult)}`, 'danger');
                }
        } else if (pnlPct >= PROFIT_TARGET) {
                addLog(`${symbol} hit profit target (+${(pnlPct*100).toFixed(2)}%) — selling`, 'success');
                const profitResult = await closePosition(symbol, apiKey, secretKey);
                if (profitResult.success || profitResult.id) {
                          addLog(`Closed ${symbol} at profit target | ID: ${profitResult.id || 'ok'}`, 'success');
                          botState.trades.push({ symbol, qty: parseFloat(pos.qty), side: 'sell', price: parseFloat(pos.current_price), time: new Date().toISOString() });
                } else {
                          addLog(`Close failed for ${symbol}: ${JSON.stringify(profitResult)}`, 'danger');
                }
        } else if (pnlPct <= -STOP_LOSS) {
                addLog(`${symbol} hit stop loss (${(pnlPct*100).toFixed(2)}%) — selling`, 'danger');
                const stopResult = await closePosition(symbol, apiKey, secretKey);
                if (stopResult.success || stopResult.id) {
                          addLog(`Closed ${symbol} at stop loss | ID: ${stopResult.id || 'ok'}`, 'success');
                          botState.trades.push({ symbol, qty: parseFloat(pos.qty), side: 'sell', price: parseFloat(pos.current_price), time: new Date().toISOString() });
                } else {
                          addLog(`Close failed for ${symbol}: ${JSON.stringify(stopResult)}`, 'danger');
                }
        }
  }

  if (isNearClose()) {
        addLog('Near market close. No new entries.', 'info');
        return;
  }

  const positionCount = Object.keys(posMap).length;
    if (positionCount >= MAX_POSITIONS) {
          addLog(`At max positions (${positionCount}/${MAX_POSITIONS}). Watching for exits.`, 'info');
          return;
    }

  for (const symbol of WATCHLIST) {
        if (posMap[symbol]) continue;

      const bars = await getBars(symbol, apiKey, secretKey);
        if (bars.length < MA_PERIOD + 2) {
                addLog(`Not enough data for ${symbol}, skipping.`, 'info');
                continue;
        }

      const ma = calcMA(bars, MA_PERIOD);
        const currentBar = bars[bars.length - 1];
        const currentPrice = currentBar.c;
        const currentVolume = currentBar.v;
        const avgVolume = calcAvgVolume(bars);

      const aboveMA = currentPrice > ma;
        const volumeSpike = avgVolume > 0 && currentVolume >= avgVolume * VOLUME_MULTIPLIER;

      addLog(`${symbol}: price $${currentPrice.toFixed(2)}, MA $${ma.toFixed(2)}, vol ${currentVolume} vs avg ${Math.round(avgVolume)}`, 'info');

      if (aboveMA && volumeSpike) {
              const maxDollar = equity * MAX_POSITION_PCT;
              const qty = Math.floor(maxDollar / currentPrice);

          if (qty < 1) {
                    addLog(`${symbol}: signal fired but not enough cash for 1 share.`, 'info');
                    continue;
          }

          if (cash < qty * currentPrice) {
                    addLog(`${symbol}: signal fired but insufficient cash.`, 'info');
                    continue;
          }

          addLog(`BUY signal: ${symbol} — above MA + volume spike. Buying ${qty} shares at ~$${currentPrice.toFixed(2)}`, 'success');
              const order = await placeOrder(symbol, qty, 'buy', apiKey, secretKey);
              if (order.id) {
                        addLog(`Order placed: ${symbol} x${qty} | ID: ${order.id}`, 'success');
                        botState.trades.push({ symbol, qty, side: 'buy', price: currentPrice, time: new Date().toISOString() });
              } else {
                        addLog(`Order failed: ${JSON.stringify(order)}`, 'danger');
              }

          break;
      }
  }

  botState.lastRun = new Date().toISOString();
}
