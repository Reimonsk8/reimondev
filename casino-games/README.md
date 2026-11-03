# 🎮 ReimonDev Games

A play-money mini-games library built with React, AWS, and WebSockets. The casino is one game in the collection alongside Square of Shadows, Outlands, and the Arcade.

![ReimonDev Games](https://img.shields.io/badge/ReimonDev-Games-blueviolet?style=for-the-badge)
![React](https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react)
![AWS](https://img.shields.io/badge/AWS-CDK-orange?style=flat-square&logo=amazonaws)
![WebSocket](https://img.shields.io/badge/WebSocket-Real--time-green?style=flat-square)

## ✨ Game library

### 🎰 Casino mini-games
- **Coin Flip** - Cinematic 3D Bitcoin coin with particle effects
- **Card Duel** - Guess red or black to win
- **Lucky Wheel** - Multiplier wheel with smooth animations

### 🌐 Real-time Multiplayer Lobby
- WebSocket-based player connections
- Custom avatar colors and positioning
- Real-time player movement on casino map
- Live player list

### 💰 Wallet System
- Secure deposits and withdrawals
- Transaction history
- Real-time balance updates

### 🔐 Authentication
- AWS Cognito user management
- Email verification
- Secure JWT tokens

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, PIXI.js |
| Backend | AWS Lambda (Node.js 20) |
| Database | DynamoDB |
| Auth | AWS Cognito |
| API | API Gateway (REST + WebSocket) |
| Infrastructure | AWS CDK v2 |

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- AWS CLI configured with credentials
- AWS CDK bootstrapped in your region

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Deployment

```bash
# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy to AWS
npm run deploy
```

## 📁 Project Structure

```
casino888/
├── frontend/           # React application
│   ├── src/
│   │   ├── components/ # UI components
│   │   ├── games/      # Game components (CoinFlip, CardGame, etc.)
│   │   ├── hooks/      # Custom React hooks
│   │   ├── utils/      # Utility functions
│   │   └── contexts/   # React contexts
│   └── index.html
├── lambdas/            # AWS Lambda functions
│   ├── websocket/      # WebSocket handlers
│   ├── login/          # Auth endpoints
│   ├── signup/
│   ├── placeBet/
│   └── ...
├── lib/                # CDK infrastructure
└── bin/                # CDK app entry point
```

## 📚 Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system diagrams (Mermaid), data model, REST/WS flows, deploy pipeline
- [`PROJECT_DESIGN.md`](PROJECT_DESIGN.md) — product/engineering authority doc + phased roadmap
- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — deploy + troubleshooting flow for the WebSocket lobby
- [`TODO_features.md`](TODO_features.md) — progress tracker

## 🔗 API Endpoints

### REST API
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Register new user |
| POST | `/auth/verify` | Verify email |
| POST | `/auth/login` | User login |
| GET | `/wallet/profile` | Get user profile |
| POST | `/wallet/bet` | Place a bet |
| GET | `/wallet/transactions` | Transaction history |

### WebSocket API
| Action | Description |
|--------|-------------|
| `$connect` | Connect to lobby |
| `$disconnect` | Disconnect from lobby |
| `getSnapshot` | Get all connected players |
| `move` | Update player position |

## 🔧 Environment Variables

Create a `.env` file in the root:

```env
VITE_WEBSOCKET_URL=wss://your-api-id.execute-api.us-east-2.amazonaws.com/prod
```

## 📝 License

MIT License - feel free to use this project for learning and development.

---

Made with ❤️ and 🎰
