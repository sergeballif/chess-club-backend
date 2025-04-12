const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});
const cors = require('cors');
const { Chess } = require('chess.js');

app.use(express.json());
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.static('../client/dist'));

let state = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves: {},
  voting: false,
  countdown: null,
  instructions: 'White to play - Find best move',
  users: {}
};

app.get('/api/position', (req, res) => res.json({ fen: state.fen, voting: state.voting, countdown: state.countdown, instructions: state.instructions }));

app.get('/api/users', (req, res) => res.json(state.users)); // New endpoint

app.post('/api/fen', (req, res) => {
  const chess = new Chess();
  if (chess.load(req.body.fen)) {
    state.fen = req.body.fen;
    state.moves = {};
    io.emit('fen-update', state.fen);
    io.emit('moves-update', state.moves);
    res.sendStatus(200);
  } else {
    res.sendStatus(400);
  }
});

app.post('/api/move', (req, res) => {
  if (!state.voting) return res.sendStatus(403);
  const { id, move, nickname } = req.body;
  const chess = new Chess(state.fen);
  const legalMove = chess.move({ from: move.slice(0, 2), to: move.slice(2, 4) });
  if (!legalMove) return res.sendStatus(400);
  
  state.users[id] = nickname || id; // Update nickname, fallback to ID
  for (const [existingMove, ids] of Object.entries(state.moves)) {
    state.moves[existingMove] = ids.filter(v => v !== id);
    if (state.moves[existingMove].length === 0) delete state.moves[existingMove];
  }
  state.moves[move] = state.moves[move] || [];
  if (!state.moves[move].includes(id)) state.moves[move].push(id);
  io.emit('moves-update', state.moves);
  io.emit('users-update', state.users); // Broadcast updated users
  res.sendStatus(200);
});

app.get('/api/moves', (req, res) => res.json(state.moves));

app.post('/api/voting', (req, res) => {
  state.voting = req.body.voting;
  io.emit('voting-update', state.voting);
  res.sendStatus(200);
});

app.post('/api/reset-votes', (req, res) => {
  state.moves = {};
  io.emit('moves-update', state.moves);
  res.sendStatus(200);
});

app.post('/api/start-countdown', (req, res) => {
  state.voting = true;
  io.emit('voting-update', true);
  let timeLeft = 10;
  state.countdown = timeLeft;
  io.emit('countdown-update', state.countdown);
  const countdown = setInterval(() => {
    timeLeft--;
    state.countdown = timeLeft >= 0 ? timeLeft : null;
    io.emit('countdown-update', state.countdown);
    if (timeLeft < 0) clearInterval(countdown);
  }, 1000);
  res.sendStatus(200);
});

app.post('/api/instructions', (req, res) => {
  state.instructions = req.body.instructions;
  io.emit('instructions-update', state.instructions);
  res.sendStatus(200);
});

io.on('connection', (socket) => {
  socket.emit('fen-update', state.fen);
  socket.emit('voting-update', state.voting);
  socket.emit('moves-update', state.moves);
  socket.emit('countdown-update', state.countdown);
  socket.emit('instructions-update', state.instructions);
  socket.emit('users-update', state.users); // Send initial users on connect
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));