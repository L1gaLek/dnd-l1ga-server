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

const isBaseCheckbox = document.getElementById('is-base');
const isSummonCheckbox = document.getElementById('is-summon');

const dice = document.getElementById('dice');
const rollResult = document.getElementById('roll-result');

const editEnvBtn = document.getElementById('edit-environment');
const addWallBtn = document.getElementById('add-wall');
const removeWallBtn = document.getElementById('remove-wall');

const startInitiativeBtn = document.getElementById("start-initiative");
const startCombatBtn = document.getElementById("start-combat");

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

const playerElements = new Map();
let finishInitiativeSent = false;

function setupPlayerTypeToggles() {
  if (!isBaseCheckbox || !isSummonCheckbox) return;

  isBaseCheckbox.addEventListener('change', () => {
    if (isBaseCheckbox.checked) isSummonCheckbox.checked = false;
  });

  isSummonCheckbox.addEventListener('change', () => {
    if (isSummonCheckbox.checked) isBaseCheckbox.checked = false;
  });
}

setupPlayerTypeToggles();

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
  myNameSpan.textContent = msg.name;
  myRoleSpan.textContent = msg.role;

  loginDiv.style.display = "none";
  gameUI.style.display = "block";

  setupRoleUI(myRole);
}

    if (msg.type === "error") loginError.textContent = msg.message;

    if (msg.type === "users") updateUserList(msg.users);

if (msg.type === "init" || msg.type === "state") {
  boardWidth = msg.state.boardWidth;
  boardHeight = msg.state.boardHeight;

  // ✅ 1) Удаляем DOM-элементы игроков, которых больше нет в состоянии
  const existingIds = new Set((msg.state.players || []).map(p => p.id));
  playerElements.forEach((el, id) => {
    if (!existingIds.has(id)) {
      el.remove();
      playerElements.delete(id);
    }
  });

  // ✅ 2) Обновляем список игроков из state
  players = msg.state.players || [];

// Если у пользователя уже есть "Основа" — запрещаем создавать вторую
if (isBaseCheckbox && myId) {
  const hasBase = players.some(p => p.ownerId === myId && p.isBase);
  isBaseCheckbox.disabled = hasBase;
  if (hasBase) isBaseCheckbox.checked = false;
}

  // Если выбранный игрок был удалён — сбрасываем выбор
  if (selectedPlayer && !existingIds.has(selectedPlayer.id)) {
    selectedPlayer = null;
  }

  renderBoard(msg.state);
  updatePhaseUI(msg.state);
  updatePlayerList();
  updateCurrentPlayer(msg.state);
  renderLog(msg.state.log || []);
}
  };

  ws.onerror = (e) => {
    loginError.textContent = "Ошибка соединения с сервером";
    console.error(e);
  };
});

startInitiativeBtn?.addEventListener("click", () => {
  sendMessage({ type: "startInitiative" });
});

startCombatBtn?.addEventListener("click", () => {
  sendMessage({ type: "startCombat" });
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
    highlightCurrentTurn(null);
    return;
  }

  const id = state.turnOrder[state.currentTurnIndex];
  const p = players.find(pl => pl.id === id);
  currentPlayerSpan.textContent = p ? p.name : '-';

  // Подсветка фигуры на поле, когда идёт бой
  if (state.phase === 'combat') highlightCurrentTurn(id);
  else highlightCurrentTurn(null);
}

function highlightCurrentTurn(playerId) {
  // снимаем подсветку со всех
  playerElements.forEach((el) => el.classList.remove('current-turn'));

  if (!playerId) return;
  const el = playerElements.get(playerId);
  if (el) el.classList.add('current-turn');
}

