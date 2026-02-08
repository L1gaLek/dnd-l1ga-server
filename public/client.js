// ================== ELEMENTS ==================
const loginDiv = document.getElementById('login-container');
const joinBtn = document.getElementById('joinBtn');
const usernameInput = document.getElementById('username');
const roleSelect = document.getElementById('role');
const loginError = document.getElementById('loginError');



// ===== Rooms lobby UI =====
const roomsDiv = document.getElementById('rooms-container');
const roomsList = document.getElementById('rooms-list');
const roomsError = document.getElementById('roomsError');

const createRoomBtn = document.getElementById('createRoomBtn');
const createRoomModal = document.getElementById('createRoomModal');
const createRoomClose = document.getElementById('createRoomClose');
const createRoomCancel = document.getElementById('createRoomCancel');
const createRoomSubmit = document.getElementById('createRoomSubmit');

const roomNameInput = document.getElementById('roomNameInput');
const roomPasswordInput = document.getElementById('roomPasswordInput');
const roomScenarioInput = document.getElementById('roomScenarioInput');

const gameUI = document.getElementById('main-container');
const myNameSpan = document.getElementById('myName');
const myRoleSpan = document.getElementById('myRole');
const myRoomSpan = document.getElementById('myRoom');
const myScenarioSpan = document.getElementById('myScenario');
const diceViz = document.getElementById('dice-viz');

const board = document.getElementById('game-board');
const playerList = document.getElementById('player-list');
const logList = document.getElementById('log-list');
const currentPlayerSpan = document.getElementById('current-player');
const nextTurnBtn = document.getElementById('next-turn');

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

const dice = document.getElementById('dice');
const diceCountInput = document.getElementById('dice-count');
const diceRolls = document.getElementById('dice-rolls');

const editEnvBtn = document.getElementById('edit-environment');
const addWallBtn = document.getElementById('add-wall');
const removeWallBtn = document.getElementById('remove-wall');

const startInitiativeBtn = document.getElementById("start-initiative");
const startCombatBtn = document.getElementById("start-combat");
const startExplorationBtn = document.getElementById("start-exploration");

const worldPhasesBox = document.getElementById('world-phases');
const envEditorBox = document.getElementById('env-editor');

// ================== VARIABLES ==================
let ws;
let myId;
let myRole;
let currentRoomId = null;
let players = [];
let lastState = null;
let boardWidth = parseInt(boardWidthInput.value, 10) || 10;
let boardHeight = parseInt(boardHeightInput.value, 10) || 10;

let selectedPlayer = null;
let editEnvironment = false;
let wallMode = null;
let mouseDown = false;

const playerElements = new Map();
let finishInitiativeSent = false;

// users map (ownerId -> {name, role})
const usersById = new Map();

// стартово прячем панель бросков до входа в комнату
if (diceViz) diceViz.style.display = 'none';

// ================== JOIN GAME ==================
joinBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  const role = roleSelect.value;

  if (!name) {
    loginError.textContent = "Введите имя";
    return;
  }

  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

    const savedUserId = localStorage.getItem("dnd_user_id") || "";
  const savedUserRole = localStorage.getItem("dnd_user_role") || "";
  const userIdToSend = (savedUserId && savedUserRole === role) ? savedUserId : "";

  ws.onopen = () => ws.send(JSON.stringify({ type: "register", userId: userIdToSend, name, role }));

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    

// ===== Rooms lobby messages =====
if (msg.type === 'rooms' && Array.isArray(msg.rooms)) {
  renderRooms(msg.rooms);
  if (!currentRoomId && diceViz) diceViz.style.display = 'none';
}
if (msg.type === 'joinedRoom' && msg.room) {
  roomsDiv.style.display = 'none';
  gameUI.style.display = 'block';

  currentRoomId = msg.room.id || null;
  if (myRoomSpan) myRoomSpan.textContent = msg.room.name || '-';
  if (myScenarioSpan) myScenarioSpan.textContent = msg.room.scenario || '-';
  if (diceViz) diceViz.style.display = 'block';
}

