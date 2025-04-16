const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: ['https://science.mom', 'http://localhost:8000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});
const cors = require('cors');
const { Chess } = require('chess.js');

app.use((req, res, next) => {
  console.log(`Request from origin: ${req.headers.origin}`);
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = ['https://science.mom', 'http://localhost:8000', 'http://localhost:5173'];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let moves = {};
let voting = false;
let countdown = null;
let instructions = 'White to play - Find best move';
let users = {};
let studentOrientation = 'white';
let gameMode = false;
let gameModeSeconds = 10;
let countdownInterval = null;
let moveHistory = [];

app.get('/api/position', (req, res) => {
  res.json({ fen, voting, countdown, instructions, gameMode, gameModeSeconds, studentOrientation, moveHistory });
});

app.post('/api/fen', (req, res) => {
  console.log('FEN update:', req.body);
  fen = req.body.fen;
  moves = {};
  if (req.body.san) {
    const isWhite = req.body.isWhite;
    const moveNumber = Math.floor(moveHistory.length / 2) + 1;
    const moveEntry = { fen, san: req.body.san, moveNumber, isWhite };
    moveHistory.push(moveEntry);
    console.log('Move history updated:', moveHistory);
    io.emit('move-history-update', moveHistory);
  } else {
    moveHistory = [];
    console.log('Move history cleared');
    io.emit('move-history-update', moveHistory);
  }
  io.emit('moves-update', moves);
  setTimeout(() => io.emit('fen-update', fen), 200);
  res.sendStatus(200);
});

app.post('/api/move', (req, res) => {
  if (voting) {
    const { id, move, nickname } = req.body;
    console.log('Move received:', { id, move, nickname });
    if (nickname) users[id] = nickname;
    Object.keys(moves).forEach((key) => {
      moves[key] = moves[key].filter((voteId) => voteId !== id);
      if (moves[key].length === 0) delete moves[key];
    });
    moves[move] = moves[move] || [];
    if (!moves[move].includes(id)) moves[move].push(id);
    io.emit('moves-update', moves);
    io.emit('users-update', users);
  }
  res.sendStatus(200);
});

app.post('/api/retract', (req, res) => {
  if (voting) {
    const { id } = req.body;
    console.log('Retract received:', { id });
    Object.keys(moves).forEach((key) => {
      moves[key] = moves[key].filter((voteId) => voteId !== id);
      if (moves[key].length === 0) delete moves[key];
    });
    io.emit('moves-update', moves);
  }
  res.sendStatus(200);
});

app.post('/api/voting', (req, res) => {
  if (!gameMode) {
    voting = req.body.voting;
    console.log('Voting update:', voting);
    io.emit('voting-update', voting);
    if (!voting) {
      moves = {};
      io.emit('moves-update', moves);
    }
  }
  res.sendStatus(200);
});

app.post('/api/reset-votes', (req, res) => {
  console.log('Resetting votes');
  moves = {};
  io.emit('moves-update', moves);
  res.sendStatus(200);
});

app.post('/api/start-game-mode', (req, res) => {
  console.log('Starting game mode:', req.body.seconds);
  gameMode = true;
  gameModeSeconds = req.body.seconds || 10;
  voting = true;
  moves = {};
  io.emit('voting-update', voting);
  io.emit('game-mode-update', { gameMode, seconds: gameModeSeconds });
  io.emit('moves-update', moves);
  startGameModeCountdown();
  res.sendStatus(200);
});

app.post('/api/end-game-mode', (req, res) => {
  console.log('Ending game mode');
  gameMode = false;
  voting = false;
  countdown = null;
  if (countdownInterval) clearInterval(countdownInterval);
  moves = {};
  io.emit('game-mode-update', { gameMode, seconds: gameModeSeconds });
  io.emit('voting-update', voting);
  io.emit('countdown-update', countdown);
  io.emit('moves-update', moves);
  res.sendStatus(200);
});

app.post('/api/game-mode-countdown', (req, res) => {
  const seconds = req.body.seconds || gameModeSeconds;
  console.log('Starting countdown:', seconds);
  startGameModeCountdown(seconds);
  res.sendStatus(200);
});

function startGameModeCountdown(seconds = gameModeSeconds) {
  if (countdownInterval) clearInterval(countdownInterval);
  let timeLeft = seconds;
  countdown = timeLeft;
  io.emit('countdown-update', countdown);
  countdownInterval = setInterval(() => {
    timeLeft--;
    countdown = timeLeft >= 0 ? timeLeft : null;
    console.log('Countdown tick:', countdown);
    io.emit('countdown-update', countdown);
    if (timeLeft < 0) {
      clearInterval(countdownInterval);
      applyMostVotedMove();
      if (gameMode) startGameModeCountdown();
    }
  }, 1000);
}

function applyMostVotedMove() {
  console.log('Applying most voted move, current moves:', moves);
  const chess = new Chess(fen);
  let moveToPlay = null;
  if (Object.keys(moves).length > 0) {
    const sortedMoves = Object.entries(moves).sort((a, b) => b[1].length - a[1].length);
    moveToPlay = sortedMoves[0][0];
    console.log('Selected move:', moveToPlay);
  } else {
    const legalMoves = chess.moves({ verbose: true });
    if (legalMoves.length > 0) {
      const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
      moveToPlay = randomMove.from + randomMove.to + (randomMove.promotion || '');
      console.log('Random move:', moveToPlay);
    }
  }
  if (moveToPlay) {
    const moveObj = chess.move({
      from: moveToPlay.slice(0, 2),
      to: moveToPlay.length === 5 ? moveToPlay.slice(2, 4) : moveToPlay.slice(2),
      promotion: moveToPlay.length === 5 ? moveToPlay[4] : undefined
    });
    if (moveObj) {
      fen = chess.fen();
      moves = {};
      const isWhite = chess.turn() === 'b';
      const moveNumber = Math.floor(moveHistory.length / 2) + 1;
      const moveEntry = { fen, san: moveObj.san, moveNumber, isWhite };
      moveHistory.push(moveEntry);
      console.log('Move history updated:', moveHistory);
      io.emit('moves-update', moves);
      io.emit('move-history-update', moveHistory);
      setTimeout(() => io.emit('fen-update', fen), 200);
    }
  }
}

app.post('/api/instructions', (req, res) => {
  instructions = req.body.instructions;
  io.emit('instructions-update', instructions);
  res.sendStatus(200);
});

app.post('/api/student-orientation', (req, res) => {
  studentOrientation = studentOrientation === 'white' ? 'black' : 'white';
  io.emit('student-orientation-update', studentOrientation);
  res.sendStatus(200);
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.emit('fen-update', fen);
  socket.emit('moves-update', moves);
  socket.emit('voting-update', voting);
  socket.emit('countdown-update', countdown);
  socket.emit('instructions-update', instructions);
  socket.emit('users-update', users);
  socket.emit('student-orientation-update', studentOrientation);
  socket.emit('game-mode-update', { gameMode, seconds: gameModeSeconds });
  socket.emit('move-history-update', moveHistory);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));