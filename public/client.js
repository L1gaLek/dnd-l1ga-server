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
const rollResult = document.getElementById('roll-result');

const editEnvBtn = document.getElementById('edit-environment');
const addWallBtn = document.getElementById('add-wall');
const removeWallBtn = document.getElementById('remove-wall');

const startInitiativeBtn = document.getElementById("start-initiative");
const startCombatBtn = document.getElementById("start-combat");

// ===== MODAL ELEMENTS =====
const sheetModal = document.getElementById('sheet-modal');
const sheetClose = document.getElementById('sheet-close');
const sheetTitle = document.getElementById('sheet-title');
const sheetSubtitle = document.getElementById('sheet-subtitle');
const sheetActions = document.getElementById('sheet-actions');
const sheetContent = document.getElementById('sheet-content');

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

// users map (ownerId -> {name, role})
const usersById = new Map();

// состояние модалки
let openedSheetPlayerId = null;

// ================== MODAL HELPERS ==================
function openModal() {
  if (!sheetModal) return;
  sheetModal.classList.remove('hidden');
  sheetModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  if (!sheetModal) return;
  sheetModal.classList.add('hidden');
  sheetModal.setAttribute('aria-hidden', 'true');
  openedSheetPlayerId = null;

  if (sheetTitle) sheetTitle.textContent = "Информация о персонаже";
  if (sheetSubtitle) sheetSubtitle.textContent = "";
  if (sheetActions) sheetActions.innerHTML = "";
  if (sheetContent) sheetContent.innerHTML = "";
}

sheetClose?.addEventListener('click', closeModal);

// клик по фону закрывает
sheetModal?.addEventListener('click', (e) => {
  if (e.target === sheetModal) closeModal();
});

// ESC закрывает
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetModal && !sheetModal.classList.contains('hidden')) {
    closeModal();
  }
});

// ================== SHEET PARSER (Charbox/LSS) ==================
function parseCharboxFileText(fileText) {
  const outer = JSON.parse(fileText);

  // Charbox LSS: outer.data — строка JSON
  let inner = null;
  if (outer && typeof outer.data === 'string') {
    try { inner = JSON.parse(outer.data); } catch { inner = null; }
  }

  return {
    source: "charbox",
    importedAt: Date.now(),
    raw: outer,
    parsed: inner || outer
  };
}

function safeGet(obj, path, fallback = '-') {
  try {
    return path.split('.').reduce((acc, k) => acc && acc[k], obj) ?? fallback;
  } catch {
    return fallback;
  }
}

