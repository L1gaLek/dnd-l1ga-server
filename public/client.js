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
  if (!name) return loginError.textContent = "Введите имя";

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
});

// ================== SYNC ==================
function syncState(state) {

  // удаляем исчезнувших игроков
  const ids = new Set(state.players.map(p => p.id));
  playerElements.forEach((el,id)=>{
    if(!ids.has(id)){ el.remove(); playerElements.delete(id); }
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

// ================== UI ==================
function renderLog(logs){
  logList.innerHTML='';
  logs.slice(-50).forEach(l=>{
    const li=document.createElement('li');
    li.textContent=l;
    logList.appendChild(li);
  });
}

function updateCurrentPlayer(state){
  if(!state.turnOrder.length){ currentPlayerSpan.textContent='-'; return; }
  const id=state.turnOrder[state.currentTurnIndex];
  const p=players.find(p=>p.id===id);
  currentPlayerSpan.textContent=p?p.name:'-';
}

// ================== PLAYER LIST ==================
function updatePlayerList(){
  playerList.innerHTML='';
  const grouped={};

  players.forEach(p=>{
    if(!grouped[p.ownerId]) grouped[p.ownerId]={ name:p.ownerName, players:[] };
    grouped[p.ownerId].players.push(p);
  });

  Object.values(grouped).forEach(g=>{
    const owner=document.createElement('li');
    owner.textContent=g.name;
    owner.style.fontWeight='bold';

    const ul=document.createElement('ul');
    g.players.forEach(p=>{
      const li=document.createElement('li');
      li.textContent=`${p.name} (${p.initiative})`;
      li.onclick=()=> selectedPlayer=p;
      ul.appendChild(li);
    });

    owner.appendChild(ul);
    playerList.appendChild(owner);
  });
}

// ================== BOARD ==================
function renderBoard(state){
  board.innerHTML='';
  board.style.gridTemplateColumns=`repeat(${boardWidth},50px)`;
  board.style.gridTemplateRows=`repeat(${boardHeight},50px)`;

  for(let y=0;y<boardHeight;y++){
    for(let x=0;x<boardWidth;x++){
      const cell=document.createElement('div');
      cell.className='cell';
      cell.dataset.x=x;
      cell.dataset.y=y;
      board.appendChild(cell);
    }
  }

  players.forEach(setPlayerPosition);
}

function setPlayerPosition(p){
  let el=playerElements.get(p.id);
  if(!el){
    el=document.createElement('div');
    el.className='player';
    el.textContent=p.name[0];
    el.style.backgroundColor=p.color;
    board.appendChild(el);
    playerElements.set(p.id,el);
  }

  if(p.x==null||p.y==null){ el.style.display='none'; return; }
  el.style.display='flex';
  el.style.left=`${p.x*50}px`;
  el.style.top=`${p.y*50}px`;
}

// ================== ACTIONS ==================
addPlayerBtn.onclick=()=>{
  const name=playerNameInput.value.trim();
  if(!name) return;
  send({ type:'addPlayer', player:{
    name,
    color:playerColorInput.value,
    size:+playerSizeInput.value
  }});
  playerNameInput.value='';
};

board.onclick=e=>{
  if(!selectedPlayer) return;
  const cell=e.target.closest('.cell');
  if(!cell) return;
  send({ type:'movePlayer', id:selectedPlayer.id, x:+cell.dataset.x, y:+cell.dataset.y });
  selectedPlayer=null;
};

rollInitiativeBtn.onclick=()=>send({ type:'rollInitiative' });
endTurnBtn.onclick=()=>send({ type:'endTurn' });
createBoardBtn.onclick=()=>{
  send({ type:'resizeBoard',
    width:+boardWidthInput.value,
    height:+boardHeightInput.value
  });
};

function send(msg){
  if(ws?.readyState===1) ws.send(JSON.stringify(msg));
}
