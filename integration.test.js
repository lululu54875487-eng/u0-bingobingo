const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 6;
const MAX_NAME_LENGTH = 14;
const MAX_CUSTOM_ITEMS = 120;
const MAX_ITEM_LENGTH = 18;
const MAX_CHAT_LENGTH = 80;
const WISH_SUCCESS_RATE = 0.35;
const MESSAGE_LIMIT = 80;
const PUBLIC_MESSAGE_LIMIT = 60;
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 30000);
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 2 * 60 * 60 * 1000);

const itemCategories = {
  numbers: {
    label: "數字派對",
    items: Array.from({ length: 75 }, (_, index) => String(index + 1))
  },
  fruits: {
    label: "水果果籃",
    items: [
      "蘋果", "香蕉", "草莓", "葡萄", "西瓜", "芒果", "鳳梨", "奇異果", "水蜜桃", "櫻桃",
      "橘子", "柳橙", "檸檬", "藍莓", "蔓越莓", "梨子", "哈密瓜", "木瓜", "火龍果", "百香果",
      "番石榴", "柚子", "荔枝", "龍眼", "桑葚", "椰子", "柿子", "李子", "梅子", "無花果",
      "覆盆莓", "葡萄柚", "香瓜", "蓮霧", "楊桃", "酪梨", "榴槤", "山竹", "紅毛丹", "枇杷",
      "甜桃", "金桔", "棗子", "黑莓", "蜜蘋果", "青蘋果", "蜜柑", "甜橙", "小番茄", "白葡萄"
    ]
  },
  animals: {
    label: "動物朋友",
    items: [
      "小狗", "小貓", "兔子", "倉鼠", "企鵝", "熊貓", "長頸鹿", "大象", "獅子", "老虎",
      "斑馬", "河馬", "無尾熊", "海豚", "鯨魚", "海龜", "狐狸", "松鼠", "刺蝟", "羊駝",
      "浣熊", "貓頭鷹", "鸚鵡", "天鵝", "孔雀", "青蛙", "烏龜", "章魚", "水母", "海星",
      "蜜蜂", "蝴蝶", "瓢蟲", "駱駝", "袋鼠", "北極熊", "馴鹿", "小雞", "鴨子", "綿羊",
      "小豬", "小牛", "馬兒", "猴子", "樹懶", "獨角仙", "螢火蟲", "鯊魚", "貝殼", "螃蟹"
    ]
  }
};

const categoryOptions = [
  { id: "mixed", label: "全部混合" },
  ...Object.entries(itemCategories).map(([id, category]) => ({ id, label: category.label })),
  { id: "custom", label: "自訂題庫" }
];

function now() {
  return Date.now();
}