if (msg.type === "registered") {
      myId = msg.id;
      localStorage.setItem("dnd_user_id", String(msg.id));
      localStorage.setItem("dnd_user_role", String(msg.role || ""));
myRole = msg.role;
      myNameSpan.textContent = msg.name;
      myRoleSpan.textContent = msg.role;
      myRole = String(msg.role || "");

      

      currentRoomId = null;
      if (diceViz) diceViz.style.display = 'none';
      if (myRoomSpan) myRoomSpan.textContent = '-';
      if (myScenarioSpan) myScenarioSpan.textContent = '-';
loginDiv.style.display = 'none';
      roomsDiv.style.display = 'block';
      gameUI.style.display = 'none';
      roomsError.textContent = '';
      sendMessage({ type: 'listRooms' });

      setupRoleUI(myRole);

      // ИНИЦИАЛИЗАЦИЯ МОДАЛКИ "ИНФА"
      if (window.InfoModal?.init) {
        window.InfoModal.init({
          sendMessage,
          getMyId: () => myId,
          getMyRole: () => myRole
        });
      }
    }

    if (msg.type === "error") {
      const text = String(msg.message || "Ошибка");
      // если мы ещё на экране логина
      if (loginDiv && loginDiv.style.display !== 'none') {
        loginError.textContent = text;
      } else if (roomsDiv && roomsDiv.style.display !== 'none') {
        roomsError.textContent = text;
      } else {
        // в игре — показываем как быстрое уведомление
        alert(text);
      }
    }

    if (msg.type === "users" && Array.isArray(msg.users)) {
      usersById.clear();
      msg.users.forEach(u => usersById.set(u.id, { name: u.name, role: u.role }));
      updatePlayerList();
    }

    if (msg.type === "diceEvent" && msg.event) {
      // показываем всем "Броски других", а себе — обновляем основную панель броска
      if (msg.event.fromId && typeof myId !== "undefined" && msg.event.fromId === myId) {
        applyDiceEventToMain(msg.event);
      } else {
        pushOtherDiceEvent(msg.event);
      }
    }

    // ===== Saved bases (персонажи, привязанные к userId) =====
    if (msg.type === "savedBasesList" && Array.isArray(msg.list)) {
      window.InfoModal?.onSavedBasesList?.(msg.list);
    }
    if (msg.type === "savedBaseSaved") {
      window.InfoModal?.onSavedBaseSaved?.(msg);
    }
    if (msg.type === "savedBaseApplied") {
      window.InfoModal?.onSavedBaseApplied?.(msg);
    }
    if (msg.type === "savedBaseDeleted") {
      window.InfoModal?.onSavedBaseDeleted?.(msg);
    }

    if (msg.type === "init" || msg.type === "state") {
      lastState = msg.state;
      boardWidth = msg.state.boardWidth;
      boardHeight = msg.state.boardHeight;

      // Удаляем DOM-элементы игроков, которых больше нет в состоянии
      const existingIds = new Set((msg.state.players || []).map(p => p.id));
      playerElements.forEach((el, id) => {
        if (!existingIds.has(id)) {
          el.remove();
          playerElements.delete(id);
        }
      });

      players = msg.state.players || [];

      // Основа одна на пользователя — блокируем чекбокс
      if (isBaseCheckbox) {
        const baseExistsForMe = players.some(p => p.isBase && p.ownerId === myId);
        isBaseCheckbox.disabled = baseExistsForMe;
        if (baseExistsForMe) isBaseCheckbox.checked = false;
      }

      if (selectedPlayer && !existingIds.has(selectedPlayer.id)) {
        selectedPlayer = null;
      }

      renderBoard(msg.state);
      updatePhaseUI(msg.state);
      updatePlayerList();
      updateCurrentPlayer(msg.state);
      renderLog(msg.state.log || []);

      // если "Инфа" открыта — обновляем ее по свежему state
      window.InfoModal?.refresh?.(players);
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

startExplorationBtn?.addEventListener("click", () => {
  sendMessage({ type: "startExploration" });
});

startCombatBtn?.addEventListener("click", () => {
  sendMessage({ type: "startCombat" });
});

nextTurnBtn?.addEventListener("click", () => {
  // "Конец хода" — перейти к следующему по инициативе
  sendMessage({ type: "endTurn" });
});

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
    if (worldPhasesBox) worldPhasesBox.style.display = 'none';
    if (envEditorBox) envEditorBox.style.display = 'none';
    if (nextTurnBtn) nextTurnBtn.style.display = 'none';
  } else if (role === "DnD-Player") {
    resetGameBtn.style.display = 'none';
    if (worldPhasesBox) worldPhasesBox.style.display = 'none';
    if (envEditorBox) envEditorBox.style.display = 'none';
  }

  if (role === "GM") {
    if (worldPhasesBox) worldPhasesBox.style.display = '';
    if (envEditorBox) envEditorBox.style.display = '';
  }
}

// ================== LOG ==================
function renderLog(logs) {
  const wasNearBottom =
    (logList.scrollTop + logList.clientHeight) >= (logList.scrollHeight - 30);

  logList.innerHTML = '';
  logs.slice(-50).forEach(line => {
    const li = document.createElement('li');
    li.textContent = line;
    logList.appendChild(li);
  });

  if (wasNearBottom) {
    logList.scrollTop = logList.scrollHeight;
  }
}

// ================== CURRENT PLAYER ==================
function updateCurrentPlayer(state) {
  const inCombat = (state && state.phase === 'combat');

  // по умолчанию
  if (nextTurnBtn) {
    nextTurnBtn.style.display = inCombat ? 'inline-block' : 'none';
    nextTurnBtn.disabled = true;
    nextTurnBtn.classList.remove('is-active');
  }

  if (!inCombat || !state || !state.turnOrder || state.turnOrder.length === 0) {
    currentPlayerSpan.textContent = '-';
    highlightCurrentTurn(null);
    return;
  }

  const id = state.turnOrder[state.currentTurnIndex];
  const p = players.find(pl => pl.id === id);
  currentPlayerSpan.textContent = p ? p.name : '-';

  highlightCurrentTurn(id);

  // кнопку "Следующий ход" может нажимать GM или владелец текущего персонажа
  if (nextTurnBtn) {
    const canNext = (myRole === 'GM') || (p && p.ownerId === myId);
    nextTurnBtn.disabled = !canNext;
    if (canNext) nextTurnBtn.classList.add('is-active');
  }
}

function highlightCurrentTurn(playerId) {
  playerElements.forEach((el) => el.classList.remove('current-turn'));
  if (!playerId) return;
  const el = playerElements.get(playerId);
  if (el) el.classList.add('current-turn');
}

