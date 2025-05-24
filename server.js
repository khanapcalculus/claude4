const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Store room data and canvas history
const rooms = new Map();
const canvasData = new Map(); // Store drawing data for each room

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint for Render.com
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // Handle joining a room
    socket.on('join-room', (roomId) => {
        console.log(`User ${socket.id} joining room: ${roomId}`);
        
        // Leave any previous rooms
        const currentRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
        currentRooms.forEach(room => {
            socket.leave(room);
            updateRoomParticipants(room);
        });
        
        // Join the new room
        socket.join(roomId);
        socket.currentRoom = roomId;
        
        // Initialize room data if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                participants: new Set(),
                createdAt: new Date()
            });
            canvasData.set(roomId, []);
        }
        
        // Add user to room participants
        rooms.get(roomId).participants.add(socket.id);
        
        // Send existing canvas data to the new user
        const existingCanvasData = canvasData.get(roomId) || [];
        if (existingCanvasData.length > 0) {
            socket.emit('canvas-data', existingCanvasData);
        }
        
        // Update participant count for all users in the room
        updateRoomParticipants(roomId);
        
        console.log(`Room ${roomId} now has ${rooms.get(roomId).participants.size} participants`);
    });
    
    // Handle drawing data
    socket.on('drawing-data', (data) => {
        if (!socket.currentRoom) return;
        
        const roomId = data.roomId || socket.currentRoom;
        
        // Store the drawing data
        if (!canvasData.has(roomId)) {
            canvasData.set(roomId, []);
        }
        
        // Add timestamp if not present
        if (!data.timestamp) {
            data.timestamp = Date.now();
        }
        
        // Store the drawing stroke
        canvasData.get(roomId).push(data);
        
        // Limit stored data to prevent memory issues (keep last 10000 strokes)
        const roomCanvasData = canvasData.get(roomId);
        if (roomCanvasData.length > 10000) {
            roomCanvasData.splice(0, roomCanvasData.length - 10000);
        }
        
        // Broadcast to all other users in the room
        socket.to(roomId).emit('drawing-data', data);
    });
    
    // Handle cursor movement
    socket.on('cursor-move', (data) => {
        if (!socket.currentRoom) return;
        
        const roomId = data.roomId || socket.currentRoom;
        
        // Broadcast cursor position to all other users in the room
        socket.to(roomId).emit('cursor-move', {
            userId: socket.id,
            x: data.x,
            y: data.y,
            color: data.color || '#ff4757'
        });
    });
    
    // Handle canvas clear
    socket.on('clear-canvas', (roomId) => {
        if (!socket.currentRoom && !roomId) return;
        
        const targetRoom = roomId || socket.currentRoom;
        
        // Clear stored canvas data
        canvasData.set(targetRoom, []);
        
        // Broadcast clear command to all users in the room
        io.to(targetRoom).emit('clear-canvas');
        
        console.log(`Canvas cleared for room: ${targetRoom}`);
    });
    
    // Handle user disconnect
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        if (socket.currentRoom) {
            const room = rooms.get(socket.currentRoom);
            if (room) {
                room.participants.delete(socket.id);
                updateRoomParticipants(socket.currentRoom);
                
                // Clean up empty rooms after 1 hour
                if (room.participants.size === 0) {
                    setTimeout(() => {
                        if (rooms.has(socket.currentRoom) && rooms.get(socket.currentRoom).participants.size === 0) {
                            console.log(`Cleaning up empty room: ${socket.currentRoom}`);
                            rooms.delete(socket.currentRoom);
                            canvasData.delete(socket.currentRoom);
                        }
                    }, 3600000); // 1 hour
                }
            }
        }
    });
    
    // Handle connection errors
    socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
    });
});

// Function to update participant count for a room
function updateRoomParticipants(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        const participantCount = room.participants.size;
        io.to(roomId).emit('participant-count', participantCount);
    }
}

// Cleanup function to remove old rooms and data
function cleanupOldRooms() {
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    for (const [roomId, roomData] of rooms.entries()) {
        if (roomData.participants.size === 0 && roomData.createdAt < oneHourAgo) {
            console.log(`Cleaning up old room: ${roomId}`);
            rooms.delete(roomId);
            canvasData.delete(roomId);
        }
    }
}

// Run cleanup every hour
setInterval(cleanupOldRooms, 3600000);

// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Server started at: ${new Date().toISOString()}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});