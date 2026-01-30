const loginDiv = document.getElementById('login');
const joinBtn = document.getElementById('joinBtn');
const usernameInput = document.getElementById('username');
const roleSelect = document.getElementById('role');
const loginError = document.getElementById('loginError');

const gameUI = document.getElementById('game-ui');
const myNameSpan = document.getElementById('myName');
const myRoleSpan = document.getElementById('myRole');
const userList = document.getElementById('userList');
const board = document.getElementById('game-board');

let ws;
let myId;
let myRole;

// ================== JOIN GAME ==================
joinBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  const role = roleSelect.value;

  if (!name) return loginError.textContent = "Введите имя";

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

        loginDiv.style.display = "none";
        gameUI.style.display = "block";

        setupRoleUI(myRole);
        break;

      case "error":
        loginError.textContent = msg.message;
        break;

      case "users":
        updateUserList(msg.users);
        break;

      case "state":
        // сюда можно интегрировать твой renderBoard и обновление игроков
        break;
    }
  };
});

function updateUserList(users) {
  userList.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.textContent = `${u.name} (${u.role})`;
    userList.appendChild(li);
  });
}

function setupRoleUI(role) {
  if (role === "Spectator") {
    // Скрываем кнопки управления
    // Например:
    // document.getElementById('add-player').style.display = 'none';
    // document.getElementById('roll').style.display = 'none';
  } else if (role === "DnD-Player") {
    // Игрок видит только свои кнопки и поле
  } else if (role === "GM") {
    // GM видит все кнопки и поле
  }
}
