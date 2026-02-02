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

// ================== UTILS ==================
// достаёт value из {value: ...} или возвращает само значение
function v(x, fallback = "-") {
  if (x && typeof x === "object") {
    if ("value" in x) return (x.value ?? fallback);
  }
  return (x ?? fallback);
}

// безопасный доступ по пути + авто unwrap {value}
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

// ===== Charbox/LSS rich-text helpers (ProseMirror-like JSON) =====
// В LSS значения часто лежат как:
//   field = { value: { data: { type:'doc', content:[...] } } }
// либо  field = { data: { type:'doc', content:[...] } }
function extractDoc(node) {
  if (!node) return null;
  // unwrap {value: {...}}
  if (node && typeof node === 'object' && 'value' in node) return extractDoc(node.value);
  // unwrap {data: {...}}
  if (node && typeof node === 'object' && 'data' in node) return extractDoc(node.data);
  if (node && typeof node === 'object' && node.type === 'doc') return node;
  return null;
}

function collectTextFromDocNode(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach(n => collectTextFromDocNode(n, out));
    return;
  }
  if (typeof node !== 'object') return;
  if (node.type === 'text' && typeof node.text === 'string') {
    out.push(node.text);
  }
  if (node.content) collectTextFromDocNode(node.content, out);
}