// ================== PLAYER LIST ==================
function roleToLabel(role) {
  if (role === "GM") return "GM";
  if (role === "DnD-Player") return "DND-P";
  if (role === "Spectator") return "Spectr";
  return role || "-";
}

function roleToClass(role) {
  if (role === "GM") return "role-gm";
  if (role === "DnD-Player") return "role-player";
  return "role-spectr";
}

function updatePlayerList() {
  if (!playerList) return;
  playerList.innerHTML = '';

  const currentTurnId = (lastState && lastState.phase === 'combat' && Array.isArray(lastState.turnOrder) && lastState.turnOrder.length)
    ? lastState.turnOrder[lastState.currentTurnIndex]
    : null;

  // Сначала создаём группы по пользователям (даже если у них ещё нет персонажей)
  const grouped = {};
  usersById.forEach((u, ownerId) => {
    grouped[ownerId] = {
      ownerName: (u && u.name) ? u.name : 'Unknown',
      players: []
    };
  });

  // Добавляем персонажей в соответствующие группы
  players.forEach(p => {
    if (!grouped[p.ownerId]) {
      grouped[p.ownerId] = {
        ownerName: p.ownerName || 'Unknown',
        players: []
      };
    }
    grouped[p.ownerId].players.push(p);
  });

  Object.entries(grouped).forEach(([ownerId, group]) => {
    const userInfo = ownerId ? usersById.get(ownerId) : null;

    const ownerLi = document.createElement('li');
    ownerLi.className = 'owner-group';

    const ownerHeader = document.createElement('div');
    ownerHeader.className = 'owner-header';

    const ownerNameSpan = document.createElement('span');
    ownerNameSpan.className = 'owner-name';
    ownerNameSpan.textContent = userInfo?.name || group.ownerName;

    const role = userInfo?.role;
    const badge = document.createElement('span');
    badge.className = `role-badge ${roleToClass(role)}`;
    badge.textContent = `(${roleToLabel(role)})`;

    ownerHeader.appendChild(ownerNameSpan);
    ownerHeader.appendChild(badge);

    const ul = document.createElement('ul');
    ul.className = 'owner-players';

    if (!group.players || group.players.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'player-list-item';
      const text = document.createElement('span');
      text.classList.add('player-name-text');
      text.textContent = 'Персонажей нет';
      emptyLi.appendChild(text);
      ul.appendChild(emptyLi);
    }

    group.players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'player-list-item';

      if (currentTurnId && p.id === currentTurnId) {
        li.classList.add('is-current-turn');
      }

      const indicator = document.createElement('span');
      indicator.classList.add('placement-indicator');
      const placed = (p.x !== null && p.y !== null);
      indicator.classList.add(placed ? 'placed' : 'not-placed');

      const text = document.createElement('span');
      text.classList.add('player-name-text');
      const initVal = (p.initiative !== null && p.initiative !== undefined) ? p.initiative : 0;
      text.textContent = `${p.name} (${initVal})`;

      const nameWrap = document.createElement('div');
      nameWrap.classList.add('player-name-wrap');
      nameWrap.appendChild(indicator);
      nameWrap.appendChild(text);

      if (p.isBase) {
        const baseBadge = document.createElement('span');
        baseBadge.className = 'base-badge';
        baseBadge.textContent = 'основа';
        nameWrap.appendChild(baseBadge);
      }

      li.appendChild(nameWrap);

      const actions = document.createElement('div');
      actions.className = 'player-actions';

      // ===== Новый игрок во время боя: выбор инициативы (только для него) =====
      if (lastState && lastState.phase === 'combat' && p.pendingInitiativeChoice && (myRole === 'GM' || p.ownerId === myId)) {
        const box = document.createElement('div');
        box.className = 'init-choice-box';

        const rollInitBtn = document.createElement('button');
        rollInitBtn.className = 'init-choice-btn';
        rollInitBtn.textContent = 'Бросить инициативу';
        rollInitBtn.classList.add('mini-action-btn');
        rollInitBtn.title = 'd20 + модификатор Ловкости';
        rollInitBtn.onclick = (e) => {
          e.stopPropagation();
          sendMessage({ type: 'combatInitChoice', id: p.id, choice: 'roll' });
        };

        const baseInitBtn = document.createElement('button');
        baseInitBtn.className = 'init-choice-btn';
        baseInitBtn.textContent = 'Инициатива основы';
        baseInitBtn.classList.add('mini-action-btn');
        baseInitBtn.title = 'Взять инициативу из персонажа "основа" владельца';
        baseInitBtn.onclick = (e) => {
          e.stopPropagation();
          sendMessage({ type: 'combatInitChoice', id: p.id, choice: 'base' });
        };

        box.appendChild(rollInitBtn);
        box.appendChild(baseInitBtn);
        actions.appendChild(box);
      }

      // КНОПКА "ИНФА" — теперь вызывает внешний модуль
      if (p.isBase) {
        const infoBtn = document.createElement('button');
        infoBtn.textContent = 'Инфа';
        infoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.InfoModal?.open?.(p);
        });
        actions.appendChild(infoBtn);
      }

      // изменение размера
      if (myRole === "GM" || p.ownerId === myId) {
        const sizeSelect = document.createElement('select');
        sizeSelect.className = 'size-select';
        for (let s = 1; s <= 5; s++) {
          const opt = document.createElement('option');
          opt.value = String(s);
          opt.textContent = `${s}x${s}`;
          if (s === p.size) opt.selected = true;
          sizeSelect.appendChild(opt);
        }

        sizeSelect.addEventListener('click', (e) => e.stopPropagation());
        sizeSelect.addEventListener('change', (e) => {
          e.stopPropagation();
          sendMessage({ type: 'updatePlayerSize', id: p.id, size: parseInt(sizeSelect.value, 10) });
        });

        actions.appendChild(sizeSelect);
      }

      li.addEventListener('click', () => {
        selectedPlayer = p;
        if (p.x === null || p.y === null) {
          const size = Number(p.size) || 1;
          const spot = findFirstFreeSpotClient(size);
          if (!spot) {
            alert("Нет свободных клеток для размещения персонажа");
            return;
          }
          sendMessage({ type: 'movePlayer', id: p.id, x: spot.x, y: spot.y });
        }
      });

      if (myRole === "GM" || p.ownerId === myId) {
        const removeFromBoardBtn = document.createElement('button');
        removeFromBoardBtn.textContent = 'С поля';
        removeFromBoardBtn.onclick = (e) => {
          e.stopPropagation();
          sendMessage({ type: 'removePlayerFromBoard', id: p.id });
        };

        const removeCompletelyBtn = document.createElement('button');
        removeCompletelyBtn.textContent = 'Удалить';
        removeCompletelyBtn.onclick = (e) => {
          e.stopPropagation();
          sendMessage({ type: 'removePlayerCompletely', id: p.id });
        };

        actions.appendChild(removeFromBoardBtn);
        actions.appendChild(removeCompletelyBtn);
      }

      li.appendChild(actions);
      ul.appendChild(li);
    });

    ownerLi.appendChild(ownerHeader);
    ownerLi.appendChild(ul);
    playerList.appendChild(ownerLi);
  });
}

