'use client';
import { useState, useEffect, useRef } from 'react';

const WATCHLIST = ['AAPL','TSLA','NVDA','AMD','SPY','QQQ','AMZN','META','MSFT','GOOGL'];

export default function Dashboard() {
  const [botRunning, setBotRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.account) setAccount(data.account);
      if (Array.isArray(data.positions)) setPositions(data.positions);
    } catch(e) {}
  }

  async function fetchBotState() {
    try {
      const res = await fetch('/api/bot');
      const data = await res.json();
      setBotRunning(data.running);
      if (data.logs) setLogs(data.logs);
      if (data.trades) setTrades(data.trades);
    } catch(e) {}
  }

  async function runCycle() {
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cycle' }),
      });
      const data = await res.json();
      if (data.logs) setLogs(data.logs);
      if (data.trades) setTrades(data.trades);
      await fetchStatus();
    } catch(e) {}
  }

  async function startBot() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setLoading(false); return; }
      setBotRunning(true);
      if (data.logs) setLogs(data.logs);
      await fetchStatus();
    } catch(e) { setError(e.message); }
    setLoading(false);
  }

  async function stopBot() {
    setLoading(true);
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      const data = await res.json();
      setBotRunning(false);
      if (data.logs) setLogs(data.logs);
    } catch(e) {}
    setLoading(false);
  }

  useEffect(() => {
    fetchStatus();
    fetchBotState();
  }, []);

  useEffect(() => {
    if (botRunning) {
      intervalRef.current = setInterval(async () => {
        await runCycle();
      }, 60000); // run every 60 seconds
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [botRunning]);

  const equity = account ? parseFloat(account.equity) : null;
  const cash = account ? parseFloat(account.cash) : null;
  const pnl = account ? parseFloat(account.unrealized_pl || 0) : null;
  const dayPnl = account ? parseFloat(account.equity) - parseFloat(account.last_equity || account.equity) : null;

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', background: '#f5f5f3', minHeight: '100vh', padding: '1.5rem', color: '#1a1a1a' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>Alpaca trading bot</h1>
            <p style={{ fontSize: 13, color: '#6b6b6b' }}>Momentum + volume strategy · Paper trading</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: botRunning ? '#22c55e' : '#9ca3af', display: 'inline-block' }}></span>
            <span style={{ fontSize: 13, color: botRunning ? '#16a34a' : '#6b6b6b', fontWeight: 500 }}>{botRunning ? 'Running' : 'Stopped'}</span>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#b91c1c' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          {[
            { label: 'Portfolio value', value: equity != null ? '$' + equity.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '–' },
            { label: 'Cash', value: cash != null ? '$' + cash.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '–' },
            { label: 'Unrealized P&L', value: pnl != null ? (pnl>=0?'+':'')+'$'+pnl.toFixed(2) : '–', color: pnl != null ? (pnl>=0?'#16a34a':'#dc2626') : undefined },
            { label: 'Open positions', value: positions.length },
          ].map(m => (
            <div key={m.label} style={{ background: '#f5f5f3', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: m.color || '#1a1a1a' }}>{m.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#6b6b6b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Strategy</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13, marginBottom: 14 }}>
            <div><span style={{ color: '#6b6b6b' }}>Buy trigger: </span>Price above 9-bar MA + volume 1.5× avg</div>
            <div><span style={{ color: '#6b6b6b' }}>Sell trigger: </span>+2% profit target or −1% stop loss</div>
            <div><span style={{ color: '#6b6b6b' }}>Max positions: </span>3 concurrent, 10% portfolio each</div>
          </div>
          <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 14 }}>
            Watchlist: {WATCHLIST.join(' · ')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={botRunning ? stopBot : startBot}
              disabled={loading}
              style={{ padding: '8px 20px', borderRadius: 8, border: '0.5px solid', borderColor: botRunning ? '#fca5a5' : '#1a1a1a', background: botRunning ? 'transparent' : '#1a1a1a', color: botRunning ? '#dc2626' : '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Please wait...' : botRunning ? 'Stop bot' : 'Start bot'}
            </button>
            <button
              onClick={fetchStatus}
              style={{ padding: '8px 16px', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.25)', background: 'transparent', color: '#1a1a1a', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Refresh
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 12, padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#6b6b6b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Open positions</div>
            {positions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af', fontSize: 13 }}>No open positions</div>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Symbol','Qty','Entry','Current','P&L'].map(h => (
                    <th key={h} style={{ textAlign: 'left', fontWeight: 500, fontSize: 12, color: '#6b6b6b', padding: '4px 6px', borderBottom: '0.5px solid rgba(0,0,0,0.1)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {positions.map(p => {
                    const pl = parseFloat(p.unrealized_pl);
                    return (
                      <tr key={p.symbol}>
                        <td style={{ padding: '6px', fontWeight: 500 }}>{p.symbol}</td>
                        <td style={{ padding: '6px' }}>{parseFloat(p.qty).toFixed(2)}</td>
                        <td style={{ padding: '6px' }}>${parseFloat(p.avg_entry_price).toFixed(2)}</td>
                        <td style={{ padding: '6px' }}>${parseFloat(p.current_price).toFixed(2)}</td>
                        <td style={{ padding: '6px', color: pl >= 0 ? '#16a34a' : '#dc2626' }}>{pl >= 0 ? '+' : ''}${pl.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 12, padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#6b6b6b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Today's trades</div>
            {trades.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af', fontSize: 13 }}>No trades yet today</div>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Symbol','Side','Qty','Price','Time'].map(h => (
                    <th key={h} style={{ textAlign: 'left', fontWeight: 500, fontSize: 12, color: '#6b6b6b', padding: '4px 6px', borderBottom: '0.5px solid rgba(0,0,0,0.1)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px', fontWeight: 500 }}>{t.symbol}</td>
                      <td style={{ padding: '6px' }}>
                        <span style={{ background: t.side==='buy'?'#eff6ff':'#fef2f2', color: t.side==='buy'?'#1d4ed8':'#b91c1c', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500 }}>{t.side}</span>
                      </td>
                      <td style={{ padding: '6px' }}>{t.qty}</td>
                      <td style={{ padding: '6px' }}>${parseFloat(t.price).toFixed(2)}</td>
                      <td style={{ padding: '6px', color: '#6b6b6b' }}>{new Date(t.time).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 12, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#6b6b6b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Activity log</div>
          <div style={{ background: '#f5f5f3', borderRadius: 8, padding: 10, fontFamily: 'SF Mono, Fira Code, monospace', fontSize: 12, height: 220, overflowY: 'auto' }}>
            {logs.length === 0 ? (
              <div style={{ color: '#9ca3af', padding: '4px 0' }}>Start the bot to see activity...</div>
            ) : logs.map((l, i) => (
              <div key={i} style={{ padding: '2px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)', color: l.type==='success'?'#16a34a':l.type==='danger'?'#dc2626':l.type==='info'?'#1d4ed8':'#6b6b6b' }}>
                [{new Date(l.time).toLocaleTimeString()}] {l.msg}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          Paper trading only · Not financial advice · Bot runs a cycle every 60 seconds when active
        </div>
      </div>
    </div>
  );
}
