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

  // UI-состояние модалки (чтобы обновления state не сбрасывали вкладку/скролл)
  // Map<playerId, { activeTab: string, scrollTopByTab: Record<string, number>, lastInteractAt: number }>
  const uiStateByPlayerId = new Map();

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

  // Fallback: если cleanSpellName определён в другом файле, используем его.
  // Иначе — базовая очистка: убрать хвосты типа "— заклинание"/"- заговор".
  if (typeof window.cleanSpellName !== 'function') {
    window.cleanSpellName = function (name) {
      let s = String(name ?? '').trim();
      if (!s) return '';

      // Удаляем типичные хвосты: "— заклинание", "- заговор", "— spell" и т.п.
      s = s.replace(/\s*[-—–]\s*(заклинание|заговор|spell|cantrip)\b.*$/i, '').trim();

      // Чистим лишние пробелы
      s = s.replace(/\s{2,}/g, ' ').trim();
      return s;
    };
  }

  

  // D&D 5e: модификатор = floor((score - 10) / 2), ограничиваем 1..30
  function scoreToModifier(score) {
    const s = Math.max(1, Math.min(30, safeInt(score, 10)));
    const m = Math.floor((s - 10) / 2);
    // для надёжности ограничим диапазон -5..+10
    return Math.max(-5, Math.min(10, m));
  }

  // принимает "+3", "-1", "3", "" -> number
  function parseModInput(str, fallback = 0) {
    if (str == null) return fallback;
    const t = String(str).trim();
    if (!t) return fallback;
    const n = Number(t.replace(",", "."));
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

  // ================== UI STATE (tab/scroll/anti-jump) ==================
  function getUiState(playerId) {
    if (!playerId) return { activeTab: "basic", scrollTopByTab: {}, lastInteractAt: 0 };
    if (!uiStateByPlayerId.has(playerId)) {
      uiStateByPlayerId.set(playerId, { activeTab: "basic", scrollTopByTab: {}, lastInteractAt: 0 });
    }
    return uiStateByPlayerId.get(playerId);
  }

  function captureUiStateFromDom(player) {
    if (!player?.id) return;
    const st = getUiState(player.id);
    const activeTab = player._activeSheetTab || st.activeTab || "basic";
    st.activeTab = activeTab;

    const main = sheetContent?.querySelector?.("#sheet-main");
    if (main) {
      st.scrollTopByTab[activeTab] = main.scrollTop || 0;
    }
  }

  function restoreUiStateToDom(player) {
    if (!player?.id) return;
    const st = getUiState(player.id);
    const activeTab = player._activeSheetTab || st.activeTab || "basic";
    const main = sheetContent?.querySelector?.("#sheet-main");
    if (main && st.scrollTopByTab && typeof st.scrollTopByTab[activeTab] === "number") {
      main.scrollTop = st.scrollTopByTab[activeTab];
    }
  }

  function markModalInteracted(playerId) {
    if (!playerId) return;
    const st = getUiState(playerId);
    st.lastInteractAt = Date.now();
  }

  function isModalBusy(playerId) {
    if (!sheetModal || sheetModal.classList.contains('hidden')) return false;
    const activeEl = document.activeElement;
    if (activeEl && sheetModal.contains(activeEl)) return true;
    const st = getUiState(playerId);
    return (Date.now() - (st.lastInteractAt || 0)) < 900;
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
      // Навыки должны существовать даже до загрузки .json (всё по 0)
      skills: {
        // STR
        athletics: { label: "Атлетика", baseStat: "str", isProf: 0, bonus: 0 },
        // DEX
        acrobatics: { label: "Акробатика", baseStat: "dex", isProf: 0, bonus: 0 },
        "sleight of hand": { label: "Ловкость рук", baseStat: "dex", isProf: 0, bonus: 0 },
        stealth: { label: "Скрытность", baseStat: "dex", isProf: 0, bonus: 0 },
        // INT
        arcana: { label: "Магия", baseStat: "int", isProf: 0, bonus: 0 },
        history: { label: "История", baseStat: "int", isProf: 0, bonus: 0 },
        investigation: { label: "Анализ", baseStat: "int", isProf: 0, bonus: 0 },
        nature: { label: "Природа", baseStat: "int", isProf: 0, bonus: 0 },
        religion: { label: "Религия", baseStat: "int", isProf: 0, bonus: 0 },
        // WIS
        "animal handling": { label: "Уход за животными", baseStat: "wis", isProf: 0, bonus: 0 },
        insight: { label: "Проницательность", baseStat: "wis", isProf: 0, bonus: 0 },
        medicine: { label: "Медицина", baseStat: "wis", isProf: 0, bonus: 0 },
        perception: { label: "Восприятие", baseStat: "wis", isProf: 0, bonus: 0 },
        survival: { label: "Выживание", baseStat: "wis", isProf: 0, bonus: 0 },
        // CHA
        deception: { label: "Обман", baseStat: "cha", isProf: 0, bonus: 0 },
        intimidation: { label: "Запугивание", baseStat: "cha", isProf: 0, bonus: 0 },
        performance: { label: "Выступление", baseStat: "cha", isProf: 0, bonus: 0 },
        persuasion: { label: "Убеждение", baseStat: "cha", isProf: 0, bonus: 0 }
      },
      bonusesSkills: {},
      bonusesStats: {},
      spellsInfo: {
        base: { code: "" },
        save: { customModifier: "" },
        mod: { customModifier: "" }
      },
      spells: {},
      personality: {
        backstory: { value: "" },
        allies: { value: "" },
        traits: { value: "" },
        ideals: { value: "" },
        bonds: { value: "" },
        flaws: { value: "" }
      },
      notes: {
        details: {
          height: { value: "" },
          weight: { value: "" },
          age: { value: "" },
          eyes: { value: "" },
          skin: { value: "" },
          hair: { value: "" }
        },
        entries: []
      },
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

  // ================== CALC MODIFIERS ==================
  function getProfBonus(sheet) {
    return safeInt(sheet?.proficiency, 2) + safeInt(sheet?.proficiencyCustom, 0);
  }

  // ===== ВАЖНО: теперь "звезды" навыка = это boost (0/1/2), БЕЗ двойного суммирования =====
  // Поддержка старых файлов:
  // - если sheet.skills[skillKey].boostLevel есть -> используем его
  // - иначе используем sheet.skills[skillKey].isProf как уровень звезд (0/1/2), как у тебя в json
  function getSkillBoostLevel(sheet, skillKey) {
    const sk = sheet?.skills?.[skillKey];
    if (!sk || typeof sk !== "object") return 0;

    if (sk.boostLevel !== undefined && sk.boostLevel !== null) {
      const lvl = safeInt(sk.boostLevel, 0);
      return (lvl === 1 || lvl === 2) ? lvl : 0;
    }

    // fallback: isProf уже содержит 0/1/2 (звезды в файле)
    const legacy = safeInt(sk.isProf, 0);
    return (legacy === 1 || legacy === 2) ? legacy : 0;
  }

  function setSkillBoostLevel(sheet, skillKey, lvl) {
    if (!sheet.skills || typeof sheet.skills !== "object") sheet.skills = {};
    if (!sheet.skills[skillKey] || typeof sheet.skills[skillKey] !== "object") sheet.skills[skillKey] = {};
    sheet.skills[skillKey].boostLevel = lvl;

    // чтобы при повторной загрузке/экспорте и в других местах (если где-то ожидается isProf) не было рассинхрона:
    sheet.skills[skillKey].isProf = lvl;
  }

  function boostLevelToAdd(lvl, prof) {
    const p = safeInt(prof, 0);
    if (lvl === 1) return p;
    if (lvl === 2) return p * 2;
    return 0;
  }

  function boostLevelToStars(lvl) {
    if (lvl === 1) return "★";
    if (lvl === 2) return "★★";
    return "";
  }

  // Скилл-бонус: statMod + boostAdd (+ бонусы из sheet.skills[skillKey].bonus если есть)
  // (важно: никакого prof* по isProf — иначе снова будет двойное начисление)
  function calcSkillBonus(sheet, skillKey) {
    const skill = sheet?.skills?.[skillKey];
    const baseStat = skill?.baseStat;
    const statMod = safeInt(sheet?.stats?.[baseStat]?.modifier, 0);

    const extra = safeInt(skill?.bonus, 0); // если в файле есть отдельный бонус — учитываем
    const boostLevel = getSkillBoostLevel(sheet, skillKey);

    // ВАЖНО: звёзды навыков считаются от "владения" (proficiency):
    // 1 звезда = +proficiency, 2 звезды = +proficiency*2
    const prof = getProfBonus(sheet);

    return statMod + extra + boostLevelToAdd(boostLevel, prof);
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
    bonus += safeInt(sheet?.stats?.[statKey]?.checkBonus, 0);
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

      const boostLevel = getSkillBoostLevel(sheet, key);
      const bonus = calcSkillBonus(sheet, key);

      const statBlock = stats.find(s => s.k === baseStat);
      if (!statBlock) continue;

      statBlock.skills.push({
        key,
        label,
        bonus,
        boostLevel,
        boostStars: boostLevelToStars(boostLevel)
      });
    }
    stats.forEach(s => s.skills.sort((a,b) => a.label.localeCompare(b.label, 'ru')));

    // passive senses
    const passive = [
      { key: "perception", label: "Мудрость (Восприятие)" },
      { key: "insight", label: "Мудрость (Проницательность)" },
      { key: "investigation", label: "Интеллект (Анализ)" }
    ].map(x => {
      const skillBonus = (sheet?.skills?.[x.key]) ? calcSkillBonus(sheet, x.key) : 0;
      return { key: x.key, label: x.label, value: 10 + skillBonus };
    });

    // “прочие владения и заклинания” (редактируемый текст)
    const profDoc = sheet?.text?.prof?.value?.data;
    const profPlain = (sheet?.text?.profPlain?.value ?? sheet?.text?.profPlain ?? "");
    let profLines = tiptapToPlainLines(profDoc);
    // если нет tiptap-данных — используем редактируемый plain-text
    if ((!profLines || !profLines.length) && typeof profPlain === "string") {
      profLines = profPlain.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    const profText = (typeof profPlain === "string" && profPlain.length)
      ? profPlain
      : (profLines && profLines.length ? profLines.join("\n") : "");

    // personality (редактируемые поля)
    const personality = {
      backstory: get(sheet, "personality.backstory.value", get(sheet, "info.background.value", "")),
      allies: get(sheet, "personality.allies.value", ""),
      traits: get(sheet, "personality.traits.value", ""),
      ideals: get(sheet, "personality.ideals.value", ""),
      bonds: get(sheet, "personality.bonds.value", ""),
      flaws: get(sheet, "personality.flaws.value", "")
    };

    // notes (детали + список заметок)
    const notesDetails = {
      height: get(sheet, "notes.details.height.value", ""),
      weight: get(sheet, "notes.details.weight.value", ""),
      age: get(sheet, "notes.details.age.value", ""),
      eyes: get(sheet, "notes.details.eyes.value", ""),
      skin: get(sheet, "notes.details.skin.value", ""),
      hair: get(sheet, "notes.details.hair.value", "")
    };
    const notesEntries = Array.isArray(sheet?.notes?.entries) ? sheet.notes.entries : [];

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
      const total = safeNum(slotsRaw?.[k]?.value, 0);
      const filled = safeNum(slotsRaw?.[k]?.filled, 0);
      slots.push({ level: lvlN, total, filled });
    }

    const text = (sheet?.text && typeof sheet.text === "object") ? sheet.text : {};

    // ===== Custom spells storage (editable, with descriptions) =====
    // sheet.customSpells.levels[level] = [{ name, url, description, expanded }]
    if (!sheet.customSpells || typeof sheet.customSpells !== "object") sheet.customSpells = {};
    if (!Array.isArray(sheet.customSpells.levels)) sheet.customSpells.levels = Array.from({ length: 10 }, () => []);

    // Migration: ensure text container exists, and if custom list for a level is empty,
    // try to import from existing tiptap/plain spells-level-N.
    const spellsByLevel = [];
    for (let lvl = 0; lvl <= 9; lvl++) {
      const key = `spells-level-${lvl}`;
      if (!text[key] || typeof text[key] !== "object") text[key] = {};
      if (!text[key].plain || typeof text[key].plain !== "object") text[key].plain = { value: "" };

      // one-time migration from tiptap -> plain
      const curPlain = typeof text[key].plain.value === "string" ? text[key].plain.value : "";
      if (!curPlain) {
        const tiptapDoc = text[key]?.value?.data;
        const parsed = parseSpellsFromTiptap(tiptapDoc);
        if (parsed && parsed.length) {
          const lines = parsed.map(it => it.href ? `${it.text} | ${it.href}` : it.text);
          text[key].plain.value = lines.join("\n");
        }
      }

      // one-time migration from plain -> custom spells (name + url only)
      if (!Array.isArray(sheet.customSpells.levels[lvl])) sheet.customSpells.levels[lvl] = [];
      if (sheet.customSpells.levels[lvl].length === 0) {
        const plainLines = String(text[key].plain.value || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const imported = plainLines.map(line => {
          const parts = line.split("|").map(s => s.trim()).filter(Boolean);
          const name = cleanSpellName(parts[0] || "");
          const url = (parts[1] && /^https?:\/\//i.test(parts[1])) ? parts[1] : "";
          return { name, url, description: "", expanded: false };
        }).filter(x => x.name || x.url);
        if (imported.length) sheet.customSpells.levels[lvl] = imported;
      }

      spellsByLevel.push({ level: lvl, items: sheet.customSpells.levels[lvl] });
    }

    const weapons = Array.isArray(sheet?.weaponsList) ? sheet.weaponsList : [];
    const weaponsVm = weapons
      .map(w => ({ name: v(w?.name, "-"), atk: v(w?.mod, "-"), dmg: v(w?.dmg, "-") }))
      .filter(w => w.name && w.name !== "-");

    const coinsRaw = sheet?.coins && typeof sheet.coins === "object" ? sheet.coins : null;
    const coins = coinsRaw ? { cp: v(coinsRaw.cp, 0), sp: v(coinsRaw.sp, 0), ep: v(coinsRaw.ep, 0), gp: v(coinsRaw.gp, 0), pp: v(coinsRaw.pp, 0) } : null;

    return { name, cls, lvl, race, hp, hpCur, ac, spd, stats, passive, profLines, profText, personality, notesDetails, notesEntries, spellsInfo, slots, spellsByLevel, weapons: weaponsVm, coins };
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

  
  // ===== LIVE UI UPDATERS (без полного ререндера) =====
  function updateHeroChips(root, sheet) {
    if (!root || !sheet) return;
    const ac = safeInt(sheet?.vitality?.ac?.value, 0);
    const hp = safeInt(sheet?.vitality?.["hp-max"]?.value, 0);
    const hpCur = safeInt(sheet?.vitality?.["hp-current"]?.value, 0);
    const spd = safeInt(sheet?.vitality?.speed?.value, 0);

    const acEl = root.querySelector('[data-hero-val="ac"]');
    if (acEl) acEl.textContent = String(ac);

    const hpEl = root.querySelector('[data-hero-val="hp"]');
    if (hpEl) hpEl.textContent = `${hpCur}/${hp}`;

    const spdEl = root.querySelector('[data-hero-val="speed"]');
    if (spdEl) spdEl.textContent = String(spd);
  }

  function updateSkillsAndPassives(root, sheet) {
    if (!root || !sheet) return;

    // skills
    const dots = root.querySelectorAll('.lss-dot[data-skill-key]');
    dots.forEach(dot => {
      const key = dot.getAttribute('data-skill-key');
      if (!key) return;
      const row = dot.closest('.lss-skill-row');
      if (!row) return;
      const valEl = row.querySelector('.lss-skill-val');
      if (valEl) {
        const v = formatMod(calcSkillBonus(sheet, key));
        if (valEl.tagName === "INPUT" || valEl.tagName === "TEXTAREA") valEl.value = v;
        else valEl.textContent = v;
      }
    });

    // passives (10 + skill bonus)
    const passiveKeys = ["perception", "insight", "investigation"];
    passiveKeys.forEach(k => {
      const val = 10 + (sheet?.skills?.[k] ? calcSkillBonus(sheet, k) : 0);
      const el = root.querySelector(`.lss-passive-val[data-passive-val="${k}"]`);
      if (el) el.textContent = String(val);
    });
  }
function bindEditableInputs(root, player, canEdit) {
    if (!root || !player?.sheet?.parsed) return;

    const inputs = root.querySelectorAll("[data-sheet-path]");
    inputs.forEach(inp => {
      const path = inp.getAttribute("data-sheet-path");
      if (!path) return;

      // если в json есть tiptap-профи, а plain пустой — заполняем plain один раз, чтобы было что редактировать
      if (path === "text.profPlain.value") {
        const curPlain = getByPath(player.sheet.parsed, "text.profPlain.value");
        if (!curPlain) {
          const profDoc = player.sheet.parsed?.text?.prof?.value?.data;
          const lines = tiptapToPlainLines(profDoc);
          if (lines && lines.length) {
            setByPath(player.sheet.parsed, "text.profPlain.value", lines.join("\n"));
          }
        }
      }

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

        // live updates
        if (path === "proficiency") {
          updateSkillsAndPassives(root, player.sheet.parsed);
        }
        if (path === "vitality.ac.value" || path === "vitality.hp-max.value" || path === "vitality.hp-current.value" || path === "vitality.speed.value") {
          updateHeroChips(root, player.sheet.parsed);
        }

        scheduleSheetSave(player);
      };

      inp.addEventListener("input", handler);
      inp.addEventListener("change", handler);
    });
  }

  // ===== clickable dots binding (skills boost) =====
  function bindSkillBoostDots(root, player, canEdit) {
    if (!root || !player?.sheet?.parsed) return;

    const sheet = player.sheet.parsed;
    const dots = root.querySelectorAll(".lss-dot[data-skill-key]");
    dots.forEach(dot => {
      const skillKey = dot.getAttribute("data-skill-key");
      if (!skillKey) return;

      dot.classList.add("clickable");
      if (!canEdit) return;

      dot.addEventListener("click", (e) => {
        e.stopPropagation();

        const cur = getSkillBoostLevel(sheet, skillKey);
        const next = (cur === 0) ? 1 : (cur === 1) ? 2 : 0;

        setSkillBoostLevel(sheet, skillKey, next);

        dot.classList.remove("boost1", "boost2");
        if (next === 1) dot.classList.add("boost1");
        if (next === 2) dot.classList.add("boost2");

        const row = dot.closest(".lss-skill-row");
        if (row) {
          const valEl = row.querySelector(".lss-skill-val");
          if (valEl) {
            const v = formatMod(calcSkillBonus(sheet, skillKey));
            if (valEl.tagName === "INPUT" || valEl.tagName === "TEXTAREA") valEl.value = v;
            else valEl.textContent = v;
          }

          const nameEl = row.querySelector(".lss-skill-name");
          if (nameEl) {
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

  // ===== editable abilities / checks / saves / skill values =====
  function bindAbilityAndSkillEditors(root, player, canEdit) {
    if (!root || !player?.sheet?.parsed) return;
    const sheet = player.sheet.parsed;

    // ---- ability score edits (score -> modifier -> recompute) ----
    const scoreInputs = root.querySelectorAll('.lss-ability-score-input[data-stat-key]');
    scoreInputs.forEach(inp => {
      const statKey = inp.getAttribute('data-stat-key');
      if (!statKey) return;

      if (!canEdit) { inp.disabled = true; return; }

      const handler = () => {
        const score = safeInt(inp.value, 10);
        if (!sheet.stats) sheet.stats = {};
        if (!sheet.stats[statKey]) sheet.stats[statKey] = {};
        sheet.stats[statKey].score = score;
        sheet.stats[statKey].modifier = scoreToModifier(score);

        // обновляем связанные значения на экране
        updateDerivedForStat(root, sheet, statKey);
        updateSkillsAndPassives(root, sheet);

        scheduleSheetSave(player);
      };

      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });

    // ---- check/save edits (меняем bonus-часть, чтобы итог стал нужным) ----
    const pillInputs = root.querySelectorAll('.lss-pill-val-input[data-stat-key][data-kind]');
    pillInputs.forEach(inp => {
      const statKey = inp.getAttribute('data-stat-key');
      const kind = inp.getAttribute('data-kind');
      if (!statKey || !kind) return;

      if (!canEdit) { inp.disabled = true; return; }

      const handler = () => {
        const desired = parseModInput(inp.value, 0);
        const prof = getProfBonus(sheet);
        const statMod = safeInt(sheet?.stats?.[statKey]?.modifier, 0);

        if (kind === "save") {
          if (!sheet.saves) sheet.saves = {};
          if (!sheet.saves[statKey]) sheet.saves[statKey] = {};
          const isProf = !!sheet.saves[statKey].isProf;
          const base = statMod + (isProf ? prof : 0);
          sheet.saves[statKey].bonus = desired - base;
        }

        if (kind === "check") {
          if (!sheet.stats) sheet.stats = {};
          if (!sheet.stats[statKey]) sheet.stats[statKey] = {};
          const check = safeInt(sheet.stats[statKey].check, 0); // 0/1/2
          let base = statMod;
          if (check === 1) base += prof;
          if (check === 2) base += prof * 2;
          sheet.stats[statKey].checkBonus = desired - base;
        }

        // сразу обновим вывод (на случай странного ввода)
        updateDerivedForStat(root, sheet, statKey);
        updateSkillsAndPassives(root, sheet);

        scheduleSheetSave(player);
      };

      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });

    // ---- skill bonus edits (меняем skill.bonus так, чтобы итог стал нужным) ----
    const skillInputs = root.querySelectorAll('.lss-skill-val-input[data-skill-key]');
    skillInputs.forEach(inp => {
      const skillKey = inp.getAttribute('data-skill-key');
      if (!skillKey) return;

      if (!canEdit) { inp.disabled = true; return; }

      const handler = () => {
        const desired = parseModInput(inp.value, 0);
        if (!sheet.skills) sheet.skills = {};
        if (!sheet.skills[skillKey]) sheet.skills[skillKey] = {};

        const baseStat = sheet.skills[skillKey].baseStat;
        const statMod = safeInt(sheet?.stats?.[baseStat]?.modifier, 0);
        const prof = getProfBonus(sheet);
        const boostLevel = getSkillBoostLevel(sheet, skillKey);
        const boostAdd = boostLevelToAdd(boostLevel, prof);

        // extra бонус внутри навыка
        sheet.skills[skillKey].bonus = desired - statMod - boostAdd;

        // обновляем навык и пассивки
        updateSkillsAndPassives(root, sheet);

        scheduleSheetSave(player);
      };

      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });
  }

  // ===== Notes tab: add / rename / toggle / delete, text editing =====
  function bindNotesEditors(root, player, canEdit) {
    if (!root || !player?.sheet?.parsed) return;

    const sheet = player.sheet.parsed;
    if (!sheet.notes || typeof sheet.notes !== "object") sheet.notes = {};
    if (!sheet.notes.details || typeof sheet.notes.details !== "object") sheet.notes.details = {};
    if (!Array.isArray(sheet.notes.entries)) sheet.notes.entries = [];

    const main = root.querySelector("#sheet-main");
    if (!main) return;

    // add note button
    const addBtn = main.querySelector("[data-note-add]");
    if (addBtn) {
      if (!canEdit) addBtn.disabled = true;
      addBtn.addEventListener("click", () => {
        if (!canEdit) return;

        // choose next Заметка-N
        const titles = sheet.notes.entries.map(e => String(e?.title || "")).filter(Boolean);
        let maxN = 0;
        for (const t of titles) {
          const mm = /^Заметка-(\d+)$/i.exec(t.trim());
          if (mm) maxN = Math.max(maxN, parseInt(mm[1], 10) || 0);
        }
        const nextN = maxN + 1;

        sheet.notes.entries.push({ title: `Заметка-${nextN}`, text: "", collapsed: false });
        scheduleSheetSave(player);

        // rerender current tab to show new note
        const freshVm = toViewModel(sheet, player.name);
        main.innerHTML = renderNotesTab(freshVm);
        bindEditableInputs(root, player, canEdit);
        bindSkillBoostDots(root, player, canEdit);
        bindAbilityAndSkillEditors(root, player, canEdit);
        bindNotesEditors(root, player, canEdit);
      });
    }

    // title edit
    const titleInputs = main.querySelectorAll("input[data-note-title]");
    titleInputs.forEach(inp => {
      const idx = parseInt(inp.getAttribute("data-note-title") || "", 10);
      if (!Number.isFinite(idx)) return;
      if (!canEdit) { inp.disabled = true; return; }

      inp.addEventListener("input", () => {
        if (!sheet.notes.entries[idx]) return;
        sheet.notes.entries[idx].title = inp.value;
        scheduleSheetSave(player);
      });
    });

    // text edit
    const textAreas = main.querySelectorAll("textarea[data-note-text]");
    textAreas.forEach(ta => {
      const idx = parseInt(ta.getAttribute("data-note-text") || "", 10);
      if (!Number.isFinite(idx)) return;
      if (!canEdit) { ta.disabled = true; return; }

      ta.addEventListener("input", () => {
        if (!sheet.notes.entries[idx]) return;
        sheet.notes.entries[idx].text = ta.value;
        scheduleSheetSave(player);
      });
    });

    // toggle collapse
    const toggleBtns = main.querySelectorAll("[data-note-toggle]");
    toggleBtns.forEach(btn => {
      const idx = parseInt(btn.getAttribute("data-note-toggle") || "", 10);
      if (!Number.isFinite(idx)) return;
      if (!canEdit) btn.disabled = true;

      btn.addEventListener("click", () => {
        if (!sheet.notes.entries[idx]) return;
        sheet.notes.entries[idx].collapsed = !sheet.notes.entries[idx].collapsed;
        scheduleSheetSave(player);

        const freshVm = toViewModel(sheet, player.name);
        main.innerHTML = renderNotesTab(freshVm);
        bindEditableInputs(root, player, canEdit);
        bindSkillBoostDots(root, player, canEdit);
        bindAbilityAndSkillEditors(root, player, canEdit);
        bindNotesEditors(root, player, canEdit);
      });
    });

    // delete
    const delBtns = main.querySelectorAll("[data-note-del]");
    delBtns.forEach(btn => {
      const idx = parseInt(btn.getAttribute("data-note-del") || "", 10);
      if (!Number.isFinite(idx)) return;
      if (!canEdit) btn.disabled = true;

      btn.addEventListener("click", () => {
        if (!canEdit) return;
        if (!sheet.notes.entries[idx]) return;
        sheet.notes.entries.splice(idx, 1);
        scheduleSheetSave(player);

        const freshVm = toViewModel(sheet, player.name);
        main.innerHTML = renderNotesTab(freshVm);
        bindEditableInputs(root, player, canEdit);
        bindSkillBoostDots(root, player, canEdit);
        bindAbilityAndSkillEditors(root, player, canEdit);
        bindNotesEditors(root, player, canEdit);
      });
    });
  }
  // ===== Slots (spell slots) editors =====
function bindSlotEditors(root, player, canEdit) {
  if (!root || !player?.sheet?.parsed) return;
  const sheet = player.sheet.parsed;
  if (!sheet.spells || typeof sheet.spells !== "object") sheet.spells = {};

  function ensureKey(lvl) {
    const key = `slots-${lvl}`;
    if (!sheet.spells[key] || typeof sheet.spells[key] !== "object") {
      sheet.spells[key] = { value: 0, filled: 0 };
    }
    // normalize nested LSS objects
    const total = Math.max(0, Math.min(12, safeNum(sheet.spells[key].value, 0)));
    const filled = Math.max(0, Math.min(12, safeNum(sheet.spells[key].filled, 0)));
    sheet.spells[key].value = total;
    sheet.spells[key].filled = filled;
    return { key, total, filled };
  }

  function paintDots(lvl) {
    const st = ensureKey(lvl);
    const remaining = Math.max(0, st.total - st.filled);

    const wrap = root.querySelector(`.slot-dots[data-slot-dots="${lvl}"]`);
    if (!wrap) return;

    const dots = Array.from({ length: st.total }).map((_, idx) => {
      const on = idx < remaining;
      return `<span class="slot-dot ${on ? 'on' : ''}" data-slot-level="${lvl}" data-slot-idx="${idx}"></span>`;
    }).join('');

    wrap.innerHTML = dots || `<span class="slot-dots-empty">—</span>`;

    // bind dots clicks after rerender
    const newDots = wrap.querySelectorAll('.slot-dot[data-slot-level][data-slot-idx]');
    newDots.forEach(dot => {
      dot.classList.add('clickable');
      if (!canEdit) return;
      if (dot.dataset.boundClick === "1") return;
      dot.dataset.boundClick = "1";
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const lvl2 = safeInt(dot.getAttribute('data-slot-level'), 0);
        if (!lvl2) return;
        const st2 = ensureKey(lvl2);
        const remaining2 = Math.max(0, st2.total - st2.filled);
        const isOn2 = dot.classList.contains('on');
        if (isOn2) {
          if (remaining2 <= 0) return;
          sheet.spells[st2.key].filled = Math.min(12, safeNum(sheet.spells[st2.key].filled, 0) + 1);
        } else {
          sheet.spells[st2.key].filled = Math.max(0, safeNum(sheet.spells[st2.key].filled, 0) - 1);
        }
        paintDots(lvl2);
        scheduleSheetSave(player);
      });
    });

    const inp = root.querySelector(`.slot-current-input[data-slot-level="${lvl}"]`);
    if (inp) inp.value = String(remaining);
  }

  // editable remaining inputs
  const inputs = root.querySelectorAll(".slot-current-input[data-slot-level]");
  inputs.forEach(inp => {
    const lvl = safeInt(inp.getAttribute("data-slot-level"), 0);
    if (!lvl) return;

    if (!canEdit) { inp.disabled = true; return; }

    const handler = () => {
      const desired = Math.max(0, Math.min(12, safeInt(inp.value, 0)));
      const st = ensureKey(lvl);

      // UX: when user sets remaining manually, treat it as new total and reset usage
      st.total = desired;
      st.filled = 0;
      sheet.spells[st.key].value = desired;
      sheet.spells[st.key].filled = 0;

      paintDots(lvl);
      scheduleSheetSave(player);
    };

    inp.addEventListener("input", handler);
    inp.addEventListener("change", handler);
  });

  // clickable dots (use/restore a slot)
  const dots = root.querySelectorAll('.slot-dot[data-slot-level][data-slot-idx]');
  dots.forEach(dot => {
    dot.classList.add('clickable');
    if (!canEdit) return;
    if (dot.dataset.boundClick === '1') return;
    dot.dataset.boundClick = '1';

    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const lvl = safeInt(dot.getAttribute('data-slot-level'), 0);
      if (!lvl) return;
      const st = ensureKey(lvl);
      const remaining = Math.max(0, st.total - st.filled);
      const isOn = dot.classList.contains('on');

      // toggle behavior: on -> spend (filled++), off -> restore (filled--)
      if (isOn) {
        if (remaining <= 0) return;
        sheet.spells[st.key].filled = Math.min(12, safeNum(sheet.spells[st.key].filled, 0) + 1);
      } else {
        sheet.spells[st.key].filled = Math.max(0, safeNum(sheet.spells[st.key].filled, 0) - 1);
      }

      paintDots(lvl);
      scheduleSheetSave(player);
    });
  });
}



// ===== Custom Spells (list + add panel) editors =====
function bindCustomSpellsEditors(root, player, canEdit) {
  if (!root || !player?.sheet?.parsed) return;
  const sheet = player.sheet.parsed;
  if (!sheet.customSpells || typeof sheet.customSpells !== 'object') sheet.customSpells = {};
  if (!Array.isArray(sheet.customSpells.levels)) sheet.customSpells.levels = Array.from({ length: 10 }, () => []);

  const main = root.querySelector('#sheet-main');

  const rerenderSpells = () => {
    if (!main) return;
    const freshVm = toViewModel(sheet, player.name);
    main.innerHTML = renderSpellsTab(freshVm);
    bindEditableInputs(root, player, canEdit);
    bindSkillBoostDots(root, player, canEdit);
    bindAbilityAndSkillEditors(root, player, canEdit);
    bindNotesEditors(root, player, canEdit);
    bindSlotEditors(root, player, canEdit);
    bindCustomSpellsEditors(root, player, canEdit);
  };

  // open add panel
  root.querySelectorAll('[data-spell-add-level]').forEach(btn => {
    const lvl = safeInt(btn.getAttribute('data-spell-add-level'), -1);
    if (lvl < 0 || lvl > 9) return;
    if (!canEdit) { btn.disabled = true; return; }
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';

    btn.addEventListener('click', () => {
      const panel = root.querySelector(`.spell-add-panel[data-add-panel="${lvl}"]`);
      if (panel) panel.classList.toggle('hidden');
    });
  });

  // cancel
  root.querySelectorAll('[data-add-cancel]').forEach(btn => {
    const lvl = safeInt(btn.getAttribute('data-add-cancel'), -1);
    if (lvl < 0 || lvl > 9) return;
    if (!canEdit) { btn.disabled = true; return; }
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';

    btn.addEventListener('click', () => {
      const panel = root.querySelector(`.spell-add-panel[data-add-panel="${lvl}"]`);
      if (panel) panel.classList.add('hidden');
    });
  });

  // tabs
  root.querySelectorAll('.spell-add-tab[data-add-tab][data-add-level]').forEach(tab => {
    const lvl = safeInt(tab.getAttribute('data-add-level'), -1);
    const mode = tab.getAttribute('data-add-tab');
    if (lvl < 0 || lvl > 9 || !mode) return;

    if (tab.dataset.boundClick === '1') return;
    tab.dataset.boundClick = '1';

    tab.addEventListener('click', () => {
      const panel = root.querySelector(`.spell-add-panel[data-add-panel="${lvl}"]`);
      if (!panel) return;
      panel.querySelectorAll('.spell-add-tab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      panel.querySelectorAll(`.spell-add-mode[data-add-level="${lvl}"]`).forEach(box => {
        const m = box.getAttribute('data-add-mode');
        if (m === mode) box.classList.remove('hidden');
        else box.classList.add('hidden');
      });
    });
  });

  // add via link
  root.querySelectorAll('[data-add-confirm-link]').forEach(btn => {
    const lvl = safeInt(btn.getAttribute('data-add-confirm-link'), -1);
    if (lvl < 0 || lvl > 9) return;
    if (!canEdit) { btn.disabled = true; return; }
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';

    btn.addEventListener('click', async () => {
      const urlEl = root.querySelector(`input[data-add-url="${lvl}"]`);
      const url = (urlEl?.value || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        alert('Вставь корректную ссылку (http/https).');
        return;
      }

      try {
        btn.disabled = true;
        const resp = await fetch(`/api/spellmeta?url=${encodeURIComponent(url)}`);
        if (!resp.ok) throw new Error('bad response');
        const data = await resp.json();
        const name = cleanSpellName(data?.name || '');
        const desc = String(data?.description || '').trim();

        if (!Array.isArray(sheet.customSpells.levels[lvl])) sheet.customSpells.levels[lvl] = [];
        sheet.customSpells.levels[lvl].push({
          name: name || url,
          url,
          description: desc,
          expanded: false
        });
        scheduleSheetSave(player);
        rerenderSpells();
      } catch (e) {
        console.error(e);
        alert('Не удалось получить описание с dnd.su. Проверь ссылку.');
      } finally {
        btn.disabled = false;
      }
    });
  });

  // add manual
  root.querySelectorAll('[data-add-confirm-manual]').forEach(btn => {
    const lvl = safeInt(btn.getAttribute('data-add-confirm-manual'), -1);
    if (lvl < 0 || lvl > 9) return;
    if (!canEdit) { btn.disabled = true; return; }
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';

    btn.addEventListener('click', () => {
      const nameEl = root.querySelector(`input[data-add-name="${lvl}"]`);
      const descEl = root.querySelector(`textarea[data-add-desc="${lvl}"]`);
      const name = cleanSpellName((nameEl?.value || '').trim());
      const description = (descEl?.value || '').trim();
      if (!name) {
        alert('Укажи название заклинания.');
        return;
      }

      if (!Array.isArray(sheet.customSpells.levels[lvl])) sheet.customSpells.levels[lvl] = [];
      sheet.customSpells.levels[lvl].push({ name, url: '', description, expanded: true });
      scheduleSheetSave(player);
      rerenderSpells();
    });
  });

  // toggle description
  root.querySelectorAll('[data-spell-desc-toggle]').forEach(btn => {
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';

    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-spell-desc-toggle') || '';
      const [lvlS, idxS] = key.split(':');
      const lvl = safeInt(lvlS, -1);
      const idx = safeInt(idxS, -1);
      if (lvl < 0 || lvl > 9) return;
      if (!sheet.customSpells.levels[lvl]?.[idx]) return;
      sheet.customSpells.levels[lvl][idx].expanded = !sheet.customSpells.levels[lvl][idx].expanded;
      scheduleSheetSave(player);
      const box = root.querySelector(`[data-spell-desc="${lvl}:${idx}"]`);
      if (box) box.classList.toggle('open');
    });
  });

  // delete
  root.querySelectorAll('[data-spell-del]').forEach(btn => {
    if (!canEdit) { btn.disabled = true; return; }
    if (btn.dataset.boundClick === '1') return;
    btn.dataset.boundClick = '1';

    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-spell-del') || '';
      const [lvlS, idxS] = key.split(':');
      const lvl = safeInt(lvlS, -1);
      const idx = safeInt(idxS, -1);
      if (lvl < 0 || lvl > 9) return;
      if (!Array.isArray(sheet.customSpells.levels[lvl])) return;
      sheet.customSpells.levels[lvl].splice(idx, 1);
      scheduleSheetSave(player);
      rerenderSpells();
    });
  });

  // description edit
  root.querySelectorAll('textarea[data-spell-desc-lvl][data-spell-desc-idx]').forEach(ta => {
    const lvl = safeInt(ta.getAttribute('data-spell-desc-lvl'), -1);
    const idx = safeInt(ta.getAttribute('data-spell-desc-idx'), -1);
    if (lvl < 0 || lvl > 9 || idx < 0) return;
    if (!canEdit) { ta.disabled = true; return; }
    if (ta.dataset.boundInput === '1') return;
    ta.dataset.boundInput = '1';

    ta.addEventListener('input', () => {
      if (!sheet.customSpells.levels[lvl]?.[idx]) return;
      sheet.customSpells.levels[lvl][idx].description = ta.value;
      scheduleSheetSave(player);
    });
  });
}

function updateDerivedForStat(root, sheet, statKey) {
    if (!root || !sheet || !statKey) return;

    // check/save inputs inside this stat block
    const checkEl = root.querySelector(`.lss-pill-val-input[data-stat-key="${statKey}"][data-kind="check"]`);
    if (checkEl) checkEl.value = formatMod(calcCheckBonus(sheet, statKey));

    const saveEl = root.querySelector(`.lss-pill-val-input[data-stat-key="${statKey}"][data-kind="save"]`);
    if (saveEl) saveEl.value = formatMod(calcSaveBonus(sheet, statKey));

    // skills under this stat: just refresh all skills UI
    const scoreEl = root.querySelector(`.lss-ability-score-input[data-stat-key="${statKey}"]`);
    if (scoreEl && sheet?.stats?.[statKey]?.score != null) {
      scoreEl.value = String(sheet.stats[statKey].score);
    }
  }



  // ================== RENDER
  // ================== RENDER ==================
  function renderAbilitiesGrid(vm) {
    const blocks = vm.stats.map(s => {
      const skillRows = (s.skills || []).map(sk => {
        const dotClass = (sk.boostLevel === 1) ? "boost1" : (sk.boostLevel === 2) ? "boost2" : "";
        return `
          <div class="lss-skill-row">
            <div class="lss-skill-left">
              <span class="lss-dot ${dotClass}" data-skill-key="${escapeHtml(sk.key)}"></span>
              <span class="lss-skill-name">
                ${escapeHtml(sk.label)}
                <span class="lss-boost">${sk.boostStars ? ` ${escapeHtml(sk.boostStars)}` : ""}</span>
              </span>
            </div>
            <input class="lss-skill-val lss-skill-val-input" type="text" value="${escapeHtml(formatMod(sk.bonus))}" data-skill-key="${escapeHtml(sk.key)}">
          </div>
        `;
      }).join("");

      return `
        <div class="lss-ability">
          <div class="lss-ability-head">
            <div class="lss-ability-name">${escapeHtml(s.label.toUpperCase())}</div>
            <input class="lss-ability-score lss-ability-score-input" type="number" min="1" max="30" value="${escapeHtml(String(s.score))}" data-stat-key="${escapeHtml(s.k)}">
          </div>

          <div class="lss-ability-actions">
            <div class="lss-pill">
              <span class="lss-pill-label">ПРОВЕРКА</span>
              <input class="lss-pill-val lss-pill-val-input" type="text" value="${escapeHtml(formatMod(s.check))}" data-stat-key="${escapeHtml(s.k)}" data-kind="check">
            </div>
            <div class="lss-pill">
              <span class="lss-pill-label">СПАСБРОСОК</span>
              <input class="lss-pill-val lss-pill-val-input" type="text" value="${escapeHtml(formatMod(s.save))}" data-stat-key="${escapeHtml(s.k)}" data-kind="save">
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
      <div class="lss-passive-row" data-passive-key="${escapeHtml(String(p.key || ''))}">
        <div class="lss-passive-val" data-passive-val="${escapeHtml(String(p.key || ''))}">${escapeHtml(String(p.value))}</div>
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
    // всегда показываем блок, даже без загруженного файла
    return `
      <div class="lss-profbox">
        <div class="lss-passives-title">ПРОЧИЕ ВЛАДЕНИЯ И ЗАКЛИНАНИЯ</div>
        <textarea class="lss-prof-text" rows="8" data-sheet-path="text.profPlain.value" placeholder="Например: владения, инструменты, языки, заклинания...">${escapeHtml(vm.profText || "")}</textarea>
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
            <div class="kv"><div class="k">Владение</div><div class="v"><input type="number" min="0" max="10" data-sheet-path="proficiency" style="width:90px"></div></div>
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
    const slots = Array.isArray(vm?.slots) ? vm.slots : [];
    if (!slots.length) return `<div class="sheet-note">Ячейки заклинаний не указаны.</div>`;

    const countByLevel = {};
    (vm.spellsByLevel || []).forEach(b => {
      const lvl = Number(b.level);
      if (!Number.isFinite(lvl)) return;
      countByLevel[lvl] = Array.isArray(b.items) ? b.items.length : 0;
    });

    const cells = slots.slice(0, 9).map(s => {
      const total = Math.max(0, Math.min(12, safeNum(s.total, 0)));
      const used = Math.max(0, Math.min(12, safeNum(s.filled, 0)));
      const remaining = Math.max(0, total - used);
      const spellsCount = countByLevel[s.level] || 0;

      const dots = Array.from({ length: total }).map((_, idx) => {
        const on = idx < remaining;
        return `<span class="slot-dot ${on ? 'on' : ''}" data-slot-level="${s.level}" data-slot-idx="${idx}"></span>`;
      }).join('');

      return `
        <div class="slot-cell" data-slot-level="${s.level}">
          <div class="slot-top">
            <div class="slot-level">Ур. ${s.level}</div>
            <div class="slot-nums">
              <span class="slot-spells" title="Кол-во заклинаний уровня">${spellsCount}</span>
              <span class="slot-sep">/</span>
              <input class="slot-current slot-current-input" type="number" min="0" max="12" value="${escapeHtml(String(remaining))}" data-slot-level="${s.level}" title="Доступно ячеек (редактируемое)">
            </div>
          </div>
          <div class="slot-dots" data-slot-dots="${s.level}">
            ${dots || `<span class="slot-dots-empty">—</span>`}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="slots-frame">
        <div class="slots-grid">${cells}</div>
      </div>
    `;
  }

  function renderSpellsByLevel(vm) {
    const blocks = [];
    const levels = Array.isArray(vm?.spellsByLevel) ? vm.spellsByLevel : [];
    const byLevel = new Map(levels.map(x => [Number(x.level), x]));

    for (let lvl = 0; lvl <= 9; lvl++) {
      const b = byLevel.get(lvl) || { level: lvl, items: [] };
      const title = (lvl === 0) ? 'Заговоры (0)' : `Уровень ${lvl}`;
      const addLabel = (lvl === 0) ? 'Добавить заговор' : 'Добавить заклинание';

      const itemsHtml = (b.items || []).map((it, idx) => {
        const name = cleanSpellName(it?.name || (it?.url || ''));
        const url = (it?.url && /^https?:\/\//i.test(it.url)) ? it.url : '';

        const titleEl = url
          ? `<a class="spell-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name || url)}</a>`
          : `<span class="spell-url">${escapeHtml(name || '(без ссылки)')}</span>`;

        return `
          <div class="spell-item" data-spell-lvl="${lvl}" data-spell-idx="${idx}">
            <div class="spell-item-top">
              ${titleEl}
              <div class="spell-item-actions">
                <button class="note-btn" data-spell-desc-toggle="${lvl}:${idx}">Описание</button>
                <button class="note-btn danger" data-spell-del="${lvl}:${idx}">Удалить</button>
              </div>
            </div>

            <div class="spell-desc ${it?.expanded ? 'open' : ''}" data-spell-desc="${lvl}:${idx}">
              <div class="spell-edit-grid onecol">
                <label class="spell-edit-label">Описание</label>
                <textarea class="spell-edit-desc" rows="10" data-spell-desc-lvl="${lvl}" data-spell-desc-idx="${idx}" placeholder="Описание...">${escapeHtml(it?.description || '')}</textarea>
              </div>
            </div>
          </div>
        `;
      }).join('');

      blocks.push(`
        <div class="sheet-card fullwidth">
          <div class="spells-level-header">
            <h4>${escapeHtml(title)}</h4>
            <button class="note-add-btn" data-spell-add-level="${lvl}">${escapeHtml(addLabel)}</button>
          </div>

          <div class="spell-add-panel hidden" data-add-panel="${lvl}">
            <div class="spell-add-tabs">
              <button class="spell-add-tab active" data-add-tab="link" data-add-level="${lvl}">Ссылка</button>
              <button class="spell-add-tab" data-add-tab="manual" data-add-level="${lvl}">Вручную</button>
            </div>

            <div class="spell-add-body">
              <div class="spell-add-mode" data-add-mode="link" data-add-level="${lvl}">
                <input class="spell-add-input" type="url" placeholder="https://dnd.su/spells/..." data-add-url="${lvl}">
                <div class="spell-add-actions">
                  <button class="note-btn" data-add-confirm-link="${lvl}">Добавить</button>
                  <button class="note-btn" data-add-cancel="${lvl}">Отмена</button>
                </div>
                <div class="sheet-note">Название и описание подтянутся с dnd.su автоматически.</div>
              </div>

              <div class="spell-add-mode hidden" data-add-mode="manual" data-add-level="${lvl}">
                <input class="spell-add-input" type="text" placeholder="Название заклинания" data-add-name="${lvl}">
                <textarea class="spell-add-text" rows="8" placeholder="Описание заклинания" data-add-desc="${lvl}"></textarea>
                <div class="spell-add-actions">
                  <button class="note-btn" data-add-confirm-manual="${lvl}">Добавить</button>
                  <button class="note-btn" data-add-cancel="${lvl}">Отмена</button>
                </div>
              </div>
            </div>
          </div>

          <div class="spells-level-body">
            ${itemsHtml || `<div class="sheet-note">Пусто. Нажми «${escapeHtml(addLabel)}».</div>`}
          </div>
        </div>
      `);
    }

    return `<div class="spells-levels-col">${blocks.join('')}</div>`;
  }

  function renderSpellsTab(vm) {
    const save = vm.spellsInfo?.save || "-";
    const mod = vm.spellsInfo?.mod || "-";

    return `
      <div class="sheet-section">
        <h3>Заклинания</h3>

        <div class="sheet-card spells-metrics-card fullwidth">
          <div class="spell-metrics">
            <div class="spell-metric">
              <div class="spell-metric-label">СЛ спасброска</div>
              <div class="spell-metric-val">${escapeHtml(String(save))}</div>
            </div>
            <div class="spell-metric">
              <div class="spell-metric-label">Бонус атаки</div>
              <div class="spell-metric-val">${escapeHtml(String(mod))}</div>
            </div>
          </div>
        </div>

        <div class="sheet-card fullwidth" style="margin-top:10px;">
          <h4>Ячейки</h4>
          ${renderSlots(vm)}
          <div class="sheet-note" style="margin-top:6px;">
            Формат: <b>кол-во заклинаний</b> / <b>доступно ячеек</b> (второе число редактируемое, max 12). Кружки показывают доступные ячейки.
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

  function renderPersonalityTab(vm) {
    return `
      <div class="sheet-section">
        <h3>Личность</h3>

        <div class="sheet-grid-2">
          <div class="sheet-card">
            <h4>Внешность</h4>
            <div class="notes-details-grid">
              <div class="kv"><div class="k">Рост</div><div class="v"><input type="text" data-sheet-path="notes.details.height.value" style="width:140px"></div></div>
              <div class="kv"><div class="k">Вес</div><div class="v"><input type="text" data-sheet-path="notes.details.weight.value" style="width:140px"></div></div>
              <div class="kv"><div class="k">Возраст</div><div class="v"><input type="text" data-sheet-path="notes.details.age.value" style="width:140px"></div></div>
              <div class="kv"><div class="k">Глаза</div><div class="v"><input type="text" data-sheet-path="notes.details.eyes.value" style="width:140px"></div></div>
              <div class="kv"><div class="k">Кожа</div><div class="v"><input type="text" data-sheet-path="notes.details.skin.value" style="width:140px"></div></div>
              <div class="kv"><div class="k">Волосы</div><div class="v"><input type="text" data-sheet-path="notes.details.hair.value" style="width:140px"></div></div>
            </div>
          </div>

          <div class="sheet-card">
            <h4>Предыстория персонажа</h4>
            <textarea class="sheet-textarea" rows="6" data-sheet-path="personality.backstory.value" placeholder="Кратко опиши предысторию..."></textarea>
          </div>

          <div class="sheet-card">
            <h4>Союзники и организации</h4>
            <textarea class="sheet-textarea" rows="6" data-sheet-path="personality.allies.value" placeholder="Союзники, контакты, гильдии..."></textarea>
          </div>

          <div class="sheet-card">
            <h4>Черты характера</h4>
            <textarea class="sheet-textarea" rows="5" data-sheet-path="personality.traits.value"></textarea>
          </div>

          <div class="sheet-card">
            <h4>Идеалы</h4>
            <textarea class="sheet-textarea" rows="5" data-sheet-path="personality.ideals.value"></textarea>
          </div>

          <div class="sheet-card">
            <h4>Привязанности</h4>
            <textarea class="sheet-textarea" rows="5" data-sheet-path="personality.bonds.value"></textarea>
          </div>

          <div class="sheet-card">
            <h4>Слабости</h4>
            <textarea class="sheet-textarea" rows="5" data-sheet-path="personality.flaws.value"></textarea>
          </div>
        </div>
      </div>
    `;
  }

  function renderNotesTab(vm) {
    const entries = Array.isArray(vm?.notesEntries) ? vm.notesEntries : [];
    const renderEntry = (e, idx) => {
      const title = (e && typeof e.title === "string" && e.title) ? e.title : `Заметка-${idx + 1}`;
      const text = (e && typeof e.text === "string") ? e.text : "";
      const collapsed = !!(e && e.collapsed);
      return `
        <div class="note-card" data-note-idx="${idx}">
          <div class="note-header">
            <input class="note-title" type="text" value="${escapeHtml(title)}" data-note-title="${idx}" />
            <div class="note-actions">
              <button class="note-btn" data-note-toggle="${idx}">${collapsed ? "Показать" : "Скрыть"}</button>
              <button class="note-btn danger" data-note-del="${idx}">Удалить</button>
            </div>
          </div>
          <div class="note-body ${collapsed ? "collapsed" : ""}">
            <textarea class="sheet-textarea note-text" rows="6" data-note-text="${idx}" placeholder="Текст заметки...">${escapeHtml(text)}</textarea>
          </div>
        </div>
      `;
    };

    return `
      <div class="sheet-section">
        <h3>Заметки</h3>

        <div class="sheet-card notes-fullwidth">
          <h4>Быстрые заметки</h4>
          <div class="notes-toolbar">
            <button class="note-add-btn" data-note-add>Добавить заметку</button>
          </div>
          <div class="notes-list">
            ${entries.length ? entries.map(renderEntry).join("") : `<div class="sheet-note">Пока нет заметок. Нажми «Добавить заметку».</div>`}
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
    if (tabId === "personality") return renderPersonalityTab(vm);
    if (tabId === "notes") return renderNotesTab(vm);
    return `<div class="sheet-note">Раздел в разработке</div>`;
  }

  // ================== RENDER MODAL ==================
  function renderSheetModal(player, opts = {}) {
    if (!sheetTitle || !sheetSubtitle || !sheetActions || !sheetContent) return;
    if (!ctx) return;

    const force = !!opts.force;
    // Если пользователь сейчас редактирует что-то внутри модалки — не перерисовываем, чтобы не прыгал скролл/вкладка.
    if (!force && player?.id && isModalBusy(player.id)) {
      return;
    }

    // сохраняем текущую вкладку/скролл перед любым ререндером
    captureUiStateFromDom(player);

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
          player.sheet = sheet;
          ctx.sendMessage({ type: "setPlayerSheet", id: player.id, sheet });

          // Мгновенно обновляем UI (не ждём round-trip через сервер)
          // и при этом не сбрасываем вкладку/скролл.
          markModalInteracted(player.id);
          renderSheetModal(player, { force: true });

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
      { id: "inventory", label: "Инвентарь" },
      { id: "personality", label: "Личность" },
      { id: "notes", label: "Заметки" }
    ];

    // восстановление вкладки (если была)
    const st = player?.id ? getUiState(player.id) : null;
    if (!player._activeSheetTab) player._activeSheetTab = (st?.activeTab || "basic");
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
            <div class="sheet-chip" data-hero="ac"><div class="k">AC</div><div class="v" data-hero-val="ac">${escapeHtml(String(vm.ac))}</div></div>
            <div class="sheet-chip" data-hero="hp"><div class="k">HP</div><div class="v" data-hero-val="hp">${escapeHtml(String(vm.hpCur))}/${escapeHtml(String(vm.hp))}</div></div>
            <div class="sheet-chip" data-hero="speed"><div class="k">Speed</div><div class="v" data-hero-val="speed">${escapeHtml(String(vm.spd))}</div></div>
          </div>
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

    // восстанавливаем скролл после рендера
    restoreUiStateToDom(player);

    // отмечаем взаимодействие, чтобы state-обновления не ломали скролл
    const mainEl = sheetContent.querySelector('#sheet-main');
    mainEl?.addEventListener('scroll', () => {
      markModalInteracted(player.id);
      // и сохраняем текущий скролл в uiState
      captureUiStateFromDom(player);
    }, { passive: true });

    sheetContent.addEventListener('pointerdown', () => markModalInteracted(player.id), { passive: true });
    sheetContent.addEventListener('keydown', () => markModalInteracted(player.id), { passive: true });

    bindEditableInputs(sheetContent, player, canEdit);
    bindSkillBoostDots(sheetContent, player, canEdit);
    bindAbilityAndSkillEditors(sheetContent, player, canEdit);
    bindNotesEditors(sheetContent, player, canEdit);
    bindSlotEditors(sheetContent, player, canEdit);
    bindCustomSpellsEditors(sheetContent, player, canEdit);
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
          bindAbilityAndSkillEditors(sheetContent, player, canEdit);
          bindNotesEditors(sheetContent, player, canEdit);
          bindSlotEditors(sheetContent, player, canEdit);
          bindCustomSpellsEditors(sheetContent, player, canEdit);
        }
      });
    });

    // (скролл/взаимодействия уже повешены выше)
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
