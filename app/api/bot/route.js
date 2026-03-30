import { botState, runBotCycle } from '../../../lib/bot';

const logs = [];

function addLog(msg, type = 'info') {
  const entry = { msg, type, time: new Date().toISOString() };
  logs.unshift(entry);
  if (logs.length > 100) logs.pop();
  console.log(`[BOT][${type.toUpperCase()}] ${msg}`);
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action;

  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;

  if (!apiKey || !secretKey) {
    return Response.json({ error: 'API keys not configured in environment variables.' }, { status: 500 });
  }

  if (action === 'start') {
    if (botState.running) {
      return Response.json({ message: 'Bot already running.' });
    }
    botState.running = true;
    botState.startEquity = null;
    addLog('Bot started.', 'success');

    // Run immediately, then every 60 seconds via repeated calls from the frontend
    try {
      await runBotCycle(apiKey, secretKey, addLog);
    } catch (e) {
      addLog('Cycle error: ' + e.message, 'danger');
    }

    return Response.json({ message: 'Bot started and first cycle complete.', logs });
  }

  if (action === 'stop') {
    botState.running = false;
    addLog('Bot stopped by user.', 'info');
    return Response.json({ message: 'Bot stopped.', logs });
  }

  if (action === 'cycle') {
    if (!botState.running) {
      return Response.json({ message: 'Bot is not running.', logs });
    }
    try {
      await runBotCycle(apiKey, secretKey, addLog);
    } catch (e) {
      addLog('Cycle error: ' + e.message, 'danger');
    }
    return Response.json({ message: 'Cycle complete.', logs, trades: botState.trades });
  }

  return Response.json({ error: 'Unknown action.' }, { status: 400 });
}

export async function GET() {
  return Response.json({
    running: botState.running,
    logs,
    trades: botState.trades,
    lastRun: botState.lastRun,
  });
}
