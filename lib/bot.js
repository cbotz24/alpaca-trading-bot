// Core trading bot logic - momentum + volume strategy

const BASE = 'https://paper-api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';

const WATCHLIST = ['AAPL','TSLA','NVDA','AMD','SPY','QQQ','AMZN','META','MSFT','GOOGL'];
const PROFIT_TARGET = 0.02;   // 2% profit target
const STOP_LOSS = 0.01;       // 1% stop loss
const VOLUME_MULTIPLIER = 1.5; // volume must be 1.5x average
const MA_PERIOD = 9;           // 9-bar moving average
const MAX_POSITION_PCT = 0.10; // max 10% of portfolio per position
const DAILY_LOSS_LIMIT = 0.05; // halt if down 5% on the day

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
  const start = new Date(end.getTime() - 4 * 60 * 60 * 1000); // last 4 hours
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
  const slice = bars.slice(0, -1); // exclude most recent bar
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
  return totalMins >= 570 && totalMins < 960; // 9:30am - 4:00pm ET
}

function isNearClose() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const totalMins = hours * 60 + minutes;
  return totalMins >= 945; // 3:45pm ET - close all positions
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

  // Check daily loss limit
  const dayPnlPct = (equity - botState.startEquity) / botState.startEquity;
  if (dayPnlPct <= -DAILY_LOSS_LIMIT) {
    addLog(`Daily loss limit hit (${(dayPnlPct*100).toFixed(2)}%). Halting all trading.`, 'danger');
    botState.running = false;
    return;
  }

  // Get current positions
  const openPositions = await getPositions(apiKey, secretKey);
  const posMap = {};
  if (Array.isArray(openPositions)) {
    openPositions.forEach(p => { posMap[p.symbol] = p; });
  }

  // Manage existing positions - check profit target and stop loss
  for (const [symbol, pos] of Object.entries(posMap)) {
    const pnlPct = parseFloat(pos.unrealized_plpc);
    if (isNearClose()) {
      addLog(`Near close — closing ${symbol} (end of day rule)`, 'info');
      await closePosition(symbol, apiKey, secretKey);
      addLog(`Closed ${symbol} at end of day`, 'success');
    } else if (pnlPct >= PROFIT_TARGET) {
      addLog(`${symbol} hit profit target (+${(pnlPct*100).toFixed(2)}%) — selling`, 'success');
      await closePosition(symbol, apiKey, secretKey);
    } else if (pnlPct <= -STOP_LOSS) {
      addLog(`${symbol} hit stop loss (${(pnlPct*100).toFixed(2)}%) — selling`, 'danger');
      await closePosition(symbol, apiKey, secretKey);
    }
  }

  if (isNearClose()) {
    addLog('Near market close. No new entries.', 'info');
    return;
  }

  // Scan watchlist for entries
  const positionCount = Object.keys(posMap).length;
  const maxPositions = 3; // max concurrent positions

  if (positionCount >= maxPositions) {
    addLog(`At max positions (${positionCount}/${maxPositions}). Watching for exits.`, 'info');
    return;
  }

  for (const symbol of WATCHLIST) {
    if (posMap[symbol]) continue; // already holding

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
      // Calculate position size (max 10% of portfolio)
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

      // Only enter one new position per cycle
      break;
    }
  }

  botState.lastRun = new Date().toISOString();
}
