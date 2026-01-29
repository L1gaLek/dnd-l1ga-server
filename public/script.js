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

let boardWidth = parseInt(boardWidthInput.value);
let boardHeight = parseInt(boardHeightInput.value);
let cells = [];
const players = [];
let currentPlayerIndex = 0;
let selectedPlayer = null;

// ======== Журнал действий ========
function updateCurrentPlayer() {
  if (players.length === 0) currentPlayerSpan.textContent = '-';
  else currentPlayerSpan.textContent = players[currentPlayerIndex].name;
}

function addLog(text) {
  const li = document.createElement('li');
  li.textContent = text;
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
}

// ======== Создание поля ========
function createBoard(width, height) {
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${width}, 50px)`;
  board.style.gridTemplateRows = `repeat(${height}, 50px)`;

  cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.x = x;
      cell.dataset.y = y;
      board.appendChild(cell);
      cells.push(cell);
    }
  }

  players.forEach(player => {
    player.x = 0;
    player.y = 0;
    setPlayerPosition(player);
  });
}

createBoard(boardWidth, boardHeight);

createBoardBtn.addEventListener('click', () => {
  boardWidth = parseInt(boardWidthInput.value);
  boardHeight = parseInt(boardHeightInput.value);
  createBoard(boardWidth, boardHeight);
});

// ======== Добавление игрока ========
function addPlayer(name, color, size = 1) {
  const player = {
    name,
    color,
    size,
    initiative: 0,
    x: 0,
    y: 0,
    element: document.createElement('div')
  };

  player.element.classList.add('player');
  player.element.style.backgroundColor = color;
  player.element.textContent = name[0] || 'P';
  player.element.style.width = `${size * 50}px`;
  player.element.style.height = `${size * 50}px`;

  player.element.addEventListener('mousedown', () => {
    if (selectedPlayer) selectedPlayer.element.classList.remove('selected');
    selectedPlayer = player;
    player.element.classList.add('selected');
  });

  board.appendChild(player.element);
  players.push(player);
  setPlayerPosition(player);
  updatePlayerList();
  updateCurrentPlayer();
  addLog(`Игрок ${player.name} добавлен, размер ${size}x${size} клеток`);
}

addPlayerBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const color = playerColorInput.value;
  const size = parseInt(playerSizeInput.value);
  if (!name) return alert("Введите имя игрока");
  if (size < 1 || size > 5) return alert("Размер игрока должен быть от 1 до 5");
  addPlayer(name, color, size);
  playerNameInput.value = '';
});

// ======== Расчёт позиции игрока на поле ========
function setPlayerPosition(player) {
  player.element.style.left = `${player.x * 51}px`;
  player.element.style.top = `${player.y * 51}px`;
}

// ======== Бросок кубика ========
rollBtn.addEventListener('click', () => {
  if (players.length === 0) return alert("Добавьте хотя бы одного игрока");
  const sides = parseInt(dice.value);
  const result = Math.floor(Math.random() * sides) + 1;
  rollResult.textContent = `Результат: ${result}`;
  addLog(`Игрок ${players[currentPlayerIndex].name} бросил d${sides}: ${result}`);
});

// ======== Конец хода ========
endTurnBtn.addEventListener('click', () => {
  if (players.length === 0) return;
  addLog(`Игрок ${players[currentPlayerIndex].name} закончил ход.`);

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
  updateCurrentPlayer();
  addLog(`Ход игрока ${players[currentPlayerIndex].name}`);
});

// ======== Перетаскивание игроков ========
board.addEventListener('click', (e) => {
  if (!selectedPlayer) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;

  const x = parseInt(cell.dataset.x);
  const y = parseInt(cell.dataset.y);

  if (x + selectedPlayer.size > boardWidth || y + selectedPlayer.size > boardHeight) {
    alert("Игрок не помещается в эту позицию!");
    return;
  }

  selectedPlayer.x = x;
  selectedPlayer.y = y;
  setPlayerPosition(selectedPlayer);
  addLog(`Игрок ${selectedPlayer.name} переместился в (${x},${y})`);

  selectedPlayer.element.classList.remove('selected');
  selectedPlayer = null;
});

// ======== Инициатива ========
function updatePlayerList() {
  playerList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.initiative})`;
    playerList.appendChild(li);
  });
}

rollInitiativeBtn.addEventListener('click', () => {
  if (players.length === 0) return alert("Нет игроков для инициативы!");
  players.forEach(p => {
    p.initiative = Math.floor(Math.random() * 20) + 1;
  });

  // Сортировка по инициативе по убыванию
  players.sort((a, b) => b.initiative - a.initiative);
  updatePlayerList();
  currentPlayerIndex = 0;
  updateCurrentPlayer();
  addLog("Инициатива определена!");
});

// === Переменные ===
let editEnvironment = false;
let wallMode = null; // 'add' или 'remove'
let mouseDown = false; // для рисования стен
let dragWalls = [];    // массив перетаскиваемых стен

