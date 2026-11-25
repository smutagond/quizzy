# ⚡ Quizzy — Realtime Multiplayer Live Quiz Platform

A modern, high-performance SaaS live quiz platform built for workshops, classrooms, events, and interactive presentations. Quizzy delivers millisecond-latency multiplayer quiz experiences with live leaderboards, pin-code room joining, and a host administration control suite.

![Quizzy Platform](https://img.shields.io/badge/Platform-Next.js%2016-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/Frontend-React%2019-blue?style=for-the-badge&logo=react)
![Realtime](https://img.shields.io/badge/Realtime-Socket.io-orange?style=for-the-badge&logo=socket.io)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

---

## ✨ Features

- **🎮 Seamless Player Experience**:
  - Join via 6-digit room code with nickname.
  - Mobile-first, responsive interface optimized for smartphones, tablets, and laptops.
  - Instant live response feedback and real-time point distribution.
  
- **🏆 Live Dynamic Leaderboards**:
  - Real-time score ranking calculated from speed, streaks, and answer accuracy.
  - Podium animations for top performers at the conclusion of each round.

- **🛡️ Secure Host & Admin Panel**:
  - Dedicated host dashboard protected by secure authentication.
  - Complete game state control: Launch questions, reveal answers, pause, skip, or terminate rounds.
  - Real-time participant management: View connected players, monitor answering pace, and purge lobby or historical test data before live sessions.

- **📚 Preloaded Workshop Content**:
  - Embedded IoT & Embedded Systems quiz module (15 interactive questions with twist checks covering sensors, microcontrollers, communication protocols, and cloud layers).
  - Expandable question schema for custom domains and curriculums.

---

## 🏗️ Architecture Overview

Quizzy is engineered with a decoupled, low-latency client-server architecture:

```
┌─────────────────────────────────┐       ┌──────────────────────────────────┐
│   Next.js 16 Web Application    │       │     Standalone Realtime Hub      │
│  (App Router + Tailwind CSS)    │       │   (Node.js + Socket.IO Server)   │
│                                 │◄─────►│                                  │
│  - Player Client UI             │ WebSocket / HTTP Polling                 │
│  - Host Administration Panel    │       │  - Room & Lobby State Manager    │
│  - API Route Proxying           │       │  - Realtime Event Dispatcher     │
└─────────────────────────────────┘       └──────────────────────────────────┘
```

---

## 📁 Project Structure

```text
quizzy/
├── .env.example              # Template for environment configuration
├── next.config.ts            # Next.js configuration & dynamic proxy rules
├── package.json              # Project scripts and dependencies
├── README.md                 # Project documentation and deployment guides
├── server/
│   └── realtime.mjs          # Standalone Socket.IO realtime game engine
└── src/
    ├── app/
    │   ├── api/admin/auth/   # Host authentication and verification endpoint
    │   ├── favicon.ico
    │   ├── globals.css       # Tailwind base styles and theme definitions
    │   ├── layout.tsx        # Root HTML layout and font loading
    │   └── page.tsx          # Main entry route
    └── components/
        └── quiz-app.tsx      # Core live interactive game interface & host suite
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18.17.0 or later (v20+ recommended)
- **npm** or **pnpm**

### 1. Clone the Repository

```bash
git clone https://github.com/smutagond/quizzy.git
cd quizzy
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env.local` and define your credentials:

```bash
cp .env.example .env.local
```

| Variable | Description | Default (Local) |
|---|---|---|
| `ADMIN_PASSWORD` | Password required to unlock Host/Admin Mode | `ChangeMe123!` |
| `REALTIME_PORT` | Port for the standalone Socket.IO server | `4001` |
| `REALTIME_SERVER_URL` | Local/internal URL for Socket.IO upstream proxy | `http://127.0.0.1:4001` |
| `NEXT_PUBLIC_REALTIME_URL` | External Socket.IO endpoint (set for cross-domain hosting) | *(empty defaults to same origin)* |
| `WEB_ORIGIN` | Allowed origin for Socket.IO CORS policies | `*` |

---

## 🏃 Running Locally

Start both the realtime engine and the Next.js development server:

**Terminal 1 — Realtime Socket Server**:
```bash
npm run realtime
```
*Runs on port 4001.*

**Terminal 2 — Next.js Application**:
```bash
npm run dev
```
*Runs on [http://localhost:3000](http://localhost:3000).*

---

## 🌐 Production Deployment

### Option A: Vercel (Frontend) + Render / Railway (Realtime Engine)

1. **Deploy Socket.IO Engine (Railway / Render)**:
   - Root directory: `/`
   - Start Command: `npm run realtime`
   - Port: `4001` (or `$PORT`)
   - Environment variables: `WEB_ORIGIN=https://your-quizzy-frontend.vercel.app`
   - Copy the generated URL (e.g. `https://quizzy-realtime.up.railway.app`).

2. **Deploy Next.js Frontend (Vercel)**:
   - Connect your GitHub repository to Vercel.
   - Set Environment Variables:
     - `NEXT_PUBLIC_REALTIME_URL=https://quizzy-realtime.up.railway.app`
     - `ADMIN_PASSWORD=your_secure_password`
   - Deploy.

---

### Option B: Single VPS / Docker (Self-Hosted)

For single-server deployment (e.g., Ubuntu VPS, DigitalOcean, AWS EC2, or Hetzner):

1. **Run Realtime Server using PM2**:
   ```bash
   pm2 start server/realtime.mjs --name "quizzy-realtime"
   ```

2. **Build and Run Next.js**:
   ```bash
   npm run build
   pm2 start npm --name "quizzy-web" -- start
   ```

3. **Configure Nginx Reverse Proxy**:
   Proxy both HTTP traffic (port `3000`) and WebSocket traffic on `/socket.io` (port `4001`).

---

## 🔒 Security Best Practices

- Always change the default `ADMIN_PASSWORD` in your production environment before opening rooms to the public.
- Keep `.env.local` strictly excluded from source control (enforced via `.gitignore`).
- For public domains, ensure HTTPS/WSS is active to protect credentials and realtime communication.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
