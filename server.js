const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const { randomBytes } = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// roomId -> room object
const rooms = new Map();

function generateRoomId() {
  return randomBytes(3).toString('hex').toUpperCase();
}

function wsSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  const msg = JSON.stringify(data);
  room.clients.forEach(ws => {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  });
}

function buildRoomState(room) {
  const players = [];
  room.clients.forEach(ws => {
    if (!ws.player) return;
    players.push({
      id: ws.player.id,
      name: ws.player.name,
      isModerator: ws.player.id === room.moderatorId,
      voted: ws.player.voted,
      voteValue: room.revealed ? ws.player.voteValue : null,
    });
  });
  return {
    type: 'room_state',
    roomId: room.id,
    moderatorId: room.moderatorId,
    tasks: room.tasks,
    currentTaskIndex: room.currentTaskIndex,
    revealed: room.revealed,
    taskAverages: room.taskAverages,
    players,
  };
}

function resetVotes(room) {
  room.revealed = false;
  room.clients.forEach(ws => {
    if (ws.player) {
      ws.player.voted = false;
      ws.player.voteValue = null;
    }
  });
}

wss.on('connection', ws => {
  ws.player = null;
  ws.roomId = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'create_room': {
        const name = String(msg.name || '').trim().slice(0, 30);
        if (!name) return;
        const roomId = generateRoomId();
        const playerId = randomBytes(4).toString('hex');
        const room = {
          id: roomId,
          moderatorId: playerId,
          clients: new Set([ws]),
          tasks: [],
          currentTaskIndex: 0,
          revealed: false,
          taskAverages: [],
        };
        rooms.set(roomId, room);
        ws.roomId = roomId;
        ws.player = { id: playerId, name, voted: false, voteValue: null };
        wsSend(ws, { type: 'joined', playerId, isModerator: true, roomId });
        broadcast(room, buildRoomState(room));
        break;
      }

      case 'join_room': {
        const name = String(msg.name || '').trim().slice(0, 30);
        const roomId = String(msg.roomId || '').trim().toUpperCase();
        if (!name) return;
        const room = rooms.get(roomId);
        if (!room) {
          wsSend(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
          return;
        }
        const playerId = randomBytes(4).toString('hex');
        ws.roomId = roomId;
        ws.player = { id: playerId, name, voted: false, voteValue: null };
        room.clients.add(ws);
        wsSend(ws, { type: 'joined', playerId, isModerator: false, roomId });
        broadcast(room, buildRoomState(room));
        break;
      }

      case 'upload_tasks': {
        const room = rooms.get(ws.roomId);
        if (!room || !ws.player || ws.player.id !== room.moderatorId) return;
        if (!Array.isArray(msg.tasks)) return;
        room.tasks = msg.tasks.slice(0, 200).map(t => ({
          key: String(t.key || '').slice(0, 50),
          summary: String(t.summary || '').slice(0, 300),
        }));
        room.currentTaskIndex = 0;
        room.taskAverages = [];
        resetVotes(room);
        broadcast(room, buildRoomState(room));
        break;
      }

      case 'vote': {
        const room = rooms.get(ws.roomId);
        if (!room || !ws.player || room.revealed) return;
        if (room.currentTaskIndex >= room.tasks.length) return;
        ws.player.voted = true;
        ws.player.voteValue = String(msg.value || '').slice(0, 10);
        broadcast(room, buildRoomState(room));
        break;
      }

      case 'reveal': {
        const room = rooms.get(ws.roomId);
        if (!room || !ws.player || ws.player.id !== room.moderatorId) return;
        room.revealed = true;
        // Compute and persist average for current task
        const voters = [...room.clients].filter(c => c.player?.voted);
        const nums = voters
          .map(c => Number(c.player.voteValue))
          .filter(n => !isNaN(n));
        room.taskAverages[room.currentTaskIndex] =
          nums.length > 0
            ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)
            : null;
        broadcast(room, buildRoomState(room));
        break;
      }

      case 'reset_votes': {
        const room = rooms.get(ws.roomId);
        if (!room || !ws.player || ws.player.id !== room.moderatorId) return;
        resetVotes(room);
        broadcast(room, buildRoomState(room));
        break;
      }

      case 'next_task': {
        const room = rooms.get(ws.roomId);
        if (!room || !ws.player || ws.player.id !== room.moderatorId) return;
        if (room.currentTaskIndex < room.tasks.length) {
          room.currentTaskIndex++;
        }
        resetVotes(room);
        broadcast(room, buildRoomState(room));
        break;
      }

      case 'prev_task': {
        const room = rooms.get(ws.roomId);
        if (!room || !ws.player || ws.player.id !== room.moderatorId) return;
        if (room.currentTaskIndex > 0) {
          room.currentTaskIndex--;
        }
        resetVotes(room);
        broadcast(room, buildRoomState(room));
        break;
      }

      case 'goto_task': {
        const room = rooms.get(ws.roomId);
        if (!room || !ws.player || ws.player.id !== room.moderatorId) return;
        const idx = Number(msg.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= room.tasks.length) return;
        if (idx === room.currentTaskIndex) return;
        room.currentTaskIndex = idx;
        resetVotes(room);
        broadcast(room, buildRoomState(room));
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      rooms.delete(ws.roomId);
    } else {
      broadcast(room, buildRoomState(room));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  Planning Poker is running!`);
  console.log(`  Open http://localhost:${PORT} in your browser\n`);
});
