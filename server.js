const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const {
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  ROOM_TTL_MS,
  sanitizeRoomCode,
  sanitizeClientId,
  sanitizeCategory,
  sanitizeWinLines,
  sanitizeCustomItems,
  sanitizeChat,
  createRoom,
  getPlayer,
  getPlayerByClientId,
  makeGuest,
  reconnectGuest,
  roomState,
  addMessage,
  markDisconnected,
  cleanupRooms,
  callNextItem,
  skipCurrentCaller,
  startGame,
  resetToLobby,
  checkWinners
} = require("./src/game");

const PORT = process.env.PORT || 3000;
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 60000);
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);
const rooms = new Map();

function allowOrigin(origin, callback) {
  if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error("Origin not allowed"));
}

const io = new Server(server, {
  cors: {
    origin: allowOrigin
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    uptime: process.uptime()
  });
});

app.get("/room/:roomCode", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function safePayload(payload) {
  return payload && typeof payload === "object" ? payload : {};
}

function callbackError(callback, error) {
  callback?.({ ok: false, error });
}

function emitRoom(room) {
  [...room.participants, ...room.spectators].forEach((player) => {
    if (player.connected === false) return;
    io.to(player.id).emit("room:state", roomState(room, player.id));
  });
}

function makeRateLimiter(limit, windowMs) {
  const buckets = new Map();
  return (socket, key) => {
    const id = `${socket.id}:${key}`;
    const current = Date.now();
    const bucket = buckets.get(id) || { count: 0, resetAt: current + windowMs };
    if (current > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = current + windowMs;
    }
    bucket.count += 1;
    buckets.set(id, bucket);
    return bucket.count <= limit;
  };
}

const allowAction = makeRateLimiter(30, 10000);
const allowGameCall = makeRateLimiter(180, 10000);
const allowChat = makeRateLimiter(8, 10000);
const allowCreate = makeRateLimiter(5, 60000);

function withRoom(socket, callback) {
  const room = rooms.get(socket.data.roomCode);
  if (!room) return null;
  callback(room);
  return room;
}

function joinExistingSeat(socket, room, payload) {
  const clientId = sanitizeClientId(payload.clientId);
  const existing = getPlayerByClientId(room, clientId);
  if (!existing) return null;

  reconnectGuest(room, existing, socket.id, payload.name);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.clientId = clientId;
  addMessage(room, { type: "system", text: `${existing.name} 已重新連線。` });
  return existing;
}

function joinRoom(socket, room, payload) {
  const reconnected = joinExistingSeat(socket, room, payload);
  if (reconnected) return { guest: reconnected, reconnected: true };

  const role = room.participants.length < MAX_PLAYERS && room.status === "lobby" ? "player" : "spectator";
  const guest = makeGuest(
    socket.id,
    payload.clientId,
    payload.name,
    role,
    room.participants.length === 0 && room.spectators.length === 0
  );

  if (role === "player") {
    room.participants.push(guest);
  } else {
    room.spectators.push(guest);
  }

  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.clientId = guest.clientId;
  addMessage(room, {
    type: "system",
    text: role === "player" ? `${guest.name} 加入參賽席。` : `${guest.name} 加入觀眾席。`
  });
  return { guest, reconnected: false };
}

io.on("connection", (socket) => {
  socket.on("room:create", (rawPayload, callback) => {
    if (!allowCreate(socket, "room:create")) {
      callbackError(callback, "建立房間太頻繁，請稍後再試。");
      return;
    }

    const payload = safePayload(rawPayload);
    const room = createRoom(rooms);
    const player = makeGuest(socket.id, payload.clientId, payload.name, "player", true);
    room.participants.push(player);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.clientId = player.clientId;

    addMessage(room, { type: "system", text: `${player.name} 建立房間，成為房主。` });
    callback?.({ ok: true, roomCode: room.code, role: player.role });
    emitRoom(room);
  });

  socket.on("room:join", (rawPayload, callback) => {
    if (!allowAction(socket, "room:join")) {
      callbackError(callback, "加入太頻繁，請稍後再試。");
      return;
    }

    const payload = safePayload(rawPayload);
    const code = sanitizeRoomCode(payload.roomCode);
    const room = rooms.get(code);
    if (!room) {
      callbackError(callback, "找不到房間，請確認代碼是否正確。");
      return;
    }

    const { guest, reconnected } = joinRoom(socket, room, payload);
    callback?.({ ok: true, roomCode: code, role: guest.role, reconnected });
    emitRoom(room);
  });

  socket.on("room:updateSettings", (rawPayload, callback) => {
    if (!allowAction(socket, "room:updateSettings")) {
      callbackError(callback, "操作太頻繁，請稍後再試。");
      return;
    }

    withRoom(socket, (room) => {
      const payload = safePayload(rawPayload);
      const player = getPlayer(room, socket.id);
      if (!player?.isHost) {
        callbackError(callback, "只有房主可以調整設定。");
        return;
      }
      if (room.status === "playing") {
        callbackError(callback, "遊戲進行中不能調整設定。");
        return;
      }

      room.settings.category = sanitizeCategory(payload.category);
      room.settings.customItems = sanitizeCustomItems(payload.customItems);
      room.settings.winLines = sanitizeWinLines(payload.winLines);
      addMessage(room, {
        type: "system",
        text: `房主更新設定：${room.settings.winLines} 條線決勝。`
      });
      callback?.({ ok: true });
      emitRoom(room);
    });
  });

  socket.on("room:takeSeat", (rawPayload, callback) => {
    if (!allowAction(socket, "room:takeSeat")) {
      callbackError(callback, "操作太頻繁，請稍後再試。");
      return;
    }

    withRoom(socket, (room) => {
      const spectator = room.spectators.find((player) => player.id === socket.id);
      if (!spectator) {
        callbackError(callback, "你已經在參賽席，或尚未加入房間。");
        return;
      }
      if (room.status !== "lobby") {
        callbackError(callback, "只有準備室可以加入參賽席。");
        return;
      }
      if (room.participants.length >= MAX_PLAYERS) {
        callbackError(callback, "參賽席已滿，最多 6 人。");
        return;
      }

      room.spectators = room.spectators.filter((player) => player.id !== socket.id);
      spectator.role = "player";
      spectator.board = null;
      spectator.wishUsed = false;
      room.participants.push(spectator);
      addMessage(room, { type: "system", text: `${spectator.name} 從觀眾席加入參賽席。` });
      callback?.({ ok: true });
      emitRoom(room);
    });
  });

  socket.on("game:start", () => {
    if (!allowAction(socket, "game:start")) return;
    withRoom(socket, (room) => {
      const player = getPlayer(room, socket.id);
      if (!player?.isHost) return;
      startGame(room);
      emitRoom(room);
    });
  });

  socket.on("game:call", (rawPayload = {}) => {
    if (!allowGameCall(socket, "game:call")) return;
    withRoom(socket, (room) => {
      const payload = safePayload(rawPayload);
      callNextItem(room, socket.id, payload.wish);
      emitRoom(room);
    });
  });

  socket.on("game:skipCaller", () => {
    if (!allowAction(socket, "game:skipCaller")) return;
    withRoom(socket, (room) => {
      skipCurrentCaller(room, socket.id);
      emitRoom(room);
    });
  });

  socket.on("game:reset", () => {
    if (!allowAction(socket, "game:reset")) return;
    withRoom(socket, (room) => {
      const player = getPlayer(room, socket.id);
      if (!player?.isHost) return;
      resetToLobby(room);
      emitRoom(room);
    });
  });

  socket.on("chat:message", (rawPayload) => {
    if (!allowChat(socket, "chat:message")) return;
    withRoom(socket, (room) => {
      const payload = safePayload(rawPayload);
      const player = getPlayer(room, socket.id);
      if (!player) return;

      const cleanText = sanitizeChat(payload.text);
      if (!cleanText) return;

      addMessage(room, {
        type: "chat",
        playerName: player.name,
        text: cleanText
      });
      io.to(room.code).emit("chat:message", room.messages[room.messages.length - 1]);
    });
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;

    const leavingPlayer = markDisconnected(room, socket.id);
    if (leavingPlayer) {
      addMessage(room, { type: "system", text: `${leavingPlayer.name} 暫時離線。` });
    }

    if (room.status === "playing") {
      checkWinners(room);
    }

    emitRoom(room);
  });
});

const cleanupTimer = setInterval(() => {
  cleanupRooms(rooms);
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();

server.listen(PORT, () => {
  console.log(`小u0賓果bingo server running on http://localhost:${PORT}`);
  console.log(`Reconnect grace: ${RECONNECT_GRACE_MS}ms, room TTL: ${ROOM_TTL_MS}ms`);
});

module.exports = { app, server, io, rooms };
