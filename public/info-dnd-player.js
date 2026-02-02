/* info-dnd-player.js
   UI/логика модалки "Инфа" вынесены сюда.
   Экспортирует window.InfoModal:
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
      if ("name" in x && x.name && typeof x.name === "object" && "value" in x.name) return (x.name.value ?? fallback);
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

  function formatMod(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    return x >= 0 ? `+${x}` : `${x}`;
  }

  function safeInt(x, fallback = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
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

  // ================== TIPTAP DOC PARSING ==================
  function tiptapToPlainLines(doc) {
    if (!doc || typeof doc !== "object") return [];
    const root = doc?.content;
    if (!Array.isArray(root)) return [];
    const lines = [];

    function walkNode(node, acc) {
      if (!node || typeof node !== "object") return acc;
      if (node.type === "text") {
        acc.push(String(node.text || ""));
        return acc;
      }
      if (Array.isArray(node.content)) {
        node.content.forEach(ch => walkNode(ch, acc));
      }
      return acc;
    }

    for (const block of root) {
      if (!block) continue;
      if (block.type === "paragraph") {
        const acc = [];
        walkNode(block, acc);
        const line = acc.join("").trim();
        if (line) lines.push(line);
      }
    }
    return lines;
  }

  function parseSpellsFromTiptap(doc) {
    if (!doc || typeof doc !== "object") return [];
    const root = doc?.content;
    if (!Array.isArray(root)) return [];
    const items = [];

    function walk(node, state) {
      if (!node || typeof node !== "object") return;
      if (node.type === "text") {
        const text = String(node.text || "").trim();
        if (!text) return;

        let href = null;
        if (Array.isArray(node.marks)) {
          const link = node.marks.find(m => m?.type === "link" && m?.attrs?.href);
          if (link) href = link.attrs.href;
        }
        state.parts.push({ text, href });
        return;
      }
      if (Array.isArray(node.content)) node.content.forEach(ch => walk(ch, state));
    }

    for (const block of root) {
      if (!block) continue;
      if (block.type === "paragraph") {
        const state = { parts: [] };
        walk(block, state);
        const combinedText = state.parts.map(p => p.text).join("").trim();
        if (combinedText) {
          const href = state.parts.find(p => p.href)?.href || null;
          items.push({ text: combinedText, href });
        }
      }
    }
    return items;
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
      proficiency: 2,
      stats: {
        str: { score: 10, modifier: 0, label: "Сила", check: 0 },
        dex: { score: 10, modifier: 0, label: "Ловкость", check: 0 },
        con: { score: 10, modifier: 0, label: "Телосложение", check: 0 },
        int: { score: 10, modifier: 0, label: "Интеллект", check: 0 },
        wis: { score: 10, modifier: 0, label: "Мудрость", check: 0 },
        cha: { score: 10, modifier: 0, label: "Харизма", check: 0 }
      },
      saves: {
        str: { isProf: false, bonus: 0 },
        dex: { isProf: false, bonus: 0 },
        con: { isProf: false, bonus: 0 },
        int: { isProf: false, bonus: 0 },
        wis: { isProf: false, bonus: 0 },
        cha: { isProf: false, bonus: 0 }
      },
      skills: {},
      bonusesSkills: {},
      bonusesStats: {},
      spellsInfo: {
        base: { code: "" },
        save: { customModifier: "" },
        mod: { customModifier: "" }
      },
      spells: {},
      text: {},
      weaponsList: [],
      coins: { cp: { value: 0 }, sp: { value: 0 }, ep: { value: 0 }, gp: { value: 0 }, pp: { value: 0 } }
    };
  }

  function ensurePlayerSheetWrapper(player) {
    if (!player.sheet || typeof player.sheet !== "object") {
      player.sheet = { source: "manual", importedAt: Date.now(), raw: null, parsed: createEmptySheet(player.name) };
      return;
    }
    if (!player.sheet.parsed || typeof player.sheet.parsed !== "object") {
      player.sheet.parsed = createEmptySheet(player.name);
    }
  }

  // ================== CALC MODIFIERS (LSS) ==================
  function hasHalfProfBonusForSkill(sheet, skillKey) {
    const bs = sheet?.bonusesSkills;
    if (!bs || typeof bs !== "object") return false;
    for (const k of Object.keys(bs)) {
      const val = bs[k]?.value;
      const arr = val?.[skillKey];
      if (Array.isArray(arr) && arr.some(x => x?.type === "spread" && x?.key === "halfProfType")) return true;
    }
    return false;
  }

  function hasHalfProfBonusForStat(sheet, statKey) {
    const bs = sheet?.bonusesStats;
    if (!bs || typeof bs !== "object") return false;
    for (const k of Object.keys(bs)) {
      const val = bs[k]?.value;
      const arr = val?.[statKey];
      if (Array.isArray(arr) && arr.some(x => x?.type === "spread" && x?.key === "halfProfType")) return true;
    }
    return false;
  }

  function getProfBonus(sheet) {
    return safeInt(sheet?.proficiency, 2) + safeInt(sheet?.proficiencyCustom, 0);
  }

  // ===== NEW: boost for skills via clickable dots =====
  function getSkillBoostLevel(sheet, skillKey) {
    const lvl = safeInt(sheet?.skills?.[skillKey]?.boostLevel, 0);
    if (lvl === 1) return 1;
    if (lvl === 2) return 2;
    return 0;
  }
  function boostLevelToAdd(lvl) {
    if (lvl === 1) return 1;
    if (lvl === 2) return 3;
    return 0;
  }
  function boostLevelToStars(lvl) {
    if (lvl === 1) return "★";
    if (lvl === 2) return "★★★";
    return "";
  }

  function calcSkillBonus(sheet, skillKey) {
    const prof = getProfBonus(sheet);
    const skill = sheet?.skills?.[skillKey];
    const baseStat = skill?.baseStat;
    const statMod = safeInt(sheet?.stats?.[baseStat]?.modifier, 0);
    const isProf = safeInt(skill?.isProf, 0);

    let bonus = statMod;

    if (isProf === 1) bonus += prof;
    if (isProf === 2) bonus += prof * 2;

    // Jack of all trades / half-prof if not proficient
    if (isProf === 0 && hasHalfProfBonusForSkill(sheet, skillKey)) {
      bonus += Math.floor(prof / 2);
    }

    // NEW: add dot boost
    const boostLevel = getSkillBoostLevel(sheet, skillKey);
    bonus += boostLevelToAdd(boostLevel);

    return bonus;
  }

  function calcSaveBonus(sheet, statKey) {
    const prof = getProfBonus(sheet);
    const statMod = safeInt(sheet?.stats?.[statKey]?.modifier, 0);
    const save = sheet?.saves?.[statKey];
    const isProf = !!save?.isProf;
    const bonusExtra = safeInt(save?.bonus, 0);
    return statMod + (isProf ? prof : 0) + bonusExtra;
  }

  function calcCheckBonus(sheet, statKey) {
    const prof = getProfBonus(sheet);
    const statMod = safeInt(sheet?.stats?.[statKey]?.modifier, 0);
    const check = safeInt(sheet?.stats?.[statKey]?.check, 0);

    let bonus = statMod;
    if (check === 1) bonus += prof;
    if (check === 2) bonus += prof * 2;

    if (check === 0 && hasHalfProfBonusForStat(sheet, statKey)) {
      bonus += Math.floor(prof / 2);
    }
    return bonus;
  }

  // ================== VIEW MODEL ==================
  function toViewModel(sheet, fallbackName = "-") {
    const name = get(sheet, 'name.value', fallbackName);
    const cls = get(sheet, 'info.charClass.value', '-');
    const lvl = get(sheet, 'info.level.value', '-');
    const race = get(sheet, 'info.race.value', '-');

    const hp = get(sheet, 'vitality.hp-max.value', '-');
    const hpCur = get(sheet, 'vitality.hp-current.value', '-');
    const ac = get(sheet, 'vitality.ac.value', '-');
    const spd = get(sheet, 'vitality.speed.value', '-');

    const statKeys = ["str","dex","con","int","wis","cha"];
    const stats = statKeys.map(k => {
      const s = sheet?.stats?.[k] || {};
      const label = s.label || ({ str:"Сила", dex:"Ловкость", con:"Телосложение", int:"Интеллект", wis:"Мудрость", cha:"Харизма" })[k];
      const score = safeInt(s.score, 10);
      const mod = safeInt(s.modifier, 0);
      return { k, label, score, mod, check: calcCheckBonus(sheet, k), save: calcSaveBonus(sheet, k), skills: [] };
    });

    // group skills under stats
    const skillsRaw = (sheet?.skills && typeof sheet.skills === "object") ? sheet.skills : {};
    for (const key of Object.keys(skillsRaw)) {
      const sk = skillsRaw[key];
      const baseStat = sk?.baseStat;
      const label = sk?.label || key;
      const isProf = safeInt(sk?.isProf, 0);

      const boostLevel = getSkillBoostLevel(sheet, key);
      const bonus = calcSkillBonus(sheet, key);

      const statBlock = stats.find(s => s.k === baseStat);
      if (!statBlock) continue;
      statBlock.skills.push({ key, label, isProf, bonus, boostLevel, boostStars: boostLevelToStars(boostLevel) });
    }
    stats.forEach(s => s.skills.sort((a,b) => a.label.localeCompare(b.label, 'ru')));

    // passive senses
    const passive = [
      { key: "perception", label: "Мудрость (Восприятие)" },
      { key: "insight", label: "Мудрость (Проницательность)" },
      { key: "investigation", label: "Интеллект (Анализ)" }
    ].map(x => {
      const skillBonus = (sheet?.skills?.[x.key]) ? calcSkillBonus(sheet, x.key) : 0;
      return { label: x.label, value: 10 + skillBonus };
    });

    // “прочие владения и языки”
    const profDoc = sheet?.text?.prof?.value?.data;
    const profLines = tiptapToPlainLines(profDoc);

    // spells info + slots + lists
    const spellsInfo = {
      base: sheet?.spellsInfo?.base?.code || sheet?.spellsInfo?.base?.value || "",
      save: sheet?.spellsInfo?.save?.customModifier || sheet?.spellsInfo?.save?.value || "",
      mod: sheet?.spellsInfo?.mod?.customModifier || sheet?.spellsInfo?.mod?.value || ""
    };

    const slotsRaw = (sheet?.spells && typeof sheet.spells === "object") ? sheet.spells : {};
    const slots = [];
    for (let lvlN = 1; lvlN <= 9; lvlN++) {
      const k = `slots-${lvlN}`;
      if (!slotsRaw[k]) continue;
      const total = safeInt(slotsRaw[k]?.value, 0);
      const filled = safeInt(slotsRaw[k]?.filled, 0);
      slots.push({ level: lvlN, total, filled });
    }

    const text = (sheet?.text && typeof sheet.text === "object") ? sheet.text : {};
    const spellKeys = Object.keys(text).filter(k => k.startsWith("spells-level-"));
    const spellsByLevel = spellKeys
      .map(k => ({ level: safeInt(k.split("-").pop(), 0), items: parseSpellsFromTiptap(text[k]?.value?.data) }))
      .filter(x => x.items && x.items.length)
      .sort((a,b) => a.level - b.level);

    const weapons = Array.isArray(sheet?.weaponsList) ? sheet.weaponsList : [];
    const weaponsVm = weapons
      .map(w => ({ name: v(w?.name, "-"), atk: v(w?.mod, "-"), dmg: v(w?.dmg, "-") }))
      .filter(w => w.name && w.name !== "-");

    const coinsRaw = sheet?.coins && typeof sheet.coins === "object" ? sheet.coins : null;
    const coins = coinsRaw ? { cp: v(coinsRaw.cp, 0), sp: v(coinsRaw.sp, 0), ep: v(coinsRaw.ep, 0), gp: v(coinsRaw.gp, 0), pp: v(coinsRaw.pp, 0) } : null;

    return { name, cls, lvl, race, hp, hpCur, ac, spd, stats, passive, profLines, spellsInfo, slots, spellsByLevel, weapons: weaponsVm, coins };
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
    try { return path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj); }
    catch { return undefined; }
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
      if (inp.type === "checkbox") inp.checked = !!raw;
      else inp.value = (raw ?? "");

      if (!canEdit) {
        inp.disabled = true;
        return;
      }

      const handler = () => {
        let val;
        if (inp.type === "checkbox") val = !!inp.checked;
        else if (inp.type === "number") val = inp.value === "" ? "" : Number(inp.value);
        else val = inp.value;

        setByPath(player.sheet.parsed, path, val);

        if (path === "name.value") player.name = val || player.name;

        scheduleSheetSave(player);
      };

      inp.addEventListener("input", handler);
      inp.addEventListener("change", handler);
    });
  }

  // ===== NEW: clickable dots binding (skills boost) =====
  function ensureSkillNode(sheet, skillKey) {
    if (!sheet.skills || typeof sheet.skills !== "object") sheet.skills = {};
    if (!sheet.skills[skillKey] || typeof sheet.skills[skillKey] !== "object") sheet.skills[skillKey] = {};
  }

  function bindSkillBoostDots(root, player, canEdit) {
    if (!root || !player?.sheet?.parsed) return;

    const sheet = player.sheet.parsed;
    const dots = root.querySelectorAll(".lss-dot[data-skill-key]");
    dots.forEach(dot => {
      const skillKey = dot.getAttribute("data-skill-key");
      if (!skillKey) return;

      // делаем кликабельным визуально
      dot.classList.add("clickable");

      // если нельзя редактировать — просто не вешаем обработчик
      if (!canEdit) return;

      dot.addEventListener("click", (e) => {
        e.stopPropagation();

        ensureSkillNode(sheet, skillKey);

        const cur = safeInt(sheet.skills[skillKey].boostLevel, 0);
        const next = (cur === 0) ? 1 : (cur === 1) ? 2 : 0;
        sheet.skills[skillKey].boostLevel = next;

        // обновим UI точечно (без полного ререндера)
        dot.classList.remove("boost1", "boost2");
        if (next === 1) dot.classList.add("boost1");
        if (next === 2) dot.classList.add("boost2");

        const row = dot.closest(".lss-skill-row");
        if (row) {
          const valEl = row.querySelector(".lss-skill-val");
          if (valEl) valEl.textContent = formatMod(calcSkillBonus(sheet, skillKey));

          const nameEl = row.querySelector(".lss-skill-name");
          if (nameEl) {
            // обновим/вставим звездочки boost
            let boostSpan = nameEl.querySelector(".lss-boost");
            const stars = boostLevelToStars(next);

            if (!boostSpan) {
              boostSpan = document.createElement("span");
              boostSpan.className = "lss-boost";
              nameEl.appendChild(boostSpan);
            }
            boostSpan.textContent = stars ? ` ${stars}` : "";
          }
        }

        scheduleSheetSave(player);
      });
    });
  }

  // ================== RENDER: BASIC (WITH STATS INSIDE) ==================
  function renderAbilitiesGrid(vm) {
    const blocks = vm.stats.map(s => {
      const skillRows = (s.skills || []).map(sk => {
        const profMark = (sk.isProf === 1) ? "★" : (sk.isProf === 2) ? "★★" : "";
        const boostMark = sk.boostStars || "";

        const dotClass = (sk.boostLevel === 1) ? "boost1" : (sk.boostLevel === 2) ? "boost2" : "";
        return `
          <div class="lss-skill-row">
            <div class="lss-skill-left">
              <span class="lss-dot ${dotClass}" data-skill-key="${escapeHtml(sk.key)}"></span>
              <span class="lss-skill-name">
                ${escapeHtml(sk.label)}
                ${profMark ? ` <span class="lss-prof">${profMark}</span>` : ""}
                ${boostMark ? ` <span class="lss-boost"> ${boostMark}</span>` : `<span class="lss-boost"></span>`}
              </span>
            </div>
            <div class="lss-skill-val">${escapeHtml(formatMod(sk.bonus))}</div>
          </div>
        `;
      }).join("");

      return `
        <div class="lss-ability">
          <div class="lss-ability-head">
            <div class="lss-ability-name">${escapeHtml(s.label.toUpperCase())}</div>
            <div class="lss-ability-score">${escapeHtml(String(s.score))}</div>
          </div>

          <div class="lss-ability-actions">
            <div class="lss-pill">
              <span class="lss-pill-label">ПРОВЕРКА</span>
              <span class="lss-pill-val">${escapeHtml(formatMod(s.check))}</span>
            </div>
            <div class="lss-pill">
              <span class="lss-pill-label">СПАСБРОСОК</span>
              <span class="lss-pill-val">${escapeHtml(formatMod(s.save))}</span>
            </div>
          </div>

          <div class="lss-skill-list">
            ${skillRows || `<div class="sheet-note">Нет навыков</div>`}
          </div>
        </div>
      `;
    }).join("");

    return `<div class="lss-abilities-grid">${blocks}</div>`;
  }

  function renderPassives(vm) {
    const rows = vm.passive.map(p => `
      <div class="lss-passive-row">
        <div class="lss-passive-val">${escapeHtml(String(p.value))}</div>
        <div class="lss-passive-label">${escapeHtml(p.label)}</div>
      </div>
    `).join("");

    return `
      <div class="lss-passives">
        <div class="lss-passives-title">ПАССИВНЫЕ ЧУВСТВА</div>
        ${rows}
      </div>
    `;
  }

  function renderProfBox(vm) {
    if (!vm.profLines || !vm.profLines.length) return "";
    const lines = vm.profLines.map(l => `<div class="lss-prof-line">${escapeHtml(l)}</div>`).join("");
    return `
      <div class="lss-profbox">
        <div class="lss-passives-title">ПРОЧИЕ ВЛАДЕНИЯ И ЯЗЫКИ</div>
        <div class="lss-prof-scroll">${lines}</div>
      </div>
    `;
  }

  function renderBasicTab(vm) {
    return `
      <div class="sheet-section">
        <h3>Основное</h3>

        <div class="sheet-grid-2">
          <div class="sheet-card">
            <h4>Профиль</h4>

            <div class="kv"><div class="k">Имя</div><div class="v"><input type="text" data-sheet-path="name.value" style="width:180px"></div></div>
            <div class="kv"><div class="k">Класс</div><div class="v"><input type="text" data-sheet-path="info.charClass.value" style="width:180px"></div></div>
            <div class="kv"><div class="k">Уровень</div><div class="v"><input type="number" min="1" max="20" data-sheet-path="info.level.value" style="width:90px"></div></div>
            <div class="kv"><div class="k">Раса</div><div class="v"><input type="text" data-sheet-path="info.race.value" style="width:180px"></div></div>
            <div class="kv"><div class="k">Предыстория</div><div class="v"><input type="text" data-sheet-path="info.background.value" style="width:180px"></div></div>
            <div class="kv"><div class="k">Мировоззрение</div><div class="v"><input type="text" data-sheet-path="info.alignment.value" style="width:180px"></div></div>
          </div>

          <div class="sheet-card">
            <h4>Базовые параметры</h4>
            <div class="kv"><div class="k">AC</div><div class="v"><input type="number" min="0" max="40" data-sheet-path="vitality.ac.value" style="width:90px"></div></div>
            <div class="kv"><div class="k">HP max</div><div class="v"><input type="number" min="0" max="999" data-sheet-path="vitality.hp-max.value" style="width:90px"></div></div>
            <div class="kv"><div class="k">HP current</div><div class="v"><input type="number" min="0" max="999" data-sheet-path="vitality.hp-current.value" style="width:90px"></div></div>
            <div class="kv"><div class="k">Speed</div><div class="v"><input type="number" min="0" max="200" data-sheet-path="vitality.speed.value" style="width:90px"></div></div>
          </div>
        </div>

        <div class="sheet-section" style="margin-top:12px;">
          <h3>Характеристики и навыки</h3>
          ${renderAbilitiesGrid(vm)}
        </div>

        <div class="lss-bottom-grid">
          ${renderPassives(vm)}
          ${renderProfBox(vm)}
        </div>
      </div>
    `;
  }

  // ================== RENDER: SPELLS ==================
  function renderSlots(vm) {
    if (!vm.slots || !vm.slots.length) return `<div class="sheet-note">Ячейки заклинаний не указаны в файле.</div>`;

    const rows = vm.slots.map(s => {
      const left = Math.max(0, s.total - (s.filled || 0));
      return `
        <div class="lss-slot">
          <div class="lss-slot-lvl">${s.level}</div>
          <div class="lss-slot-bar">
            <div class="lss-slot-text">${left}/${s.total}</div>
          </div>
        </div>
      `;
    }).join("");

    return `<div class="lss-slots">${rows}</div>`;
  }

  function renderSpellsByLevel(vm) {
    if (!vm.spellsByLevel || !vm.spellsByLevel.length) {
      return `<div class="sheet-note">Заклинания не найдены в разделе spells-level-* (в твоём .json они лежат в sheet.text).</div>`;
    }

    const blocks = vm.spellsByLevel.map(b => {
      const items = (b.items || []).map(it => {
        if (it.href) {
          return `<a class="sheet-pill spell-link" href="${escapeHtml(it.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.text)}</a>`;
        }
        return `<span class="sheet-pill">${escapeHtml(it.text)}</span>`;
      }).join("");

      const title = (b.level === 0) ? "Заговоры (0)" : `Уровень ${b.level}`;
      return `
        <div class="sheet-card">
          <h4>${escapeHtml(title)}</h4>
          <div>${items || `<div class="sheet-note">Пусто</div>`}</div>
        </div>
      `;
    }).join("");

    return `<div class="sheet-grid-2">${blocks}</div>`;
  }

  function renderSpellsTab(vm) {
    const base = vm.spellsInfo?.base ? String(vm.spellsInfo.base).toUpperCase() : "-";
    const save = vm.spellsInfo?.save || "-";
    const mod = vm.spellsInfo?.mod || "-";

    return `
      <div class="sheet-section">
        <h3>Заклинания</h3>

        <div class="sheet-grid-2">
          <div class="sheet-card">
            <h4>Параметры магии</h4>
            <div class="kv"><div class="k">База</div><div class="v">${escapeHtml(String(base))}</div></div>
            <div class="kv"><div class="k">СЛ спасброска</div><div class="v">${escapeHtml(String(save))}</div></div>
            <div class="kv"><div class="k">Бонус атаки</div><div class="v">${escapeHtml(String(mod))}</div></div>
          </div>

          <div class="sheet-card">
            <h4>Ячейки</h4>
            ${renderSlots(vm)}
          </div>
        </div>

        <div class="sheet-section" style="margin-top:10px;">
          <h3>Список заклинаний</h3>
          ${renderSpellsByLevel(vm)}
          <div class="sheet-note" style="margin-top:8px;">
            Подсказка: если в твоём .json ссылки на dnd.su — они кликабельны.
          </div>
        </div>
      </div>
    `;
  }

  // ================== OTHER TABS ==================
  function renderCombatTab(vm) {
    const weapons = vm.weapons.length
      ? vm.weapons.map(w => `
        <div class="sheet-card">
          <h4>${escapeHtml(w.name)}</h4>
          <div class="kv"><div class="k">Atk</div><div class="v">${escapeHtml(String(w.atk))}</div></div>
          <div class="kv"><div class="k">Dmg</div><div class="v">${escapeHtml(String(w.dmg))}</div></div>
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

  function renderInventoryTab(vm) {
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

  function renderActiveTab(tabId, vm) {
    if (tabId === "basic") return renderBasicTab(vm);
    if (tabId === "spells") return renderSpellsTab(vm);
    if (tabId === "combat") return renderCombatTab(vm);
    if (tabId === "inventory") return renderInventoryTab(vm);
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
      ? "Можно загрузить .json (Long Story Short/Charbox) или редактировать поля вручную — всё сохраняется."
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
      { id: "spells", label: "Заклинания" },
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
            <div class="sheet-chip"><div class="k">AC</div><div class="v">${escapeHtml(String(vm.ac))}</div></div>
            <div class="sheet-chip"><div class="k">HP</div><div class="v">${escapeHtml(String(vm.hpCur))}/${escapeHtml(String(vm.hp))}</div></div>
            <div class="sheet-chip"><div class="k">Speed</div><div class="v">${escapeHtml(String(vm.spd))}</div></div>
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
        ${renderActiveTab(activeTab, vm)}
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
    bindSkillBoostDots(sheetContent, player, canEdit);

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
          main.innerHTML = renderActiveTab(activeTab, freshVm);

          bindEditableInputs(sheetContent, player, canEdit);
          bindSkillBoostDots(sheetContent, player, canEdit);
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
