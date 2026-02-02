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

// состояние модалки
let openedSheetPlayerId = null;

// debounce timers for sheet save (playerId -> timer)
const sheetSaveTimers = new Map();

// ================== UTILS ==================
function v(x, fallback = "-") {
  if (x && typeof x === "object") {
    if ("value" in x) return (x.value ?? fallback);
  }
  return (x ?? fallback);
}

function get(obj, path, fallback = "-") {
  try {
    const raw = path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj);
    return v(raw, fallback);
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

function clamp(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

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

// ================== MANUAL SHEET DEFAULT ==================
function createEmptySheet(fallbackName = "-") {
  return {
    name: { value: fallbackName },
    info: {
      charClass: { value: "" },
      level: { value: 1 },
      race: { value: "" },
      background: { value: "" },
      alignment: { value: "" }
    },
    vitality: {
      "hp-max": { value: 0 },
      "hp-current": { value: 0 },
      ac: { value: 0 },
      speed: { value: 0 }
    },
    stats: {
      str: { score: 10, modifier: 0 },
      dex: { score: 10, modifier: 0 },
      con: { score: 10, modifier: 0 },
      int: { score: 10, modifier: 0 },
      wis: { score: 10, modifier: 0 },
      cha: { score: 10, modifier: 0 }
    },
    skills: {},
    saves: {},
    weaponsList: [],
    coins: { cp: { value: 0 }, sp: { value: 0 }, ep: { value: 0 }, gp: { value: 0 }, pp: { value: 0 } }
  };
}

function ensurePlayerSheetWrapper(player) {
  // всегда гарантируем player.sheet + player.sheet.parsed
  if (!player.sheet || typeof player.sheet !== "object") {
    player.sheet = {
      source: "manual",
      importedAt: Date.now(),
      raw: null,
      parsed: createEmptySheet(player.name)
    };
    return;
  }
  if (!player.sheet.parsed || typeof player.sheet.parsed !== "object") {
    player.sheet.parsed = createEmptySheet(player.name);
  }
}

// ================== VIEW MODEL ==================
function toViewModel(sheet, fallbackName = "-") {
  const name = get(sheet, 'name.value', fallbackName);
  const cls = get(sheet, 'info.charClass.value', '-');
  const lvl = get(sheet, 'info.level.value', '-');
  const race = get(sheet, 'info.race.value', '-');
  const bg = get(sheet, 'info.background.value', '-');
  const align = get(sheet, 'info.alignment.value', '-');

  const hp = get(sheet, 'vitality.hp-max.value', '-');
  const hpCur = get(sheet, 'vitality.hp-current.value', '-');
  const ac = get(sheet, 'vitality.ac.value', '-');
  const spd = get(sheet, 'vitality.speed.value', '-');

  const stats = ["str","dex","con","int","wis","cha"].map(k => ({
    key: k.toUpperCase(),
    k,
    score: v(sheet?.stats?.[k]?.score, '-'),
    mod: v(sheet?.stats?.[k]?.modifier, '-')
  }));

  // skills
  const skillsRaw = (sheet?.skills && typeof sheet.skills === "object") ? sheet.skills : {};
  const skills = Object.keys(skillsRaw).map(key => {
    const obj = skillsRaw[key] || {};
    const val = v(obj.score ?? obj.modifier, "-");
    const prof = !!v(obj.proficiency, false);
    return { key, val, prof };
  }).sort((a,b) => a.key.localeCompare(b.key));

  // saves
  const savesRaw = (sheet?.saves && typeof sheet.saves === "object") ? sheet.saves : {};
  const saves = Object.keys(savesRaw).map(key => {
    const obj = savesRaw[key] || {};
    const val = v(obj.score ?? obj.modifier, "-");
    const prof = !!v(obj.proficiency, false);
    return { key: key.toUpperCase(), val, prof };
  }).sort((a,b) => a.key.localeCompare(b.key));

  // weapons
  const weapons = Array.isArray(sheet?.weaponsList) ? sheet.weaponsList : [];
  const weaponsVm = weapons
    .map(w => ({
      name: v(w?.name, "-"),
      atk: v(w?.attackBonus ?? w?.atkBonus ?? w?.toHit ?? w?.mod, "-"),
      dmg: v(w?.damage ?? w?.dmg, "-"),
      type: v(w?.type ?? w?.damageType, "")
    }))
    .filter(w => w.name && w.name !== "-");

  // coins
  const coinsRaw = sheet?.coins && typeof sheet.coins === "object" ? sheet.coins : null;
  const coins = coinsRaw ? {
    cp: v(coinsRaw.cp, 0),
    sp: v(coinsRaw.sp, 0),
    ep: v(coinsRaw.ep, 0),
    gp: v(coinsRaw.gp, 0),
    pp: v(coinsRaw.pp, 0)
  } : null;

  // inventory
  const invRaw = Array.isArray(sheet?.inventory) ? sheet.inventory : [];
  const inventory = invRaw.map(i => {
    if (typeof i === "string") return i;
    if (i && typeof i === "object") return v(i.name ?? i.itemName, "[item]");
    return String(i);
  }).filter(Boolean);

  // spells (Charbox часто хранит в sheet.text["spells-level-x"])
  const text = (sheet?.text && typeof sheet.text === "object") ? sheet.text : {};
  const spellKeys = Object.keys(text).filter(k => k.startsWith("spells-level-"));

  const spellsByLevel = spellKeys
    .sort((a,b) => {
      const la = parseInt(a.split("-").pop(), 10);
      const lb = parseInt(b.split("-").pop(), 10);
      return la - lb;
    })
    .map(k => {
      const level = k.split("-").pop();
      const raw = text[k];

      let items = [];
      if (Array.isArray(raw)) items = raw.map(x => v(x, "")).map(String);
      else if (typeof raw === "string") items = raw.split("\n").map(s => s.trim()).filter(Boolean);
      else if (raw != null) items = [String(v(raw, ""))];

      items = items.map(s => s.trim()).filter(Boolean);
      return { level, items };
    })
    .filter(x => x.items.length);

  return {
    name, cls, lvl, race, bg, align,
    hp, hpCur, ac, spd,
    stats, skills, saves,
    weapons: weaponsVm,
    coins,
    inventory,
    spellsByLevel
  };
}

// ================== SHEET UPDATE HELPERS ==================
function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

function getByPath(obj, path) {
  try {
    return path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj);
  } catch {
    return undefined;
  }
}

function scheduleSheetSave(player) {
  if (!player?.id) return;
  const key = player.id;

  const prev = sheetSaveTimers.get(key);
  if (prev) clearTimeout(prev);

  const t = setTimeout(() => {
    // отправляем текущий sheet wrapper (player.sheet)
    sendMessage({ type: "setPlayerSheet", id: player.id, sheet: player.sheet });
    sheetSaveTimers.delete(key);
  }, 450);

  sheetSaveTimers.set(key, t);
}

function bindEditableInputs(root, player, canEdit) {
  if (!root || !player?.sheet?.parsed) return;

  const inputs = root.querySelectorAll("[data-sheet-path]");
  inputs.forEach(inp => {
    const path = inp.getAttribute("data-sheet-path");
    if (!path) return;

    // начальное значение
    const raw = getByPath(player.sheet.parsed, path);
    if (inp.type === "checkbox") {
      inp.checked = !!raw;
    } else {
      inp.value = (raw ?? "");
    }

    if (!canEdit) {
      inp.disabled = true;
      return;
    }

    const handler = () => {
      let val;
      if (inp.type === "checkbox") {
        val = !!inp.checked;
      } else if (inp.type === "number") {
        // оставляем число или 0
        val = inp.value === "" ? "" : Number(inp.value);
      } else {
        val = inp.value;
      }

      // спец: если поле вида {value: ...}, то пишем в .value, иначе как есть
      // (но тут path уже нацелен на конкретное поле, так что просто set)
      setByPath(player.sheet.parsed, path, val);

      // актуализируем title/hero если меняли имя
      if (path === "name.value") {
        player.name = val || player.name;
      }

      scheduleSheetSave(player);
    };

    inp.addEventListener("input", handler);
    inp.addEventListener("change", handler);
  });
}

// ================== MODAL UI (LEFT TABS) ==================
function renderSheetTabContent(tabId, vm) {
  if (tabId === "basic") {
    return `
      <div class="sheet-section">
        <h3>Основное</h3>
        <div class="sheet-grid-2">
          <div class="sheet-card">
            <h4>Профиль</h4>

            <div class="kv">
              <div class="k">Имя</div>
              <div class="v"><input type="text" data-sheet-path="name.value" style="width:160px"></div>
            </div>

            <div class="kv">
              <div class="k">Класс</div>
              <div class="v"><input type="text" data-sheet-path="info.charClass.value" style="width:160px"></div>
            </div>

            <div class="kv">
              <div class="k">Уровень</div>
              <div class="v"><input type="number" min="1" max="20" data-sheet-path="info.level.value" style="width:90px"></div>
            </div>

            <div class="kv">
              <div class="k">Раса</div>
              <div class="v"><input type="text" data-sheet-path="info.race.value" style="width:160px"></div>
            </div>
          </div>

          <div class="sheet-card">
            <h4>Фон</h4>

            <div class="kv">
              <div class="k">Предыстория</div>
              <div class="v"><input type="text" data-sheet-path="info.background.value" style="width:160px"></div>
            </div>

            <div class="kv">
              <div class="k">Мировоззрение</div>
              <div class="v"><input type="text" data-sheet-path="info.alignment.value" style="width:160px"></div>
            </div>

            <div class="kv">
              <div class="k">AC</div>
              <div class="v"><input type="number" min="0" max="40" data-sheet-path="vitality.ac.value" style="width:90px"></div>
            </div>

            <div class="kv">
              <div class="k">HP max</div>
              <div class="v"><input type="number" min="0" max="999" data-sheet-path="vitality.hp-max.value" style="width:90px"></div>
            </div>

            <div class="kv">
              <div class="k">HP current</div>
              <div class="v"><input type="number" min="0" max="999" data-sheet-path="vitality.hp-current.value" style="width:90px"></div>
            </div>

            <div class="kv">
              <div class="k">Speed</div>
              <div class="v"><input type="number" min="0" max="200" data-sheet-path="vitality.speed.value" style="width:90px"></div>
            </div>

          </div>
        </div>
      </div>
    `;
  }

  if (tabId === "stats") {
    const cards = vm.stats.map(s => `
      <div class="sheet-card">
        <h4>${escapeHtml(s.key)}</h4>

        <div class="kv">
          <div class="k">Score</div>
          <div class="v">
            <input type="number" min="1" max="30" data-sheet-path="stats.${s.k}.score" style="width:90px">
          </div>
        </div>

        <div class="kv">
          <div class="k">Mod</div>
          <div class="v">
            <input type="number" min="-10" max="10" data-sheet-path="stats.${s.k}.modifier" style="width:90px">
          </div>
        </div>

      </div>
    `).join("");

    return `
      <div class="sheet-section">
        <h3>Характеристики</h3>
        <div class="sheet-grid-3">
          ${cards}
        </div>
        <div class="sheet-note" style="margin-top:8px;">
          Подсказка: модификатор можно вводить вручную, либо считать самому.
        </div>
      </div>
    `;
  }

  if (tabId === "skills") {
    const skills = vm.skills.length
      ? vm.skills.map(x => `
        <div class="kv">
          <div class="k">${escapeHtml(x.key)}${x.prof ? " ★" : ""}</div>
          <div class="v">${escapeHtml(x.val)}</div>
        </div>
      `).join("")
      : `<div class="sheet-note">Нет данных (из файла). Навыки вручную пока не редактируются в этом UI.</div>`;

    const saves = vm.saves.length
      ? vm.saves.map(x => `
        <div class="kv">
          <div class="k">${escapeHtml(x.key)}${x.prof ? " ★" : ""}</div>
          <div class="v">${escapeHtml(x.val)}</div>
        </div>
      `).join("")
      : `<div class="sheet-note">Нет данных (из файла). Сейвы вручную пока не редактируются в этом UI.</div>`;

    return `
      <div class="sheet-section">
        <h3>Навыки и сейвы</h3>
        <div class="sheet-grid-2">
          <div class="sheet-card">
            <h4>Skills</h4>
            ${skills}
          </div>
          <div class="sheet-card">
            <h4>Saves</h4>
            ${saves}
          </div>
        </div>
        <div class="sheet-note" style="margin-top:8px;">★ — proficiency (если есть в файле)</div>
      </div>
    `;
  }

  if (tabId === "combat") {
    const weapons = vm.weapons.length
      ? vm.weapons.map(w => `
        <div class="sheet-card">
          <h4>${escapeHtml(w.name)}</h4>
          <div class="kv"><div class="k">Atk</div><div class="v">${escapeHtml(w.atk)}</div></div>
          <div class="kv"><div class="k">Dmg</div><div class="v">${escapeHtml(w.dmg)} ${escapeHtml(w.type || "")}</div></div>
        </div>
      `).join("")
      : `<div class="sheet-note">Оружие не указано (из файла). Ручное добавление оружия в этом UI пока не сделано.</div>`;

    return `
      <div class="sheet-section">
        <h3>Бой</h3>
        <div class="sheet-grid-2">
          ${weapons}
        </div>
      </div>
    `;
  }

  if (tabId === "spells") {
    if (!vm.spellsByLevel.length) {
      return `<div class="sheet-note">Заклинания не указаны (из файла). Ручное редактирование заклинаний в этом UI пока не сделано.</div>`;
    }

    const blocks = vm.spellsByLevel.map(b => `
      <div class="sheet-card">
        <h4>Уровень ${escapeHtml(b.level)}</h4>
        <div>
          ${b.items.map(s => `<span class="sheet-pill">${escapeHtml(s)}</span>`).join("")}
        </div>
      </div>
    `).join("");

    return `
      <div class="sheet-section">
        <h3>Заклинания</h3>
        <div class="sheet-grid-2">
          ${blocks}
        </div>
      </div>
    `;
  }

  if (tabId === "inventory") {
    const coins = vm.coins
      ? `
        <div class="kv"><div class="k">CP</div><div class="v"><input type="number" min="0" max="999999" data-sheet-path="coins.cp.value" style="width:110px"></div></div>
        <div class="kv"><div class="k">SP</div><div class="v"><input type="number" min="0" max="999999" data-sheet-path="coins.sp.value" style="width:110px"></div></div>
        <div class="kv"><div class="k">EP</div><div class="v"><input type="number" min="0" max="999999" data-sheet-path="coins.ep.value" style="width:110px"></div></div>
        <div class="kv"><div class="k">GP</div><div class="v"><input type="number" min="0" max="999999" data-sheet-path="coins.gp.value" style="width:110px"></div></div>
        <div class="kv"><div class="k">PP</div><div class="v"><input type="number" min="0" max="999999" data-sheet-path="coins.pp.value" style="width:110px"></div></div>
      `
      : `<div class="sheet-note">Нет данных</div>`;

    const inv = vm.inventory.length
      ? `<ul class="sheet-list">${vm.inventory.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : `<div class="sheet-note">Инвентарь не указан (из файла). Ручное редактирование инвентаря в этом UI пока не сделано.</div>`;

    return `
      <div class="sheet-section">
        <h3>Инвентарь</h3>
        <div class="sheet-grid-2">
          <div class="sheet-card">
            <h4>Монеты (редактируемые)</h4>
            ${coins}
          </div>
          <div class="sheet-card">
            <h4>Предметы</h4>
            ${inv}
          </div>
        </div>
      </div>
    `;
  }

  return `<div class="sheet-note">Раздел в разработке</div>`;
}

function renderSheetModal(player) {
  if (!sheetTitle || !sheetSubtitle || !sheetActions || !sheetContent) return;

  const canEdit = (myRole === "GM" || player.ownerId === myId);

  sheetTitle.textContent = `Инфа: ${player.name}`;
  sheetSubtitle.textContent = `Владелец: ${player.ownerName || 'Unknown'} • Тип: ${player.isBase ? 'Основа' : '-'}`;

  // гарантируем sheet даже если файл не загружали
  ensurePlayerSheetWrapper(player);

  // actions (upload + hint)
  sheetActions.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'sheet-note';
  note.textContent = canEdit
    ? "Можно загрузить .json (Charbox/LSS) или просто редактировать поля вручную — всё сохраняется на сервере."
    : "Просмотр. Редактировать лист может только владелец или GM.";
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
        player.sheet = sheet; // сразу обновим локально
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

  const sheet = player.sheet?.parsed || createEmptySheet(player.name);
  const vm = toViewModel(sheet, player.name);

  const tabs = [
    { id: "basic", label: "Основное" },
    { id: "stats", label: "Характеристики" },
    { id: "skills", label: "Навыки / Сейвы" },
    { id: "combat", label: "Бой" },
    { id: "spells", label: "Заклинания" },
    { id: "inventory", label: "Инвентарь" }
  ];

  if (!player._activeSheetTab) player._activeSheetTab = "basic";
  let activeTab = player._activeSheetTab;

  const hero = `
    <div class="sheet-hero">
      <div class="sheet-hero-top">
        <div>
          <div class="sheet-hero-title">${escapeHtml(vm.name)}</div>
          <div class="sheet-hero-sub">
            ${escapeHtml(vm.cls)} • lvl ${escapeHtml(vm.lvl)} • ${escapeHtml(vm.race)}
          </div>
        </div>
        <div class="sheet-chips">
          <div class="sheet-chip"><div class="k">AC</div><div class="v">${escapeHtml(vm.ac)}</div></div>
          <div class="sheet-chip"><div class="k">HP</div><div class="v">${escapeHtml(vm.hp)}</div></div>
          <div class="sheet-chip"><div class="k">Speed</div><div class="v">${escapeHtml(vm.spd)}</div></div>
        </div>
      </div>
    </div>
  `;

  const sidebarHtml = `
    <div class="sheet-sidebar">
      ${tabs.map(t => `
        <button class="sheet-tab ${t.id === activeTab ? "active" : ""}" data-tab="${t.id}">
          ${escapeHtml(t.label)}
        </button>
      `).join("")}
    </div>
  `;

  const mainHtml = `
    <div class="sheet-main" id="sheet-main">
      ${renderSheetTabContent(activeTab, vm)}
    </div>
  `;

  sheetContent.innerHTML = `
    ${hero}
    <div class="sheet-layout">
      ${sidebarHtml}
      ${mainHtml}
    </div>
  `;

  // биндим инпуты текущей вкладки
  bindEditableInputs(sheetContent, player, canEdit);

  const tabButtons = sheetContent.querySelectorAll(".sheet-tab");
  const main = sheetContent.querySelector("#sheet-main");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;
      if (!tabId) return;

      activeTab = tabId;
      player._activeSheetTab = tabId;

      tabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      if (main) {
        // пересобираем vm из актуального sheet (после ручных правок)
        const freshSheet = player.sheet?.parsed || createEmptySheet(player.name);
        const freshVm = toViewModel(freshSheet, player.name);
        main.innerHTML = renderSheetTabContent(activeTab, freshVm);

        // заново привязываем инпуты
        bindEditableInputs(sheetContent, player, canEdit);
      }
    });
  });
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

      // если модалка открыта — обновим контент по свежему state
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

      // КНОПКА "ИНФА" — теперь открывает модалку ВСЕГДА, даже если файл не загружали
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

// ================== DICE ==================
rollBtn.addEventListener('click', () => {
  const sides = parseInt(dice.value, 10);
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
