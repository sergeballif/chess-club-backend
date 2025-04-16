const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let moves = {};
let voting = false;
let countdown = null;
let instructions = 'White to play - Find best move';
let users = {};
let gameMode = false;
let gameModeSeconds = 10;
let studentOrientation = 'white';
let moveHistory = [];

app.get('/api/position', (req, res) => {
  console.log('Backend /api/position:', { fen, voting, countdown, instructions, gameMode, gameModeSeconds, studentOrientation, moveHistory: moveHistory.map(m => m.san) });
  const chess = new Chess();
  if (!chess.validateFen(fen).valid) {
    console.warn('Invalid server FEN:', fen, 'Resetting to default');
    fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  }
  res.json({ fen, voting, countdown, instructions, gameMode, gameModeSeconds, studentOrientation, moveHistory });
});

app.post('/api/fen', (req, res) => {
  const { fen: newFen, san, isWhite, truncateToIndex } = req.body;
  console.log('Backend /api/fen received:', { newFen, san, isWhite, truncateToIndex });
  try {
    if (!newFen || typeof newFen !== 'string' || newFen.trim().length < 20) {
      throw new Error('Invalid or empty FEN');
    }
    const cleanedFen = newFen.trim().replace(/\s+/g, ' ');
    const fenParts = cleanedFen.split(' ');
    if (fenParts.length !== 6) {
      throw new Error(`Invalid FEN format: expected 6 fields, got ${fenParts.length}`);
    }
    const chess = new Chess();
    const validation = chess.validateFen(cleanedFen);
    if (!validation.valid) {
      throw new Error(`Invalid FEN: ${validation.error}`);
    }
    chess.load(cleanedFen);
    fen = cleanedFen;
    if (chess.isGameOver()) {
      voting = false;
      countdown = null;
      gameMode = false;
      io.emit('voting-update', voting);
      io.emit('countdown-update', countdown);
      io.emit('game-mode-update', { gameMode, seconds: gameModeSeconds });
    }
    if (san && typeof san === 'string') {
      const validTruncateIndex = Number.isInteger(truncateToIndex) && truncateToIndex >= 0 ? truncateToIndex : moveHistory.length;
      moveHistory = moveHistory.slice(0, validTruncateIndex);
      moveHistory.push({ fen: cleanedFen, san, isWhite: !!isWhite });
      console.log('Move history updated:', moveHistory.map(m => m.san));
    }
    io.emit('fen-update', fen);
    io.emit('move-history-update', moveHistory);
    res.json({ success: true });
  } catch (error) {
    console.error('Backend /api/fen error:', error.message, 'Payload:', req.body);
    res.status(400).json({ error: error.message || 'Invalid FEN or payload' });
  }
});

app.post('/api/move', (req, res) => {
  const { move, userId } = req.body;
  console.log('Backend /api/move:', { move, userId });
  if (voting && move && userId) {
    moves[move] = moves[move] || [];
    if (!moves[move].includes(userId)) {
      Object.keys(moves).forEach((m) => {
        moves[m] = moves[m].filter((id) => id !== userId);
        if (moves[m].length === 0) delete moves[m];
      });
      moves[move].push(userId);
      console.log('Backend moves updated:', moves);
      io.emit('moves-update', moves);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'User already voted for this move' });
    }
  } else {
    res.status(400).json({ error: 'Voting is not active or invalid move/userId' });
  }
});

app.post('/api/reset-votes', (req, res) => {
  console.log('Backend /api/reset-votes');
  moves = {};
  io.emit('moves-update', moves);
  res.json({ success: true });
});

app.post('/api/voting', (req, res) => {
  const { voting: newVoting } = req.body;
  console.log('Backend /api/voting:', newVoting);
  voting = newVoting;
  if (!voting) {
    countdown = null;
    io.emit('countdown-update', countdown);
  }
  io.emit('voting-update', voting);
  res.json({ success: true });
});

app.post('/api/game-mode-countdown', (req, res) => {
  const { seconds } = req.body;
  console.log('Backend /api/game-mode-countdown:', seconds);
  countdown = seconds;
  io.emit('countdown-update', countdown);
  res.json({ success: true });
});

