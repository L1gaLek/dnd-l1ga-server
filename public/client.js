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

// ================== VARIABLES ==================
let ws;
let myId;
let myRole;
let players = [];
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

      // ИНИЦИАЛИЗАЦИЯ МОДАЛКИ "ИНФА"
      if (window.InfoModal?.init) {
        window.InfoModal.init({
          sendMessage,
          getMyId: () => myId,
          getMyRole: () => myRole
        });
      }
    }

    if (msg.type === "error") loginError.textContent = msg.message;

    if (msg.type === "users" && Array.isArray(msg.users)) {
      usersById.clear();
      msg.users.forEach(u => usersById.set(u.id, { name: u.name, role: u.role }));
      updatePlayerList();
    }

    if (msg.type === "init" || msg.type === "state") {
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

      if (p.isBase) {
        const baseBadge = document.createElement('span');
        baseBadge.className = 'base-badge';
        baseBadge.textContent = 'основа';
        nameWrap.appendChild(baseBadge);
      }

      li.appendChild(nameWrap);

      const actions = document.createElement('div');
      actions.className = 'player-actions';

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

  sendMessage({ type: 'movePlayer', id: selectedPlayer.id, x, y });
  const el = playerElements.get(selectedPlayer.id);
  if (el) el.classList.remove('selected');
  selectedPlayer = null;
});

// ================== DICE PANEL ==================
const diceSelect = document.getElementById("dice-select");
const diceCountInput = document.getElementById("dice-count");
const diceRollBtn = document.getElementById("dice-roll");
const diceCanvas = document.getElementById("dice-canvas");
const diceCtx = diceCanvas?.getContext?.("2d");
const diceMeta = document.getElementById("dice-meta");
const diceTotal = document.getElementById("dice-total");

// Если у тебя остался старый rollResult — используем его, иначе просто игнор
const rollResult = document.getElementById("roll-result");

let diceAnimFrame = null;
let diceAnimBusy = false;

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function randDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