function formatMod(mod) {
  const n = Number(mod);
  if (Number.isNaN(n)) return String(mod);
  return n >= 0 ? `+${n}` : `${n}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSheetModal(player) {
  if (!sheetTitle || !sheetSubtitle || !sheetActions || !sheetContent) return;

  sheetTitle.textContent = `Инфа: ${player.name}`;
  sheetSubtitle.textContent = `Владелец: ${player.ownerName || 'Unknown'} • Тип: ${player.isBase ? 'Основа' : '-'}`;

  const canEdit = (myRole === "GM" || player.ownerId === myId);

  sheetActions.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'sheet-note';
  note.textContent = canEdit
    ? "Можно загрузить .json (Charbox/LSS). После загрузки лист сохраняется на сервере."
    : "Просмотр. Загружать лист может только владелец или GM.";
  sheetActions.appendChild(note);

  if (canEdit) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const sheet = parseCharboxFileText(text);

        sendMessage({ type: "setPlayerSheet", id: player.id, sheet });

        const tmp = document.createElement('div');
        tmp.className = 'sheet-note';
        tmp.textContent = "Файл отправлен на сервер. Сейчас обновится состояние…";
        sheetActions.appendChild(tmp);
      } catch (err) {
        alert("Не удалось прочитать/распарсить файл .json");
        console.error(err);
      } finally {
        fileInput.value = '';
      }
    });

    sheetActions.appendChild(fileInput);
  }

  const sheet = player.sheet?.parsed || null;
  if (!sheet) {
    sheetContent.innerHTML = `<div class="sheet-note">Лист не загружен.${canEdit ? " Загрузите .json через кнопку выше." : ""}</div>`;
    return;
  }

  const name = safeGet(sheet, 'name.value', player.name);
  const cls = safeGet(sheet, 'info.charClass.value', '-');
  const lvl = safeGet(sheet, 'info.level.value', '-');
  const race = safeGet(sheet, 'info.race.value', '-');
  const bg = safeGet(sheet, 'info.background.value', '-');
  const align = safeGet(sheet, 'info.alignment.value', '-');

  const hp = safeGet(sheet, 'vitality.hp-max.value', '-');
  const ac = safeGet(sheet, 'vitality.ac.value', '-');
  const spd = safeGet(sheet, 'vitality.speed.value', '-');

  function statLine(key) {
    const score = safeGet(sheet, `stats.${key}.score`, '-');
    const mod = safeGet(sheet, `stats.${key}.modifier`, '-');
    return { score, mod };
  }

  const STR = statLine('str');
  const DEX = statLine('dex');
  const CON = statLine('con');
  const INT = statLine('int');
  const WIS = statLine('wis');
  const CHA = statLine('cha');

  const weapons = Array.isArray(sheet.weaponsList)
    ? sheet.weaponsList.map(w => w?.name).filter(Boolean)
    : [];

  const coins = sheet.coins ? sheet.coins : null;
  const coinsText = coins
    ? ["cp","sp","ep","gp","pp"].filter(k => typeof coins[k] !== "undefined")
        .map(k => `${k.toUpperCase()}: ${coins[k]}`).join(" • ")
    : "Нет данных";

  sheetContent.innerHTML = `
    <div class="sheet-grid">
      <div class="sheet-card">
        <h4>Основное</h4>
        <div class="kv"><div class="k">Имя</div><div class="v">${escapeHtml(name)}</div></div>
        <div class="kv"><div class="k">Класс</div><div class="v">${escapeHtml(cls)}</div></div>
        <div class="kv"><div class="k">Уровень</div><div class="v">${escapeHtml(lvl)}</div></div>
        <div class="kv"><div class="k">Раса</div><div class="v">${escapeHtml(race)}</div></div>
        <div class="kv"><div class="k">Предыстория</div><div class="v">${escapeHtml(bg)}</div></div>
        <div class="kv"><div class="k">Мировоззрение</div><div class="v">${escapeHtml(align)}</div></div>
      </div>

      <div class="sheet-card">
        <h4>Характеристики</h4>
        <div class="kv"><div class="k">STR</div><div class="v">${STR.score} (${formatMod(STR.mod)})</div></div>
        <div class="kv"><div class="k">DEX</div><div class="v">${DEX.score} (${formatMod(DEX.mod)})</div></div>
        <div class="kv"><div class="k">CON</div><div class="v">${CON.score} (${formatMod(CON.mod)})</div></div>
        <div class="kv"><div class="k">INT</div><div class="v">${INT.score} (${formatMod(INT.mod)})</div></div>
        <div class="kv"><div class="k">WIS</div><div class="v">${WIS.score} (${formatMod(WIS.mod)})</div></div>
        <div class="kv"><div class="k">CHA</div><div class="v">${CHA.score} (${formatMod(CHA.mod)})</div></div>
      </div>

      <div class="sheet-card">
        <h4>Защита и движение</h4>
        <div class="kv"><div class="k">HP (max)</div><div class="v">${escapeHtml(hp)}</div></div>
        <div class="kv"><div class="k">AC</div><div class="v">${escapeHtml(ac)}</div></div>
        <div class="kv"><div class="k">Speed</div><div class="v">${escapeHtml(spd)}</div></div>
      </div>

      <div class="sheet-card" style="grid-column: 1 / -1;">
        <h4>Оружие (кратко)</h4>
        <div class="sheet-note">${weapons.length ? weapons.map(escapeHtml).join(", ") : "Нет данных"}</div>
      </div>

      <div class="sheet-card" style="grid-column: 1 / -1;">
        <h4>Монеты</h4>
        <div class="sheet-note">${escapeHtml(coinsText)}</div>
      </div>
    </div>
  `;
}

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

    // ✅ сохраняем пользователей (нужно для вывода ролей в списке инициативы)
    if (msg.type === "users" && Array.isArray(msg.users)) {
      usersById.clear();
      msg.users.forEach(u => usersById.set(u.id, { name: u.name, role: u.role }));
      updatePlayerList();
    }

    if (msg.type === "init" || msg.type === "state") {
      boardWidth = msg.state.boardWidth;
      boardHeight = msg.state.boardHeight;

      // ✅ Удаляем DOM-элементы игроков, которых больше нет в состоянии
      const existingIds = new Set((msg.state.players || []).map(p => p.id));
      playerElements.forEach((el, id) => {
        if (!existingIds.has(id)) {
          el.remove();
          playerElements.delete(id);
        }
      });

      players = msg.state.players || [];

      // ✅ Основа одна на пользователя — блокируем чекбокс
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

      // ✅ если модалка открыта — обновим контент по свежему state
      if (openedSheetPlayerId) {
        const pl = players.find(x => x.id === openedSheetPlayerId);
        if (pl) renderSheetModal(pl);
      }
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
    resetGameBtn.style.display = 'none';
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
  if (!state || !state.turnOrder || state.turnOrder.length === 0) {
    currentPlayerSpan.textContent = '-';
    highlightCurrentTurn(null);
    return;
  }

  const id = state.turnOrder[state.currentTurnIndex];
  const p = players.find(pl => pl.id === id);
  currentPlayerSpan.textContent = p ? p.name : '-';

  if (state.phase === 'combat') highlightCurrentTurn(id);
  else highlightCurrentTurn(null);
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

  // Группируем игроков по владельцу
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

  Object.entries(grouped).forEach(([ownerId, group]) => {
    const userInfo = ownerId ? usersById.get(ownerId) : null;

    // ===== контейнер группы владельца =====
    const ownerLi = document.createElement('li');
    ownerLi.className = 'owner-group';

    // ===== заголовок владельца (имя + роль) =====
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

    // ===== список персонажей владельца (ниже заголовка) =====
    const ul = document.createElement('ul');
    ul.className = 'owner-players';

    group.players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'player-list-item';

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

      // ✅ маленький бейдж "основа"
      if (p.isBase) {
        const baseBadge = document.createElement('span');
        baseBadge.className = 'base-badge';
        baseBadge.textContent = 'основа';
        nameWrap.appendChild(baseBadge);
      }

      li.appendChild(nameWrap);

      const actions = document.createElement('div');
      actions.className = 'player-actions';

      // ✅ КНОПКА "ИНФА" — показываем всем, но загрузка доступна владельцу/GM
      if (p.isBase) {
        const infoBtn = document.createElement('button');
        infoBtn.textContent = 'Инфа';
        infoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openedSheetPlayerId = p.id;
          renderSheetModal(p);
          openModal();
        });
        actions.appendChild(infoBtn);
      }

      // ✅ изменение размера игрока (только владелец или GM)
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
          sendMessage({ type: 'movePlayer', id: p.id, x: 0, y: 0 });
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

      // ✅ чтобы “Инфа” работала даже если игрок не владелец — добавляем actions всегда
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
    el.textContent = player.name[0];
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

  // ✅ ВАЖНО: обновляем внешний вид КАЖДЫЙ РАЗ (для realtime изменения размера/цвета)
  el.textContent = player.name ? player.name[0] : '?';
  el.style.backgroundColor = player.color;
  el.style.width = `${player.size * 50}px`;
  el.style.height = `${player.size * 50}px`;

  if (player.x === null || player.y === null) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';

  let maxX = boardWidth - player.size;
  let maxY = boardHeight - player.size;
  let x = Math.min(Math.max(player.x, 0), maxX);
  let y = Math.min(Math.max(player.y, 0), maxY);

  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) {
    el.style.left = `${cell.offsetLeft}px`;
    el.style.top = `${cell.offsetTop}px`;
  }
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

  let x = parseInt(cell.dataset.x);
  let y = parseInt(cell.dataset.y);
  if (x + selectedPlayer.size > boardWidth) x = boardWidth - selectedPlayer.size;
  if (y + selectedPlayer.size > boardHeight) y = boardHeight - selectedPlayer.size;

  sendMessage({ type: 'movePlayer', id: selectedPlayer.id, x, y });
  const el = playerElements.get(selectedPlayer.id);
  if (el) el.classList.remove('selected');
  selectedPlayer = null;
});

// ================== DICE ==================
rollBtn.addEventListener('click', () => {
  const sides = parseInt(dice.value);
  const result = Math.floor(Math.random() * sides) + 1;
  rollResult.textContent = `Результат: ${result}`;
  sendMessage({ type: 'log', text: `Бросок d${sides}: ${result}` });
});

// ================== END TURN ==================
endTurnBtn.addEventListener('click', () => sendMessage({ type: 'endTurn' }));

// ================== INITIATIVE ==================
rollInitiativeBtn.addEventListener('click', () => sendMessage({ type: 'rollInitiative' }));

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

board.addEventListener('mouseup', () => mouseDown = false);

function toggleWall(cell) {
  if (!cell) return;
  const x = +cell.dataset.x, y = +cell.dataset.y;
  if (wallMode === 'add') { sendMessage({ type: 'addWall', wall: { x, y } }); cell.classList.add('wall'); }
  else if (wallMode === 'remove') { sendMessage({ type: 'removeWall', wall: { x, y } }); cell.classList.remove('wall'); }
}

// ================== CREATE BOARD ==================
createBoardBtn.addEventListener('click', () => {
  const width = parseInt(boardWidthInput.value);
  const height = parseInt(boardHeightInput.value);
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

  if (state.phase === "initiative") {
    rollInitiativeBtn.style.display = "inline-block";

    startInitiativeBtn.classList.remove('active', 'ready', 'pending');
    startInitiativeBtn.classList.add(allRolled ? 'ready' : 'active');

    if (myRole === 'GM' && allRolled && !finishInitiativeSent) {
      finishInitiativeSent = true;
      sendMessage({ type: 'finishInitiative' });
    }
  } else {
    rollInitiativeBtn.style.display = "none";
    startInitiativeBtn.classList.remove('active', 'ready', 'pending');
    finishInitiativeSent = false;
  }

  startCombatBtn.classList.remove('active', 'ready', 'pending');

  if (state.phase === 'placement') {
    startCombatBtn.disabled = false;
    startCombatBtn.classList.add('pending');
  } else if (state.phase === 'combat') {
    startCombatBtn.disabled = false;
    startCombatBtn.classList.add('ready');
  } else {
    startCombatBtn.disabled = true;
  }

  updateCurrentPlayer(state);
}
