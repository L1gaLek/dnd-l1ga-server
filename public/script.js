// ====================== ЭЛЕМЕНТЫ ======================
const board = document.getElementById('game-board');
const dice = document.getElementById('dice');
const rollBtn = document.getElementById('roll');
const rollResult = document.getElementById('roll-result');
const endTurnBtn = document.getElementById('end-turn');
const addPlayerBtn = document.getElementById('add-player');
const playerNameInput = document.getElementById('player-name');
const playerColorInput = document.getElementById('player-color');
const playerSizeInput = document.getElementById('player-size');
const createBoardBtn = document.getElementById('create-board');
const boardWidthInput = document.getElementById('board-width');
const boardHeightInput = document.getElementById('board-height');
const rollInitiativeBtn = document.getElementById('roll-initiative');
const currentPlayerSpan = document.getElementById('current-player');
const logList = document.getElementById('log-list');
const playerList = document.getElementById('player-list');

const editEnvBtn = document.getElementById('edit-environment');
const addWallBtn = document.getElementById('add-wall');
const removeWallBtn = document.getElementById('remove-wall');

const resetGameBtn = document.getElementById('reset-game');
const clearBoardBtn = document.getElementById('clear-board');

// ====================== ПЕРЕМЕННЫЕ ======================
let boardWidth = parseInt(boardWidthInput.value);
let boardHeight = parseInt(boardHeightInput.value);

let players = [];
let selectedPlayer = null;

let editEnvironment = false;
let wallMode = null;
let mouseDown = false;

// ====================== WEBSOCKET ======================
const ws = new WebSocket(
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host
);

ws.onopen = () => console.log("🟢 Connected to server");

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type !== 'init' && msg.type !== 'state') return;

  const state = msg.state;

  boardWidth = state.boardWidth;
  boardHeight = state.boardHeight;

  players = state.players.map(p => {
    const existing = players.find(pl => pl.id === p.id);
    return { ...p, element: existing?.element || null };
  });

  renderBoard(state);
  updatePlayerList();
  updateCurrentPlayer(state);
  renderLog(state.log);
};

// ====================== УТИЛИТЫ ======================
function sendMessage(msg) {
  ws.send(JSON.stringify(msg));
}

function updateCurrentPlayer(state) {
  if (!state.turnOrder?.length) {
    currentPlayerSpan.textContent = '-';
    return;
  }
  const id = state.turnOrder[state.currentTurnIndex];
  const p = players.find(pl => pl.id === id);
  currentPlayerSpan.textContent = p?.name || '-';
}

function updatePlayerList() {
  playerList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.initiative || 0})`;
    playerList.appendChild(li);
  });
}

// ====================== ПОЛЕ ======================
function renderBoard(state) {
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${boardWidth},50px)`;
  board.style.gridTemplateRows = `repeat(${boardHeight},50px)`;

  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.x = x;
      cell.dataset.y = y;

      if (state.walls?.some(w => w.x === x && w.y === y)) {
        cell.classList.add('wall');
      }

      board.appendChild(cell);
    }
  }

  players.forEach(p => setPlayerPosition(p));
}

createBoardBtn.addEventListener('click', () => {
  boardWidth = parseInt(boardWidthInput.value);
  boardHeight = parseInt(boardHeightInput.value);
  sendMessage({ type: 'resizeBoard', width: boardWidth, height: boardHeight });
});

// ====================== ИГРОКИ ======================
function setPlayerPosition(player) {
  if (!player.element) {
    const el = document.createElement('div');
    el.classList.add('player');
    el.textContent = player.name[0];
    el.style.backgroundColor = player.color;
    el.style.width = `${player.size * 50}px`;
    el.style.height = `${player.size * 50}px`;
    el.style.position = 'absolute';

    el.addEventListener('mousedown', () => {
      if (editEnvironment) return;
      if (selectedPlayer?.element) {
        selectedPlayer.element.classList.remove('selected');
      }
      selectedPlayer = player;
      el.classList.add('selected');
    });

    board.appendChild(el);
    player.element = el;
  }

  player.element.style.left = `${player.x * 50}px`;
  player.element.style.top = `${player.y * 50}px`;
}

addPlayerBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const color = playerColorInput.value;
  const size = parseInt(playerSizeInput.value);
  if (!name) return;

  sendMessage({
    type: 'addPlayer',
    player: { name, color, size, x: 0, y: 0 }
  });

  playerNameInput.value = '';
});

// ====================== ПЕРЕМЕЩЕНИЕ ======================
board.addEventListener('click', e => {
  if (!selectedPlayer) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;

  const x = +cell.dataset.x;
  const y = +cell.dataset.y;

  sendMessage({
    type: 'movePlayer',
    id: selectedPlayer.id,
    x,
    y
  });

  selectedPlayer.element.classList.remove('selected');
  selectedPlayer = null;
});

// ====================== КУБИК ======================
rollBtn.addEventListener('click', () => {
  const sides = parseInt(dice.value);
  sendMessage({ type: 'rollDice', sides });
});

// ====================== ХОД / ИНИЦИАТИВА ======================
endTurnBtn.addEventListener('click', () => {
  sendMessage({ type: 'endTurn' });
});

rollInitiativeBtn.addEventListener('click', () => {
  sendMessage({ type: 'rollInitiative' });
});

// ====================== СТЕНЫ ======================
editEnvBtn.addEventListener('click', () => {
  editEnvironment = !editEnvironment;
  addWallBtn.disabled = !editEnvironment;
  removeWallBtn.disabled = !editEnvironment;
  wallMode = null;
});

addWallBtn.addEventListener('click', () => wallMode = 'add');
removeWallBtn.addEventListener('click', () => wallMode = 'remove');

board.addEventListener('mousedown', e => {
  if (!editEnvironment || !wallMode) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  mouseDown = true;
  toggleWall(cell);
});

board.addEventListener('mouseover', e => {
  if (!mouseDown) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  toggleWall(cell);
});

document.addEventListener('mouseup', () => mouseDown = false);

function toggleWall(cell) {
  const x = +cell.dataset.x;
  const y = +cell.dataset.y;

  if (wallMode === 'add') {
    sendMessage({ type: 'addWall', wall: { x, y } });
  } else {
    sendMessage({ type: 'removeWall', wall: { x, y } });
  }
}

// ====================== СБРОС ======================
resetGameBtn.addEventListener('click', () => {
  sendMessage({ type: 'resetGame' });
});

clearBoardBtn.addEventListener('click', () => {
  sendMessage({ type: 'clearBoard' });
});

// ====================== ЛОГ ======================
function renderLog(logs = []) {
  logList.innerHTML = '';
  logs.slice(-50).forEach(l => {
    const li = document.createElement('li');
    li.textContent = l;
    logList.appendChild(li);
  });
}

