const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PORT = "0";
process.env.RECONNECT_GRACE_MS = "2000";
process.env.ROOM_TTL_MS = "5000";

const { io: Client } = require("socket.io-client");
const { server, io, rooms } = require("../server");

function address() {
  const info = server.address();
  return `http://127.0.0.1:${info.port}`;
}

function connectClient(name, clientId) {
  const socket = Client(address(), {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false
  });
  const states = [];
  const chatMessages = [];
  socket.on("room:state", (state) => states.push(state));
  socket.on("chat:message", (message) => chatMessages.push(message));
  return { socket, name, clientId, states, chatMessages };
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitFor(predicate, timeoutMs = 3000, label = "condition") {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const result = predicate();
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${label}`));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 20);
  });
}

function latest(client) {
  return client.states[client.states.length - 1];
}

async function waitForState(client, predicate, timeoutMs, label) {
  return waitFor(() => {
    const state = latest(client);
    return state && predicate(state) ? state : null;
  }, timeoutMs, label);
}

async function playOneRound(clients, roomCode) {
  clients[0].socket.emit("game:start");
  await waitForState(clients[0], (state) => state.status === "playing", 3000, "round to start");

  for (let turn = 0; turn < 120; turn += 1) {
    const state = latest(clients[0]);
    if (state.status === "finished") return state;

    const caller = clients.find((client) => client.socket.id === state.callerId);
    assert.ok(caller, `caller should exist in room ${roomCode}`);
    caller.socket.emit("game:call", {});
    const after = await waitForState(
      clients[0],
      (nextState) => nextState.calledItems.length > state.calledItems.length || nextState.status === "finished",
      3000,
      `call ${turn + 1} to advance from ${state.calledItems.length}`
    );
    if (after.status === "finished") return after;
  }

  throw new Error("round did not finish within 120 calls");
}

test("three complete multiplayer rounds, reconnect, chat, and malformed payloads", async (t) => {
  await new Promise((resolve) => server.listening ? resolve() : server.once("listening", resolve));

  const host = connectClient("Host", "host-client");
  const playerA = connectClient("A", "a-client");
  const playerB = connectClient("B", "b-client");
  const clients = [host, playerA, playerB];

  t.after(async () => {
    clients.forEach((client) => client.socket.disconnect());
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  const create = await emitAck(host.socket, "room:create", { name: host.name, clientId: host.clientId });
  assert.equal(create.ok, true);
  const roomCode = create.roomCode;

  const joinA = await emitAck(playerA.socket, "room:join", { roomCode, name: playerA.name, clientId: playerA.clientId });
  const joinB = await emitAck(playerB.socket, "room:join", { roomCode, name: playerB.name, clientId: playerB.clientId });
  assert.equal(joinA.ok, true);
  assert.equal(joinB.ok, true);

  await waitForState(host, (state) => state.participants.length === 3, 3000, "three participants");

  host.socket.emit("chat:message", { text: "第一局開始" });
  host.socket.emit("chat:message", null);
  await waitFor(() => host.chatMessages.some((message) => message.type === "chat"), 3000, "chat message");

  for (let round = 1; round <= 3; round += 1) {
    const finished = await playOneRound(clients, roomCode);
    assert.equal(finished.status, "finished");
    assert.ok(finished.winners.length >= 1 || finished.calledItems.length > 0);

    if (round < 3) {
      host.socket.emit("game:reset");
      await waitForState(host, (state) => state.status === "lobby", 3000, "reset to lobby");
    }
  }

  const oldHostSocketId = host.socket.id;
  host.socket.disconnect();
  const reconnectedHost = connectClient("Host", "host-client");
  const reconnect = await emitAck(reconnectedHost.socket, "room:join", { roomCode, name: "Host", clientId: "host-client" });
  assert.equal(reconnect.ok, true);
  assert.equal(reconnect.reconnected, true);
  const reconnectedState = await waitForState(
    reconnectedHost,
    (state) => state.participants.some((player) => player.clientId === "host-client" && player.connected),
    3000,
    "host reconnect"
  );
  assert.notEqual(reconnectedHost.socket.id, oldHostSocketId);
  assert.equal(reconnectedState.participants.length, 3);
  reconnectedHost.socket.disconnect();

  assert.equal(rooms.has(roomCode), true);
});