// ================== BOARD ==================
function renderBoard(state) {
  board.querySelectorAll('.cell').forEach(c => c.remove());
  board.style.position = 'relative';
  board.style.width = `${boardWidth * 50}px`;
  board.style.height = `${boardHeight * 50}px`;
  board.style.display = 'grid';
  board.style.gridTemplateColumns = `repeat(${boardWidth}, 50px)`;
  board.style.gridTemplateRows = `repeat(${boardHeight}, 50px)`;

  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
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
    el.textContent = player.name?.[0] || '?';
    el.style.backgroundColor = player.color;
    el.style.position = 'absolute';

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

  el.textContent = player.name ? player.name[0] : '?';
  el.style.backgroundColor = player.color;
  el.style.width = `${player.size * 50}px`;
  el.style.height = `${player.size * 50}px`;

  if (player.x === null || player.y === null) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';

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

// ================== NO-OVERLAP HELPERS (CLIENT SIDE) ==================
function rectsOverlap(ax, ay, as, bx, by, bs) {
  return ax < (bx + bs) && (ax + as) > bx && ay < (by + bs) && (ay + as) > by;
}

function isAreaFreeClient(ignoreId, x, y, size) {
  for (const other of players) {
    if (!other) continue;
    if (ignoreId && other.id === ignoreId) continue;
    if (other.x === null || other.y === null) continue;
    const os = Number(other.size) || 1;
    if (rectsOverlap(x, y, size, other.x, other.y, os)) return false;
  }
  return true;
}

function findFirstFreeSpotClient(size) {
  const maxX = boardWidth - size;
  const maxY = boardHeight - size;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      if (isAreaFreeClient(null, x, y, size)) return { x, y };
    }
  }
  return null;
}

// ================== ADD PLAYER ==================
addPlayerBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return alert("Введите имя");

  const player = {
    name,
    color: playerColorInput.value,
    size: parseInt(playerSizeInput.value, 10),
    isBase: !!isBaseCheckbox?.checked
  };

  sendMessage({ type: 'addPlayer', player });

  playerNameInput.value = '';
  if (isBaseCheckbox && !isBaseCheckbox.disabled) isBaseCheckbox.checked = false;
});

// ================== MOVE PLAYER ==================
board.addEventListener('click', e => {
  if (!selectedPlayer) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;

  let x = parseInt(cell.dataset.x, 10);
  let y = parseInt(cell.dataset.y, 10);
  if (x + selectedPlayer.size > boardWidth) x = boardWidth - selectedPlayer.size;
  if (y + selectedPlayer.size > boardHeight) y = boardHeight - selectedPlayer.size;

  // быстрый локальный чек (сервер всё равно проверит)
  const size = Number(selectedPlayer.size) || 1;
  if (!isAreaFreeClient(selectedPlayer.id, x, y, size)) {
    alert("Эта клетка занята другим персонажем");
    return;
  }

  sendMessage({ type: 'movePlayer', id: selectedPlayer.id, x, y });
  const el = playerElements.get(selectedPlayer.id);
  if (el) el.classList.remove('selected');
  selectedPlayer = null;
});

// ===== Dice Viz (panel + canvas animation) =====
const diceVizKind = document.getElementById("dice-viz-kind");
const diceVizValue = document.getElementById("dice-viz-value");
const diceCanvas = document.getElementById("dice-canvas");
const diceCtx = diceCanvas?.getContext?.("2d");

