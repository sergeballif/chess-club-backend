// backend/index.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS settings
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for now (adjust for production later)
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000; // Use Render's port or 3000 locally

// Basic connection handler
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Handle cleanup if needed (e.g., removing votes)
    });

    // --- More event handlers will go here ---

    // Student submits a vote
  socket.on('submit_vote', ({ gameId, move, userId }) => {
    // Store vote in memory or DB
    // Aggregate votes for this gameId
    // Broadcast updated tally to all clients in this game
    io.to(gameId).emit('vote_tally', { votes: { e2e4: 3, d2d4: 2, ... } });
  });

  // Teacher broadcasts board state
  socket.on('update_board', ({ gameId, fen, moveHistory }) => {
    io.to(gameId).emit('board_update', { fen, moveHistory });
  });

  // Teacher sets mode or triggers reveal
  socket.on('set_mode', ({ gameId, mode, reveal }) => {
    io.to(gameId).emit('mode_update', { mode, reveal });
  });

  // Join game room for isolated events
  socket.on('join_game', ({ gameId }) => {
    socket.join(gameId);
  });
});


server.listen(PORT, () => {
    console.log(`Server listening on *:${PORT}`);
});