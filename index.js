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

// Log CORS requests for debugging
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

app.get('/api/position', (req, res) => {
  res.json({ fen, voting, countdown, instructions });
});

app.post('/api/fen', (req, res) => {
  fen = req.body.fen;
  io.emit('fen-update', fen);
  res.sendStatus(200);
});

app.post('/api/move', (req, res) => {
  if (voting) {
    const { id, move, nickname } = req.body;
    if (nickname) users[id] = nickname;
    moves[move] = moves[move] || [];
    if (!moves[move].includes(id)) moves[move].push(id);
    io.emit('moves-update', moves);
    io.emit('users-update', users);
  }
  res.sendStatus(200);
});

app.post('/api/voting', (req, res) => {
  voting = req.body.voting;
  io.emit('voting-update', voting);
  res.sendStatus(200);
});

app.post('/api/reset-votes', (req, res) => {
  moves = {};
  io.emit('moves-update', moves);
  res.sendStatus(200);
});

app.post('/api/start-countdown', (req, res) => {
  voting = true;
  io.emit('voting-update', voting);
  let timeLeft = 10;
  countdown = timeLeft;
  io.emit('countdown-update', countdown);
  const countdownInterval = setInterval(() => {
    timeLeft--;
    countdown = timeLeft >= 0 ? timeLeft : null;
    io.emit('countdown-update', countdown);
    if (timeLeft < 0) clearInterval(countdownInterval);
  }, 1000);
  res.sendStatus(200);
});

app.post('/api/instructions', (req, res) => {
  instructions = req.body.instructions;
  io.emit('instructions-update', instructions);
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
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));