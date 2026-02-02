/* info-dnd-player.js
   Весь UI/логика модалки "Инфа" вынесены сюда.
   Экспортирует window.InfoModal с методами:
   - init(context)
   - open(player)
   - refresh(players)
*/

(function () {
  // ===== MODAL ELEMENTS =====
  const sheetModal = document.getElementById('sheet-modal');
  const sheetClose = document.getElementById('sheet-close');
  const sheetTitle = document.getElementById('sheet-title');
  const sheetSubtitle = document.getElementById('sheet-subtitle');
  const sheetActions = document.getElementById('sheet-actions');
  const sheetContent = document.getElementById('sheet-content');

  // context from client.js
  let ctx = null;

  // состояние модалки
  let openedSheetPlayerId = null;

  // debounce save timers
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

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

  function ensureWiredCloseHandlers() {
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
  }

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

    const stats = ["str", "dex", "con", "int", "wis", "cha"].map(k => ({
      key: k.toUpperCase(),
      k,
      score: v(sheet?.stats?.[k]?.score, '-'),
      mod: v(sheet?.stats?.[k]?.modifier, '-')
    }));

    const weapons = Array.isArray(sheet?.weaponsList) ? sheet.weaponsList : [];
    const weaponsVm = weapons
      .map(w => ({
        name: v(w?.name, "-"),
        atk: v(w?.attackBonus ?? w?.atkBonus ?? w?.toHit ?? w?.mod, "-"),
        dmg: v(w?.damage ?? w?.dmg, "-"),
        type: v(w?.type ?? w?.damageType, "")
      }))
      .filter(w => w.name && w.name !== "-");

    const coinsRaw = sheet?.coins && typeof sheet.coins === "object" ? sheet.coins : null;
    const coins = coinsRaw ? {
      cp: v(coinsRaw.cp, 0),
      sp: v(coinsRaw.sp, 0),
      ep: v(coinsRaw.ep, 0),
      gp: v(coinsRaw.gp, 0),
      pp: v(coinsRaw.pp, 0)
    } : null;

    return {
      name, cls, lvl, race, bg, align,
      hp, hpCur, ac, spd,
      stats,
      weapons: weaponsVm,
      coins
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
    if (!player?.id || !ctx?.sendMessage) return;

    const key = player.id;
    const prev = sheetSaveTimers.get(key);
    if (prev) clearTimeout(prev);

    const t = setTimeout(() => {
      ctx.sendMessage({ type: "setPlayerSheet", id: player.id, sheet: player.sheet });
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
          val = inp.value === "" ? "" : Number(inp.value);
        } else {
          val = inp.value;
        }

        setByPath(player.sheet.parsed, path, val);

        if (path === "name.value") {
          player.name = val || player.name;
        }

        scheduleSheetSave(player);
      };

      inp.addEventListener("input", handler);
      inp.addEventListener("change", handler);
    });
  }

  // ================== RENDER TABS ==================
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
              <h4>Базовые статы</h4>

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
        : `<div class="sheet-note">Оружие не указано (из файла).</div>`;

      return `
        <div class="sheet-section">
          <h3>Бой</h3>
          <div class="sheet-grid-2">
            ${weapons}
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
              <div class="sheet-note">Пока не редактируются в UI.</div>
            </div>
          </div>
        </div>
      `;
    }

    return `<div class="sheet-note">Раздел в разработке</div>`;
  }

  // ================== RENDER MODAL ==================
  function renderSheetModal(player) {
    if (!sheetTitle || !sheetSubtitle || !sheetActions || !sheetContent) return;
    if (!ctx) return;

    const myRole = ctx.getMyRole?.();
    const myId = ctx.getMyId?.();

    const canEdit = (myRole === "GM" || player.ownerId === myId);

    sheetTitle.textContent = `Инфа: ${player.name}`;
    sheetSubtitle.textContent = `Владелец: ${player.ownerName || 'Unknown'} • Тип: ${player.isBase ? 'Основа' : '-'}`;

    ensurePlayerSheetWrapper(player);

    sheetActions.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'sheet-note';
    note.textContent = canEdit
      ? "Можно загрузить .json (Charbox/LSS) или редактировать поля вручную — всё сохраняется."
      : "Просмотр. Редактировать может только владелец или GM.";
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
          player.sheet = sheet; // локально
          ctx.sendMessage({ type: "setPlayerSheet", id: player.id, sheet });

          const tmp = document.createElement('div');
          tmp.className = 'sheet-note';
          tmp.textContent = "Файл отправлен. Сейчас обновится состояние…";
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
      { id: "combat", label: "Бой" },
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
          const freshSheet = player.sheet?.parsed || createEmptySheet(player.name);
          const freshVm = toViewModel(freshSheet, player.name);
          main.innerHTML = renderSheetTabContent(activeTab, freshVm);
          bindEditableInputs(sheetContent, player, canEdit);
        }
      });
    });
  }

  // ================== PUBLIC API ==================
  function init(context) {
    ctx = context || null;
    ensureWiredCloseHandlers();
  }

  function open(player) {
    if (!player) return;
    openedSheetPlayerId = player.id;
    renderSheetModal(player);
    openModal();
  }

  function refresh(players) {
    if (!openedSheetPlayerId) return;
    if (!Array.isArray(players)) return;
    const pl = players.find(x => x.id === openedSheetPlayerId);
    if (pl) renderSheetModal(pl);
  }

  window.InfoModal = { init, open, refresh, close: closeModal };
})();