let diceAnimFrame = null;
let diceAnimBusy = false;

// ===== Other players dice feed (right of dice panel) =====
let othersDiceWrap = null;

function ensureOthersDiceUI() {
  if (othersDiceWrap) return othersDiceWrap;

  othersDiceWrap = document.createElement("div");
  othersDiceWrap.className = "dice-others";
  othersDiceWrap.innerHTML = `<div class="dice-others__title">Броски других</div>`;
  document.body.appendChild(othersDiceWrap);
  return othersDiceWrap;
}

// показываем результат броска в основной панели (используется для серверных инициатив и т.п.)
async function applyDiceEventToMain(ev) {
  if (!ev) return;

  const sides = Number(ev.sides) || null;
  const count = Number(ev.count) || 1;
  const bonus = Number(ev.bonus) || 0;

  // подпись
  if (diceVizKind) {
    diceVizKind.textContent = ev.kindText || (sides ? `d${sides}` : "Бросок");
  }

  // значение — итог (с бонусом)
  if (diceVizValue) {
    diceVizValue.textContent = String(Number(ev.total) || 0);
  }

  // фишки — только "сырой" кубик (rolls)
  const rolls = Array.isArray(ev.rolls) ? ev.rolls.map(n => Number(n) || 0) : [];
  renderRollChips(rolls.length ? rolls : [Number(ev.total) || 0], -1, sides);

  // анимация кубика (как при обычном "Бросить")
  if (!diceAnimBusy && diceCtx && diceCanvas && sides && rolls.length) {
    diceAnimBusy = true;
    try {
      for (const r of rolls) {
        await animateSingleRoll(sides, r);
      }
    } finally {
      diceAnimBusy = false;
    }
  }

  // крит-подсветку оставляем только для чистого d20 (без бонуса)
  if (sides === 20 && count === 1 && bonus === 0 && rolls.length === 1) {
    applyPureD20CritUI(rolls[0]);
  } else {
    clearCritUI();
  }
}

function pushOtherDiceEvent(ev) {
  ensureOthersDiceUI();

  // не показываем свои же броски
  if (ev.fromId && typeof myId !== "undefined" && ev.fromId === myId) return;

  const item = document.createElement("div");
  item.className = "dice-others__item";
  item.dataset.crit = ev.crit || "";

  const rollsText = (ev.rolls && ev.rolls.length)
    ? ev.rolls.join(" + ")
    : "-";

  const head = `${ev.fromName || "Игрок"}: ${ev.kindText || `d${ev.sides} × ${ev.count}`}`;

  // Для одиночного броска с бонусом показываем компактно: "12+4=16"
  let tail = `${rollsText} = ${ev.total}`;
  const bonusNum = Number(ev.bonus) || 0;
  if (Number(ev.count) === 1 && bonusNum !== 0 && Array.isArray(ev.rolls) && ev.rolls.length === 1) {
    const r = Number(ev.rolls[0]) || 0;
    const sign = bonusNum >= 0 ? "+" : "-";
    tail = `${r}${sign}${Math.abs(bonusNum)}=${ev.total}`;
  }

  item.innerHTML = `
    <div class="dice-others__head">${escapeHtmlLocal(head)}</div>
    <div class="dice-others__body">${escapeHtmlLocal(tail)}</div>
  `;

  // крит подсветка (если прилетело)
  if (ev.crit === "crit-fail") item.classList.add("crit-fail");
  if (ev.crit === "crit-success") item.classList.add("crit-success");

  othersDiceWrap.appendChild(item);

  // через 5с — плавное исчезновение
  setTimeout(() => item.classList.add("fade"), 4200);
  setTimeout(() => item.remove(), 5200);
}

// маленький экранировщик
function escapeHtmlLocal(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearCritUI() {
  if (diceVizValue) {
    diceVizValue.classList.remove("crit-fail", "crit-success");
  }
  if (diceRolls) {
    diceRolls.querySelectorAll(".dice-chip").forEach(ch =>
      ch.classList.remove("crit-fail", "crit-success")
    );
  }
}

function applyPureD20CritUI(finalValue) {
  // крит только для "чистого" d20 (без бонуса), поэтому сюда передаём значение когда условия уже проверены
  clearCritUI();

  if (finalValue === 1) {
    if (diceVizValue) diceVizValue.classList.add("crit-fail");
    const chip = diceRolls?.querySelector(".dice-chip");
    if (chip) chip.classList.add("crit-fail");
    return " — КРИТИЧЕСКИЙ ПРОВАЛ (1)";
  }

  if (finalValue === 20) {
    if (diceVizValue) diceVizValue.classList.add("crit-success");
    const chip = diceRolls?.querySelector(".dice-chip");
    if (chip) chip.classList.add("crit-success");
    return " — КРИТИЧЕСКИЙ УСПЕХ (20)";
  }

  return "";
}


function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawDieFace(ctx, w, h, sides, value, t) {
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;

  // лёгкая тряска/вращение
  const ang = Math.sin(t * 0.02) * 0.22;
  const scale = 1 + Math.sin(t * 0.015) * 0.02;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  const pad = 14;
  const rw = w - pad * 2;
  const rh = h - pad * 2;
  const r = 18;

  // тень
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#000";
  roundRect(ctx, pad + 3, pad + 6, rw, rh, r);
  ctx.fill();
  ctx.globalAlpha = 1;

  // тело
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.strokeStyle = "rgba(255,255,255,0.20)";
  ctx.lineWidth = 2;
  roundRect(ctx, pad, pad, rw, rh, r);
  ctx.fill();
  ctx.stroke();

  // подпись dN
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`d${sides}`, cx, pad + 26);

  // значение
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "900 46px sans-serif";
  ctx.fillText(String(value), cx, cy + 18);

  ctx.restore();
}

