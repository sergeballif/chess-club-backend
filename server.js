const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let currentFen = '8/p5p1/N1p4p/3k2pr/3Pp2P/1P2P1P1/P3K3/8 w - - 0 1';
let moves = {};
let voting = false;
let countdown = null;
let instructions = 'White to play - Find best move';

app.use(express.json());

app.post('/api/fen', (req, res) => {
  currentFen = req.body.fen;
  moves = {};
  io.emit('fen-update', currentFen);
  io.emit('moves-update', moves);
  res.sendStatus(200);
});

app.post('/api/move', (req, res) => {
  const { nickname, move } = req.body;
  if (voting) {
    if (!moves[move]) moves[move] = [];
    if (!moves[move].includes(nickname)) moves[move].push(nickname);
    io.emit('moves-update', moves);
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
  countdown = 10;
  io.emit('countdown-update', countdown);
  const interval = setInterval(() => {
    countdown--;
    if (countdown < 0) {
      clearInterval(interval);
      countdown = null;
    }
    io.emit('countdown-update', countdown);
  }, 1000);
  res.sendStatus(200);
});

app.post('/api/instructions', (req, res) => {
  instructions = req.body.instructions;
  io.emit('instructions-update', instructions);
  res.sendStatus(200);
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});