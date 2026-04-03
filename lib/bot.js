// Core trading bot logic - momentum + volume strategy (swing-optimised)
const BASE = 'https://paper-api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';
const PROFIT_TARGET = 0.04;
const STOP_LOSS = 0.01;
const VOLUME_MULTIPLIER = 2.5;
const MA_PERIOD = 9;
const MAX_POSITION_PCT = 0.20;
const MAX_POSITIONS = 4;
const DAILY_LOSS_LIMIT = 0.05;
const MIN_PRICE = 1.00;
const MIN_VOLUME = 300000;
const MAX_CANDIDATES = 40;
const UNIVERSE = ['AAL','AACG','ABEV','ACAD','ACHR','ADT','AES','AG','AGNC','AGS','AIOT','AKAM','AL','ALK','ALKT','ALLT','ALNY','ALT','ALVR','AM','AMCX','AMD','AMRN','AMTX','ANET','ANF','ANGI','APA','APLD','APLT','APT','ARCO','AR','ARWR','ASO','ASTS','ATSG','ATUS','AAP','AUPH','AVGO','AVNW','AWH','AXS','AZUL','AZTA','BAC','BB','BBAI','BCRX','BLNK','BMBL','BNGO','BNTX','BORR','BTG','BTU','C','CALT','CALX','CARA','CAVA','CCL','CDNA','CDXS','CEMI','CERE','CHPT','CIFR','CLBT','CLFD','CLNE','CLOV','CLSK','CLF','CMRE','CNSL','COOP','COP','CORZ','COWN','CPE','CPRI','CRDO','CRSR','CSAN','CSIQ','CUBI','CURO','CURV','DAL','DASH','DENN','DFIN','DJT','DKNG','DNN','DOGZ','DOMO','DOOR','DPST','DVN','DXCM','EBON','ECVT','EDR','EFC','EGIO','ELVN','ENER','ENS','EQT','ERIC','ERII','EXK','EXPI','F','FANG','FAT','FBIN','FCNCA','FDUS','FLGT','FLNC','FLNG','FOSL','FREY','FSM','FTAI','FUBO','GATO','GFI','GHC','GILD','GIS','GLBE','GLNG','GME','GMED','GNRC','GOOG','GPMT','GS','GSAT','HA','HAL','HALO','HBAN','HCVI','HERO','HES','HIMS','HL','HLNE','HOOD','HP','HTZ','HUYA','IAC','IEP','IMVT','INFN','INMD','INSG','INTC','IONQ','IQ','IREN','IRON','JACK','JAGX','JBLU','JKS','JOBY','KGC','KLIC','KNTK','KR','KTOS','KW','LAAC','LAZR','LCID','LGND','LL','LLAP','LMND','LNTH','LOOP','LU','LUMN','LUNA','LXP','LYFT','LYRA','MARA','MAXN','MBLY','MBUU','ME','MESA','MFA','MITT','MRO','MRTN','MU','MUX','MVST','NCLH','NET','NGL','NGS','NIO','NLY','NMRA','NOK','NOVA','NRDS','NTR','NVAX','NVTS','NWSA','NYCB','OCGN','ORC','OSCR','PAGS','PARA','PARR','PAYX','PBTS','PCRX','PENN','PFE','PFLT','PGRE','PLBY','PLUG','PLUR','PBF','PRAX','PRGO','PRTS','PSEC','PSFE','PTGX','PVBC','QDEL','QRVO','RCL','RGR','RIDE','RITM','RIVN','RRC','RRGB','RZLT','SAVE','SBSW','SDCL','SHEN','SHLS','SIRI','SKY','SKYW','SLRC','SMCI','SOFI','SOLO','SOUN','SPRC','SSRM','SWN','SWBI','SYNH','T','TBPH','TELL','TPVG','TRX','TSE','TTOO','TWO','UAL','UDMY','UP','USAC','VG','VIRT','VNET','VNOM','VOXR','VSAT','VYX','WBD','WKHS','WOW','WRK','WULF','XOM','XPEV','XTIA','ZETA','ZION','ZM','ZYME','ARLO','ADMA','AMRN','ATSG','DENN','ARCO','KGC','KTOS','MRTN','SWBI','CLNE','BTU','NVAX','AG'];
export const botState={running:false,log:[],positions:{},trades:[],startEquity:null,lastRun:null};
function headers(k,s){return{'APCA-API-KEY-ID':k,'APCA-API-SECRET-KEY':s,'Content-Type':'application/json'}}
async function getAccount(k,s){return(await fetch(BASE+'/v2/account',{headers:headers(k,s)})).json()}
async function getPositions(k,s){return(await fetch(BASE+'/v2/positions',{headers:headers(k,s)})).json()}
async function getSnapshots(symbols,k,s){const unique=[...new Set(symbols)];const result={};for(let i=0;i<unique.length;i+=500){const chunk=unique.slice(i,i+500);const res=await fetch(DATA_BASE+'/v2/stocks/snapshots?symbols='+chunk.join(',')+'&feed=iex',{headers:headers(k,s)});const data=await res.json();if(data&&typeof data==='object')Object.assign(result,data);}return result;}
async function getBars(sym,k,s){const end=new Date();const start=new Date(end.getTime()-4*60*60*1000);const url=DATA_BASE+'/v2/stocks/'+sym+'/bars?timeframe=1Min&start='+start.toISOString()+'&end='+end.toISOString()+'&limit=60&feed=iex';const data=await(await fetch(url,{headers:headers(k,s)})).json();return data.bars||[];}
async function placeOrder(sym,qty,side,k,s){const res=await fetch(BASE+'/v2/orders',{method:'POST',headers:headers(k,s),body:JSON.stringify({symbol:sym,qty:qty.toString(),side,type:'market',time_in_force:'day'})});return res.json();}
async function closePosition(sym,k,s){const res=await fetch(BASE+'/v2/positions/'+sym,{method:'DELETE',headers:headers(k,s)});if(res.status===204)return{success:true};return res.json();}
async function getTodayBuys(k,s){const today=new Date().toISOString().split('T')[0];const orders=await(await fetch(BASE+'/v2/orders?status=filled&limit=100&after='+today+'T00:00:00Z&direction=desc',{headers:headers(k,s)})).json();const buys=new Set();if(Array.isArray(orders))orders.forEach(o=>{if(o.side==='buy')buys.add(o.symbol)});return buys;}
function calcMA(bars,period){if(bars.length<period)return null;return bars.slice(-period).reduce((s,b)=>s+b.c,0)/period}
function calcAvgVolume(bars){if(bars.length<2)return 0;const sl=bars.slice(0,-1);return sl.reduce((s,b)=>s+b.v,0)/sl.length}
function isMarketOpen(){const et=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));const d=et.getDay();if(d===0||d===6)return false;const m=et.getHours()*60+et.getMinutes();return m>=570&&m<960;}
function isNearClose(){const et=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes()>=945;}
function isBuyWindow(){const et=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));const d=et.getDay();if(d===5)return false;return et.getHours()*60+et.getMinutes()<840;}
export async function runBotCycle(apiKey,secretKey,addLog){
  if(!isMarketOpen()){addLog('Market is closed. Bot is standing by.','info');return;}
  const account=await getAccount(apiKey,secretKey);
  const equity=parseFloat(account.equity);
  const cash=parseFloat(account.cash);
  if(!botState.startEquity)botState.startEquity=equity;
  const pnlPct=(equity-botState.startEquity)/botState.startEquity;
  if(pnlPct<=-DAILY_LOSS_LIMIT){addLog('Daily loss limit hit ('+(pnlPct*100).toFixed(2)+'%). Halting.','danger');botState.running=false;return;}
  const openPos=await getPositions(apiKey,secretKey);
  const posMap={};
  if(Array.isArray(openPos))openPos.forEach(p=>{posMap[p.symbol]=p});
  const todayBuys=await getTodayBuys(apiKey,secretKey);
  for(const[symbol,pos]of Object.entries(posMap)){
    const pnl=parseFloat(pos.unrealized_plpc);
    const openedToday=todayBuys.has(symbol);
    if(parseFloat(pos.qty_available??pos.qty)<=0){addLog(symbol+': qty unavailable (pending order) — skipping','info');continue;}
    if(isNearClose()){
      if(openedToday){addLog(symbol+': opened today — skipping EOD close (PDT protection)','info');continue;}
      addLog('Near close — closing '+symbol,'info');
      const r=await closePosition(symbol,apiKey,secretKey);
      if(r.success||r.id){addLog('Closed '+symbol+' at EOD | ID: '+(r.id||'ok'),'success');botState.trades.push({symbol,qty:parseFloat(pos.qty),side:'sell',price:parseFloat(pos.current_price),time:new Date().toISOString()})}
      else addLog('Close failed for '+symbol+': '+JSON.stringify(r),'danger');
    }else if(pnl>=PROFIT_TARGET){
      if(openedToday){addLog(symbol+' hit profit target but opened today — holding (PDT protection)','info');continue;}
      addLog(symbol+' hit profit target (+'+(pnl*100).toFixed(2)+'%) — selling','success');
      const r=await closePosition(symbol,apiKey,secretKey);
      if(r.success||r.id){addLog('Closed '+symbol+' at profit | ID: '+(r.id||'ok'),'success');botState.trades.push({symbol,qty:parseFloat(pos.qty),side:'sell',price:parseFloat(pos.current_price),time:new Date().toISOString()})}
      else addLog('Close failed for '+symbol+': '+JSON.stringify(r),'danger');
    }else if(pnl<=-STOP_LOSS){
      if(openedToday){addLog(symbol+' hit stop loss but opened today — holding (PDT protection)','info');continue;}
      addLog(symbol+' hit stop loss ('+(pnl*100).toFixed(2)+'%) — selling','danger');
      const r=await closePosition(symbol,apiKey,secretKey);
      if(r.success||r.id){addLog('Closed '+symbol+' at stop loss | ID: '+(r.id||'ok'),'success');botState.trades.push({symbol,qty:parseFloat(pos.qty),side:'sell',price:parseFloat(pos.current_price),time:new Date().toISOString()})}
      else addLog('Close failed for '+symbol+': '+JSON.stringify(r),'danger');
    }
  }
  if(!isBuyWindow()){addLog('Outside buy window (after 2 PM ET or Friday) — no new entries.','info');return;}
  const posCount=Object.keys(posMap).length;
  if(posCount>=MAX_POSITIONS){addLog('At max positions ('+posCount+'/'+MAX_POSITIONS+'). Watching for exits.','info');return;}
  const maxPrice=equity*MAX_POSITION_PCT;
  addLog('Scanning '+UNIVERSE.length+' stocks for opportunities...','info');
  const snaps=await getSnapshots(UNIVERSE,apiKey,secretKey);
  const candidates=Object.entries(snaps).filter(([sym,snap])=>{if(posMap[sym])return false;const price=snap?.latestTrade?.p||snap?.minuteBar?.c||0;const vol=snap?.dailyBar?.v||0;return price>=MIN_PRICE&&price<=maxPrice&&vol>=MIN_VOLUME;}).map(([sym,snap])=>({symbol:sym,price:snap?.latestTrade?.p||snap?.minuteBar?.c||0,dailyVol:snap?.dailyBar?.v||0})).sort((a,b)=>b.dailyVol-a.dailyVol).slice(0,MAX_CANDIDATES);
  addLog('Screened down to '+candidates.length+' affordable liquid candidates. Checking signals...','info');
  for(const{symbol}of candidates){
    const bars=await getBars(symbol,apiKey,secretKey);
    if(bars.length<MA_PERIOD+2)continue;
    const ma=calcMA(bars,MA_PERIOD);
    const cur=bars[bars.length-1];
    const price=cur.c,vol=cur.v,avgVol=calcAvgVolume(bars);
    if(price>ma&&avgVol>0&&vol>=avgVol*VOLUME_MULTIPLIER){
      const qty=Math.floor(equity*MAX_POSITION_PCT/price);
      if(qty<1)continue;
      if(cash<qty*price){addLog(symbol+': signal fired but insufficient cash.','info');continue;}
      addLog('BUY signal: '+symbol+' @ $'+price.toFixed(2)+' — above MA + volume spike ('+(Math.round(vol/avgVol*10)/10)+'x avg). Buying '+qty+' shares.','success');
      const order=await placeOrder(symbol,qty,'buy',apiKey,secretKey);
      if(order.id){addLog('Order placed: '+symbol+' x'+qty+' | ID: '+order.id,'success');botState.trades.push({symbol,qty,side:'buy',price,time:new Date().toISOString()})}
      else addLog('Order failed: '+JSON.stringify(order),'danger');
      break;
    }
  }
  botState.lastRun=new Date().toISOString();
}
