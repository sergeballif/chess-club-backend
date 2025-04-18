// index.js (Node.js backend for chess-club)

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { Chess } = require('chess.js'); // npm install chess.js

// --- CONFIGURATION ---
const PORT = process.env.PORT || 10000;
const FRONTEND_ORIGINS = [
  "http://localhost:5173", // local dev
  "[https://your-frontend-url.com](https://your-frontend-url.com)", // replace with your actual deployed frontend
];

// --- EXPRESS SETUP ---
const app = express();
app.use(cors({
  origin: FRONTEND_ORIGINS,
  credentials: true,
}));

const server = http.createServer(app);

// --- SOCKET.IO SETUP ---
const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  }
});

// --- IN-MEMORY GAME STATE ---
const games = {}; // { [gameId]: { ... } }

// --- GAME TIMER LOGIC ---
function startGameTimer(gameId) {
  const game = games[gameId];
  if (!game) return;
  clearInterval(game.timerInterval);
  game.timer = game.timerLength || 10;
  game.reveal = false;
  io.to(gameId).emit('timer_update', { timer: game.timer });
  io.to(gameId).emit('mode_update', { mode: 'game', reveal: false });

  game.timerInterval = setInterval(() => {
    game.timer -= 1;
    io.to(gameId).emit('timer_update', { timer: game.timer });

    if (game.timer === game.revealTime && !game.reveal) {
      game.reveal = true;
      io.to(gameId).emit('mode_update', { mode: 'game', reveal: true });
    }

    if (game.timer <= 0) {
      clearInterval(game.timerInterval);
      applyVotedMove(gameId);
      // Restart timer for next move
      startGameTimer(gameId);
    }
  }, 1000);
}

function applyVotedMove(gameId) {
  const game = games[gameId];
  if (!game) return;
  const votes = game.votes || {};
  let moveToApply = null;
  // Find move with most votes
  const entries = Object.entries(votes);
  if (entries.length > 0) {
    entries.sort((a, b) => b[1] - a[1]); // Descending
    const topVotes = entries.filter(e => e[1] === entries[0][1]);
    moveToApply = topVotes[0][0]; // Topmost if tie
  }
  const chess = new Chess(game.fen);
  let moveObj = null;
  if (moveToApply && chess.moves({ verbose: true }).some(m => (m.from + m.to + (m.promotion || '')) === moveToApply)) {
    moveObj = chess.move({ from: moveToApply.slice(0,2), to: moveToApply.slice(2,4), promotion: moveToApply.slice(4) });
  } else {
    // No votes or invalid move, pick random legal move
    const legal = chess.moves({ verbose: true });
    if (legal.length > 0) {
      const randMove = legal[Math.floor(Math.random() * legal.length)];
      moveObj = chess.move(randMove);
    }
  }
  if (moveObj) {
    game.fen = chess.fen();
    game.moveHistory = [...(game.moveHistory || []), moveObj.san];
    game.votes = {};
    game.reveal = false;
    io.to(gameId).emit('board_update', { fen: game.fen, moveHistory: game.moveHistory });
    io.to(gameId).emit('vote_tally', { votes: {} });
    io.to(gameId).emit('mode_update', { mode: 'game', reveal: false });
  }
}

// --- SOCKET.IO EVENTS ---
io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.on('join_game', ({ gameId, userId, name }) => {
    socket.join(gameId);
    console.log(`User ${userId} (${name}) joined game ${gameId} (socket: ${socket.id})`);
    // Send current game state to the new user
    if (games[gameId]) {
      socket.emit('board_update', {
        fen: games[gameId].fen,
        moveHistory: games[gameId].moveHistory,
      });
      socket.emit('mode_update', {
        mode: games[gameId].mode ?? 'poll',
        reveal: games[gameId].reveal ?? false,
      });
      socket.emit('vote_tally', { votes: games[gameId].votes ?? {} });
      if (games[gameId].mode === 'game') {
        socket.emit('timer_update', { timer: games[gameId].timer ?? games[gameId].timerLength ?? 10 });
      }
    }
  });

  socket.on('update_board', ({ gameId, fen, moveHistory }) => {
    games[gameId] = { ...games[gameId], fen, moveHistory, votes: {} };
    io.to(gameId).emit('board_update', { fen, moveHistory });
    io.to(gameId).emit('vote_tally', { votes: {} });
    if (games[gameId].mode === 'game') startGameTimer(gameId);
  });

  socket.on('submit_vote', ({ gameId, move, userId }) => {
    if (!games[gameId]) {
      games[gameId] = { fen: '', moveHistory: [], votes: {}, mode: 'poll', reveal: false };
    }
    if (!games[gameId].votes) {
      games[gameId].votes = {};
    }
    if (!games[gameId].votes[move]) {
      games[gameId].votes[move] = 0;
    }
    games[gameId].votes[move] += 1;
    io.to(gameId).emit('vote_tally', { votes: games[gameId].votes });
    console.log('[backend] Emitted vote_tally:', { votes: games[gameId].votes });
  });

  socket.on('set_mode', ({ gameId, mode, reveal, timerLength, revealTime }) => {
    if (!games[gameId]) games[gameId] = { fen: '', moveHistory: [], votes: {} };
    games[gameId].mode = mode;
    games[gameId].reveal = reveal;
    if (mode === 'game') {
      games[gameId].timerLength = timerLength || 10;
      games[gameId].revealTime = revealTime || 3;
      startGameTimer(gameId);
    } else {
      clearInterval(games[gameId].timerInterval);
      games[gameId].votes = {};
      games[gameId].reveal = false;
      io.to(gameId).emit('mode_update', { mode, reveal: false });
      io.to(gameId).emit('vote_tally', { votes: {} });
    }
    console.log(`Mode for game ${gameId} set to ${mode} (reveal: ${reveal})`);
  });

  socket.on('retract_vote', ({ gameId, move, userId }) => {
    if (!games[gameId] || !games[gameId].votes) return;
    if (games[gameId].votes[move]) {
      games[gameId].votes[move] -= 1;
      if (games[gameId].votes[move] <= 0) {
        delete games[gameId].votes[move];
      }
      io.to(gameId).emit('vote_tally', { votes: games[gameId].votes });
      console.log('[backend] Vote retracted:', { move, votes: games[gameId].votes });
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Optionally handle user leaving game
  });
});

// --- START SERVER ---
server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});