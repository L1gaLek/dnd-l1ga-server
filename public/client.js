// ================== ELEMENTS ==================
const loginDiv = document.getElementById('login-container');
const joinBtn = document.getElementById('joinBtn');
const usernameInput = document.getElementById('username');
const roleSelect = document.getElementById('role');
const loginError = document.getElementById('loginError');

const gameUI = document.getElementById('main-container');
const myNameSpan = document.getElementById('myName');
const myRoleSpan = document.getElementById('myRole');

const board = document.getElementById('game-board');
const playerList = document.getElementById('player-list');
const logList = document.getElementById('log-list');
const currentPlayerSpan = document.getElementById('current-player');

const addPlayerBtn = document.getElementById('add-player');
const rollInitiativeBtn = document.getElementById('roll-initiative');
const endTurnBtn = document.getElementById('end-turn');
const createBoardBtn = document.getElementById('create-board');

const boardWidthInput = document.getElementById('board-width');
const boardHeightInput = document.getElementById('board-height');

const playerNameInput = document.getElementById('player-name');
const playerColorInput = document.getElementById('player-color');
const playerSizeInput = document.getElementById('player-size');

// ================== STATE ==================
let ws;
let myId, myRole;
let players = [];
let boardWidth = 10;
let boardHeight = 10;
let selectedPlayer = null;

const playerElements = new Map();

// ================== JOIN ==================
joinBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  const role = roleSelect.value;

  if (!name) {
    loginError.textContent = "Введите имя";
    return;
  }

  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

  ws.onopen = () => ws.send(JSON.stringify({ type: "register", name, role }));

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === "registered") {
      myId = msg.id;
      myRole = msg.role;
      myNameSpan.textContent = msg.name;
      myRoleSpan.textContent = msg.role;
      loginDiv.style.display = "none";
      gameUI.style.display = "block";
    }

    if (msg.type === "init" || msg.type === "state") {
      syncState(msg.state);
    }
  };

  ws.onerror = () => loginError.textContent = "Ошибка соединения";
});

// ================== SYNC ==================
function syncState(state) {

  // удаляем лишние DOM-элементы
  const ids = new Set(state.players.map(p => p.id));
  playerElements.forEach((el, id) => {
    if (!ids.has(id)) {
      el.remove();
      playerElements.delete(id);
    }
  });

  players = state.players.map(p => ({
    ...p,
    element: playerElements.get(p.id) || null
  }));

  boardWidth = state.boardWidth;
  boardHeight = state.boardHeight;

  renderBoard(state);
  updatePlayerList();
  updateCurrentPlayer(state);
  renderLog(state.log || []);
}

// ================== LOG ==================
function renderLog(logs) {
  logList.innerHTML = '';
  logs.slice(-50).forEach(line => {
    const li = document.createElement('li');
    li.textContent = line;
    logList.appendChild(li);
  });
}

// ================== TURN ==================
function updateCurrentPlayer(state) {
  if (!state.turnOrder.length) {
    currentPlayerSpan.textContent = '-';
    return;
  }
  const id = state.turnOrder[state.currentTurnIndex];
  const p = players.find(pl => pl.id === id);
  currentPlayerSpan.textContent = p ? p.name : '-';
}

// ================== PLAYER LIST ==================
function updatePlayerList() {
  playerList.innerHTML = '';

  const grouped = {};
  players.forEach(p => {
    if (!grouped[p.ownerId]) {
      grouped[p.ownerId] = { name: p.ownerName, players: [] };
    }
    grouped[p.ownerId].players.push(p);
  });

  Object.values(grouped).forEach(group => {
    const ownerLi = document.createElement('li');
    ownerLi.textContent = group.name;
    ownerLi.style.fontWeight = 'bold';

    const ul = document.createElement('ul');
    group.players.forEach(p => {
      const li = document.createElement('li');
      li.textContent = `${p.name} (${p.initiative})`;
      li.onclick = () => selectedPlayer = p;
      ul.appendChild(li);
    });

    ownerLi.appendChild(ul);
    playerList.appendChild(ownerLi);
  });
}

// ================== BOARD ==================
function renderBoard(state) {
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${boardWidth}, 50px)`;
  board.style.gridTemplateRows = `repeat(${boardHeight}, 50px)`;

  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.x = x;
      cell.dataset.y = y;
      if (state.walls?.find(w => w.x === x && w.y === y)) {
        cell.classList.add('wall');
      }
      board.appendChild(cell);
    }
  }

  players.forEach(setPlayerPosition);
}

function setPlayerPosition(p) {
  let el = playerElements.get(p.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'player';
    el.textContent = p.name[0];
    el.style.backgroundColor = p.color;
    board.appendChild(el);
    playerElements.set(p.id, el);
  }

  if (p.x == null || p.y == null) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'flex';
  el.style.left = `${p.x * 50}px`;
  el.style.top = `${p.y * 50}px`;
}

// ================== ACTIONS ==================
addPlayerBtn.onclick = () => {
  const name = playerNameInput.value.trim();
  if (!name) return;

  send({
    type: 'addPlayer',
    player: {
      name,
      color: playerColorInput.value,
      size: parseInt(playerSizeInput.value)
    }
  });

  playerNameInput.value = '';
};

board.onclick = e => {
  if (!selectedPlayer) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;

  send({
    type: 'movePlayer',
    id: selectedPlayer.id,
    x: +cell.dataset.x,
    y: +cell.dataset.y
  });

  selectedPlayer = null;
};

rollInitiativeBtn.onclick = () => send({ type: 'rollInitiative' });
endTurnBtn.onclick = () => send({ type: 'endTurn' });

createBoardBtn.onclick = () => {
  send({
    type: 'resizeBoard',
    width: +boardWidthInput.value,
    height: +boardHeightInput.value
  });
};

// ================== SEND ==================
function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
