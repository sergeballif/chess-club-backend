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

// Helper: emit vote_tally with showVotes
function emitVoteTallyWithShowVotes(gameId) {
  const game = games[gameId];
  if (!game) return;
  const showVotes = (game.mode === 'poll' && game.reveal === true) ||
    (game.mode === 'game' && typeof game.timer === 'number' && typeof game.revealTime === 'number' && game.timer <= game.revealTime);
  io.to(gameId).emit('vote_tally', {
    votes: game.votes || {},
    votesByMove: game.votesByMove || {},
    showVotes
  });
}

// --- GAME TIMER LOGIC ---
function startGameTimer(gameId) {
  const game = games[gameId];
  if (!game) return;
  clearInterval(game.timerInterval);
  // Use the current value of timerLength (which should be set via set_mode)
  game.timer = (typeof game.timerLength === 'number' && !isNaN(game.timerLength)) ? game.timerLength : 10;
  game.reveal = false;
  emitVoteTallyWithShowVotes(gameId); // send initial tally with showVotes
  io.to(gameId).emit('timer_update', { timer: game.timer, revealTime: game.revealTime });
  io.to(gameId).emit('mode_update', { mode: 'game', reveal: false });

  game.timerInterval = setInterval(() => {
    game.timer -= 1;
    io.to(gameId).emit('timer_update', { timer: game.timer, revealTime: game.revealTime });

    if (game.timer === game.revealTime && !game.reveal) {
      game.reveal = true;
      io.to(gameId).emit('mode_update', { mode: 'game', reveal: true });
      emitVoteTallyWithShowVotes(gameId); // send tally with showVotes=true
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
    game.votesByMove = {};
    game.userVotes = {};
    // Only reset reveal if you really want to hide votes after the move
    game.reveal = false;
    io.to(gameId).emit('board_update', { fen: game.fen, moveHistory: game.moveHistory });
    // Optionally clear votes on frontend:
    emitVoteTallyWithShowVotes(gameId);
    // Do NOT emit mode_update unless you are actually changing the mode or reveal state.
    // io.to(gameId).emit('mode_update', { mode: 'game', reveal: false });
  }
}

// --- SOCKET.IO EVENTS ---
io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.on('join_game', ({ gameId, userId, name }) => {
    socket.join(gameId);
    if (!games[gameId]) {
      games[gameId] = {
        fen: new Chess().fen(),
        moveHistory: [],
        votes: {},
        votesByMove: {},
        userVotes: {},
        userNames: {},
        mode: 'poll',
        reveal: false
      };
    }
    // Track name
    if (name) games[gameId].userNames[userId] = name;
    // Send current game state to the new user
    socket.emit('board_update', {
      fen: games[gameId].fen,
      moveHistory: games[gameId].moveHistory,
    });
    socket.emit('mode_update', {
      mode: games[gameId].mode ?? 'poll',
      reveal: games[gameId].reveal ?? false,
    });
    emitVoteTallyWithShowVotes(gameId);
    if (games[gameId].mode === 'game') {
      socket.emit('timer_update', { timer: games[gameId].timer ?? games[gameId].timerLength ?? 10, revealTime: games[gameId].revealTime });
    }
  });

  socket.on('update_board', ({ gameId, fen, moveHistory }) => {
    games[gameId] = {
      ...games[gameId],
      fen,
      moveHistory,
      votes: {},
      votesByMove: {},
      userVotes: {}
    };
    io.to(gameId).emit('board_update', { fen, moveHistory });
    emitVoteTallyWithShowVotes(gameId);
    if (games[gameId].mode === 'game') startGameTimer(gameId);
  });

  socket.on('submit_vote', ({ gameId, move, userId, name }) => {
    if (!games[gameId]) {
      games[gameId] = {
        fen: '',
        moveHistory: [],
        votes: {},
        votesByMove: {},
        userVotes: {},
        userNames: {},
        mode: 'poll',
        reveal: false
      };
    }
    const game = games[gameId];
    if (name) game.userNames[userId] = name;

    // Remove previous vote (if any)
    const prevMove = game.userVotes[userId];
    if (prevMove) {
      if (game.votes[prevMove]) game.votes[prevMove] -= 1;
      if (game.votesByMove[prevMove]) game.votesByMove[prevMove] = game.votesByMove[prevMove].filter(n => n !== game.userNames[userId]);
      if (game.votes[prevMove] <= 0) delete game.votes[prevMove];
      if (game.votesByMove[prevMove] && game.votesByMove[prevMove].length === 0) delete game.votesByMove[prevMove];
    }

    // Add new vote
    game.votes[move] = (game.votes[move] || 0) + 1;
    if (!game.votesByMove[move]) game.votesByMove[move] = [];
    if (!game.votesByMove[move].includes(game.userNames[userId])) game.votesByMove[move].push(game.userNames[userId]);
    game.userVotes[userId] = move;

    emitVoteTallyWithShowVotes(gameId);
    console.log('[backend] Emitted vote_tally:', { votes: game.votes, votesByMove: game.votesByMove });
  });

  socket.on('set_mode', ({ gameId, mode, reveal, timerLength, revealTime }) => {
    if (!games[gameId]) games[gameId] = { fen: '', moveHistory: [], votes: {}, votesByMove: {}, userVotes: {}, userNames: {} };
    games[gameId].mode = mode;
    games[gameId].reveal = reveal;
    if (mode === 'game') {
      games[gameId].timerLength = timerLength || 10;
      games[gameId].revealTime = revealTime || 3;
      startGameTimer(gameId);
    } else {
      clearInterval(games[gameId].timerInterval);
      games[gameId].reveal = reveal;
      io.to(gameId).emit('mode_update', { mode, reveal });
      emitVoteTallyWithShowVotes(gameId);
      // Do NOT clear votes or emit vote_tally here.
    }
    console.log(`Mode for game ${gameId} set to ${mode} (reveal: ${reveal})`);
  });

  socket.on('retract_vote', ({ gameId, move, userId }) => {
    const game = games[gameId];
    if (!game || !game.votes || !game.userVotes) return;
    const userMove = game.userVotes[userId];
    if (userMove && game.votes[userMove]) {
      game.votes[userMove] -= 1;
      if (game.votes[userMove] <= 0) delete game.votes[userMove];
      if (game.votesByMove[userMove]) game.votesByMove[userMove] = game.votesByMove[userMove].filter(n => n !== game.userNames[userId]);
      if (game.votesByMove[userMove] && game.votesByMove[userMove].length === 0) delete game.votesByMove[userMove];
      delete game.userVotes[userId];
    }
    emitVoteTallyWithShowVotes(gameId);
    console.log('[backend] Vote retracted:', { move, votes: game.votes, votesByMove: game.votesByMove });
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