function renderRollChips(values, activeIndex, sides = null) {
  if (!diceRolls) return;
  diceRolls.innerHTML = "";
  values.forEach((v, i) => {
    const chip = document.createElement("span");
    chip.className = "dice-chip" + (i === activeIndex ? " active" : "");
    // ✅ Подсветка 1 и 20 для любого количества одновременно брошенных d20
    if (Number(sides) === 20 && v !== null) {
      if (v === 1) chip.classList.add('crit-fail');
      if (v === 20) chip.classList.add('crit-success');
    }
    chip.textContent = (v === null ? "…" : String(v));
    diceRolls.appendChild(chip);
  });
}

function animateSingleRoll(sides, finalValue) {
  // Возвращает Promise, чтобы можно было кидать несколько кубов по очереди
  return new Promise((resolve) => {
    if (!diceCtx || !diceCanvas) {
      resolve();
      return;
    }

    const start = performance.now();
    const dur = 420; // ms на один кубик
    let lastShown = rollDie(sides);

    function frame(now) {
      const t = now - start;
      const p = Math.min(1, t / dur);

      const changeProb = 0.92 - 0.86 * p; // 0.92 -> 0.06
      if (Math.random() < changeProb) lastShown = rollDie(sides);

      drawDieFace(diceCtx, diceCanvas.width, diceCanvas.height, sides, lastShown, t);

      if (p < 1) {
        diceAnimFrame = requestAnimationFrame(frame);
      } else {
        drawDieFace(diceCtx, diceCanvas.width, diceCanvas.height, sides, finalValue, t + 999);
        resolve();
      }
    }

    if (diceAnimFrame) cancelAnimationFrame(diceAnimFrame);
    diceAnimFrame = requestAnimationFrame(frame);
  });
}

// ===== other players dice feed =====
let diceOthersWrap = null;

function ensureDiceOthersUI() {
  if (diceOthersWrap) return diceOthersWrap;

  diceOthersWrap = document.createElement('div');
  diceOthersWrap.className = 'dice-others';
  diceOthersWrap.innerHTML = `<div class="dice-others__title">Броски других</div>`;
  document.body.appendChild(diceOthersWrap);

  return diceOthersWrap;
}

function pushOtherDice(ev) {
  // не показываем свои же броски
  if (ev?.fromId && typeof myId !== 'undefined' && ev.fromId === myId) return;

  ensureDiceOthersUI();

  const item = document.createElement('div');
  item.className = 'dice-others__item';

  if (ev.crit === 'crit-fail') item.classList.add('crit-fail');
  if (ev.crit === 'crit-success') item.classList.add('crit-success');

  const head = `${ev.fromName || 'Игрок'}: ${ev.kindText || `d${ev.sides} × ${ev.count}`}`;
  const rollsText = (ev.rolls && ev.rolls.length) ? ev.rolls.join(' + ') : '-';

  // Для одиночного броска с бонусом показываем компактно: "12+4=16"
  let body = `${rollsText} = ${ev.total}`;
  const bonusNum = Number(ev.bonus) || 0;
  if (Number(ev.count) === 1 && bonusNum !== 0 && Array.isArray(ev.rolls) && ev.rolls.length === 1) {
    const r = Number(ev.rolls[0]) || 0;
    const sign = bonusNum >= 0 ? '+' : '-';
    body = `${r}${sign}${Math.abs(bonusNum)}=${ev.total}`;
  }

  item.innerHTML = `
    <div class="dice-others__head">${escapeHtmlLocal(head)}</div>
    <div class="dice-others__body">${escapeHtmlLocal(body)}</div>
  `;

  diceOthersWrap.appendChild(item);

  // затухание и удаление
  setTimeout(() => item.classList.add('fade'), 4200);
  setTimeout(() => item.remove(), 5200);
}

