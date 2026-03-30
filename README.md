# Alpaca Paper Trading Bot

An automated trading bot using momentum + volume strategy, built with Next.js and deployable to Vercel.

## Strategy
- **Buy when:** Price is above the 9-bar moving average AND current volume is 1.5× the average volume
- **Sell when:** +2% profit target hit OR −1% stop loss hit OR near market close (3:45pm ET)
- **Watchlist:** AAPL, TSLA, NVDA, AMD, SPY, QQQ, AMZN, META, MSFT, GOOGL
- **Max positions:** 3 concurrent, max 10% of portfolio per position
- **Daily loss limit:** Bot halts if down 5% on the day

## Setup & Deploy to Vercel

### Step 1: Push to GitHub
1. Create a new repo on github.com
2. Upload this entire folder to it

### Step 2: Deploy to Vercel
1. Go to vercel.com and sign in
2. Click "Add New Project"
3. Import your GitHub repo
4. Before deploying, add your environment variables (see Step 3)

### Step 3: Add Environment Variables in Vercel
In your Vercel project settings → Environment Variables, add:
```
ALPACA_API_KEY=your_alpaca_api_key
ALPACA_SECRET_KEY=your_alpaca_secret_key
```

### Step 4: Deploy
Click Deploy. Vercel will build and host your bot automatically.

### Step 5: Run the bot
1. Open your Vercel URL (e.g. your-bot.vercel.app)
2. Click "Start bot"
3. The bot will scan the watchlist every 60 seconds during market hours

## Local Development
```bash
npm install
cp .env.local.example .env.local
# Add your keys to .env.local
npm run dev
```
Open http://localhost:3000

## Important Notes
- This is **paper trading only** — no real money is at risk
- The bot only runs while your browser tab is open (Vercel serverless functions are stateless)
- For 24/7 autonomous trading, you would need a persistent server (e.g. Railway, Render, or a VPS)
- This is not financial advice