// ================== PLAYER LIST ==================
function updatePlayerList() {
  playerList.innerHTML = '';

  // 🔹 Группируем игроков по владельцу
  const grouped = {};
  players.forEach(p => {
    if (!grouped[p.ownerId]) {
      grouped[p.ownerId] = {
        ownerName: p.ownerName || 'Unknown',
        players: []
      };
    }
    grouped[p.ownerId].players.push(p);
  });

  // 🔹 Рисуем
  Object.values(grouped).forEach(group => {
    const ownerLi = document.createElement('li');
    ownerLi.textContent = group.ownerName;
    ownerLi.style.marginTop = '8px';
    ownerLi.style.fontWeight = 'bold';

    const ul = document.createElement('ul');
    ul.style.paddingLeft = '15px';

    group.players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'player-list-item';
      li.style.fontWeight = 'normal';

      // ✅ кружок размещения
      const indicator = document.createElement('span');
      indicator.classList.add('placement-indicator');
      const placed = (p.x !== null && p.y !== null);
      indicator.classList.add(placed ? 'placed' : 'not-placed');

      // ✅ текст
const text = document.createElement('span');
text.classList.add('player-name-text');   // 👈 добавили класс
const initVal = (p.initiative !== null && p.initiative !== undefined) ? p.initiative : 0;
text.textContent = `${p.name} (${initVal})`;

li.appendChild(indicator);
li.appendChild(text);

      // Клик по игроку — выбираем (и если не размещён, ставим в 0,0 как раньше)
      li.addEventListener('click', () => {
        selectedPlayer = p;
        if (p.x === null || p.y === null) {
          sendMessage({ type: 'movePlayer', id: p.id, x: 0, y: 0 });
        }
      });

      // 🔒 Кнопки — только владельцу или GM
      if (myRole === "GM" || p.ownerId === myId) {
        const removeFromBoardBtn = document.createElement('button');
        removeFromBoardBtn.textContent = 'С поля';
        removeFromBoardBtn.style.marginLeft = '5px';
        removeFromBoardBtn.onclick = (e) => {
          e.stopPropagation();
          sendMessage({ type: 'removePlayerFromBoard', id: p.id });
        };

        const removeCompletelyBtn = document.createElement('button');
        removeCompletelyBtn.textContent = 'Удалить';
        removeCompletelyBtn.style.marginLeft = '5px';
        removeCompletelyBtn.onclick = (e) => {
          e.stopPropagation();
          sendMessage({ type: 'removePlayerCompletely', id: p.id });
        };

        li.appendChild(removeFromBoardBtn);
        li.appendChild(removeCompletelyBtn);
      }

      ul.appendChild(li);
    });

    ownerLi.appendChild(ul);
    playerList.appendChild(ownerLi);
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
    name,
    color: playerColorInput.value,
    size: parseInt(playerSizeInput.value),
    isBase: !!isBaseCheckbox?.checked,
    isSummon: !!isSummonCheckbox?.checked
  };

  // защита от двух галочек
  if (player.isBase && player.isSummon) {
    return alert("Выберите только один тип: Основа или Призвать");
  }

  sendMessage({ type: 'addPlayer', player });

  playerNameInput.value = '';
  if (isSummonCheckbox) isSummonCheckbox.checked = false;
  if (isBaseCheckbox && !isBaseCheckbox.disabled) isBaseCheckbox.checked = false;
});

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
  sendMessage({ type:'resetGame' });
});

// ================== CLEAR BOARD ==================
clearBoardBtn.addEventListener('click', () => {
  // Не трогаем playerElements руками — дождёмся state от сервера
  // (так синхронизация будет одинаковой у всех)
  sendMessage({ type: 'clearBoard' });
});

// ================== HELPER ==================
function sendMessage(msg){ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

function updatePhaseUI(state) {
  const allRolled = state.players?.length
    ? state.players.every(p => p.hasRolledInitiative)
    : false;

  // ---------- КНОПКА "Фаза инициативы" ----------
  // (красная = активная фаза; зелёная = все бросили)
  if (state.phase === "initiative") {
    rollInitiativeBtn.style.display = "inline-block";

    startInitiativeBtn.classList.remove('active', 'ready', 'pending');
    startInitiativeBtn.classList.add(allRolled ? 'ready' : 'active');

    // 🔑 Как только все бросили — автоматически завершаем инициативу
    // чтобы сервер перевёл фазу в placement и можно было начинать бой.
    if (myRole === 'GM' && allRolled && !finishInitiativeSent) {
      finishInitiativeSent = true;
      sendMessage({ type: 'finishInitiative' });
    }
  } else {
    rollInitiativeBtn.style.display = "none";
    startInitiativeBtn.classList.remove('active', 'ready', 'pending');

    // если мы вышли из инициативы — подготовим флаг к следующему разу
    finishInitiativeSent = false;
  }

  // ---------- КНОПКА "Начало боя" ----------
  // оранжевая = можно начинать бой (placement)
  // зелёная   = бой идёт (combat)
  startCombatBtn.classList.remove('active', 'ready', 'pending');

  if (state.phase === 'placement') {
    startCombatBtn.disabled = false;
    startCombatBtn.classList.add('pending'); // оранжевая
  } else if (state.phase === 'combat') {
    startCombatBtn.disabled = false;
    startCombatBtn.classList.add('ready'); // зелёная
  } else {
    startCombatBtn.disabled = true;
  }

  // Обновляем подпись "Текущий игрок" и подсветку
  updateCurrentPlayer(state);
}











