export async function GET() {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;

  if (!apiKey || !secretKey) {
    return Response.json({ error: 'API keys not configured.' }, { status: 500 });
  }

  try {
    const [accountRes, positionsRes] = await Promise.all([
      fetch('https://paper-api.alpaca.markets/v2/account', {
        headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': secretKey },
      }),
      fetch('https://paper-api.alpaca.markets/v2/positions', {
        headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': secretKey },
      }),
    ]);

    const account = await accountRes.json();
    const positions = await positionsRes.json();

    return Response.json({ account, positions });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
