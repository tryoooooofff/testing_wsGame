// ── 配置（修改这里连接你的 Railway 服务器）──────────────────────
// 开发时使用 ws://localhost:3000
// 部署后替换为 wss://你的服务.railway.app
const WS_URL = window.location.hostname === 'localhost'
  ? `ws://localhost:3000`
  : `wss://${window.location.hostname.replace('github.io', 'railway.app').replace(/^[^.]+\./, '')}`;
// 如果自动检测不准，直接硬编码：
// const WS_URL = 'wss://YOUR-APP.railway.app';

const ARENA_W = 800, ARENA_H = 600;
const PLAYER_SIZE = 20, BULLET_SIZE = 5;

// ── 状态 ─────────────────────────────────────────────────────────
let ws = null;
let myId = 0;
let gameState = { players: [], bullets: [], pickups: [] };
let inputKeys = 0;
let mouseAngle = 0;
let firing = false;
let connected = false;
let playerName = '';
let frameCount = 0;

// ── Canvas 设置 ───────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = ARENA_W; canvas.height = ARENA_H;

// ── 输入处理 ──────────────────────────────────────────────────────
const keyMap = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8 };

document.addEventListener('keydown', e => {
  const bit = keyMap[e.code];
  if (bit) { inputKeys |= bit; e.preventDefault(); }
  if (e.code === 'Space') { firing = true; e.preventDefault(); }
});
document.addEventListener('keyup', e => {
  const bit = keyMap[e.code];
  if (bit) inputKeys &= ~bit;
  if (e.code === 'Space') firing = false;
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = ARENA_W / rect.width;
  const scaleY = ARENA_H / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;
  const me = gameState.players.find(p => p.id === myId);
  if (me) mouseAngle = Math.atan2(my - me.y, mx - me.x);
});

canvas.addEventListener('mousedown', () => firing = true);
canvas.addEventListener('mouseup', () => firing = false);

// 触摸支持（移动端虚拟摇杆）
let touchStart = null;
canvas.addEventListener('touchstart', e => { e.preventDefault(); touchStart = e.touches[0]; });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!touchStart) return;
  const t = e.touches[0];
  const dx = t.clientX - touchStart.clientX;
  const dy = t.clientY - touchStart.clientY;
  inputKeys = 0;
  if (Math.abs(dx) > 15 || Math.abs(dy) > 15) {
    if (dy < -15) inputKeys |= 1;
    if (dy >  15) inputKeys |= 2;
    if (dx < -15) inputKeys |= 4;
    if (dx >  15) inputKeys |= 8;
  }
  mouseAngle = Math.atan2(dy, dx);
  firing = Math.sqrt(dx*dx + dy*dy) > 60;
});
canvas.addEventListener('touchend', () => { inputKeys = 0; firing = false; touchStart = null; });

// ── WS 通信 ───────────────────────────────────────────────────────
function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const buf = new ArrayBuffer(5);
  const view = new DataView(buf);
  view.setUint8(0, 1);          // type: input
  view.setUint8(1, inputKeys);
  view.setInt16(2, Math.round(mouseAngle * 100), true);
  view.setUint8(4, firing ? 1 : 0);
  ws.send(buf);
}

function sendJoin(name) {
  const nb = new TextEncoder().encode(name.slice(0, 12));
  const buf = new ArrayBuffer(2 + nb.length);
  const view = new DataView(buf);
  view.setUint8(0, 0);          // type: join
  view.setUint8(1, nb.length);
  new Uint8Array(buf, 2).set(nb);
  ws.send(buf);
}

// ── 二进制解析 ────────────────────────────────────────────────────
function parseState(buf) {
  const view = new DataView(buf);
  let o = 1; // skip type byte
  const state = { players: [], bullets: [], pickups: [] };
  const dec = new TextDecoder();

  // 玩家
  const pc = view.getUint16(o, true); o += 2;
  for (let i = 0; i < pc; i++) {
    const id    = view.getUint16(o, true); o += 2;
    const x     = view.getInt16(o, true);  o += 2;
    const y     = view.getInt16(o, true);  o += 2;
    const angle = view.getInt16(o, true) / 100; o += 2;
    const hp    = view.getUint8(o++);
    const shield= view.getUint8(o++);
    const ammo  = view.getUint8(o++);
    const score = view.getUint16(o, true); o += 2;
    const color = view.getUint32(o, true); o += 4;
    const dead  = view.getUint8(o++) === 1;
    const nl    = view.getUint8(o++);
    const name  = dec.decode(new Uint8Array(buf, o, nl)); o += nl;
    state.players.push({ id, x, y, angle, hp, shield, ammo, score, color, dead, name });
  }

  // 子弹
  const bc = view.getUint16(o, true); o += 2;
  for (let i = 0; i < bc; i++) {
    const id = view.getUint16(o, true); o += 2;
    const x  = view.getInt16(o, true);  o += 2;
    const y  = view.getInt16(o, true);  o += 2;
    state.bullets.push({ id, x, y });
  }

  // 拾取物
  const ukc = view.getUint16(o, true); o += 2;
  for (let i = 0; i < ukc; i++) {
    const id   = view.getUint16(o, true); o += 2;
    const x    = view.getInt16(o, true);  o += 2;
    const y    = view.getInt16(o, true);  o += 2;
    const type = view.getUint8(o++);
    state.pickups.push({ id, x, y, type });
  }

  return state;
}

