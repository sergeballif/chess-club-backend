// backend/index.js
const { Chess } = require('chess.js');
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

const PORT = process.env.PORT || 3000;

// --- In-memory state (reset on server restart) ---
const games = {}; // gameId -> { votes: { userId: move }, names: { userId: name }, board: { fen, moveHistory }, mode: { mode, reveal } }

// --- Socket.IO event handlers ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Join game room and register user
    socket.on('join_game', ({ gameId, userId, name }) => {
        socket.join(gameId);
        if (!games[gameId]) {
          const chess = new Chess();
          games[gameId] = {
              votes: {},
              names: {},
              board: { fen: chess.fen(), moveHistory: [] },
              mode: { mode: 'poll', reveal: false }
          };
        }
        games[gameId].names[userId] = name || userId;
        console.log(`User ${userId} (${games[gameId].names[userId]}) joined game ${gameId}`);
        // Send current board, votes, and mode to new client
        socket.emit('board_update', games[gameId].board);
        socket.emit('vote_tally', aggregateVotes(games[gameId].votes));
        socket.emit('mode_update', games[gameId].mode);
    });

    // Student submits a vote
    socket.on('submit_vote', ({ gameId, move, userId }) => {
      if (!games[gameId]) return;
      games[gameId].votes[userId] = move;
      // Only emit vote tally if not in Observation Mode
      if (games[gameId].mode.mode !== 'observe') {
          const tally = aggregateVotes(games[gameId].votes);
          io.to(gameId).emit('vote_tally', tally);
      }
      // In Observation Mode, do not emit vote_tally
    });

    // Teacher broadcasts board state
    socket.on('update_board', ({ gameId, fen, moveHistory }) => {
        if (!games[gameId]) return;
        games[gameId].board = { fen, moveHistory };
        // Reset votes when board updates
        games[gameId].votes = {};
        io.to(gameId).emit('board_update', { fen, moveHistory });
        io.to(gameId).emit('vote_tally', aggregateVotes({})); // Reset votes
    });

    // Teacher sets mode or triggers reveal
    socket.on('set_mode', ({ gameId, mode, reveal }) => {
        if (!games[gameId]) return;
        games[gameId].mode = { mode, reveal };
        io.to(gameId).emit('mode_update', games[gameId].mode);
        // If entering Observation Mode, clear vote tally for students
        if (mode === 'observe') {
            io.to(gameId).emit('vote_tally', aggregateVotes({}));
        } else {
            io.to(gameId).emit('vote_tally', aggregateVotes(games[gameId].votes));
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Optionally: Remove user votes/names if you want
    });
});

// --- Helper: Aggregate votes into move -> count ---
function aggregateVotes(votes) {
    // votes: { userId: move }
    const tally = {};
    Object.values(votes).forEach(move => {
        tally[move] = (tally[move] || 0) + 1;
    });
    return { votes: tally };
}

server.listen(PORT, () => {
    console.log(`Server listening on *:${PORT}`);
});