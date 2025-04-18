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
    console.log(`update_board from socket ${socket.id} for game ${gameId}`);
    // Save state (optional, for restoring or new joiners)
    games[gameId] = { fen, moveHistory };
    // Broadcast to all in the room
    io.to(gameId).emit('board_update', { fen, moveHistory });
  });

  socket.on('submit_vote', ({ gameId, move, userId }) => {
    // Handle voting logic here (not implemented in this example)
    console.log(`Vote from user ${userId} for move ${move} in game ${gameId}`);
    // Optionally emit updated vote tally
    // io.to(gameId).emit('vote_tally', { votes: ... });
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