// ================== ELEMENTS ==================
const loginDiv = document.getElementById('login-container');
const joinBtn = document.getElementById('joinBtn');
const usernameInput = document.getElementById('username');
const roleSelect = document.getElementById('role');
const loginError = document.getElementById('loginError');

const gameUI = document.getElementById('main-container');
const myNameSpan = document.getElementById('myName');
const myRoleSpan = document.getElementById('myRole');
const userList = document.getElementById('player-list'); // используем player-list для списка пользователей

const board = document.getElementById('game-board');
const playerList = document.getElementById('player-list');
const logList = document.getElementById('log-list');
const currentPlayerSpan = document.getElementById('current-player');

// Игровые кнопки
const addPlayerBtn = document.getElementById('add-player');
const rollBtn = document.getElementById('roll');
const endTurnBtn = document.getElementById('end-turn');
const rollInitiativeBtn = document.getElementById('roll-initiative');
const createBoardBtn = document.getElementById('create-board');
const boardWidthInput = document.getElementById('board-width');
const boardHeightInput = document.getElementById('board-height');
const resetGameBtn = document.getElementById('reset-game');
const clearBoardBtn = document.getElementById('clear-board');

// ================== VARIABLES ==================
let ws;
let myId;
let myRole;
let players = [];
let boardWidth = 10;
let boardHeight = 10;

// DOM-элементы игроков
const playerElements = new Map();

// ================== JOIN GAME ==================
joinBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  const role = roleSelect.value;

  if (!name) {
    loginError.textContent = "Введите имя";
    return;
  }

  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "register", name, role }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch(msg.type) {
      case "registered":
        myId = msg.id;
        myRole = msg.role;

        myNameSpan.textContent = msg.name;
        myRoleSpan.textContent = msg.role;

        // Показываем главное окно после успешного входа
        loginDiv.style.display = "none";
        gameUI.style.display = "block";

        setupRoleUI(myRole);

        // Если сервер прислал состояние, отрисовываем поле и игроков
        if (msg.state) {
          if (msg.state.boardWidth) boardWidth = msg.state.boardWidth;
          if (msg.state.boardHeight) boardHeight = msg.state.boardHeight;
          players = msg.state.players;
          renderBoard(msg.state);
          updatePlayerList();
          updateCurrentPlayer(msg.state);
          renderLog(msg.state.log || []);
        }
        break;

      case "error":
        loginError.textContent = msg.message;
        break;

      case "users":
        updateUserList(msg.users);
        break;

      case "state":
        if (msg.state.boardWidth) boardWidth = msg.state.boardWidth;
        if (msg.state.boardHeight) boardHeight = msg.state.boardHeight;
        players = msg.state.players;
        renderBoard(msg.state);
        updatePlayerList();
        updateCurrentPlayer(msg.state);
        renderLog(msg.state.log || []);
        break;
    }
  };

  ws.onerror = (e) => {
    loginError.textContent = "Ошибка соединения с сервером";
    console.error(e);
  };
});

// ================== CREATE BOARD BUTTON ==================
createBoardBtn.addEventListener('click', () => {
  const width = parseInt(boardWidthInput.value);
  const height = parseInt(boardHeightInput.value);

  if (!width || !height) return;

  // Отправляем серверу событие изменения размера поля
  ws.send(JSON.stringify({ type: "resizeBoard", width, height }));
});

// ================== OTHER NOTES ==================
// Теперь игровое поле создается сразу после входа.
// Кнопка "Создать поле" обновляет размер у всех игроков.
// Игроки можно добавлять и перемещать как раньше.

// ================== USERS ==================
function updateUserList(users) {
  userList.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.textContent = `${u.name} (${u.role})`;
    userList.appendChild(li);
  });
}

// ================== ROLE UI ==================
function setupRoleUI(role) {
  if (role === "Spectator") {
    addPlayerBtn.style.display = 'none';
    rollBtn.style.display = 'none';
    endTurnBtn.style.display = 'none';
    rollInitiativeBtn.style.display = 'none';
    createBoardBtn.style.display = 'none';
    resetGameBtn.style.display = 'none';
    clearBoardBtn.style.display = 'none';
  } else if (role === "DnD-Player") {
    resetGameBtn.style.display = 'none'; // игрок не может сбрасывать игру
  } else if (role === "GM") {
    // GM видит все кнопки
  }
}

// ================== GAME LOG ==================
function renderLog(logs) {
  logList.innerHTML = '';
  logs.slice(-50).forEach(line => {
    const li = document.createElement('li');
    li.textContent = line;
    logList.appendChild(li);
  });
}

// ================== CURRENT PLAYER ==================
function updateCurrentPlayer(state) {
  if (!state || !state.turnOrder || state.turnOrder.length === 0) {
    currentPlayerSpan.textContent = '-';
    return;
  }
  const id = state.turnOrder[state.currentTurnIndex];
  const p = players.find(pl => pl.id === id);
  currentPlayerSpan.textContent = p ? p.name : '-';
}

// ================== PLAYERS ==================
function updatePlayerList() {
  playerList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.initiative || 0})`;

    if (myRole === "GM" || myRole === "DnD-Player") {
      const removeFromBoardBtn = document.createElement('button');
      removeFromBoardBtn.textContent = 'С поля';
      removeFromBoardBtn.addEventListener('click', e => {
        e.stopPropagation();
        ws.send(JSON.stringify({ type: 'removePlayerFromBoard', id: p.id }));
      });

      const removeCompletelyBtn = document.createElement('button');
      removeCompletelyBtn.textContent = 'Удалить полностью';
      removeCompletelyBtn.addEventListener('click', e => {
        e.stopPropagation();
        ws.send(JSON.stringify({ type: 'removePlayerCompletely', id: p.id }));
      });

      li.appendChild(removeFromBoardBtn);
      li.appendChild(removeCompletelyBtn);
    }

    playerList.appendChild(li);
  });
}

// ================== BOARD ==================
function renderBoard(state) {
  board.innerHTML = '';
  board.style.position = 'relative';
  board.style.width = `${boardWidth*50}px`;
  board.style.height = `${boardHeight*50}px`;
  board.style.display = 'grid';
  board.style.gridTemplateColumns = `repeat(${boardWidth}, 50px)`;
  board.style.gridTemplateRows = `repeat(${boardHeight}, 50px)`;

  for (let y=0; y<boardHeight; y++) {
    for (let x=0; x<boardWidth; x++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.x = x;
      cell.dataset.y = y;
      board.appendChild(cell);
    }
  }

  players.forEach(p => setPlayerPosition(p));
}

function setPlayerPosition(player) {
  let el = playerElements.get(player.id);
  if (!el) {
    el = document.createElement('div');
    el.classList.add('player');
    el.textContent = player.name[0];
    el.style.backgroundColor = player.color;
    el.style.position = 'absolute';
    el.style.width = `${player.size*50}px`;
    el.style.height = `${player.size*50}px`;
    board.appendChild(el);
    playerElements.set(player.id, el);
  }

  if (player.x === null || player.y === null) {
    el.style.display = 'none';
    return;
  } else {
    el.style.display = 'flex';
  }

  const maxX = boardWidth - player.size;
  const maxY = boardHeight - player.size;

  const x = Math.min(Math.max(player.x, 0), maxX);
  const y = Math.min(Math.max(player.y, 0), maxY);

  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) {
    el.style.left = `${cell.offsetLeft}px`;
    el.style.top = `${cell.offsetTop}px`;
  }
}