// --- РИСОВАЛКА ФОРМ (узнаваемые “DnD-кубики” в 2D) ---
function roundRectLocal(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawPolygon(ctx, n, r) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawDiamond(ctx, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(0, -ry);
  ctx.lineTo(rx, 0);
  ctx.lineTo(0, ry);
  ctx.lineTo(-rx, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawDieShape(ctx, sides, t) {
  // объём через градиент
  const g = ctx.createLinearGradient(-60, -60, 60, 60);
  g.addColorStop(0, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0.04)");
  ctx.fillStyle = g;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;

  if (sides === 2) {
    // d2 как “монетка”/овальная капсула
    roundRectLocal(ctx, -52, -34, 104, 68, 34);
    ctx.fill(); ctx.stroke();
  } else if (sides === 4) {
    drawPolygon(ctx, 3, 42);
  } else if (sides === 6) {
    roundRectLocal(ctx, -44, -44, 88, 88, 14);
    ctx.fill(); ctx.stroke();
  } else if (sides === 8) {
    drawDiamond(ctx, 42, 54);
  } else if (sides === 10 || sides === 100) {
    drawDiamond(ctx, 40, 60);
  } else if (sides === 12) {
    drawPolygon(ctx, 7, 46);
  } else if (sides === 20) {
    drawPolygon(ctx, 9, 48);
  } else {
    drawPolygon(ctx, 8, 46);
  }

  // тонкие “рёбра”
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-36, 0); ctx.lineTo(36, 0);
  ctx.moveTo(0, -36); ctx.lineTo(0, 36);
  ctx.stroke();
  ctx.restore();
}

function drawDieTile(ctx, x, y, sides, value, t, isRolling) {
  ctx.save();
  ctx.translate(x, y);

  // вращение только в процессе
  const ang = isRolling ? (t * 0.004 + Math.sin(t * 0.012) * 0.12) : 0;
  const wob = isRolling ? Math.sin(t * 0.02) * 1.5 : 0;

  ctx.translate(wob, 0);
  ctx.rotate(ang);

  drawDieShape(ctx, sides, t);

  ctx.restore();

  // текст без вращения (чтобы читался)
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 22px sans-serif";
  ctx.fillText(String(value), 0, 6);
  ctx.font = "bold 11px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.fillText(`d${sides}`, 0, -22);
  ctx.restore();
}

function layoutDicePositions(count) {
  // до 6 кубиков красиво, дальше — сетка 4x?
  const positions = [];
  const w = diceCanvas.width, h = diceCanvas.height;

  const cols = count <= 2 ? count : (count <= 4 ? 2 : 3);
  const rows = Math.ceil(count / cols);

  const cellW = w / cols;
  const cellH = h / rows;

  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    positions.push({
      x: (c + 0.5) * cellW,
      y: (r + 0.5) * cellH
    });
  }
  return positions;
}

function animateMultiRoll(sides, count, finals) {
  if (!diceCtx || !diceCanvas) {
    // фоллбэк без визуализации
    const sum = finals.reduce((a, b) => a + b, 0);
    if (rollResult) rollResult.textContent = `Результат: ${sum} (${finals.join(" + ")})`;
    diceTotal.textContent = `Σ ${sum}`;
    return;
  }

  if (diceAnimBusy) return;
  diceAnimBusy = true;

  diceMeta.textContent = `d${sides} × ${count}`;
  diceTotal.textContent = `Σ …`;

  const start = performance.now();
  const dur = 1100; // ms

  const shown = finals.slice(); // текущие значения
  for (let i = 0; i < shown.length; i++) shown[i] = randDie(sides);

  const pos = layoutDicePositions(count);

  function frame(now) {
    const t = now - start;
    const p = Math.min(1, t / dur);

    diceCtx.clearRect(0, 0, diceCanvas.width, diceCanvas.height);

    // обновляем “мигающие” значения, но затухаем к концу
    const changeProb = 0.92 - 0.85 * p; // 0.92 -> 0.07
    for (let i = 0; i < count; i++) {
      // небольшой сдвиг затухания по кубикам — выглядит живее
      const localP = Math.min(1, (t - i * 60) / dur);
      const localProb = 0.92 - 0.85 * Math.max(0, localP);
      if (Math.random() < localProb) shown[i] = randDie(sides);
    }

    // рисуем
    for (let i = 0; i < count; i++) {
      drawDieTile(diceCtx, pos[i].x, pos[i].y, sides, shown[i], t + i * 40, p < 1);
    }

    if (p < 1) {
      diceAnimFrame = requestAnimationFrame(frame);
    } else {
      // фиксируем финальные значения
      diceCtx.clearRect(0, 0, diceCanvas.width, diceCanvas.height);
      for (let i = 0; i < count; i++) {
        drawDieTile(diceCtx, pos[i].x, pos[i].y, sides, finals[i], t + i * 40, false);
      }

      const sum = finals.reduce((a, b) => a + b, 0);
      diceTotal.textContent = `Σ ${sum}`;

      if (rollResult) rollResult.textContent = `Результат: ${sum} (${finals.join(" + ")})`;

      diceAnimBusy = false;
    }
  }

  if (diceAnimFrame) cancelAnimationFrame(diceAnimFrame);
  diceAnimFrame = requestAnimationFrame(frame);
}

// ================== DICE ==================
diceRollBtn.addEventListener("click", () => {
  if (diceAnimBusy) return;

  const sides = clampInt(diceSelect.value, 2, 100, 20);
  const count = clampInt(diceCountInput.value, 1, 20, 1);

  const finals = Array.from({ length: count }, () => randDie(sides));
  const sum = finals.reduce((a, b) => a + b, 0);

  // визуализация
  animateMultiRoll(sides, count, finals);

  // лог (как раньше, но с деталями)
  sendMessage({
    type: "log",
    text: `Бросок d${sides} × ${count}: ${finals.join(" + ")} = ${sum}`
  });
});

// ===== Dice Viz (canvas animation) =====
const diceVizKind = document.getElementById("dice-viz-kind");
const diceVizValue = document.getElementById("dice-viz-value");
const diceCanvas = document.getElementById("dice-canvas");
const diceCtx = diceCanvas?.getContext?.("2d");

let diceAnimFrame = null;
let diceAnimBusy = false;

// ======== БРОСКИ КУБИКА =========

function drawDieFace(ctx, w, h, sides, value, t) {
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const ang = (t * 0.002) + Math.sin(t * 0.01) * 0.12; // вращение
  const wob = Math.sin(t * 0.012) * 2.0; // лёгкая тряска

  ctx.save();
  ctx.translate(cx + wob, cy);
  ctx.rotate(ang);

  // немного “объёма” через градиент
  const g = ctx.createLinearGradient(-60, -60, 60, 60);
  g.addColorStop(0, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0.04)");

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.fillStyle = g;

  // рисуем соответствующую форму
  if (sides === 6) {
    drawD6(ctx);
    // для d6 можно рисовать “точки”, но у нас есть число — оставим число (или могу сделать режим: точки вместо числа)
  } else if (sides === 4) {
    drawPolygon(ctx, 3, 56);          // треугольник
    drawHintEdges(ctx, 3, 56);
  } else if (sides === 8) {
    // “октаэдр”: ромб (квадрат под 45°) + диагональ
    drawDiamond(ctx, 56, 68);
    drawOctaHint(ctx, 56, 68);
  } else if (sides === 10) {
    // “d10”: вытянутый ромб + центральный “пояс”
    drawDiamond(ctx, 52, 74);
    drawD10Hint(ctx, 52, 74);
  } else if (sides === 12) {
    // “d12”: силуэт многоугольника
    drawPolygon(ctx, 7, 58);          // выглядит ближе к “додекаэдр-профилю”, чем просто круг
    drawHintEdges(ctx, 7, 58);
  } else if (sides === 20) {
    // “d20”: более круглый многоугольник
    drawPolygon(ctx, 9, 60);
    drawHintEdges(ctx, 9, 60);
  } else if (sides === 100) {
    // d100 часто как d10: рисуем как d10, но подписываем иначе
    drawDiamond(ctx, 52, 74);
    drawD10Hint(ctx, 52, 74);
  } else {
    // запасной вариант: многоугольник по количеству граней (но ограничим, чтобы не было 100-гранника как “круг”)
    const n = Math.max(3, Math.min(12, Math.round(Math.sqrt(sides) * 3)));
    drawPolygon(ctx, n, 58);
    drawHintEdges(ctx, n, 58);
  }

  // подпись dN (маленькая)
  ctx.save();
  ctx.resetTransform?.(); // если поддерживается
  // если resetTransform нет — дорисуем без него ниже через restore + отдельный save
  ctx.restore();

  ctx.restore();

  // Рисуем текст уже без вращения (чтобы читался)
  ctx.save();
  ctx.font = "900 42px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(String(value), cx, cy + 8);

  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.fillText(`d${sides}`, cx, cy - 44);
  ctx.restore();
}

function drawPolygon(ctx, n, r) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawHintEdges(ctx, n, r) {
  // тонкие “рёбра”, чтобы не было плоско
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDiamond(ctx, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(0, -ry);
  ctx.lineTo(rx, 0);
  ctx.lineTo(0, ry);
  ctx.lineTo(-rx, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawOctaHint(ctx, rx, ry) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -ry);
  ctx.lineTo(0, ry);
  ctx.moveTo(-rx, 0);
  ctx.lineTo(rx, 0);
  ctx.stroke();
  ctx.restore();
}

function drawD10Hint(ctx, rx, ry) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  // “пояс” (полоса) + диагонали
  ctx.moveTo(-rx * 0.6, -ry * 0.15);
  ctx.lineTo(rx * 0.6, -ry * 0.15);
  ctx.moveTo(-rx * 0.6, ry * 0.15);
  ctx.lineTo(rx * 0.6, ry * 0.15);

  ctx.moveTo(0, -ry);
  ctx.lineTo(rx, 0);
  ctx.moveTo(0, -ry);
  ctx.lineTo(-rx, 0);
  ctx.moveTo(0, ry);
  ctx.lineTo(rx, 0);
  ctx.moveTo(0, ry);
  ctx.lineTo(-rx, 0);

  ctx.stroke();
  ctx.restore();
}

function drawD6(ctx) {
  const s = 92; // размер квадрата
  const r = 14;
  // квадрат со скруглением (кубик “фейс”)
  roundRectLocal(ctx, -s/2, -s/2, s, s, r);
  ctx.fill();
  ctx.stroke();

  // лёгкие “рёбра”
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-s/2 + 10, -s/2 + 20);
  ctx.lineTo(s/2 - 10, -s/2 + 20);
  ctx.moveTo(-s/2 + 20, -s/2 + 10);
  ctx.lineTo(-s/2 + 20, s/2 - 10);
  ctx.stroke();
  ctx.restore();
}

