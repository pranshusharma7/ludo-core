 #!/bin/bash
cd "$(dirname "$0")"

echo "🎲 Starting Royal Ludo Real-Time Multiplayer Suite..."

npm --prefix server run dev &
SERVER_PID=$!

npm --prefix client run dev &
CLIENT_PID=$!

cleanup() {
  echo ""
  echo "🛑 Stopping Royal Ludo servers..."
  kill $SERVER_PID 2>/dev/null || true
  kill $CLIENT_PID 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM

sleep 2
open "http://localhost:5173" 2>/dev/null || true

echo ""
echo "✨ Royal Ludo is LIVE!"
echo "📡 Server: http://localhost:4000"
echo "🎮 Client: http://localhost:5173"
echo "Press Ctrl+C to stop both servers."

wait
