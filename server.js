const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

let players = {};
let objects = [];

// ===== 初始化地图物体 =====
for (let i = 0; i < 30; i++) {
  objects.push({
    id: i,
    type: Math.random() > 0.5 ? 'blue' : 'red',
    x: Math.random() * 800,
    y: Math.random() * 600,
    r: 8
  });
}

// ===== 连接处理 =====
wss.on('connection', (ws) => {
  const id = Math.random().toString(36).slice(2, 10);

  players[id] = {
    x: 400,
    y: 300,
    r: 10,
    hp: 50,
    maxHp: 50,
    input: { x: 0, y: 0 }
  };

  // 发ID
  ws.send(JSON.stringify({
    type: 'init',
    id
  }));

  // 收输入
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'input' && players[id]) {
        players[id].input = data.input || { x: 0, y: 0 };
      }
    } catch (e) {
      // 忽略非法数据
    }
  });

  // 断开连接
  ws.on('close', () => {
    delete players[id];
  });
});

// ===== 游戏主循环（20Hz）=====
setInterval(() => {
  // 更新玩家
  for (const id in players) {
    const p = players[id];
    if (!p) continue;

    // 输入安全处理（防 NaN）
    const ix = p.input?.x || 0;
    const iy = p.input?.y || 0;

    // 移动
    p.x += ix * 3;
    p.y += iy * 3;

    // 边界限制
    p.x = Math.max(0, Math.min(1000, p.x));
    p.y = Math.max(0, Math.min(800, p.y));

    // 碰撞检测
    for (const o of objects) {
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < p.r + o.r) {
        if (o.type === 'blue') {
          p.maxHp += 1;
          p.hp += 0.5;
        } else {
          p.hp += 1;
        }

        p.hp = Math.min(p.hp, p.maxHp);
      }
    }
  }

  // ===== 广播（安全版）=====
  const payload = JSON.stringify({
    type: 'state',
    players,
    objects
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (e) {
        // 忽略发送失败
      }
    }
  });

}, 50); // 20Hz