function roundRectLocal(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ====== КОНЕЦ БРОСКОВ КУБИКА ======

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

function animateDiceRoll(sides, finalValue) {
  if (!diceCtx || !diceCanvas) {
    // если canvas не загрузился — просто показываем результат
    rollResult.textContent = `Результат: ${finalValue}`;
    return;
  }

  // блокируем повторные клики, чтобы анимации не накладывались
  if (diceAnimBusy) return;
  diceAnimBusy = true;

  diceVizKind.textContent = `d${sides}`;
  diceVizValue.textContent = "…";

  const start = performance.now();
  const dur = 1000; // ms
  let lastShown = finalValue;

  function frame(now) {
    const t = now - start;
    const p = Math.min(1, t / dur);

    // чем ближе к концу — тем реже меняем число (ощущение “затухания”)
    const changeProb = 0.85 - 0.75 * p; // 0.85 -> 0.10
    if (Math.random() < changeProb) {
      lastShown = Math.floor(Math.random() * sides) + 1;
    }

    drawDieFace(diceCtx, diceCanvas.width, diceCanvas.height, sides, lastShown, t);

    if (p < 1) {
      diceAnimFrame = requestAnimationFrame(frame);
    } else {
      // финальный кадр
      drawDieFace(diceCtx, diceCanvas.width, diceCanvas.height, sides, finalValue, t + 999);
      diceVizValue.textContent = String(finalValue);
      rollResult.textContent = `Результат: ${finalValue}`;
      diceAnimBusy = false;
    }
  }

  // на старте рисуем первый кадр
  if (diceAnimFrame) cancelAnimationFrame(diceAnimFrame);
  diceAnimFrame = requestAnimationFrame(frame);
}

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



