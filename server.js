const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// 房间数据结构: Map<roomId, Set<WebSocket>>
const rooms = new Map();

// 玩家数据: Map<WebSocket, playerData>
const players = new Map();

function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    return rooms.get(roomId);
}

function broadcastToRoom(roomId, message, excludeWs = null) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const data = JSON.stringify(message);
    room.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN && ws !== excludeWs) {
            ws.send(data);
        }
    });
}

wss.on('connection', (ws) => {
    console.log(`[CONNECT] 新连接建立，当前连接数: ${wss.clients.size}`);
    
    let currentRoom = null;
    let playerData = null;
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            
            switch (msg.type) {
                case 'JOIN':
                    // 离开旧房间
                    if (currentRoom && rooms.has(currentRoom)) {
                        const oldRoom = rooms.get(currentRoom);
                        oldRoom.delete(ws);
                        if (oldRoom.size === 0) rooms.delete(currentRoom);
                    }
                    
                    // 加入新房间
                    currentRoom = msg.room || 'public';
                    const room = getOrCreateRoom(currentRoom);
                    room.add(ws);
                    
                    playerData = {
                        id: msg.id,
                        x: msg.x || 0,
                        y: msg.y || 0,
                        hp: msg.hp || 100,
                        maxHp: msg.maxHp || 100,
                        radius: msg.radius || 22
                    };
                    players.set(ws, playerData);
                    
                    // 广播 JOIN 消息给房间内其他玩家
                    broadcastToRoom(currentRoom, {
                        type: 'JOIN',
                        room: currentRoom,
                        id: msg.id,
                        x: msg.x,
                        y: msg.y,
                        hp: msg.hp,
                        maxHp: msg.maxHp,
                        radius: msg.radius
                    }, ws);
                    
                    // 发送房间内其他玩家的状态给新加入的玩家
                    room.forEach(otherWs => {
                        if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
                            const otherPlayer = players.get(otherWs);
                            if (otherPlayer) {
                                ws.send(JSON.stringify({
                                    type: 'STATE',
                                    room: currentRoom,
                                    id: otherPlayer.id,
                                    x: otherPlayer.x,
                                    y: otherPlayer.y,
                                    hp: otherPlayer.hp,
                                    maxHp: otherPlayer.maxHp,
                                    radius: otherPlayer.radius
                                }));
                            }
                        }
                    });
                    
                    console.log(`[JOIN] 玩家 ${msg.id.slice(-6)} 加入房间 "${currentRoom}"，房间玩家数: ${room.size}`);
                    break;
                
                case 'STATE':
                    if (!currentRoom || msg.room !== currentRoom) return;
                    
                    // 更新玩家数据
                    if (playerData) {
                        playerData.x = msg.x;
                        playerData.y = msg.y;
                        playerData.hp = msg.hp;
                        playerData.maxHp = msg.maxHp;
                        playerData.radius = msg.radius;
                    }
                    
                    // 广播状态给房间内其他玩家
                    broadcastToRoom(currentRoom, {
                        type: 'STATE',
                        room: currentRoom,
                        id: msg.id,
                        x: msg.x,
                        y: msg.y,
                        hp: msg.hp,
                        maxHp: msg.maxHp,
                        radius: msg.radius
                    }, ws);
                    break;
                
                case 'LEAVE':
                    if (currentRoom && msg.room === currentRoom && playerData) {
                        // 广播 LEAVE 消息
                        broadcastToRoom(currentRoom, {
                            type: 'LEAVE',
                            room: currentRoom,
                            id: msg.id
                        });
                        
                        console.log(`[LEAVE] 玩家 ${msg.id.slice(-6)} 离开房间 "${currentRoom}"`);
                    }
                    break;
            }
        } catch (e) {
            console.warn('[MSG] 解析消息失败:', e.message);
        }
    });
    
    ws.on('close', () => {
        // 从房间移除
        if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            room.delete(ws);
            
            // 如果房间为空则删除
            if (room.size === 0) {
                rooms.delete(currentRoom);
            } else if (playerData) {
                // 广播玩家离线消息
                broadcastToRoom(currentRoom, {
                    type: 'LEAVE',
                    room: currentRoom,
                    id: playerData.id
                });
            }
        }
        
        // 清除玩家数据
        players.delete(ws);
        
        console.log(`[DISCONNECT] 连接断开，当前连接数: ${wss.clients.size}`);
    });
    
    ws.on('error', (err) => {
        console.error('[ERROR] WebSocket 错误:', err.message);
    });
});

server.listen(PORT, () => {
    console.log(`🎮 Game WebSocket Server running on port ${PORT}`);
    console.log(`📡 Connect from: ws://localhost:${PORT}`);
});
