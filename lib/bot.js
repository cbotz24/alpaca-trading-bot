// Core trading bot logic - momentum + volume strategy with broad market scanner
const BASE = 'https://paper-api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';

const PROFIT_TARGET = 0.02;
const STOP_LOSS = 0.01;
const VOLUME_MULTIPLIER = 2.0;
const MA_PERIOD = 9;
const MAX_POSITION_PCT = 0.20;
const MAX_POSITIONS = 4;
const DAILY_LOSS_LIMIT = 0.05;
const MIN_PRICE = 1.00;
const MIN_VOLUME = 300000;
const MAX_CANDIDATES = 40;

// Broad liquid universe for scanning (~400 stocks across all sectors)
const UNIVERSE = [
      'AAL','AACG','ABEV','ACAD','ACHR','ADT','AES','AG','AGNC','AGS',
      'AIOT','AKAM','AL','ALK','ALKT','ALLT','ALNY','ALT','ALVR','AM',
      'AMCX','AMD','AMRN','AMTX','ANET','ANF','ANGI','APA','APLD','APLT',
      'APT','ARCO','AR','ARWR','ASO','ASTS','ATSG','ATUS','AAP','AUPH',
      'AVGO','AVNW','AWH','AXS','AZUL','AZTA','BAC','BB','BBAI','BCRX',
      'BLNK','BMBL','BNGO','BNTX','BORR','BTG','BTU','C','CALT','CALX',
      'CARA','CAVA','CCL','CDNA','CDXS','CEMI','CERE','CHPT','CIFR','CLBT',
      'CLFD','CLNE','CLOV','CLSK','CLF','CMRE','CNSL','COOP','COP','CORZ',
      'COWN','CPE','CPRI','CRDO','CRSR','CSAN','CSIQ','CUBI','CURO','CURV',
      'DAL','DASH','DENN','DFIN','DJT','DKNG','DNN','DOGZ','DOMO','DOOR',
      'DPST','DVN','DXCM','EBON','ECVT','EDR','EFC','EGIO','ELVN','ENER',
      'ENS','EQT','ERIC','ERII','EXK','EXPI','F','FANG','FAT','FBIN',
      'FCNCA','FDUS','FLGT','FLNC','FLNG','FOSL','FREY','FSM','FTAI','FUBO',
      'GATO','GFI','GHC','GILD','GIS','GLBE','GLNG','GME','GMED','GNRC',
      'GOOG','GPMT','GS','GSAT','HA','HAL','HALO','HBAN','HCVI','HERO',
      'HES','HIMS','HL','HLNE','HOOD','HP','HTZ','HUYA','IAC','IEP',
      'IMVT','INFN','INMD','INSG','INTC','IONQ','IQ','IREN','IRON','JACK',
      'JAGX','JBLU','JKS','JOBY','KGC','KLIC','KNTK','KR','KTOS','KW',
      'LAAC','LAZR','LCID','LGND','LL','LLAP','LMND','LNTH','LOOP','LU',
      'LUMN','LUNA','LXP','LYFT','LYRA','MARA','MAXN','MBLY','MBUU','ME',
      'MESA','MFA','MITT','MRO','MRTN','MU','MUX','MVST','NCLH','NET',
      'NGL','NGS','NIO','NLY','NMRA','NOK','NOVA','NRDS','NTR','NVAX',
      'NVTS','NWSA','NYCB','OCGN','ORC','OSCR','PAGS','PARA','PARR','PAYX',
      'PBTS','PCRX','PENN','PFE','PFLT','PGRE','PLBY','PLUG','PLUR','PBF',
      'PRAX','PRGO','PRTS','PSEC','PSFE','PTGX','PVBC','QDEL','QRVO','RCL',
      'RGR','RIDE','RITM','RIVN','RRC','RRGB','RZLT','SAVE','SBSW','SDCL',
      'SHEN','SHLS','SIRI','SKY','SKYW','SLRC','SMCI','SOFI','SOLO','SOUN',
      'SPRC','SSRM','SWN','SWBI','SYNH','T','TBPH','TELL','TPVG','TRX',
      'TSE','TTOO','TWO','UAL','UDMY','UP','USAC','VG','VIRT','VNET',
      'VNOM','VOXR','VSAT','VYX','WBD','WKHS','WOW','WRK','WULF','XOM',
      'XPEV','XTIA','ZETA','ZION','ZM','ZYME','ARLO','ADMA','AMRN','ATSG',
      'DENN','ARCO','KGC','KTOS','MRTN','SWBI','CLNE','BTU','NVAX','AG',
    ];

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

