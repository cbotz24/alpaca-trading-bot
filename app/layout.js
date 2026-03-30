export const metadata = {
  title: 'Alpaca Trading Bot',
  description: 'Automated paper trading bot with momentum strategy',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