// ── 连接逻辑 ──────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    connected = true;
    sendJoin(playerName);
    document.getElementById('overlay').style.display = 'none';
  };

  ws.onmessage = e => {
    const buf = e.data;
    const view = new DataView(buf);
    const type = view.getUint8(0);
    if (type === 0) {
      myId = view.getUint16(1, true); // welcome
    } else if (type === 1) {
      gameState = parseState(buf);
    }
  };

  ws.onclose = () => {
    connected = false;
    myId = 0;
    document.getElementById('overlay').style.display = 'flex';
    document.getElementById('status').textContent = '连接已断开，请重新进入';
    setTimeout(() => {}, 0);
  };

  ws.onerror = () => {
    document.getElementById('status').textContent = '连接失败，检查服务器地址';
  };
}

// ── 渲染 ──────────────────────────────────────────────────────────
function colorFromInt(n) {
  return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

function drawArena() {
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < ARENA_W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke(); }
  for (let y = 0; y < ARENA_H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke(); }

  // 边界
  ctx.strokeStyle = 'rgba(100,200,255,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, ARENA_W - 2, ARENA_H - 2);
}

function drawPlayer(p) {
  const color = colorFromInt(p.color);
  ctx.save();
  ctx.translate(p.x, p.y);

  if (p.dead) {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_SIZE, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); return;
  }

  // 护盾光环
  if (p.shield > 0) {
    ctx.globalAlpha = p.shield / 200 * 0.4;
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_SIZE + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 坦克本体
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, PLAYER_SIZE, 0, Math.PI * 2); ctx.fill();

  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath(); ctx.arc(-4, -4, PLAYER_SIZE * 0.5, 0, Math.PI * 2); ctx.fill();

  // 炮管
  ctx.rotate(p.angle);
  ctx.fillStyle = color;
  ctx.fillRect(0, -5, PLAYER_SIZE + 6, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(PLAYER_SIZE, -3, 8, 6);

  ctx.restore();

  // 名字 & 血条
  const bw = 40, bh = 4;
  const bx = p.x - bw / 2, by = p.y - PLAYER_SIZE - 14;
  ctx.fillStyle = '#333'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = p.hp > 50 ? '#44ff88' : p.hp > 25 ? '#ffaa00' : '#ff4444';
  ctx.fillRect(bx, by, bw * p.hp / 100, bh);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(p.name, p.x, p.y - PLAYER_SIZE - 18);

  // 我自己加箭头标记
  if (p.id === myId) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('▼', p.x, p.y - PLAYER_SIZE - 28);
  }
}

function drawBullet(b) {
  ctx.fillStyle = '#ffdd44';
  ctx.shadowColor = '#ffaa00';
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(b.x, b.y, BULLET_SIZE, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}

function drawPickup(pk) {
  ctx.save();
  ctx.translate(pk.x, pk.y);
  const pulse = Math.sin(frameCount * 0.05) * 3;
  if (pk.type === 0) {
    ctx.fillStyle = '#ffaa00';
    ctx.font = `${16 + pulse}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔫', 0, 0);
  } else {
    ctx.fillStyle = '#00ffff';
    ctx.font = `${16 + pulse}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🛡', 0, 0);
  }
  ctx.restore();
}

function drawHUD() {
  const me = gameState.players.find(p => p.id === myId);
  if (!me) return;

  // 底部HUD
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, ARENA_H - 44, ARENA_W, 44);

  ctx.font = '13px monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#44ff88';
  ctx.fillText(`❤ ${me.hp}`, 12, ARENA_H - 22);
  ctx.fillStyle = me.shield > 0 ? '#00ffff' : '#444';
  ctx.fillText(`🛡 ${me.shield}`, 80, ARENA_H - 22);
  ctx.fillStyle = '#ffaa00';
  ctx.fillText(`🔫 ${me.ammo}`, 160, ARENA_H - 22);
  ctx.fillStyle = '#fff';
  ctx.fillText(`★ ${me.score}`, 240, ARENA_H - 22);

  // 记分板
  const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(ARENA_W - 160, 8, 152, sorted.length * 20 + 10);
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  sorted.forEach((p, i) => {
    ctx.fillStyle = p.id === myId ? '#fff' : 'rgba(255,255,255,0.65)';
    const mark = p.dead ? '💀' : '●';
    ctx.fillText(`${mark} ${p.name} ${p.score}`, ARENA_W - 155, 22 + i * 20);
  });

  // 在线人数
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`在线: ${gameState.players.length}`, 12, 16);

  if (me.dead) {
    ctx.fillStyle = 'rgba(255,60,60,0.7)';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('已阵亡 — 正在复活...', ARENA_W / 2, ARENA_H / 2);
  }
}

// ── 主游戏循环 ────────────────────────────────────────────────────
let lastInput = 0;
function loop(ts) {
  frameCount++;
  if (connected && ts - lastInput > 16) {  // ~60fps 发送输入
    sendInput();
    lastInput = ts;
  }
  drawArena();
  for (const pk of gameState.pickups) drawPickup(pk);
  for (const b of gameState.bullets) drawBullet(b);
  for (const p of gameState.players) drawPlayer(p);
  drawHUD();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ── UI 事件 ───────────────────────────────────────────────────────
document.getElementById('joinBtn').addEventListener('click', () => {
  playerName = document.getElementById('nameInput').value.trim() || 'Player';
  connect();
});
document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('joinBtn').click();
});
