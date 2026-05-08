const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.static('.'));

const rooms = new Map(); // { roomId: Set<player> }
const players = new Map(); // { ws: { id, room, x, y, ... } }

wss.on('connection', (ws) => {
    console.log('[WS] New connection');
    let playerData = null;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            const { type, room, id, x, y, hp, maxHp, radius } = msg;

            // First time joining
            if (!playerData) {
                playerData = { id, room, x, y, hp, maxHp, radius };
                players.set(ws, playerData);
                
                if (!rooms.has(room)) {
                    rooms.set(room, new Set());
                }
                rooms.get(room).add(ws);
                console.log(`[JOIN] Player ${id.slice(-6)} joined room "${room}"`);
            } else {
                // Update existing player data
                playerData.room = room;
                playerData.x = x;
                playerData.y = y;
                playerData.hp = hp;
                playerData.maxHp = maxHp;
                playerData.radius = radius;
            }

            // Handle room changes
            if (playerData.room !== room) {
                // Leave old room
                if (rooms.has(playerData.room)) {
                    rooms.get(playerData.room).delete(ws);
                    // Notify others
                    broadcastToRoom(playerData.room, {
                        type: 'LEAVE',
                        id: id,
                        room: playerData.room
                    });
                }
                // Join new room
                playerData.room = room;
                if (!rooms.has(room)) {
                    rooms.set(room, new Set());
                }
                rooms.get(room).add(ws);
                console.log(`[ROOM_CHANGE] Player ${id.slice(-6)} moved to "${room}"`);
            }

            // Broadcast message to all players in the room
            broadcastToRoom(room, msg);

        } catch (e) {
            console.error('[ERROR] Message parsing:', e.message);
        }
    });

    ws.on('close', () => {
        if (playerData) {
            const { id, room } = playerData;
            console.log(`[LEAVE] Player ${id.slice(-6)} disconnected from "${room}"`);
            
            if (rooms.has(room)) {
                rooms.get(room).delete(ws);
                // Notify others
                broadcastToRoom(room, {
                    type: 'LEAVE',
                    id: id,
                    room: room
                });
            }
        }
        players.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('[WS_ERROR]', err.message);
    });
});

function broadcastToRoom(room, msg) {
    if (!rooms.has(room)) return;
    rooms.get(room).forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg));
        }
    });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 WebSocket relay server running on port ${PORT}`);
    console.log(`📡 Connect to: ws://localhost:${PORT}`);
});