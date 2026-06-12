const socket = io();

const joinView = document.querySelector("#joinView");
const gameView = document.querySelector("#gameView");
const joinForm = document.querySelector("#joinForm");
const nameInput = document.querySelector("#nameInput");
const roomInput = document.querySelector("#roomInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinError = document.querySelector("#joinError");
const roomCodeLabel = document.querySelector("#roomCodeLabel");
const copyLinkButton = document.querySelector("#copyLinkButton");
const statusTitle = document.querySelector("#statusTitle");
const lastCallLabel = document.querySelector("#lastCallLabel");
const nextCallLabel = document.querySelector("#nextCallLabel");
const winLineLabel = document.querySelector("#winLineLabel");
const playersList = document.querySelector("#playersList");
const spectatorsList = document.querySelector("#spectatorsList");
const seatCountLabel = document.querySelector("#seatCountLabel");
const spectatorCountLabel = document.querySelector("#spectatorCountLabel");
const categorySelect = document.querySelector("#categorySelect");
const winLinesSelect = document.querySelector("#winLinesSelect");
const customItemsInput = document.querySelector("#customItemsInput");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const settingsHint = document.querySelector("#settingsHint");
const roleLabel = document.querySelector("#roleLabel");
const startButton = document.querySelector("#startButton");
const resetButton = document.querySelector("#resetButton");
const bingoBoard = document.querySelector("#bingoBoard");
const calledCountLabel = document.querySelector("#calledCountLabel");
const calledList = document.querySelector("#calledList");
const messagesList = document.querySelector("#messagesList");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const emojiButtons = Array.from(document.querySelectorAll(".emoji-row button"));

const urlRoomCode = location.pathname.match(/\/room\/([A-Za-z0-9]+)/)?.[1];
if (urlRoomCode) {
  roomInput.value = urlRoomCode.toUpperCase();
}

let state = null;
let countdownId = null;
let settingsDirty = false;

function setError(message = "") {
  joinError.textContent = message;
}

function playerName() {
  return nameInput.value.trim() || localStorage.getItem("u0-bingo-name") || "";
}

function rememberName() {
  const name = nameInput.value.trim();
  if (name) localStorage.setItem("u0-bingo-name", name);
}

function enterGame() {
  joinView.hidden = true;
  gameView.hidden = false;
}

function roomLink(code) {
  return `${location.origin}/room/${code}`;
}

function requestCreateRoom() {
  rememberName();
  socket.emit("room:create", { name: playerName() }, (response) => {
    if (!response?.ok) {
      setError(response?.error || "建立房間失敗，請再試一次。");
      return;
    }
    history.replaceState(null, "", `/room/${response.roomCode}`);
    enterGame();
  });
}

function requestJoinRoom() {
  rememberName();
  const roomCode = roomInput.value.trim();
  if (!roomCode) {
    setError("請輸入房間代碼，或直接建立新房間。");
    return;
  }
  socket.emit("room:join", { roomCode, name: playerName() }, (response) => {
    if (!response?.ok) {
      setError(response?.error || "加入房間失敗，請再試一次。");
      return;
    }
    history.replaceState(null, "", `/room/${response.roomCode}`);
    enterGame();
  });
}

function categoryLabel(categoryId) {
  return state?.categoryOptions?.find((item) => item.id === categoryId)?.label || "全部混合";
}

function myProfile() {
  return [...(state?.participants || []), ...(state?.spectators || [])].find((player) => player.id === socket.id);
}

function markedCell(cell) {
  return cell?.free || state.calledItems.includes(cell?.text);
}

function makePlayerItem(player) {
  const item = document.createElement("li");
  const name = document.createElement("span");
  const score = document.createElement("span");
  const badges = [];

  if (player.isHost) badges.push("房主");
  if (state.winners.some((winner) => winner.id === player.id)) badges.push("贏家");

  name.className = "player-name";
  score.className = "player-score";
  name.textContent = `${player.name}${badges.length ? ` · ${badges.join(" · ")}` : ""}`;
  score.textContent = `${player.lines}/${state.settings.winLines}`;
  item.append(name, score);
  return item;
}

function renderPlayers() {
  playersList.replaceChildren(...state.participants.map(makePlayerItem));
  spectatorsList.replaceChildren(
    ...state.spectators.map((player) => {
      const item = document.createElement("li");
      item.textContent = `${player.name}${player.isHost ? " · 房主" : ""}`;
      return item;
    })
  );
  seatCountLabel.textContent = `${state.participants.length}/${state.maxPlayers}`;
  spectatorCountLabel.textContent = String(state.spectators.length);
}

function renderBoard() {
  if (!state.board) {
    const isPlaying = state.status === "playing";
    bingoBoard.classList.add("empty");
    bingoBoard.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-board";
    empty.textContent = isPlaying ? "你目前在觀眾席，可以用留言和表情一起互動。" : "等待房主開始遊戲。";
    bingoBoard.append(empty);
    return;
  }

  bingoBoard.classList.remove("empty");
  bingoBoard.replaceChildren(
    ...state.board.map((cell) => {
      const tile = document.createElement("div");
      tile.className = "bingo-cell";
      if (markedCell(cell)) tile.classList.add("is-marked");
      if (cell.free) tile.classList.add("is-free");
      tile.textContent = cell.text;
      return tile;
    })
  );
}

function renderCalledItems() {
  calledCountLabel.textContent = String(state.calledItems.length);
  calledList.replaceChildren(
    ...state.calledItems.slice(-28).reverse().map((item, index) => {
      const chip = document.createElement("span");
      chip.className = index === 0 ? "called-chip latest" : "called-chip";
      chip.textContent = item;
      return chip;
    })
  );
}

function messageMarkup(message) {
  const item = document.createElement("div");
  item.className = `message ${message.type || "chat"}`;
  if (message.type === "chat") {
    const strong = document.createElement("strong");
    strong.textContent = `${message.playerName}: `;
    item.append(strong, document.createTextNode(message.text));
    return item;
  }
  item.textContent = message.text;
  return item;
}

function renderMessages(messages) {
  messagesList.replaceChildren(...messages.map(messageMarkup));
  messagesList.scrollTop = messagesList.scrollHeight;
}

function renderSettings(isHost) {
  if (!settingsDirty) {
    categorySelect.value = state.settings.category;
    winLinesSelect.value = String(state.settings.winLines);
    customItemsInput.value = (state.settings.customItems || []).join("\n");
  }

  const locked = !isHost || state.status === "playing";
  categorySelect.disabled = locked;
  winLinesSelect.disabled = locked;
  customItemsInput.disabled = locked;
  saveSettingsButton.hidden = !isHost;
  saveSettingsButton.disabled = locked || !settingsDirty;

  if (!isHost) {
    settingsHint.textContent = `目前題庫：${categoryLabel(state.settings.category)}，${state.settings.winLines} 條線決勝。`;
  } else if (state.status === "playing") {
    settingsHint.textContent = "遊戲進行中，結束後可以重新調整設定。";
  } else {
    settingsHint.textContent = "自訂題目至少 24 個才可單獨開局，也能混入其他題庫。";
  }
}

function updateCountdown() {
  if (!state?.nextCallAt || state.status !== "playing") {
    nextCallLabel.textContent = "--";
    return;
  }
  const seconds = Math.max(0, Math.ceil((state.nextCallAt - Date.now()) / 1000));
  nextCallLabel.textContent = `${seconds}s`;
}

function startCountdown() {
  clearInterval(countdownId);
  updateCountdown();
  countdownId = setInterval(updateCountdown, 400);
}

function renderState(nextState) {
  state = nextState;
  const me = myProfile();
  const isHost = Boolean(me?.isHost);
  const myLines = state.participants.find((player) => player.id === socket.id)?.lines || 0;
  const winnerNames = state.winners.map((winner) => winner.name).join("、");

  roomCodeLabel.textContent = state.code;
  lastCallLabel.textContent = state.lastItem || (state.status === "playing" ? "準備叫號" : categoryLabel(state.settings.category));
  winLineLabel.textContent = `${state.settings.winLines} 條線`;
  statusTitle.textContent =
    state.status === "playing"
      ? `遊戲中 · 我的線數 ${myLines}`
      : state.status === "finished"
        ? `本局勝利：${winnerNames || "平手"}`
        : "準備開局";
  roleLabel.textContent =
    me?.role === "player"
      ? `你是參賽者，目前 ${myLines} 條線`
      : me?.role === "spectator"
        ? "你是觀眾，可以留言互動"
        : "等待加入房間";

  startButton.hidden = !isHost || state.status === "playing";
  resetButton.hidden = !isHost || state.status === "lobby";
  startButton.disabled = state.participants.length < 1;

  renderPlayers();
  renderBoard();
  renderCalledItems();
  renderMessages(state.messages);
  renderSettings(isHost);
  startCountdown();
}

function saveSettings() {
  saveSettingsButton.disabled = true;
  socket.emit(
    "room:updateSettings",
    {
      category: categorySelect.value,
      winLines: winLinesSelect.value,
      customItems: customItemsInput.value
    },
    (response) => {
      if (!response?.ok) {
        settingsHint.textContent = response?.error || "設定儲存失敗。";
        saveSettingsButton.disabled = false;
        return;
      }
      settingsDirty = false;
      saveSettingsButton.textContent = "已儲存";
      setTimeout(() => {
        saveSettingsButton.textContent = "儲存";
      }, 1200);
    }
  );
}

function insertEmoji(emoji) {
  const start = chatInput.selectionStart ?? chatInput.value.length;
  const end = chatInput.selectionEnd ?? chatInput.value.length;
  chatInput.value = `${chatInput.value.slice(0, start)}${emoji}${chatInput.value.slice(end)}`.slice(0, 80);
  const cursor = Math.min(start + emoji.length, chatInput.value.length);
  chatInput.focus();
  chatInput.setSelectionRange(cursor, cursor);
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  requestJoinRoom();
});