function docToLines(node) {
  const doc = extractDoc(node);
  if (!doc || !Array.isArray(doc.content)) return [];

  // стараемся резать по параграфам
  const lines = [];
  for (const block of doc.content) {
    const parts = [];
    collectTextFromDocNode(block, parts);
    const line = parts.join('').replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines;
}

function formatPlus(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return x >= 0 ? `+${x}` : `${x}`;
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

// ================== VIEW MODEL ==================
function toViewModel(sheet, fallbackName = "-") {
  const name = get(sheet, 'name.value', fallbackName);
  const cls = get(sheet, 'info.charClass.value', '-');
  const lvl = get(sheet, 'info.level.value', '-');
  const race = get(sheet, 'info.race.value', '-');
  const bg = get(sheet, 'info.background.value', '-');
  const align = get(sheet, 'info.alignment.value', '-');
  const xp = get(sheet, 'info.experience.value', '-');

  const playerName = get(sheet, 'info.playerName.value', '-');
  const age = get(sheet, 'subInfo.age.value', '-');
  const height = get(sheet, 'subInfo.height.value', '-');
  const weight = get(sheet, 'subInfo.weight.value', '-');

  const hp = get(sheet, 'vitality.hp-max.value', '-');
  const hpCur = get(sheet, 'vitality.hp-current.value', '-');
  const ac = get(sheet, 'vitality.ac.value', '-');
  const spd = get(sheet, 'vitality.speed.value', '-');
  const hitDie = get(sheet, 'vitality.hit-die.value', '-');

  const prof = Number(v(sheet?.proficiency, 0)) + Number(v(sheet?.proficiencyCustom, 0));

  const abilityOrder = ["str","dex","con","int","wis","cha"];
  const abilities = abilityOrder.map(code => {
    const a = sheet?.stats?.[code] || {};
    const label = v(a.label, code.toUpperCase());
    const score = Number(v(a.score, 0));
    const mod = Number(v(a.modifier, 0));

    const save = sheet?.saves?.[code] || {};
    const saveProf = !!v(save.isProf, false);
    const saveBonus = Number(v(save.bonus, 0));
    const saveTotal = mod + (saveProf ? prof : 0) + saveBonus;

    return {
      code,
      key: code.toUpperCase(),
      label,
      score,
      mod,
      checkTotal: mod, // в Charbox check = модификатор характеристики
      saveTotal,
      saveProf
    };
  });

  // навыки: в charbox isProf: 0/1/2 (2 = экспертность)
  const skillsRaw = (sheet?.skills && typeof sheet.skills === "object") ? sheet.skills : {};
  const skills = Object.keys(skillsRaw).map(key => {
    const s = skillsRaw[key] || {};
    const label = v(s.label, key);
    const baseStat = v(s.baseStat, "");
    const isProf = Number(v(s.isProf, 0));
    const ability = sheet?.stats?.[baseStat] || {};
    const baseMod = Number(v(ability.modifier, 0));
    const bonus = baseMod + (isProf === 1 ? prof : isProf === 2 ? prof * 2 : 0);
    return { key, label, baseStat, isProf, bonus };
  }).sort((a,b) => a.label.localeCompare(b.label));

  // пассивные чувства (как в LSS): 10 + модификатор навыка
  const passive = {
    perception: 10 + (skills.find(s => s.key === 'perception')?.bonus ?? 0),
    insight: 10 + (skills.find(s => s.key === 'insight')?.bonus ?? 0),
    investigation: 10 + (skills.find(s => s.key === 'investigation')?.bonus ?? 0)
  };

  // weapons (Charbox хранит в weaponsList элементы как {name:{value}, mod:{value}, dmg:{value}})
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

  // equipment / prof / notes (в файле они в sheet.text.*)
  const text = (sheet?.text && typeof sheet.text === "object") ? sheet.text : {};
  const equipmentLines = docToLines(text?.equipment).filter(Boolean);
  const profLines = docToLines(text?.prof).filter(Boolean);

  // spells: в твоём примере лежат в sheet.text["spells-level-x"].value.data.content
  const spellKeys = Object.keys(text).filter(k => k.startsWith("spells-level-"));
  const spellsByLevel = spellKeys
    .sort((a,b) => Number(a.split("-").pop()) - Number(b.split("-").pop()))
    .map(k => {
      const level = k.split("-").pop();
      const lines = docToLines(text[k]);
      // часто в строках есть "Название [Name]" — оставляем как есть
      return { level, items: lines };
    })
    .filter(x => x.items.length);

  // spell slots info
  const slotsRaw = (sheet?.spells && typeof sheet.spells === 'object') ? sheet.spells : {};
  const slots = Object.keys(slotsRaw)
    .filter(k => k.startsWith('slots-'))
    .map(k => {
      const level = k.split('-').pop();
      const obj = slotsRaw[k] || {};
      return { level, value: Number(v(obj.value, 0)), filled: Number(v(obj.filled, 0)) };
    })
    .sort((a,b) => Number(a.level) - Number(b.level));

  const spellsInfo = {
    base: v(sheet?.spellsInfo?.base?.code, ''),
    dc: Number(v(sheet?.spellsInfo?.save?.customModifier, 0)),
    atk: Number(v(sheet?.spellsInfo?.mod?.customModifier, 0))
  };

  return {
    name, cls, lvl, race, bg, align, xp,
    playerName, age, height, weight,
    hp, hpCur, ac, spd, hitDie,
    prof,
    abilities,
    skills,
    passive,
    weapons: weaponsVm,
    coins,
    equipmentLines,
    // совместимость со старым табом "Инвентарь"
    inventory: equipmentLines,
    profLines,
    spellsByLevel,
    spellsInfo,
    slots
  };
}

// ================== MODAL UI (LEFT TABS) ==================
function renderSheetTabContent(tabId, vm) {
  if (tabId === "basic") {
    const skillsByStat = {
      str: vm.skills.filter(s => s.baseStat === 'str'),
      dex: vm.skills.filter(s => s.baseStat === 'dex'),
      con: vm.skills.filter(s => s.baseStat === 'con'),
      int: vm.skills.filter(s => s.baseStat === 'int'),
      wis: vm.skills.filter(s => s.baseStat === 'wis'),
      cha: vm.skills.filter(s => s.baseStat === 'cha')
    };

    const abilityCards = vm.abilities.map(a => {
      const list = skillsByStat[a.code] || [];
      const skillsHtml = list.map(s => {
        const mark = s.isProf === 2 ? '◆' : s.isProf === 1 ? '●' : '○';
        return `
          <div class="ab-skill">
            <span class="ab-dot">${mark}</span>
            <span class="ab-skill-name">${escapeHtml(s.label)}</span>
            <span class="ab-skill-val">${escapeHtml(formatPlus(s.bonus))}</span>
          </div>
        `;
      }).join('') || `<div class="sheet-note">Нет навыков</div>`;

      return `
        <div class="ab-card">
          <div class="ab-head">
            <div class="ab-title">${escapeHtml(a.label)}</div>
            <div class="ab-score">${escapeHtml(a.score)}</div>
          </div>

          <div class="ab-row">
            <div class="ab-mini">
              <span class="ab-mini-label">Проверка</span>
              <span class="ab-mini-val">${escapeHtml(formatPlus(a.checkTotal))}</span>
            </div>
            <div class="ab-mini">
              <span class="ab-mini-label">Спасбросок</span>
              <span class="ab-mini-val">${escapeHtml(formatPlus(a.saveTotal))}</span>
            </div>
          </div>

          <div class="ab-skills">
            ${skillsHtml}
          </div>
        </div>
      `;
    }).join('');

    const profBlock = vm.profLines.length
      ? `<div class="sheet-scrollbox">${vm.profLines.map(l => `<div>${escapeHtml(l)}</div>`).join('')}</div>`
      : `<div class="sheet-note">Нет данных</div>`;

    const equipBlock = vm.equipmentLines.length
      ? `<ul class="sheet-list">${vm.equipmentLines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
      : `<div class="sheet-note">Инвентарь/снаряжение не указаны</div>`;

    return `
      <div class="sheet-section">
        <h3>Основное</h3>
        <div class="sheet-grid-2">
          <div class="sheet-card">
            <h4>Профиль</h4>
            <div class="kv"><div class="k">Имя</div><div class="v">${escapeHtml(vm.name)}</div></div>
            <div class="kv"><div class="k">Игрок</div><div class="v">${escapeHtml(vm.playerName)}</div></div>
            <div class="kv"><div class="k">Класс</div><div class="v">${escapeHtml(vm.cls)}</div></div>
            <div class="kv"><div class="k">Уровень</div><div class="v">${escapeHtml(vm.lvl)}</div></div>
            <div class="kv"><div class="k">Опыт</div><div class="v">${escapeHtml(vm.xp)}</div></div>
            <div class="kv"><div class="k">Раса</div><div class="v">${escapeHtml(vm.race)}</div></div>
            <div class="kv"><div class="k">Предыстория</div><div class="v">${escapeHtml(vm.bg)}</div></div>
            <div class="kv"><div class="k">Мировоззрение</div><div class="v">${escapeHtml(vm.align)}</div></div>
          </div>

          <div class="sheet-card">
            <h4>Бой / выживание</h4>
            <div class="kv"><div class="k">Кость хитов</div><div class="v">${escapeHtml(vm.hitDie)}</div></div>
            <div class="kv"><div class="k">HP</div><div class="v">${escapeHtml(vm.hpCur)} / ${escapeHtml(vm.hp)}</div></div>
            <div class="kv"><div class="k">AC</div><div class="v">${escapeHtml(vm.ac)}</div></div>
            <div class="kv"><div class="k">Speed</div><div class="v">${escapeHtml(vm.spd)}</div></div>
            <div class="kv"><div class="k">Бонус мастерства</div><div class="v">${escapeHtml(formatPlus(vm.prof))}</div></div>
          </div>
        </div>
      </div>

      <div class="sheet-section">
        <h3>Характеристики</h3>
        <div class="ab-grid">
          ${abilityCards}
        </div>
      </div>

      <div class="sheet-section">
        <h3>Пассивные чувства</h3>
        <div class="sheet-grid-3">
          <div class="sheet-card"><h4>Мудрость (Восприятие)</h4><div class="kv"><div class="k">Пассивно</div><div class="v">${escapeHtml(vm.passive.perception)}</div></div></div>
          <div class="sheet-card"><h4>Мудрость (Проницательность)</h4><div class="kv"><div class="k">Пассивно</div><div class="v">${escapeHtml(vm.passive.insight)}</div></div></div>
          <div class="sheet-card"><h4>Интеллект (Анализ)</h4><div class="kv"><div class="k">Пассивно</div><div class="v">${escapeHtml(vm.passive.investigation)}</div></div></div>
        </div>
      </div>

      <div class="sheet-section">
        <h3>Прочие владения и языки</h3>
        ${profBlock}
      </div>

      <div class="sheet-section">
        <h3>Снаряжение</h3>
        ${equipBlock}
        <div class="sheet-note" style="margin-top:8px;">● — владение, ◆ — экспертность (если есть в файле)</div>
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
      : `<div class="sheet-note">Оружие не указано</div>`;

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
    const slots = (vm.slots && vm.slots.length)
      ? `
        <div class="sheet-card">
          <h4>Ячейки</h4>
          ${vm.slots.map(s => `
            <div class="kv"><div class="k">${escapeHtml(s.level)} ур.</div><div class="v">${escapeHtml(s.filled || 0)} / ${escapeHtml(s.value || 0)}</div></div>
          `).join('')}
        </div>
      `
      : `
        <div class="sheet-card">
          <h4>Ячейки</h4>
          <div class="sheet-note">Нет данных</div>
        </div>
      `;

    const castInfo = `
      <div class="sheet-card">
        <h4>Параметры магии</h4>
        <div class="kv"><div class="k">База</div><div class="v">${escapeHtml((vm.spellsInfo?.base || '').toUpperCase() || '-')}</div></div>
        <div class="kv"><div class="k">СЛ спасброска</div><div class="v">${escapeHtml(vm.spellsInfo?.dc ?? '-') }</div></div>
        <div class="kv"><div class="k">Бонус атаки</div><div class="v">${escapeHtml(formatPlus(vm.spellsInfo?.atk ?? 0))}</div></div>
      </div>
    `;

    if (!vm.spellsByLevel.length) {
      return `
        <div class="sheet-section">
          <h3>Заклинания</h3>
          <div class="sheet-grid-2">
            ${castInfo}
            ${slots}
          </div>
          <div class="sheet-note" style="margin-top:10px;">Заклинания не указаны</div>
        </div>
      `;
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
        <div class="sheet-grid-2" style="margin-bottom:10px;">
          ${castInfo}
          ${slots}
        </div>
        <div class="sheet-grid-2">
          ${blocks}
        </div>
      </div>
    `;
  }

  if (tabId === "inventory") {
    const coins = vm.coins
      ? ["cp","sp","ep","gp","pp"].map(k => `<span class="sheet-pill">${k.toUpperCase()}: ${escapeHtml(vm.coins[k])}</span>`).join("")
      : `<div class="sheet-note">Нет данных</div>`;

    const inv = vm.inventory.length
      ? `<ul class="sheet-list">${vm.inventory.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : `<div class="sheet-note">Инвентарь не указан</div>`;

    return `
      <div class="sheet-section">
        <h3>Инвентарь</h3>
        <div class="sheet-grid-2">
          <div class="sheet-card">
            <h4>Монеты</h4>
            <div>${coins}</div>
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

  sheetTitle.textContent = `Инфа: ${player.name}`;
  sheetSubtitle.textContent = `Владелец: ${player.ownerName || 'Unknown'} • Тип: ${player.isBase ? 'Основа' : '-'}`;

  const canEdit = (myRole === "GM" || player.ownerId === myId);

  // actions (upload + hint)
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

  // content
  const sheet = player.sheet?.parsed || null;
  if (!sheet) {
    sheetContent.innerHTML = `<div class="sheet-note">Лист не загружен.${canEdit ? " Загрузите .json через кнопку выше." : ""}</div>`;
    return;
  }

  const vm = toViewModel(sheet, player.name);

  const tabs = [
    { id: "basic", label: "Основное" },
    { id: "combat", label: "Бой" },
    { id: "spells", label: "Заклинания" },
    { id: "inventory", label: "Инвентарь" }
  ];

  // активный таб сохраняем на player (в рантайме)
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

      if (main) main.innerHTML = renderSheetTabContent(activeTab, vm);
    });
  });
}


// ================== INFO MODAL BRIDGE ==================
// Модалка "Инфа" вынесена в info-dnd-player.js.
// Здесь только прокидываем контекст и вызываем API окна.
function infoModalInit() {
  if (!window.InfoModal || typeof window.InfoModal.init !== "function") return;
  window.InfoModal.init({
    sendMessage,
    getMyRole: () => myRole,
    getMyId: () => myId
  });
}

function infoModalOpen(player) {
  if (!window.InfoModal || typeof window.InfoModal.open !== "function") return;
  window.InfoModal.open(player);
}

function infoModalRefresh(playersArr) {
  if (!window.InfoModal || typeof window.InfoModal.refresh !== "function") return;
  window.InfoModal.refresh(playersArr);
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
      infoModalInit();
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
      // если модалка открыта — обновим контент
      infoModalRefresh(players);
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

      // КНОПКА "ИНФА"
      if (p.isBase) {
        const infoBtn = document.createElement('button');
        infoBtn.textContent = 'Инфа';
        infoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          infoModalOpen(p);
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