const editEnvBtn = document.getElementById('edit-environment');
const addWallBtn = document.getElementById('add-wall');
const removeWallBtn = document.getElementById('remove-wall');

// ======== Включение/выключение редактирования ========
editEnvBtn.addEventListener('click', () => {
  editEnvironment = !editEnvironment;
  addWallBtn.disabled = !editEnvironment;
  removeWallBtn.disabled = !editEnvironment;
  wallMode = null;

  editEnvBtn.textContent = editEnvironment ? "Редактирование окружения: ВКЛ" : "Редактирование окружения: ВЫКЛ";
  addLog(editEnvironment ? "Режим редактирования включен" : "Режим редактирования выключен");
});

// ======== Выбор действия со стенами ========
addWallBtn.addEventListener('click', () => wallMode = 'add');
removeWallBtn.addEventListener('click', () => wallMode = 'remove');

// ======== Рисование стен ========
board.addEventListener('mousedown', (e) => {
  if (!editEnvironment || !wallMode) return;

  const cell = e.target.closest('.cell');
  if (!cell) return;
  mouseDown = true;

  toggleWall(cell);
});

board.addEventListener('mouseover', (e) => {
  if (!editEnvironment || !wallMode || !mouseDown) return;

  const cell = e.target.closest('.cell');
  if (!cell) return;

  toggleWall(cell);
});

board.addEventListener('mouseup', () => {
  mouseDown = false;
});

// ======== Функция добавления или удаления стены ========
function toggleWall(cell) {
  if (wallMode === 'add' && !cell.classList.contains('wall')) {
    cell.classList.add('wall');
    cell.setAttribute('draggable', true);
    addLog(`Стена добавлена в (${cell.dataset.x},${cell.dataset.y})`);
  } else if (wallMode === 'remove' && cell.classList.contains('wall')) {
    cell.classList.remove('wall');
    cell.removeAttribute('draggable');
    addLog(`Стена удалена из (${cell.dataset.x},${cell.dataset.y})`);
  }
}

// ======== Drag & Drop стен (множество стен) ========
let dragging = false;
let draggedCells = [];

board.addEventListener('dragstart', (e) => {
  if (!editEnvironment) return;
  const cell = e.target.closest('.cell');
  if (!cell || !cell.classList.contains('wall')) return;

  dragging = true;
  draggedCells = [cell];
  cell.classList.add('dragging');
});

board.addEventListener('dragover', (e) => {
  e.preventDefault();
});

board.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!dragging) return;

  const targetCell = e.target.closest('.cell');
  if (!targetCell || targetCell.classList.contains('wall')) return;

  // Переносим все перетаскиваемые стены
  draggedCells.forEach((c) => {
    c.classList.remove('wall', 'dragging');
    c.removeAttribute('draggable');
  });

  targetCell.classList.add('wall');
  targetCell.setAttribute('draggable', true);
  addLog(`Стена перемещена в (${targetCell.dataset.x},${targetCell.dataset.y})`);

  dragging = false;
  draggedCells = [];
});



const ws = new WebSocket('wss://dnd-l1ga-server.onrender.com');

let state = null;

// ======== Подключение и получение состояния ========
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'updateState') {
    state = msg.state;
    renderBoard();
  }
};

// ======== Отправка действий ========
function sendMessage(msg) {
  ws.send(JSON.stringify(msg));
}

// ======== Пример функции добавления игрока ========
function addPlayerOnline(name, color, size) {
  sendMessage({ type: 'addPlayer', name, color, size });
}

// ======== Перемещение игрока ========
function movePlayerOnline(name, x, y) {
  sendMessage({ type: 'movePlayer', name, x, y });
}

// ======== Добавление/удаление стены ========
function setWallOnline(action, x, y) {
  sendMessage({ type: 'setWall', action, x, y });
}

// ======== Рисование поля на клиенте ========
const boardElement = document.getElementById('game-board');

function renderBoard() {
  if (!state) return;

  boardElement.innerHTML = '';
  boardElement.style.gridTemplateColumns = `repeat(${state.boardWidth},50px)`;
  boardElement.style.gridTemplateRows = `repeat(${state.boardHeight},50px)`;

  for (let y=0; y<state.boardHeight; y++) {
    for (let x=0; x<state.boardWidth; x++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.x = x;
      cell.dataset.y = y;

      // проверяем стены
      if (state.walls.find(w=>w.x===x && w.y===y)) {
        cell.classList.add('wall');
      }

      boardElement.appendChild(cell);
    }
  }

  // отрисовываем игроков
  state.players.forEach(p => {
    const el = document.createElement('div');
    el.classList.add('player');
    el.style.backgroundColor = p.color;
    el.textContent = p.name[0];
    el.style.width = `${p.size*50}px`;
    el.style.height = `${p.size*50}px`;
    el.style.position = 'absolute';
    el.style.left = `${p.x*51}px`;
    el.style.top = `${p.y*51}px`;
    boardElement.appendChild(el);
  });

}

const socket = new WebSocket(
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host
);