createRoomButton.addEventListener("click", requestCreateRoom);

copyLinkButton.addEventListener("click", async () => {
  if (!state?.code) return;
  const link = roomLink(state.code);
  try {
    await navigator.clipboard.writeText(link);
    copyLinkButton.textContent = "已複製";
  } catch {
    prompt("複製房間連結", link);
  }
  setTimeout(() => {
    copyLinkButton.textContent = "複製";
  }, 1400);
});

startButton.addEventListener("click", () => {
  socket.emit("game:start");
});

resetButton.addEventListener("click", () => {
  socket.emit("game:reset");
});

[categorySelect, winLinesSelect].forEach((control) => {
  control.addEventListener("change", () => {
    settingsDirty = true;
    saveSettingsButton.disabled = false;
  });
});

customItemsInput.addEventListener("input", () => {
  settingsDirty = true;
  saveSettingsButton.disabled = false;
});

saveSettingsButton.addEventListener("click", saveSettings);

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat:message", { text });
  chatInput.value = "";
});

emojiButtons.forEach((button) => {
  button.addEventListener("click", () => insertEmoji(button.dataset.emoji));
});

socket.on("room:state", renderState);
socket.on("chat:message", (message) => {
  if (!state) return;
  state.messages.push(message);
  renderMessages(state.messages);
});

const savedName = localStorage.getItem("u0-bingo-name");
if (savedName) nameInput.value = savedName;
