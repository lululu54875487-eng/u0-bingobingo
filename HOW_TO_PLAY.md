const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeCustomItems,
  sanitizeRoomCode,
  sanitizeChat,
  createRoom,
  makeGuest,
  makeBoard,
  lineCount,
  startGame,
  callNextItem,
  removeGuest,
  currentCaller,
  cleanupRooms
} = require("../src/game");

test("sanitizers normalize unsafe input", () => {
  assert.equal(sanitizeRoomCode(" ab-cd!! "), "ABCD");
  assert.equal(sanitizeChat("  hello    bingo  "), "hello bingo");
  assert.deepEqual(sanitizeCustomItems("Apple, apple，Banana、  Cat  \nCat"), ["Apple", "Banana", "Cat"]);
});

test("makeBoard creates a 5x5 board with a free center", () => {
  const pool = Array.from({ length: 30 }, (_, index) => `item-${index}`);
  const board = makeBoard(pool);
  assert.equal(board.length, 25);
  assert.deepEqual(board[12], { text: "FREE", free: true });
  assert.equal(new Set(board.filter((cell) => !cell.free).map((cell) => cell.text)).size, 24);
});

test("lineCount counts rows, columns, and diagonals", () => {
  const board = Array.from({ length: 25 }, (_, index) => ({ text: String(index), free: index === 12 }));
  assert.equal(lineCount(board, new Set(["0", "1", "2", "3", "4"])), 1);
  assert.equal(lineCount(board, new Set(["0", "6", "18", "24"])), 1);
  assert.equal(lineCount(board, new Set(["0", "1", "2", "3", "4", "5", "10", "15", "20"])), 2);
});

test("callNextItem advances caller and host can call for current caller", () => {
  const rooms = new Map();
  const room = createRoom(rooms, "TEST");
  room.participants.push(makeGuest("a", "ca", "A", "player", true));
  room.participants.push(makeGuest("b", "cb", "B", "player", false));

  assert.equal(startGame(room).ok, true);
  assert.equal(currentCaller(room).id, "a");

  const first = callNextItem(room, "a", "", () => 1);
  assert.equal(first.ok, true);
  assert.equal(currentCaller(room).id, "b");

  const second = callNextItem(room, "a", "", () => 1);
  assert.equal(second.ok, true);
  assert.equal(currentCaller(room).id, "a");
});

test("removing a player before the caller preserves the active caller", () => {
  const rooms = new Map();
  const room = createRoom(rooms, "DROP");
  room.participants.push(makeGuest("a", "ca", "A", "player", true));
  room.participants.push(makeGuest("b", "cb", "B", "player", false));
  room.participants.push(makeGuest("c", "cc", "C", "player", false));
  room.status = "playing";
  room.callerIndex = 2;

  removeGuest(room, "a");
  assert.equal(currentCaller(room).id, "c");
});

test("cleanupRooms removes stale empty rooms", () => {
  const rooms = new Map();
  const room = createRoom(rooms, "OLD");
  room.lastActiveAt = 1;
  assert.equal(cleanupRooms(rooms, Number.MAX_SAFE_INTEGER), 1);
  assert.equal(rooms.has("OLD"), false);
});