// маленький экранировщик (чтобы имена не ломали HTML)
function escapeHtmlLocal(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// ===== API: programmatic dice rolls (used by InfoModal weapons) =====
window.DicePanel = window.DicePanel || {};
// Programmatic dice roll used by InfoModal etc.
// If silent=true, it will only animate/update the local dice panel UI and will NOT send log/diceEvent.
// Returns: {sides,count,bonus,rolls,sum,total}
window.DicePanel.roll = async ({ sides = 20, count = 1, bonus = 0, kindText = null, silent = false } = {}) => {
  if (diceAnimBusy) return;
  diceAnimBusy = true;

  const S = clampInt(sides, 2, 100, 20);
  const C = clampInt(count, 1, 20, 1);
  const B = Number(bonus) || 0;

  // чтобы UI панели соответствовал броску
  if (dice) dice.value = String(S);
  if (diceCountInput) diceCountInput.value = String(C);

  clearCritUI();

  const finals = Array.from({ length: C }, () => rollDie(S));
  const shown = Array.from({ length: C }, () => null);

  renderRollChips(shown, 0, S);

  if (diceVizKind) diceVizKind.textContent = kindText ? String(kindText) : `d${S} × ${C}`;
  if (diceVizValue) diceVizValue.textContent = "…";

  for (let i = 0; i < C; i++) {
    renderRollChips(shown, i, S);
    await animateSingleRoll(S, finals[i]);
    shown[i] = finals[i];
    renderRollChips(shown, Math.min(i + 1, C - 1), S);
  }

  const sum = finals.reduce((a, b) => a + b, 0);
  const total = sum + B;

// Показ значения
if (diceVizValue) diceVizValue.textContent = String(total);
renderRollChips(shown, -1, S);

// ✅ крит-подсветка ТОЛЬКО для чистого d20 (без бонуса)
let critNote = "";
if (S === 20 && C === 1 && B === 0) {
  critNote = applyPureD20CritUI(finals[0]);
} else {
  clearCritUI();
}

  // в лог — тоже отправим (если не silent)
  if (!silent) {
    try {
      if (typeof sendMessage === "function") {
        const bonusTxt = B ? ` ${B >= 0 ? "+" : "-"} ${Math.abs(B)}` : "";
        sendMessage({
          type: 'log',
          text: `${kindText || `Бросок d${S} × ${C}`}: ${finals.join(' + ')} = ${sum}${bonusTxt} => ${total}${critNote}`
        });

        sendMessage({
          type: "diceEvent",
          event: {
            kindText: kindText ? String(kindText) : `d${S} × ${C}`,
            sides: S,
            count: C,
            bonus: B,
            rolls: finals,
            total: total,
            crit: (S === 20 && C === 1 && B === 0)
              ? (finals[0] === 1 ? "crit-fail" : finals[0] === 20 ? "crit-success" : "")
              : ""
          }
        });
      }
    } catch {}
  }

  diceAnimBusy = false;

  return { sides: S, count: C, bonus: B, rolls: finals, sum, total };
};

// ================== DICE (from the bottom-left panel) ==================
rollBtn?.addEventListener('click', async () => {
  if (diceAnimBusy) return;
  diceAnimBusy = true;
  rollBtn.disabled = true;

  const sides = clampInt(dice?.value, 2, 100, 20);
  const count = clampInt(diceCountInput?.value, 1, 20, 1);

  clearCritUI();

  // Итоговые значения заранее
  const finals = Array.from({ length: count }, () => rollDie(sides));
  const shown = Array.from({ length: count }, () => null);

  renderRollChips(shown, 0, sides);

  if (diceVizKind) diceVizKind.textContent = `d${sides} × ${count}`;
  if (diceVizValue) diceVizValue.textContent = "…";

  // Анимация: по одному кубику (видно процесс)
  for (let i = 0; i < count; i++) {
    renderRollChips(shown, i, sides);
    await animateSingleRoll(sides, finals[i]);
    shown[i] = finals[i];
    renderRollChips(shown, Math.min(i + 1, count - 1), sides);
  }

const sum = finals.reduce((a, b) => a + b, 0);

// без "Результат:" — только число
if (diceVizValue) diceVizValue.textContent = String(sum);

renderRollChips(shown, -1, sides);

// ✅ крит-подсветка ТОЛЬКО для чистого d20
let critNote = "";
if (sides === 20 && count === 1) {
  critNote = applyPureD20CritUI(finals[0]);
} else {
  clearCritUI();
}

sendMessage({
  type: 'log',
  text: `Бросок d${sides} × ${count}: ${finals.join(' + ')} = ${sum}${critNote}`
});

  sendMessage({
  type: "diceEvent",
  event: {
    kindText: `d${sides} × ${count}`,
    sides,
    count,
    bonus: 0,
    rolls: finals,
    total: sum,
    crit: (sides === 20 && count === 1)
      ? (finals[0] === 1 ? "crit-fail" : finals[0] === 20 ? "crit-success" : "")
      : ""
  }
});

  diceAnimBusy = false;
  rollBtn.disabled = false;
});

// ================== END TURN ==================
endTurnBtn?.addEventListener('click', () => sendMessage({ type: 'endTurn' }));

// ================== INITIATIVE ==================
rollInitiativeBtn.addEventListener('click', async () => {
  // Инициатива считается на сервере (d20 + модификатор Ловкости).
  // Сервер рассылает diceEvent — мы покажем его у себя в панели и у других в "Броски других".
  // UX: сразу показываем визуальную "заглушку" в панели броска, чтобы действие было видно мгновенно.
  clearCritUI();
  renderRollChips([null], -1, 20);
  if (diceVizKind) diceVizKind.textContent = 'Инициатива: d20';
  if (diceVizValue) diceVizValue.textContent = '…';
  sendMessage({ type: 'rollInitiative' });
});

// ================== WALLS ==================
editEnvBtn.addEventListener('click', () => {
  editEnvironment = !editEnvironment;
  addWallBtn.disabled = !editEnvironment;
  removeWallBtn.disabled = !editEnvironment;
  wallMode = null;
  editEnvBtn.textContent = editEnvironment ? "Редактирование: ВКЛ" : "Редактирование: ВЫКЛ";
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
  if (!mouseDown || !editEnvironment || !wallMode) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  toggleWall(cell);
});

board.addEventListener('mouseup', () => { mouseDown = false; });

function toggleWall(cell) {
  if (!cell) return;
  const x = +cell.dataset.x, y = +cell.dataset.y;
  if (wallMode === 'add') {
    sendMessage({ type: 'addWall', wall: { x, y } });
    cell.classList.add('wall');
  } else if (wallMode === 'remove') {
    sendMessage({ type: 'removeWall', wall: { x, y } });
    cell.classList.remove('wall');
  }
}

// ================== CREATE BOARD ==================
createBoardBtn.addEventListener('click', () => {
  const width = parseInt(boardWidthInput.value, 10);
  const height = parseInt(boardHeightInput.value, 10);
  if (isNaN(width) || isNaN(height) || width < 1 || height < 1 || width > 20 || height > 20)
    return alert("Введите корректные размеры поля (1–20)");
  sendMessage({ type: 'resizeBoard', width, height });
});

// ================== RESET GAME ==================
resetGameBtn.addEventListener('click', () => {
  playerElements.forEach(el => el.remove());
  playerElements.clear();
  sendMessage({ type: 'resetGame' });
});

// ================== CLEAR BOARD ==================
clearBoardBtn.addEventListener('click', () => {
  sendMessage({ type: 'clearBoard' });
});

// ================== HELPER ==================
function sendMessage(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function updatePhaseUI(state) {
  const allRolled = state.players?.length
    ? state.players.every(p => p.hasRolledInitiative)
    : false;

  // сбрасываем подсветки
  startExplorationBtn?.classList.remove('active', 'ready', 'pending');
  startInitiativeBtn?.classList.remove('active', 'ready', 'pending');
  startCombatBtn?.classList.remove('active', 'ready', 'pending');

  // ===== initiative roll button only in initiative phase
  if (state.phase === "initiative") {
    rollInitiativeBtn.style.display = "inline-block";
    rollInitiativeBtn.classList.add("is-active");
  } else {
    rollInitiativeBtn.style.display = "none";
    rollInitiativeBtn.classList.remove("is-active");
  }

  // ===== world phase buttons (GM only visually, but keep safe)
  if (state.phase === 'exploration') {
    startExplorationBtn?.classList.add('active');
    startCombatBtn.disabled = true;
  } else if (state.phase === 'initiative') {
    startInitiativeBtn?.classList.add(allRolled ? 'ready' : 'active');

    // бой можно начать только когда все бросили
    startCombatBtn.disabled = !allRolled;
    startCombatBtn.classList.add(allRolled ? 'pending' : 'active');
  } else if (state.phase === 'combat') {
    startCombatBtn.disabled = false;
    startCombatBtn.classList.add('ready');
  } else {
    // lobby or other
    startCombatBtn.disabled = true;
  }

  updateCurrentPlayer(state);
}







// ================== ROOMS LOBBY UI ==================
function renderRooms(rooms) {
  if (!roomsList) return;
  roomsError.textContent = '';
  roomsList.innerHTML = '';

  if (!rooms.length) {
    roomsList.textContent = 'Комнат пока нет.';
    return;
  }

  rooms.forEach(r => {
    const card = document.createElement('div');
    card.className = 'sheet-card';
    card.style.marginBottom = '10px';
    card.style.display = 'flex';
    card.style.alignItems = 'center';
    card.style.justifyContent = 'space-between';
    card.style.gap = '12px';

    const left = document.createElement('div');
    left.style.minWidth = '0';

    const title = document.createElement('div');
    title.style.fontWeight = '900';
    title.textContent = r.name;

    const meta = document.createElement('div');
    meta.style.fontSize = '12px';
    meta.style.color = '#aaa';
    meta.textContent =
      `Пользователей: ${r.uniqueUsers} • Пароль: ${r.hasPassword ? 'да' : 'нет'}`
      + (r.scenario ? ` • Сценарий: ${r.scenario}` : '');

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '8px';

    const joinBtn2 = document.createElement('button');
    joinBtn2.textContent = 'Войти';
    joinBtn2.onclick = () => {
      const pw = r.hasPassword ? prompt('Пароль комнаты:') : '';
      sendMessage({ type: 'joinRoom', roomId: r.id, password: pw || '' });
    };

    right.appendChild(joinBtn2);
    card.appendChild(left);
    card.appendChild(right);

    roomsList.appendChild(card);
  });
}

function openCreateRoomModal() {
  roomNameInput.value = '';
  roomPasswordInput.value = '';
  roomScenarioInput.value = '';
  createRoomModal.classList.remove('hidden');
}

function closeCreateRoomModal() {
  createRoomModal.classList.add('hidden');
}

if (createRoomBtn) createRoomBtn.addEventListener('click', openCreateRoomModal);
if (createRoomClose) createRoomClose.addEventListener('click', closeCreateRoomModal);
if (createRoomCancel) createRoomCancel.addEventListener('click', closeCreateRoomModal);

if (createRoomSubmit) createRoomSubmit.addEventListener('click', () => {
  const name = roomNameInput.value.trim();
  const password = roomPasswordInput.value || '';
  const scenario = roomScenarioInput.value.trim();

  if (!name) {
    roomsError.textContent = 'Введите название комнаты';
    return;
  }

  sendMessage({ type: 'createRoom', name, password, scenario });
  closeCreateRoomModal();
});
