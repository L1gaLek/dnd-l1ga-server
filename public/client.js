// ================== ELEMENTS ==================
const loginDiv = document.getElementById('login-container');
const joinBtn = document.getElementById('joinBtn');
const usernameInput = document.getElementById('username');
const roleSelect = document.getElementById('role');
const loginError = document.getElementById('loginError');

const gameUI = document.getElementById('main-container');
const myNameSpan = document.getElementById('myName');
const myRoleSpan = document.getElementById('myRole');
const userList = document.getElementById('player-list');

const board = document.getElementById('game-board');
const playerList = document.getElementById('player-list');
const logList = document.getElementById('log-list');
const currentPlayerSpan = document.getElementById('current-player');

const addPlayerBtn = document.getElementById('add-player');
const rollBtn = document.getElementById('roll');
const endTurnBtn = document.getElementById('end-turn');
const rollInitiativeBtn = document.getElementById('roll-initiative');
const createBoardBtn = document.getElementById('create-board');
const boardWidthInput = document.getElementById('board-width');
const boardHeightInput = document.getElementById('board-height');
const resetGameBtn = document.getElementById('reset-game');
const clearBoardBtn = document.getElementById('clear-board');

const playerNameInput = document.getElementById('player-name');
const playerColorInput = document.getElementById('player-color');
const playerSizeInput = document.getElementById('player-size');
const dice = document.getElementById('dice');
const rollResult = document.getElementById('roll-result');

const editEnvBtn = document.getElementById('edit-environment');
const addWallBtn = document.getElementById('add-wall');
const removeWallBtn = document.getElementById('remove-wall');

// ================== VARIABLES ==================
let ws;
let myId;
let myRole;
let players = [];
let boardWidth = parseInt(boardWidthInput.value) || 10;
let boardHeight = parseInt(boardHeightInput.value) || 10;

let selectedPlayer = null;
let editEnvironment = false;
let wallMode = null;
let mouseDown = false;

let myName = null;

const playerElements = new Map();
const playerOwners = new Map(); // playerId -> ownerName

// ================== JOIN GAME ==================
joinBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  const role = roleSelect.value;

  if (!name) {
    loginError.textContent = "Введите имя";
    return;
  }

  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

  ws.onopen = () => ws.send(JSON.stringify({ type: "register", name, role }));

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

if (msg.type === "registered") {
  myId = msg.id;
  myRole = msg.role;
  myName = msg.name;

  myNameSpan.textContent = myName;
  myRoleSpan.textContent = myRole;

      loginDiv.style.display = "none";
      gameUI.style.display = "block";

      setupRoleUI(myRole);

      renderBoard({ boardWidth, boardHeight, players });
      updatePlayerList();
    }

    if (msg.type === "error") loginError.textContent = msg.message;

    if (msg.type === "users") updateUserList(msg.users);

if (msg.type === "state") {
  boardWidth = msg.state.boardWidth || boardWidth;
  boardHeight = msg.state.boardHeight || boardHeight;

  players = msg.state.players.map(p => {
    if (!p.owner && playerOwners.has(p.id)) {
      p.owner = playerOwners.get(p.id);
    }
    return p;
  });
      renderBoard(msg.state);

function updatePlayerList() {
  playerList.innerHTML = '';

  const grouped = {};

  players.forEach(p => {
    const owner = p.owner || 'Без владельца';
    if (!grouped[owner]) grouped[owner] = [];
    grouped[owner].push(p);
  });

  Object.entries(grouped).forEach(([owner, ownerPlayers]) => {
    const ownerLi = document.createElement('li');
    ownerLi.style.fontWeight = 'bold';
    ownerLi.style.marginTop = '6px';
    ownerLi.textContent = `${owner} (${ownerPlayers.length}):`;
    playerList.appendChild(ownerLi);

    ownerPlayers.forEach(p => {
      const li = document.createElement('li');
      li.style.paddingLeft = '14px';
      li.textContent = `• ${p.name} (${p.initiative || 0})`;

      li.addEventListener('click', () => {
        selectedPlayer = p;
        if (p.x === null || p.y === null) {
          p.x = 0;
          p.y = 0;
          sendMessage({ type: 'movePlayer', id: p.id, x: p.x, y: p.y });
        }
      });

      if (myRole === "GM" || myRole === "DnD-Player") {
        const removeFromBoardBtn = document.createElement('button');
        removeFromBoardBtn.textContent = 'С поля';
        removeFromBoardBtn.style.marginLeft = '5px';
        removeFromBoardBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          sendMessage({ type: 'removePlayerFromBoard', id: p.id });
        });

        const removeCompletelyBtn = document.createElement('button');
        removeCompletelyBtn.textContent = 'Удалить';
        removeCompletelyBtn.style.marginLeft = '5px';
        removeCompletelyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          sendMessage({ type: 'removePlayerCompletely', id: p.id });
          playerOwners.delete(p.id);
          const el = playerElements.get(p.id);
          if (el) {
            el.remove();
            playerElements.delete(p.id);
          }
        });

        li.appendChild(removeFromBoardBtn);
        li.appendChild(removeCompletelyBtn);
      }

      playerList.appendChild(li);
    });
  });
}

      updateCurrentPlayer(msg.state);
      renderLog(msg.state.log || []);
    }
  };

  ws.onerror = (e) => {
    loginError.textContent = "Ошибка соединения с сервером";
    console.error(e);
  };
});

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
  } else if (role === "DnD-Player") resetGameBtn.style.display = 'none';
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