function sanitizeText(input, maxLength) {
  return String(input || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function sanitizeRoomCode(roomCode) {
  return String(roomCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function sanitizeName(name) {
  return sanitizeText(name, MAX_NAME_LENGTH) || `小玩家${Math.floor(Math.random() * 90) + 10}`;
}

function sanitizeClientId(clientId) {
  return String(clientId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function sanitizeCategory(category) {
  const cleanCategory = String(category || "mixed");
  return categoryOptions.some((item) => item.id === cleanCategory) ? cleanCategory : "mixed";
}

function sanitizeWinLines(winLines) {
  const clean = Number(winLines) || 1;
  return Math.max(1, Math.min(clean, 3));
}

function sanitizeCustomItems(input) {
  const lines = Array.isArray(input) ? input : String(input || "").split(/\r?\n|,|，|、/);
  const seen = new Set();
  const items = [];

  lines.forEach((line) => {
    const item = sanitizeText(line, MAX_ITEM_LENGTH);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return;
    seen.add(key);
    items.push(item);
  });

  return items.slice(0, MAX_CUSTOM_ITEMS);
}

function sanitizeWish(input) {
  return sanitizeText(input, MAX_ITEM_LENGTH);
}

function sanitizeChat(input) {
  return sanitizeText(input, MAX_CHAT_LENGTH);
}

function makeRoomCode(rooms) {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return rooms.has(code) ? makeRoomCode(rooms) : code;
}

function createRoom(rooms, roomCode = makeRoomCode(rooms)) {
  const room = {
    code: roomCode,
    participants: [],
    spectators: [],
    messages: [],
    status: "lobby",
    calledItems: [],
    callDeck: [],
    winners: [],
    callerIndex: 0,
    createdAt: now(),
    lastActiveAt: now(),
    settings: {
      category: "mixed",
      customItems: [],
      winLines: 1
    }
  };
  rooms.set(roomCode, room);
  return room;
}

function touchRoom(room) {
  room.lastActiveAt = now();
}

function getItemPool(settings) {
  const customItems = settings.customItems || [];

  if (settings.category === "custom") {
    return customItems;
  }

  const baseItems =
    settings.category === "mixed"
      ? Object.values(itemCategories).flatMap((category) => category.items)
      : itemCategories[settings.category]?.items || [];

  const seen = new Set();
  return [...baseItems, ...customItems].filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeBoard(pool) {
  const picks = shuffle(pool).slice(0, 24);
  const board = [];
  for (let i = 0; i < 25; i += 1) {
    board.push(i === 12 ? { text: "FREE", free: true } : { text: picks[i > 12 ? i - 1 : i], free: false });
  }
  return board;
}

function makeCallDeckFromBoards(players) {
  const seen = new Set();
  const items = [];

  players.forEach((player) => {
    (player.board || []).forEach((cell) => {
      if (!cell?.text || cell.free) return;
      const key = cell.text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push(cell.text);
    });
  });

  return shuffle(items);
}

function lineCount(board, calledSet) {
  if (!Array.isArray(board) || board.length !== 25) return 0;
  const marked = (index) => board[index]?.free || calledSet.has(board[index]?.text);
  const lines = [];

  for (let row = 0; row < 5; row += 1) {
    lines.push([0, 1, 2, 3, 4].map((offset) => row * 5 + offset));
  }
  for (let col = 0; col < 5; col += 1) {
    lines.push([0, 1, 2, 3, 4].map((offset) => offset * 5 + col));
  }
  lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);

  return lines.filter((line) => line.every(marked)).length;
}

function getPlayer(room, socketId) {
  return room.participants.find((player) => player.id === socketId) || room.spectators.find((player) => player.id === socketId);
}

function getPlayerByClientId(room, clientId) {
  if (!clientId) return null;
  return room.participants.find((player) => player.clientId === clientId) || room.spectators.find((player) => player.clientId === clientId);
}

function currentCaller(room) {
  if (room.status !== "playing" || room.participants.length === 0) return null;
  room.callerIndex %= room.participants.length;
  return room.participants[room.callerIndex];
}

function makeGuest(socketId, clientId, name, role, isHost = false) {
  return {
    id: socketId,
    clientId: sanitizeClientId(clientId),
    name: sanitizeName(name),
    role,
    isHost,
    connected: true,
    disconnectedAt: null,
    wishUsed: false,
    board: null
  };
}

function reconnectGuest(room, guest, socketId, name) {
  guest.id = socketId;
  guest.name = sanitizeName(name || guest.name);
  guest.connected = true;
  guest.disconnectedAt = null;
  touchRoom(room);
  return guest;
}

function publicPlayer(player, room) {
  const calledSet = new Set(room.calledItems);
  const caller = currentCaller(room);
  return {
    id: player.id,
    clientId: player.clientId,
    name: player.name,
    isHost: player.isHost,
    role: player.role,
    connected: player.connected !== false,
    wishUsed: Boolean(player.wishUsed),
    isCaller: caller?.id === player.id,
    lines: player.role === "player" ? lineCount(player.board, calledSet) : 0
  };
}

function viewerBoard(room, viewerId) {
  const player = room.participants.find((item) => item.id === viewerId);
  return player?.board || null;
}

function roomState(room, viewerId) {
  const lastItem = room.calledItems[room.calledItems.length - 1] || null;
  const caller = currentCaller(room);
  return {
    code: room.code,
    participants: room.participants.map((player) => publicPlayer(player, room)),
    spectators: room.spectators.map((player) => publicPlayer(player, room)),
    messages: room.messages.slice(-PUBLIC_MESSAGE_LIMIT),
    status: room.status,
    calledItems: room.calledItems,
    lastItem,
    callerId: caller?.id || null,
    callerName: caller?.name || null,
    winners: room.winners,
    board: viewerBoard(room, viewerId),
    settings: room.settings,
    categoryOptions,
    maxPlayers: MAX_PLAYERS,
    wishSuccessRate: WISH_SUCCESS_RATE
  };
}

function addMessage(room, message) {
  room.messages.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: Date.now(),
    ...message
  });
  room.messages = room.messages.slice(-MESSAGE_LIMIT);
  touchRoom(room);
}

function setCallerById(room, callerId) {
  const index = room.participants.findIndex((player) => player.id === callerId);
  if (index >= 0) room.callerIndex = index;
}

function removeGuest(room, socketId) {
  const previousCallerId = currentCaller(room)?.id || null;
  const leavingPlayer = getPlayer(room, socketId);
  room.participants = room.participants.filter((player) => player.id !== socketId);
  room.spectators = room.spectators.filter((player) => player.id !== socketId);

  const allGuests = [...room.participants, ...room.spectators];
  if (allGuests.length > 0 && !allGuests.some((player) => player.isHost)) {
    allGuests[0].isHost = true;
    addMessage(room, { type: "system", text: `${allGuests[0].name} 接任房主。` });
  }

  if (room.status === "playing" && room.participants.length > 0) {
    if (previousCallerId && previousCallerId !== socketId) {
      setCallerById(room, previousCallerId);
    } else {
      room.callerIndex %= room.participants.length;
    }
  }

  touchRoom(room);
  return leavingPlayer;
}

function markDisconnected(room, socketId) {
  const player = getPlayer(room, socketId);
  if (!player) return null;
  player.connected = false;
  player.disconnectedAt = now();
  touchRoom(room);
  return player;
}

function cleanupStaleGuests(room, cutoff = now()) {
  const staleIds = [...room.participants, ...room.spectators]
    .filter((player) => player.connected === false && player.disconnectedAt && cutoff - player.disconnectedAt > RECONNECT_GRACE_MS)
    .map((player) => player.id);
  staleIds.forEach((id) => removeGuest(room, id));
  return staleIds.length;
}

function cleanupRooms(rooms, cutoff = now()) {
  let removed = 0;
  rooms.forEach((room, code) => {
    cleanupStaleGuests(room, cutoff);
    const guests = [...room.participants, ...room.spectators];
    const hasConnectedGuests = guests.some((player) => player.connected !== false);
    if (guests.length === 0 || (!hasConnectedGuests && cutoff - room.lastActiveAt > ROOM_TTL_MS)) {
      rooms.delete(code);
      removed += 1;
    }
  });
  return removed;
}

function endGame(room, reason = "done") {
  room.status = "finished";

  if (reason === "empty") {
    addMessage(room, { type: "system", text: "題庫叫完了，這局平手收場。" });
  }
}

function checkWinners(room) {
  const calledSet = new Set(room.calledItems);
  const winners = room.participants
    .map((player) => ({
      id: player.id,
      name: player.name,
      lines: lineCount(player.board, calledSet)
    }))
    .filter((player) => player.lines >= room.settings.winLines);

  if (winners.length === 0) return false;

  room.winners = winners;
  addMessage(room, {
    type: "win",
    text: `${winners.map((winner) => winner.name).join("、")} 達成 ${room.settings.winLines} 條線，賓果勝利！`
  });
  endGame(room);
  return true;
}

function drawItem(room, player, wishText, random = Math.random) {
  let item = null;
  const wish = sanitizeWish(wishText);

  if (wish) {
    if (player.wishUsed) {
      addMessage(room, { type: "system", text: `${player.name} 已經用過本局的許願叫號。` });
    } else {
      const wishIndex = room.callDeck.findIndex((candidate) => candidate.toLowerCase() === wish.toLowerCase());
      if (wishIndex < 0) {
        addMessage(room, { type: "wish", text: `${player.name} 許願 ${wish}，但它已經被叫過或不在大家的賓果卡裡，這次不消耗許願。` });
      } else if (random() < WISH_SUCCESS_RATE) {
        player.wishUsed = true;
        item = room.callDeck.splice(wishIndex, 1)[0];
        addMessage(room, { type: "wish", text: `${player.name} 許願成功：${item}！` });
      } else {
        player.wishUsed = true;
        addMessage(room, { type: "wish", text: `${player.name} 許願 ${wish}，但這次沒有成功。` });
      }
    }
  }

  return item || room.callDeck.shift();
}

function callNextItem(room, socketId, wishText = "", random = Math.random) {
  if (room.status !== "playing") return { ok: false, reason: "not-playing" };
  const caller = currentCaller(room);
  const actor = getPlayer(room, socketId);
  const actorIsCaller = caller?.id === socketId;
  const actorIsHost = Boolean(actor?.isHost);
  if (!caller || (!actorIsCaller && !actorIsHost)) return { ok: false, reason: "not-allowed" };

  if (!actorIsCaller && wishText) {
    addMessage(room, { type: "system", text: "房主代叫時不會使用玩家的許願。" });
  }

  const item = drawItem(room, caller, actorIsCaller ? wishText : "", random);
  if (!item) {
    endGame(room, "empty");
    return { ok: true, ended: true };
  }

  room.calledItems.push(item);
  addMessage(room, {
    type: "call",
    text: actorIsCaller ? `${caller.name} 叫號：${item}` : `${actor.name} 代替 ${caller.name} 叫號：${item}`
  });

  if (checkWinners(room)) return { ok: true, item, ended: true };

  room.callerIndex = (room.callerIndex + 1) % room.participants.length;
  const nextCaller = currentCaller(room);
  if (nextCaller) {
    addMessage(room, { type: "system", text: `換 ${nextCaller.name} 叫下一號。` });
  }
  touchRoom(room);
  return { ok: true, item, ended: false };
}

function skipCurrentCaller(room, socketId) {
  if (room.status !== "playing") return { ok: false, reason: "not-playing" };
  const actor = getPlayer(room, socketId);
  if (!actor?.isHost) return { ok: false, reason: "not-host" };

  const caller = currentCaller(room);
  if (!caller) return { ok: false, reason: "no-caller" };

  if (room.participants.length <= 1) {
    addMessage(room, { type: "system", text: "目前只有 1 位參賽者，無法跳過叫號者。" });
    return { ok: false, reason: "single-player" };
  }

  room.callerIndex = (room.callerIndex + 1) % room.participants.length;
  addMessage(room, { type: "system", text: `${actor.name} 跳過 ${caller.name}，換 ${currentCaller(room)?.name} 叫下一號。` });
  touchRoom(room);
  return { ok: true };
}

function startGame(room) {
  if (room.status === "playing") return { ok: false, reason: "already-playing" };

  const pool = getItemPool(room.settings);
  if (pool.length < 24) {
    addMessage(room, { type: "system", text: "題庫至少需要 24 個項目才可以開始。" });
    return { ok: false, reason: "small-pool" };
  }

  if (room.participants.length < 1) {
    addMessage(room, { type: "system", text: "至少 1 位參賽者就可以開始遊戲。" });
    return { ok: false, reason: "no-players" };
  }

  room.status = "playing";
  room.calledItems = [];
  room.winners = [];
  room.callerIndex = 0;
  room.participants.forEach((player) => {
    player.board = makeBoard(pool);
    player.wishUsed = false;
  });
  room.callDeck = makeCallDeckFromBoards(room.participants);

  addMessage(room, {
    type: "system",
    text: `遊戲開始！採用玩家輪流叫號，先完成 ${room.settings.winLines} 條線的人獲勝。`
  });
  addMessage(room, { type: "system", text: `第一位叫號者：${currentCaller(room)?.name || "等待中"}。` });
  addMessage(room, { type: "system", text: "本局叫號只會抽到參賽者卡片上的項目，節奏會更緊湊。" });
  touchRoom(room);
  return { ok: true };
}

function resetToLobby(room) {
  room.status = "lobby";
  room.calledItems = [];
  room.callDeck = [];
  room.winners = [];
  room.callerIndex = 0;
  room.participants.forEach((player) => {
    player.board = null;
    player.wishUsed = false;
  });
  addMessage(room, { type: "system", text: "已回到準備室，可以調整題庫再開一局。" });
  touchRoom(room);
}

module.exports = {
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  ROOM_TTL_MS,
  WISH_SUCCESS_RATE,
  categoryOptions,
  itemCategories,
  sanitizeRoomCode,
  sanitizeName,
  sanitizeClientId,
  sanitizeCategory,
  sanitizeWinLines,
  sanitizeCustomItems,
  sanitizeWish,
  sanitizeChat,
  createRoom,
  touchRoom,
  getItemPool,
  shuffle,
  makeBoard,
  makeCallDeckFromBoards,
  lineCount,
  getPlayer,
  getPlayerByClientId,
  currentCaller,
  makeGuest,
  reconnectGuest,
  roomState,
  addMessage,
  removeGuest,
  markDisconnected,
  cleanupStaleGuests,
  cleanupRooms,
  checkWinners,
  drawItem,
  callNextItem,
  skipCurrentCaller,
  startGame,
  resetToLobby
};