app.post('/api/start-game-mode', (req, res) => {
  const { seconds } = req.body;
  console.log('Backend /api/start-game-mode:', seconds);
  gameMode = true;
  gameModeSeconds = seconds;
  voting = true;
  countdown = seconds;
  io.emit('game-mode-update', { gameMode, seconds });
  io.emit('voting-update', voting);
  io.emit('countdown-update', countdown);
  res.json({ success: true });
});

app.post('/api/end-game-mode', (req, res) => {
  console.log('Backend /api/end-game-mode');
  gameMode = false;
  voting = false;
  countdown = null;
  io.emit('game-mode-update', { gameMode, seconds: gameModeSeconds });
  io.emit('voting-update', voting);
  io.emit('countdown-update', countdown);
  res.json({ success: true });
});

app.post('/api/instructions', (req, res) => {
  const { instructions: newInstructions } = req.body;
  console.log('Backend /api/instructions:', newInstructions);
  instructions = newInstructions;
  io.emit('instructions-update', instructions);
  res.json({ success: true });
});

app.post('/api/username', (req, res) => {
  const { userId, username } = req.body;
  console.log('Backend /api/username:', { userId, username });
  users[userId] = username;
  io.emit('users-update', users);
  res.json({ success: true });
});

app.post('/api/student-orientation', (req, res) => {
  console.log('Backend /api/student-orientation');
  studentOrientation = studentOrientation === 'white' ? 'black' : 'white';
  io.emit('student-orientation-update', studentOrientation);
  res.json({ success: true });
});

const applyMostVotedMove = () => {
  console.log('Backend applyMostVotedMove:', moves);
  const moveEntries = Object.entries(moves);
  if (moveEntries.length === 0) return;
  const [mostVotedMove, userIds] = moveEntries.reduce((a, b) => (b[1].length > a[1].length ? b : a));
  console.log('Most voted move:', mostVotedMove, 'by', userIds.length, 'users');
  try {
    const chess = new Chess(fen);
    const moveObj = {
      from: mostVotedMove.slice(0, 2),
      to: mostVotedMove.slice(2, 4)
    };
    if (mostVotedMove.length === 5) {
      moveObj.promotion = mostVotedMove[4].toLowerCase();
    }
    const move = chess.move(moveObj);
    if (move) {
      fen = chess.fen();
      moveHistory.push({ fen, san: move.san, isWhite: chess.turn() === 'b' });
      console.log('Move applied:', move.san, 'New FEN:', fen, 'Move history:', moveHistory.map(m => m.san));
      io.emit('fen-update', fen);
      io.emit('move-history-update', moveHistory);
      moves = {};
      io.emit('moves-update', moves);
      if (chess.isGameOver()) {
        voting = false;
        countdown = null;
        gameMode = false;
        io.emit('voting-update', voting);
        io.emit('countdown-update', countdown);
        io.emit('game-mode-update', { gameMode, seconds: gameModeSeconds });
      }
    } else {
      console.error('Invalid move in applyMostVotedMove:', mostVotedMove);
    }
  } catch (error) {
    console.error('Backend applyMostVotedMove error:', error.message, 'Move:', mostVotedMove);
  }
};

setInterval(() => {
  if (countdown !== null && voting) {
    countdown -= 1;
    io.emit('countdown-update', countdown);
    console.log('Backend countdown:', countdown);
    if (countdown <= 0) {
      if (gameMode) {
        applyMostVotedMove();
        countdown = gameModeSeconds;
        io.emit('countdown-update', countdown);
      } else {
        countdown = null;
        io.emit('countdown-update', countdown);
      }
    }
  }
}, 1000);

io.on('connection', (socket) => {
  console.log('Backend socket connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Backend socket disconnected:', socket.id);
    delete users[socket.id];
    Object.keys(moves).forEach((move) => {
      moves[move] = moves[move].filter((id) => id !== socket.id);
      if (moves[move].length === 0) delete moves[move];
    });
    io.emit('moves-update', moves);
    io.emit('users-update', users);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});