// ================== PLAYER LIST ==================
function updatePlayerList() {
  playerList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.initiative || 0})`;

    li.addEventListener('click', () => {
      selectedPlayer = p;
      if (p.x === null || p.y === null) {
        p.x = 0;
        p.y = 0;
        sendMessage({ type: 'movePlayer', id: p.id, x: p.x, y: p.y });
      }
    });

    if (myRole === "GM" || myRole === "DnD-Player") {
      const removeFromBoardBtn = document.createElement('button');
      removeFromBoardBtn.textContent = 'С поля';
      removeFromBoardBtn.style.marginLeft = '5px';
      removeFromBoardBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendMessage({ type: 'removePlayerFromBoard', id: p.id });
      });

      const removeCompletelyBtn = document.createElement('button');
      removeCompletelyBtn.textContent = 'Удалить';
      removeCompletelyBtn.style.marginLeft = '5px';
      removeCompletelyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendMessage({ type: 'removePlayerCompletely', id: p.id });
        const el = playerElements.get(p.id);
        if (el) { el.remove(); playerElements.delete(p.id); }
      });

      li.appendChild(removeFromBoardBtn);
      li.appendChild(removeCompletelyBtn);
    }

    playerList.appendChild(li);
  });
}

// ================== BOARD ==================
function renderBoard(state) {
  board.querySelectorAll('.cell').forEach(c => c.remove());
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
      if (state.walls?.find(w => w.x === x && w.y === y)) cell.classList.add('wall');
      board.appendChild(cell);
    }
  }

  players.forEach(p => setPlayerPosition(p));
}

// ================== PLAYER POSITION ==================
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

    el.addEventListener('mousedown', () => {
      if (!editEnvironment) {
        if (selectedPlayer) {
          const prev = playerElements.get(selectedPlayer.id);
          if (prev) prev.classList.remove('selected');
        }
        selectedPlayer = player;
        el.classList.add('selected');
      }
    });

    board.appendChild(el);
    playerElements.set(player.id, el);
    player.element = el;
  }

  if (player.x === null || player.y === null) { el.style.display='none'; return; }
  el.style.display='flex';

  let maxX = boardWidth - player.size;
  let maxY = boardHeight - player.size;
  let x = Math.min(Math.max(player.x, 0), maxX);
  let y = Math.min(Math.max(player.y, 0), maxY);

  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) { el.style.left = `${cell.offsetLeft}px`; el.style.top = `${cell.offsetTop}px`; }
}

// ================== ADD PLAYER ==================
addPlayerBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return alert("Введите имя");

  const player = {
    id: crypto.randomUUID(),
    name,
    owner: myName, // владелец игрока
    color: playerColorInput.value,
    size: parseInt(playerSizeInput.value),
    x: null,
    y: null,
    initiative: 0
  };

  sendMessage({ type: 'addPlayer', player });
  playerNameInput.value = '';
});

// ================== WS HANDLER ==================
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "state") {
    const state = msg.state;

    boardWidth = state.boardWidth || boardWidth;
    boardHeight = state.boardHeight || boardHeight;

    // используем игроков с owner от сервера
    players = state.players.map(p => ({ ...p }));

    renderBoard(state);
    updatePlayerList();
    updateCurrentPlayer(state);
    renderLog(state.log || []);
  }

  if (msg.type === "users") updateUserList(msg.users);
  if (msg.type === "error") loginError.textContent = msg.message;
};

// ================== PLAYER LIST ==================
function updatePlayerList() {
  playerList.innerHTML = '';

  // группируем игроков по владельцам
  const grouped = {};
  players.forEach(p => {
    const owner = p.owner || 'Без владельца';
    if (!grouped[owner]) grouped[owner] = [];
    grouped[owner].push(p);
  });

  Object.entries(grouped).forEach(([owner, ownerPlayers]) => {
    const ownerLi = document.createElement('li');
    ownerLi.style.fontWeight = 'bold';
    ownerLi.style.marginTop = '6px';
    ownerLi.textContent = `${owner} (${ownerPlayers.length}):`;
    playerList.appendChild(ownerLi);

    ownerPlayers.forEach(p => {
      const li = document.createElement('li');
      li.style.paddingLeft = '14px';
      li.textContent = `• ${p.name} (${p.initiative || 0})`;

      li.addEventListener('click', () => {
        selectedPlayer = p;
        if (p.x === null || p.y === null) {
          p.x = 0;
          p.y = 0;
          sendMessage({ type: 'movePlayer', id: p.id, x: p.x, y: p.y });
        }
      });

      if (myRole === "GM" || myRole === "DnD-Player") {
        const removeFromBoardBtn = document.createElement('button');
        removeFromBoardBtn.textContent = 'С поля';
        removeFromBoardBtn.style.marginLeft = '5px';
        removeFromBoardBtn.addEventListener('click', e => {
          e.stopPropagation();
          sendMessage({ type: 'removePlayerFromBoard', id: p.id });
        });

        const removeCompletelyBtn = document.createElement('button');
        removeCompletelyBtn.textContent = 'Удалить';
        removeCompletelyBtn.style.marginLeft = '5px';
        removeCompletelyBtn.addEventListener('click', e => {
          e.stopPropagation();
          sendMessage({ type: 'removePlayerCompletely', id: p.id });
          const el = playerElements.get(p.id);
          if (el) { el.remove(); playerElements.delete(p.id); }
        });

        li.appendChild(removeFromBoardBtn);
        li.appendChild(removeCompletelyBtn);
      }

      playerList.appendChild(li);
    });
  });
}

// ================== MOVE PLAYER ==================
board.addEventListener('click', e => {
  if (!selectedPlayer) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;

  let x = parseInt(cell.dataset.x);
  let y = parseInt(cell.dataset.y);
  if (x + selectedPlayer.size > boardWidth) x = boardWidth - selectedPlayer.size;
  if (y + selectedPlayer.size > boardHeight) y = boardHeight - selectedPlayer.size;

  sendMessage({ type:'movePlayer', id:selectedPlayer.id, x, y });
  const el = playerElements.get(selectedPlayer.id);
  if (el) el.classList.remove('selected');
  selectedPlayer = null;
});

// ================== DICE ==================
rollBtn.addEventListener('click', () => {
  const sides = parseInt(dice.value);
  const result = Math.floor(Math.random()*sides)+1;
  rollResult.textContent = `Результат: ${result}`;
  sendMessage({ type:'log', text:`Бросок d${sides}: ${result}` });
});

// ================== END TURN ==================
endTurnBtn.addEventListener('click', () => sendMessage({ type:'endTurn' }));

// ================== INITIATIVE ==================
rollInitiativeBtn.addEventListener('click', () => sendMessage({ type:'rollInitiative' }));

// ================== WALLS ==================
editEnvBtn.addEventListener('click', () => {
  editEnvironment = !editEnvironment;
  addWallBtn.disabled = !editEnvironment;
  removeWallBtn.disabled = !editEnvironment;
  wallMode = null;
  editEnvBtn.textContent = editEnvironment ? "Редактирование: ВКЛ" : "Редактирование: ВЫКЛ";
});

addWallBtn.addEventListener('click', () => wallMode='add');
removeWallBtn.addEventListener('click', () => wallMode='remove');

board.addEventListener('mousedown', e => { if(!editEnvironment||!wallMode) return; mouseDown=true; toggleWall(e.target.closest('.cell')); });
board.addEventListener('mouseover', e => { if(!mouseDown||!editEnvironment||!wallMode) return; toggleWall(e.target.closest('.cell')); });
board.addEventListener('mouseup', () => mouseDown=false);

function toggleWall(cell){
  if(!cell) return;
  const x=+cell.dataset.x, y=+cell.dataset.y;
  if(wallMode==='add'){ sendMessage({ type:'addWall', wall:{x,y} }); cell.classList.add('wall'); }
  else if(wallMode==='remove'){ sendMessage({ type:'removeWall', wall:{x,y} }); cell.classList.remove('wall'); }
}

// ================== CREATE BOARD ==================
createBoardBtn.addEventListener('click', () => {
  const width=parseInt(boardWidthInput.value);
  const height=parseInt(boardHeightInput.value);
  if(isNaN(width)||isNaN(height)||width<1||height<1||width>20||height>20) return alert("Введите корректные размеры поля (1–20)");
  sendMessage({ type:'resizeBoard', width, height });
});

// ================== RESET GAME ==================
resetGameBtn.addEventListener('click', () => {
  playerElements.forEach(el => el.remove());
  playerElements.clear();
  playerOwners.clear();
  sendMessage({ type:'resetGame' });
});

// ================== HELPER ==================
function sendMessage(msg){ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }




