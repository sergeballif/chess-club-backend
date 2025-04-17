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
});

server.listen(PORT, () => {
    console.log(`Server listening on *:${PORT}`);
});