async function getPositions(apiKey, secretKey) {
      const res = await fetch(`${BASE}/v2/positions`, { headers: headers(apiKey, secretKey) });
      return res.json();
}

async function getSnapshots(symbols, apiKey, secretKey) {
      const unique = [...new Set(symbols)];
      const size = 500;
      const result = {};
      for (let i = 0; i < unique.length; i += size) {
              const chunk = unique.slice(i, i + size);
              const url = `${DATA_BASE}/v2/stocks/snapshots?symbols=${chunk.join(',')}&feed=iex`;
              const res = await fetch(url, { headers: headers(apiKey, secretKey) });
              const data = await res.json();
              if (data && typeof data === 'object') Object.assign(result, data);
      }
      return result;
}

async function getBars(symbol, apiKey, secretKey) {
      const end = new Date();
      const start = new Date(end.getTime() - 4 * 60 * 60 * 1000);
      const url = `${DATA_BASE}/v2/stocks/${symbol}/bars?timeframe=1Min&start=${start.toISOString()}&end=${end.toISOString()}&limit=60&feed=iex`;
      const res = await fetch(url, { headers: headers(apiKey, secretKey) });
      const data = await res.json();
      return data.bars || [];
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

async function getTodayBuys(apiKey, secretKey) {
      const today = new Date().toISOString().split('T')[0];
      const url = `${BASE}/v2/orders?status=filled&limit=100&after=${today}T00:00:00Z&direction=desc`;
      const res = await fetch(url, { headers: headers(apiKey, secretKey) });
      const orders = await res.json();
      const todayBuys = new Set();
      if (Array.isArray(orders)) {
              orders.forEach(o => { if (o.side === 'buy') todayBuys.add(o.symbol); });
      }
      return todayBuys;
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
      const day = et.getDay();
      if (day === 0 || day === 6) return false;
      const totalMins = et.getHours() * 60 + et.getMinutes();
      return totalMins >= 570 && totalMins < 960;
}

function isNearClose() {
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const totalMins = et.getHours() * 60 + et.getMinutes();
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
              addLog(`Daily loss limit hit (${(dayPnlPct * 100).toFixed(2)}%). Halting.`, 'danger');
              botState.running = false;
              return;
      }

  const openPositions = await getPositions(apiKey, secretKey);
      const posMap = {};
      if (Array.isArray(openPositions)) {
              openPositions.forEach(p => { posMap[p.symbol] = p; });
      }

  // PDT protection: find positions opened today — skip selling those
  const todayBuys = await getTodayBuys(apiKey, secretKey);

  // Manage existing positions
  for (const [symbol, pos] of Object.entries(posMap)) {
          const pnlPct = parseFloat(pos.unrealized_plpc);
          const openedToday = todayBuys.has(symbol);

        if (isNearClose()) {
                  if (openedToday) {
                              addLog(`${symbol}: opened today — skipping EOD close (PDT protection)`, 'info');
                              continue;
                  }
                  addLog(`Near close — closing ${symbol}`, 'info');
                  const result = await closePosition(symbol, apiKey, secretKey);
                  if (result.success || result.id) {
                              addLog(`Closed ${symbol} at EOD | ID: ${result.id || 'ok'}`, 'success');
                              botState.trades.push({ symbol, qty: parseFloat(pos.qty), side: 'sell', price: parseFloat(pos.current_price), time: new Date().toISOString() });
                  } else {
                              addLog(`Close failed for ${symbol}: ${JSON.stringify(result)}`, 'danger');
                  }
        } else if (pnlPct >= PROFIT_TARGET) {
                  if (openedToday) {
                              addLog(`${symbol} hit profit target but opened today — holding (PDT protection)`, 'info');
                              continue;
                  }
                  addLog(`${symbol} hit profit target (+${(pnlPct * 100).toFixed(2)}%) — selling`, 'success');
                  const result = await closePosition(symbol, apiKey, secretKey);
                  if (result.success || result.id) {
                              addLog(`Closed ${symbol} at profit | ID: ${result.id || 'ok'}`, 'success');
                              botState.trades.push({ symbol, qty: parseFloat(pos.qty), side: 'sell', price: parseFloat(pos.current_price), time: new Date().toISOString() });
                  } else {
                              addLog(`Close failed for ${symbol}: ${JSON.stringify(result)}`, 'danger');
                  }
        } else if (pnlPct <= -STOP_LOSS) {
                  if (openedToday) {
                              addLog(`${symbol} hit stop loss but opened today — holding (PDT protection)`, 'info');
                              continue;
                  }
                  addLog(`${symbol} hit stop loss (${(pnlPct * 100).toFixed(2)}%) — selling`, 'danger');
                  const result = await closePosition(symbol, apiKey, secretKey);
                  if (result.success || result.id) {
                              addLog(`Closed ${symbol} at stop loss | ID: ${result.id || 'ok'}`, 'success');
                              botState.trades.push({ symbol, qty: parseFloat(pos.qty), side: 'sell', price: parseFloat(pos.current_price), time: new Date().toISOString() });
                  } else {
                              addLog(`Close failed for ${symbol}: ${JSON.stringify(result)}`, 'danger');
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

  // --- Broad market scan using bulk snapshots ---
  const maxPrice = equity * MAX_POSITION_PCT; // can afford at least 1 share
  addLog(`Scanning ${UNIVERSE.length} stocks for opportunities...`, 'info');

  const snapshots = await getSnapshots(UNIVERSE, apiKey, secretKey);

  // Filter and rank candidates
  const candidates = Object.entries(snapshots)
        .filter(([sym, snap]) => {
                  if (posMap[sym]) return false; // already holding
                      const price = snap?.latestTrade?.p || snap?.minuteBar?.c || 0;
                  const dailyVol = snap?.dailyBar?.v || 0;
                  return price >= MIN_PRICE && price <= maxPrice && dailyVol >= MIN_VOLUME;
        })
        .map(([sym, snap]) => ({
                  symbol: sym,
                  price: snap?.latestTrade?.p || snap?.minuteBar?.c || 0,
                  dailyVol: snap?.dailyBar?.v || 0,
                  minuteVol: snap?.minuteBar?.v || 0,
        }))
        .sort((a, b) => b.dailyVol - a.dailyVol) // sort by most active
    .slice(0, MAX_CANDIDATES);

  addLog(`Screened down to ${candidates.length} affordable liquid candidates. Checking signals...`, 'info');

  for (const { symbol, price } of candidates) {
          const bars = await getBars(symbol, apiKey, secretKey);
          if (bars.length < MA_PERIOD + 2) continue;

        const ma = calcMA(bars, MA_PERIOD);
          const currentBar = bars[bars.length - 1];
          const currentPrice = currentBar.c;
          const currentVolume = currentBar.v;
          const avgVolume = calcAvgVolume(bars);

        const aboveMA = currentPrice > ma;
          const volumeSpike = avgVolume > 0 && currentVolume >= avgVolume * VOLUME_MULTIPLIER;

        if (aboveMA && volumeSpike) {
                  const qty = Math.floor((equity * MAX_POSITION_PCT) / currentPrice);
                  if (qty < 1) continue;
                  if (cash < qty * currentPrice) {
                              addLog(`${symbol}: signal fired but insufficient cash.`, 'info');
                              continue;
                  }
                  addLog(`BUY signal: ${symbol} @ $${currentPrice.toFixed(2)} — above MA + volume spike (${Math.round(currentVolume / avgVolume * 10) / 10}x avg). Buying ${qty} shares.`, 'success');
                  const order = await placeOrder(symbol, qty, 'buy', apiKey, secretKey);
                  if (order.id) {
                              addLog(`Order placed: ${symbol} x${qty} | ID: ${order.id}`, 'success');
                              botState.trades.push({ symbol, qty, side: 'buy', price: currentPrice, time: new Date().toISOString() });
                  } else {
                              addLog(`Order failed: ${JSON.stringify(order)}`, 'danger');
                  }
                  break; // one new position per cycle
        }
  }

  botState.lastRun = new Date().toISOString();
}
