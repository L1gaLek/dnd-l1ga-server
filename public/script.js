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
let cells = [];
let players = [];
let currentPlayerIndex = 0;
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

  if (msg.type === 'init' || msg.type === 'state') {
    const state = msg.state;

    boardWidth = state.boardWidth || boardWidth;
    boardHeight = state.boardHeight || boardHeight;

    // Обновляем игроков
    players = state.players.map(p => {
      // сохраняем существующий элемент если он уже есть
      const existing = players.find(pl => pl.id === p.id);
      return { ...p, element: existing?.element || null };
    });

    currentPlayerIndex = state.currentTurnIndex || 0;

    renderBoard(state);
    updatePlayerList();
    updateCurrentPlayer();
    renderLog(state.log || []);
  }
};

// ====================== ФУНКЦИИ ======================
function sendMessage(msg) {
  ws.send(JSON.stringify(msg));
}

function addLog(text) {
  const li = document.createElement('li');
  li.textContent = text;
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
}

function updateCurrentPlayer() {
  if (players.length === 0) currentPlayerSpan.textContent = '-';
  else currentPlayerSpan.textContent = players[currentPlayerIndex]?.name || '-';
}

function updatePlayerList() {
  playerList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.initiative || 0})`;
    playerList.appendChild(li);
  });
}

// ====================== СОЗДАНИЕ ПОЛЯ ======================
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

  players.forEach(p => setPlayerPosition(p));
}

createBoard(boardWidth, boardHeight);

createBoardBtn.addEventListener('click', () => {
  boardWidth = parseInt(boardWidthInput.value);
  boardHeight = parseInt(boardHeightInput.value);
  createBoard(boardWidth, boardHeight);
  sendMessage({ type: 'resizeBoard', width: boardWidth, height: boardHeight });
});

// ====================== ДОБАВЛЕНИЕ ИГРОКА ======================
function addPlayer(name, color, size = 1) {
  const player = { name, color, size, x: 0, y: 0, initiative: 0, element: null };
  players.push(player);
  setPlayerPosition(player);
  updatePlayerList();
  updateCurrentPlayer();
  addLog(`Игрок ${name} добавлен, размер ${size}x${size}`);
  sendMessage({ type: 'addPlayer', player });
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

// ====================== ПЕРЕМЕЩЕНИЕ ИГРОКА ======================
function setPlayerPosition(player) {
  if (!player.element) {
    const el = document.createElement('div');
    el.classList.add('player');
    el.textContent = player.name[0];
    el.style.backgroundColor = player.color;
    el.style.position = 'absolute';
    el.style.width = `${player.size * 50}px`;
    el.style.height = `${player.size * 50}px`;

    el.addEventListener('mousedown', () => {
      if (!editEnvironment) {
        if (selectedPlayer && selectedPlayer.element) selectedPlayer.element.classList.remove('selected');
        selectedPlayer = player;
        el.classList.add('selected');
      }
    });

    board.appendChild(el);
    player.element = el;
  }

  player.element.style.left = `${player.x * 51}px`;
  player.element.style.top = `${player.y * 51}px`;
}

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
  sendMessage({ type: 'movePlayer', id: selectedPlayer.id, x, y });

  selectedPlayer.element.classList.remove('selected');
  selectedPlayer = null;
});

// ====================== БРОСОК КУБИКА ======================
rollBtn.addEventListener('click', () => {
  if (players.length === 0) return alert("Добавьте хотя бы одного игрока");
  const sides = parseInt(dice.value);
  const result = Math.floor(Math.random() * sides) + 1;
  rollResult.textContent = `Результат: ${result}`;
  addLog(`Игрок ${players[currentPlayerIndex].name} бросил d${sides}: ${result}`);
  sendMessage({ type: 'rollDice', id: players[currentPlayerIndex]?.id, sides });
});

// ====================== КОНЕЦ ХОДА ======================
endTurnBtn.addEventListener('click', () => {
  if (players.length === 0) return;
  addLog(`Игрок ${players[currentPlayerIndex].name} закончил ход.`);
  sendMessage({ type: 'endTurn' });
});

// ====================== ИНИЦИАТИВА ======================
rollInitiativeBtn.addEventListener('click', () => {
  if (players.length === 0) return alert("Нет игроков для инициативы!");
  sendMessage({ type: 'rollInitiative' });
});

// ====================== СТЕНЫ ======================
editEnvBtn.addEventListener('click', () => {
  editEnvironment = !editEnvironment;
  addWallBtn.disabled = !editEnvironment;
  removeWallBtn.disabled = !editEnvironment;
  wallMode = null;
  editEnvBtn.textContent = editEnvironment ? "Редактирование: ВКЛ" : "Редактирование: ВЫКЛ";
  addLog(editEnvironment ? "Режим редактирования включен" : "Режим редактирования выключен");
});

addWallBtn.addEventListener('click', () => wallMode = 'add');
removeWallBtn.addEventListener('click', () => wallMode = 'remove');

board.addEventListener('mousedown', e => {
  if (!editEnvironment || !wallMode) return;
  const cell = e.target.closest('.cell'); if(!cell) return;
  mouseDown = true;
  toggleWall(cell);
});

board.addEventListener('mouseover', e => {
  if (!editEnvironment || !wallMode || !mouseDown) return;
  const cell = e.target.closest('.cell'); if(!cell) return;
  toggleWall(cell);
});

board.addEventListener('mouseup', () => mouseDown = false);

function toggleWall(cell) {
  const x = parseInt(cell.dataset.x);
  const y = parseInt(cell.dataset.y);
  if (wallMode === 'add' && !cell.classList.contains('wall')) {
    cell.classList.add('wall');
    addLog(`Стена добавлена в (${x},${y})`);
    sendMessage({ type:'addWall', wall:{x,y} });
  } else if (wallMode === 'remove' && cell.classList.contains('wall')) {
    cell.classList.remove('wall');
    addLog(`Стена удалена из (${x},${y})`);
    sendMessage({ type:'removeWall', wall:{x,y} });
  }
}

// ====================== СБРОС И ОЧИСТКА ======================
resetGameBtn.addEventListener('click', () => {
  sendMessage({ type: 'resetGame' });
});

clearBoardBtn.addEventListener('click', () => {
  sendMessage({ type: 'clearBoard' });
});

// ====================== ОТОБРАЖЕНИЕ ПОЛЯ ======================
function renderBoard(state) {
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${boardWidth},50px)`;
  board.style.gridTemplateRows = `repeat(${boardHeight},50px)`;

  for(let y=0;y<boardHeight;y++){
    for(let x=0;x<boardWidth;x++){
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.x = x;
      cell.dataset.y = y;
      if(state && state.walls?.find(w=>w.x===x && w.y===y)) cell.classList.add('wall');
      board.appendChild(cell);
    }
  }

  players.forEach(p => setPlayerPosition(p));
}

// ====================== ЖУРНАЛ ======================
function renderLog(logs) {
  logList.innerHTML='';
  if(!logs) return;
  logs.slice(-50).forEach(line => {
    const li = document.createElement('li');
    li.textContent = line;
    logList.appendChild(li);
  });
}
