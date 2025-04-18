// index.js (Node.js backend for chess-club)

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

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

// --- IN-MEMORY GAME STATE (EXAMPLE) ---
const games = {}; // { [gameId]: { fen, moveHistory: [], ... } }

// --- SOCKET.IO EVENTS ---
io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.on('join_game', ({ gameId, userId, name }) => {
    socket.join(gameId);
    console.log(`User ${userId} (${name}) joined game ${gameId} (socket: ${socket.id})`);
    // Optionally send current game state to the new user
    if (games[gameId]) {
      socket.emit('board_update', {
        fen: games[gameId].fen,
        moveHistory: games[gameId].moveHistory,
      });
    }
  });

  socket.on('update_board', ({ gameId, fen, moveHistory }) => {
    games[gameId] = { fen, moveHistory, votes: {} }; // Reset votes!
    io.to(gameId).emit('board_update', { fen, moveHistory });
    io.to(gameId).emit('vote_tally', { votes: {} }); // Notify clients votes are cleared
  });



  socket.on('submit_vote', ({ gameId, move, userId }) => {
    // Ensure game state exists
    if (!games[gameId]) {
      games[gameId] = { fen: '', moveHistory: [], votes: {} };
    }
    // Initialize votes object if missing
    if (!games[gameId].votes) {
      games[gameId].votes = {};
    }
    // Increment vote count for this move
    if (!games[gameId].votes[move]) {
      games[gameId].votes[move] = 0;
    }
    games[gameId].votes[move] += 1;
  
    // Optionally: store which user voted for what, to prevent double-voting, etc.
  
    // Emit updated vote tally to all clients in the game
    io.to(gameId).emit('vote_tally', { votes: games[gameId].votes });
    console.log('[backend] Emitted vote_tally:', { votes: games[gameId].votes });
  });

  socket.on('set_mode', ({ gameId, mode, reveal }) => {
    // Handle mode logic here
    console.log(`Mode for game ${gameId} set to ${mode} (reveal: ${reveal})`);
    io.to(gameId).emit('mode_update', { mode, reveal });
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

