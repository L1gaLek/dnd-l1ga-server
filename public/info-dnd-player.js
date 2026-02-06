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

  // Иногда числа приходят в виде { value: n }
  function numLike(x, fallback = 0) {
    if (x && typeof x === "object" && "value" in x) return safeInt(x.value, fallback);
    return safeInt(x, fallback);
  }
  function setMaybeObjField(obj, field, n) {
    if (!obj || typeof obj !== "object") return;
    const cur = obj[field];
    if (cur && typeof cur === "object" && ("value" in cur)) {
      cur.value = n;
    } else {
      obj[field] = n;
    }
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



  // ================== POPUP HELPERS (внутренние окна) ==================
  function openPopup({ title="", bodyHtml="" } = {}) {
    const overlay = document.createElement("div");
    overlay.className = "popup-overlay";
    overlay.innerHTML = `
      <div class="popup-card" role="dialog" aria-modal="true">
        <div class="popup-head">
          <div class="popup-title">${escapeHtml(String(title||""))}</div>
          <button class="popup-close" type="button" data-popup-close>✕</button>
        </div>
        <div class="popup-body">${bodyHtml}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
      if (e.target?.closest?.("[data-popup-close]")) close();
    });
    document.addEventListener("keydown", function onEsc(ev){
      if (ev.key === "Escape") {
        document.removeEventListener("keydown", onEsc);
        if (overlay.isConnected) close();
      }
    });
    return { overlay, close };
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

  // ================== PLAIN SPELLS PARSING (для ручного редактирования) ==================
  function parseSpellsFromPlain(text) {
    if (typeof text !== "string") return [];

    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const out = [];

    for (const line of lines) {
      // поддерживаем форматы:
      // 1) "Название | https://..."
      // 2) "Название https://..."
      // 3) "https://..."
      let t = line;
      let href = null;

      const partsPipe = t.split("|").map(s => s.trim()).filter(Boolean);
      if (partsPipe.length >= 2 && /^(https?:\/\/|manual:)/i.test(partsPipe[1])) {
        t = partsPipe[0];
        href = partsPipe[1];
      } else {
        const m = t.match(/(https?:\/\/[^\s]+)\s*$/i);
        if (m) {
          href = m[1];
          t = t.replace(m[1], "").trim();
        } else if (/^https?:\/\//i.test(t)) {
          href = t;
          t = t;
        }
      }

      out.push({ text: t || line, href: href || null });
    }

    return out;
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
      combat: {
        skillsAbilities: { value: "" }
      },
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
      const total = numLike(slotsRaw?.[k]?.value, 0);
      const filled = numLike(slotsRaw?.[k]?.filled, 0);
      slots.push({ level: lvlN, total, filled });
    }

    const text = (sheet?.text && typeof sheet.text === "object") ? sheet.text : {};

    // Всегда показываем уровни 0..9 даже без .json.
    // Поддерживаем 2 источника:
    // - tiptap: sheet.text["spells-level-N"].value.data
    // - plain:  sheet.text["spells-level-N-plain"].value (строка)  <-- редактируемый список
    const spellsByLevel = [];
    const spellsPlainByLevel = {};
    const spellNameByHref = {};
    const spellDescByHref = {};

    // кастомные описания/имена (добавленные кнопкой) сохраняем в sheet.text
    if (sheet?.text && typeof sheet.text === "object") {
      for (const k of Object.keys(sheet.text)) {
        if (!k) continue;
        if (k.startsWith("spell-name:")) {
          const href = k.slice("spell-name:".length);
          const val = sheet.text?.[k]?.value;
          if (href && typeof val === "string" && val.trim()) spellNameByHref[href] = val.trim();
        }
        if (k.startsWith("spell-desc:")) {
          const href = k.slice("spell-desc:".length);
          const val = sheet.text?.[k]?.value;
          // сохраняем даже пустую строку — чтобы пользователь мог очистить описание
          if (href && typeof val === "string") spellDescByHref[href] = val;
        }
      }
    }

    for (let lvlN = 0; lvlN <= 9; lvlN++) {
      const tipKey = `spells-level-${lvlN}`;
      const plainKey = `spells-level-${lvlN}-plain`;

      const tipItems = parseSpellsFromTiptap(text?.[tipKey]?.value?.data);
      const plainVal = (text?.[plainKey]?.value ?? text?.[plainKey] ?? "");
      const plainItems = parseSpellsFromPlain(plainVal);

      // сохраним plain текст для textarea (если его нет — сгенерим из tiptap, чтобы сразу можно было редактировать)
      if (typeof plainVal === "string" && plainVal.trim().length) {
        spellsPlainByLevel[lvlN] = plainVal;
      } else if (tipItems && tipItems.length) {
        spellsPlainByLevel[lvlN] = tipItems.map(it => (it.href ? `${it.text} | ${it.href}` : it.text)).join("\n");
      } else {
        spellsPlainByLevel[lvlN] = "";
      }

      // объединяем items (без умного дедупа — но уберём совсем очевидные повторы по (text+href))
      const merged = [];
      const seen = new Set();
      [...tipItems, ...plainItems].forEach(it => {
        const key = `${it?.text || ""}@@${it?.href || ""}`;
        if (!it?.text) return;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push({ text: String(it.text), href: it.href ? String(it.href) : null });
      });

      spellsByLevel.push({ level: lvlN, items: merged });
    }

const weaponsRaw = Array.isArray(sheet?.weaponsList) ? sheet.weaponsList : [];

// нормализация текстовых полей (чтобы не ловить "[object Object]" и т.п.)
const normText = (x, fallback = "") => {
  if (x == null) return fallback;
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (typeof x === "object") {
    if ("value" in x) return normText(x.value, fallback);
    if ("name" in x && x.name && typeof x.name === "object" && "value" in x.name) return normText(x.name.value, fallback);
  }
  return fallback;
};

const parseLegacyDamage = (dmgStr) => {
  const s = normText(dmgStr, "").trim();
  // примеры: "1к6", "2к8 рубящий", "1к6+2 колющий" -> "+2" оставим в type
  const m = s.match(/(\d+)\s*(к\d+)\s*(.*)$/i);
  if (!m) return { dmgNum: 1, dmgDice: "к6", dmgType: s };
  const dmgNum = safeInt(m[1], 1);
  const dmgDice = m[2] ? String(m[2]).toLowerCase() : "к6";
  const dmgType = (m[3] || "").trim();
  return { dmgNum, dmgDice, dmgType };
};

const weapons = weaponsRaw
  .map((w, idx) => {
    // Новый формат оружия (создаётся в UI вкладки "Бой")
    const isNew = !!(w && typeof w === "object" && (
      "ability" in w || "prof" in w || "extraAtk" in w || "dmgNum" in w || "dmgDice" in w || "dmgType" in w || "desc" in w || "collapsed" in w
    ));

    if (isNew) {
      // FIX: приводим строковые поля к строкам (в т.ч. dmgType)
      const normalized = {
        name: normText(w?.name, "-"),
        ability: normText(w?.ability, "str"),
        prof: !!w?.prof,
        extraAtk: safeInt(w?.extraAtk, 0),
        dmgNum: safeInt(w?.dmgNum, 1),
        dmgDice: normText(w?.dmgDice, "к6"),
        dmgType: normText(w?.dmgType, ""),
        desc: normText(w?.desc, ""),
        collapsed: !!w?.collapsed
      };
      // (необязательно, но полезно) — подправим исходник, чтобы дальше не всплывал [object Object]
      weaponsRaw[idx] = normalized;

      return { kind: "new", idx, ...normalized };
    }

    // Legacy формат из некоторых json (name + mod + dmg) -> конвертируем В СХЕМУ UI (чтобы работали Показать/Удалить)
    const legacyName = normText(w?.name, "-");
    const legacyAtk = normText(w?.mod, "0");
    const parsed = parseLegacyDamage(w?.dmg);

    const converted = {
      name: legacyName,
      ability: "str",
      prof: false,
      extraAtk: parseModInput(legacyAtk, 0),
      dmgNum: parsed.dmgNum,
      dmgDice: parsed.dmgDice,
      dmgType: parsed.dmgType,
      desc: "",
      collapsed: true
    };

    // ВАЖНО: записываем обратно в sheet.weaponsList, иначе bindCombatEditors не сможет управлять legacy-оружием
    weaponsRaw[idx] = converted;

    return { kind: "new", idx, ...converted };
  })
  .filter(w => w.name && w.name !== "-");

    const coinsRaw = sheet?.coins && typeof sheet.coins === "object" ? sheet.coins : null;
    const coins = coinsRaw ? { cp: v(coinsRaw.cp, 0), sp: v(coinsRaw.sp, 0), ep: v(coinsRaw.ep, 0), gp: v(coinsRaw.gp, 0), pp: v(coinsRaw.pp, 0) } : null;

    return { name, cls, lvl, race, hp, hpCur, ac, spd, stats, passive, profLines, profText, personality, notesDetails, notesEntries, spellsInfo, slots, spellsByLevel, spellsPlainByLevel, spellNameByHref, spellDescByHref, profBonus: getProfBonus(sheet), weapons, coins };
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

function calcWeaponAttackBonus(sheet, weapon) {
  if (!sheet || !weapon) return 0;
  const ability = String(weapon.ability || "str");
  const statMod = safeInt(sheet?.stats?.[ability]?.modifier, 0);
  const prof = weapon.prof ? getProfBonus(sheet) : 0;
  const extra = safeInt(weapon.extraAtk, 0);
  return statMod + prof + extra;
}

function weaponDamageText(weapon) {
  const n = Math.max(0, safeInt(weapon?.dmgNum, 1));
  const dice = String(weapon?.dmgDice || "к6");
  const type = String(weapon?.dmgType || "").trim();
  return `${n}${dice}${type ? ` ${type}` : ""}`.trim();
}

// Обновляем "Бонус атаки" и превью урона без полного ререндера
function updateWeaponsBonuses(root, sheet) {
  if (!root || !sheet) return;
  const list = Array.isArray(sheet?.weaponsList) ? sheet.weaponsList : [];

  const cards = root.querySelectorAll('.weapon-card[data-weapon-idx]');
  cards.forEach(card => {
    const idx = safeInt(card.getAttribute('data-weapon-idx'), -1);
    if (idx < 0) return;

    const w = list[idx];
    if (!w || typeof w !== "object") return;

    // Legacy оружие просто пропускаем
    const isNew = ("ability" in w || "prof" in w || "extraAtk" in w || "dmgNum" in w || "dmgDice" in w || "dmgType" in w || "desc" in w || "collapsed" in w);
    if (!isNew) return;

    const atkEl = card.querySelector('[data-weapon-atk]');
    if (atkEl) atkEl.textContent = formatMod(calcWeaponAttackBonus(sheet, w));

    const dmgEl = card.querySelector('[data-weapon-dmg]');
    if (dmgEl) dmgEl.textContent = weaponDamageText(w);

    const profDot = card.querySelector('[data-weapon-prof]');
    if (profDot) {
      profDot.classList.toggle('active', !!w.prof);
      profDot.title = `Владение: +${getProfBonus(sheet)} к бонусу атаки`;
    }

    const detailsWrap = card.querySelector('.weapon-details');
    if (detailsWrap) detailsWrap.classList.toggle('collapsed', !!w.collapsed);

    const head = card.querySelector('.weapon-head');
    if (head) {
      head.classList.toggle('is-collapsed', !!w.collapsed);
      head.classList.toggle('is-expanded', !w.collapsed);
    }

    const toggleBtn = card.querySelector('[data-weapon-toggle-desc]');
    if (toggleBtn) toggleBtn.textContent = w.collapsed ? "Показать" : "Скрыть";
  });
}


function rerenderCombatTabInPlace(root, player, canEdit) {
  const main = root?.querySelector('#sheet-main');
  if (!main || player?._activeSheetTab !== "combat") return;

  const freshSheet = player.sheet?.parsed || createEmptySheet(player.name);
  const freshVm = toViewModel(freshSheet, player.name);
  main.innerHTML = renderActiveTab("combat", freshVm);

  bindEditableInputs(root, player, canEdit);
  bindSkillBoostDots(root, player, canEdit);
  bindAbilityAndSkillEditors(root, player, canEdit);
  bindNotesEditors(root, player, canEdit);
  bindSlotEditors(root, player, canEdit);
  bindCombatEditors(root, player, canEdit);

  updateWeaponsBonuses(root, player.sheet?.parsed);
}

function bindCombatEditors(root, player, canEdit) {
  if (!root || !player?.sheet?.parsed) return;
  const sheet = player.sheet.parsed;

  // кнопка "Добавить оружие"
  const addBtn = root.querySelector('[data-weapon-add]');
  if (addBtn) {
    if (!canEdit) addBtn.disabled = true;
    addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!canEdit) return;

      if (!Array.isArray(sheet.weaponsList)) sheet.weaponsList = [];

      sheet.weaponsList.push({
        name: "Новое оружие",
        ability: "str",
        prof: false,
        extraAtk: 0,
        dmgNum: 1,
        dmgDice: "к6",
        dmgType: "",
        desc: "",
        collapsed: false
      });

      scheduleSheetSave(player);
      rerenderCombatTabInPlace(root, player, canEdit);
    });
  }

  const weaponCards = root.querySelectorAll('.weapon-card[data-weapon-idx]');
  weaponCards.forEach(card => {
    const idx = safeInt(card.getAttribute('data-weapon-idx'), -1);
    if (idx < 0) return;

    if (!Array.isArray(sheet.weaponsList)) sheet.weaponsList = [];
    const w = sheet.weaponsList[idx];
    if (!w || typeof w !== "object") return;

    // Legacy карточки не редактируем
    const isNew = ("ability" in w || "prof" in w || "extraAtk" in w || "dmgNum" in w || "dmgDice" in w || "dmgType" in w || "desc" in w || "collapsed" in w);
    if (!isNew) return;

    // редактирование полей
    const fields = card.querySelectorAll('[data-weapon-field]');
    fields.forEach(el => {
      const field = el.getAttribute('data-weapon-field');
      if (!field) return;

      if (!canEdit) {
        el.disabled = true;
        return;
      }

      const handler = () => {
        let val;
        if (el.tagName === "SELECT") val = el.value;
        else if (el.type === "number") val = el.value === "" ? 0 : Number(el.value);
        else val = el.value;

        if (field === "extraAtk" || field === "dmgNum") val = safeInt(val, 0);

        w[field] = val;

        updateWeaponsBonuses(root, sheet);
        scheduleSheetSave(player);
      };

      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

    // владение (кружок)
    const profBtn = card.querySelector('[data-weapon-prof]');
    if (profBtn) {
      if (!canEdit) profBtn.disabled = true;
      profBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!canEdit) return;
        w.prof = !w.prof;
        updateWeaponsBonuses(root, sheet);
        scheduleSheetSave(player);
      });
    }

    // свернуть/развернуть описание
    const toggleDescBtn = card.querySelector('[data-weapon-toggle-desc]');
    if (toggleDescBtn) {
      if (!canEdit) toggleDescBtn.disabled = true;
      toggleDescBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!canEdit) return;
        w.collapsed = !w.collapsed;
        updateWeaponsBonuses(root, sheet);
        scheduleSheetSave(player);
      });
    }

    // удалить
    const delBtn = card.querySelector('[data-weapon-del]');
    if (delBtn) {
      if (!canEdit) delBtn.disabled = true;
      delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!canEdit) return;

        sheet.weaponsList.splice(idx, 1);
        scheduleSheetSave(player);
        rerenderCombatTabInPlace(root, player, canEdit);
      });
    }

    // 🎲 броски из оружия -> в панель кубиков
    const rollAtkBtn = card.querySelector('[data-weapon-roll-atk]');
    if (rollAtkBtn) {
      rollAtkBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const bonus = calcWeaponAttackBonus(sheet, w);
        if (window.DicePanel?.roll) {
          window.DicePanel.roll({ sides: 20, count: 1, bonus, kindText: `Атака: d20 ${formatMod(bonus)}` });
        }
      });
    }

    const rollDmgBtn = card.querySelector('[data-weapon-roll-dmg]');
    if (rollDmgBtn) {
      rollDmgBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const n = Math.max(0, safeInt(w?.dmgNum, 1));
        const diceStr = String(w?.dmgDice || "к6").trim().toLowerCase(); // "к8"
        const sides = safeInt(diceStr.replace("к", ""), 6);
        if (window.DicePanel?.roll) {
          window.DicePanel.roll({ sides, count: Math.max(1, n), bonus: 0, kindText: `Урон: d${sides} × ${Math.max(1,n)}` });
        }
      });
    }
  });

  updateWeaponsBonuses(root, sheet);
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
  updateWeaponsBonuses(root, player.sheet.parsed);
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
         updateWeaponsBonuses(root, sheet);

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

  const inputs = root.querySelectorAll(".slot-current-input[data-slot-level]");
  inputs.forEach(inp => {
    const lvl = safeInt(inp.getAttribute("data-slot-level"), 0);
    if (!lvl) return;

    if (!canEdit) { inp.disabled = true; return; }

    const handler = () => {
      // desired = доступные ячейки, редактируемое значение (0..12)
      const desired = Math.max(0, Math.min(12, safeInt(inp.value, 0)));

      const key = `slots-${lvl}`;
      if (!sheet.spells[key] || typeof sheet.spells[key] !== "object") {
        sheet.spells[key] = { value: 0, filled: 0 };
      }

      // total slots (value) keep, but ensure it is at least desired and not more than 12
      const totalPrev = numLike(sheet.spells[key].value, 0);
      const total = Math.max(desired, Math.min(12, totalPrev));
      setMaybeObjField(sheet.spells[key], "value", total);

      // filled = total - desired
      setMaybeObjField(sheet.spells[key], "filled", Math.max(0, total - desired));

      // update dots in UI without full rerender
      const dotsWrap = root.querySelector(`.slot-dots[data-slot-dots="${lvl}"]`);
      if (dotsWrap) {
        const totalForUi = Math.max(0, Math.min(12, numLike(sheet.spells[key].value, 0)));
        const dots = Array.from({ length: totalForUi })
          .map((_, i) => `<span class="slot-dot${i < desired ? " is-available" : ""}" data-slot-level="${lvl}"></span>`)
          .join("");
        dotsWrap.innerHTML = dots || `<span class="slot-dots-empty">—</span>`;
      }

      inp.value = String(desired);
      scheduleSheetSave(player);
    };

    inp.addEventListener("input", handler);
    inp.addEventListener("change", handler);
  });

  // кликабельные кружки: синий = доступно, пустой = использовано
  if (!root.__spellSlotsDotsBound) {
    root.__spellSlotsDotsBound = true;
    root.addEventListener("click", (e) => {
      const dot = e.target?.closest?.(".slot-dot[data-slot-level]");
      if (!dot) return;
      if (!canEdit) return;

      const lvl = safeInt(dot.getAttribute("data-slot-level"), 0);
      if (!lvl) return;

      const key = `slots-${lvl}`;
      if (!sheet.spells[key] || typeof sheet.spells[key] !== "object") {
        sheet.spells[key] = { value: 0, filled: 0 };
      }

      const total = Math.max(0, Math.min(12, numLike(sheet.spells[key].value, 0)));
      const filled = Math.max(0, Math.min(total, numLike(sheet.spells[key].filled, 0)));
      let available = Math.max(0, total - filled);

      // нажали на доступный -> используем 1; нажали на пустой -> возвращаем 1
      if (dot.classList.contains("is-available")) available = Math.max(0, available - 1);
      else available = Math.min(total, available + 1);

      setMaybeObjField(sheet.spells[key], "filled", Math.max(0, total - available));

      const inp = root.querySelector(`.slot-current-input[data-slot-level="${lvl}"]`);
      if (inp) inp.value = String(available);

      const dotsWrap = root.querySelector(`.slot-dots[data-slot-dots="${lvl}"]`);
      if (dotsWrap) {
        const dots = Array.from({ length: total })
          .map((_, i) => `<span class="slot-dot${i < available ? " is-available" : ""}" data-slot-level="${lvl}"></span>`)
          .join("");
        dotsWrap.innerHTML = dots || `<span class="slot-dots-empty">—</span>`;
      }

      scheduleSheetSave(player);
    });
  }
}

// ===== add spells by URL + toggle descriptions =====
function normalizeDndSuUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  // accept dnd.su links only (spells)
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (!parsed.hostname.endsWith("dnd.su")) return "";
    // normalize trailing slash
    let href = parsed.href;
    if (!href.endsWith("/")) href += "/";
    return href;
  } catch {
    return "";
  }
}

async function fetchSpellHtml(url) {
  // IMPORTANT: через наш сервер, чтобы избежать CORS
  const r = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function extractSpellFromHtml(html) {
  const txt = String(html || "");
  // name
  let name = "";
  try {
    const doc = new DOMParser().parseFromString(txt, "text/html");
    name = (doc.querySelector('h2.card-title[itemprop="name"]')?.textContent || "").trim();
  } catch { name = ""; }

  // description block: from <ul class="params card__article-body"> ... to <section class="comments-block ...">
  let desc = "";
  const start = txt.indexOf('<ul class="params card__article-body"');
  const end = txt.indexOf('<section class="comments-block');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = txt.slice(start, end);
    const wrap = document.createElement("div");
    wrap.innerHTML = slice;
    // innerText обычно сохраняет абзацы и списки достаточно близко к сайту
    desc = (wrap.innerText || "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    // подчистим лишние пустые строки
    desc = desc
      .split("\n")
      .map(l => l.replace(/\s+$/g, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return { name: name || "(без названия)", desc: desc || "" };
}

function ensureSpellSaved(sheet, level, name, href, desc) {
  if (!sheet.text || typeof sheet.text !== "object") sheet.text = {};

  // store meta
  sheet.text[`spell-name:${href}`] = { value: String(name || "").trim() };
  sheet.text[`spell-desc:${href}`] = { value: String(desc || "") };

  // append to plain list if absent
  const plainKey = `spells-level-${level}-plain`;
  const cur = String(sheet.text?.[plainKey]?.value ?? "");
  const lines = cur.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const already = lines.some(l => l.includes(href));
  if (!already) lines.push(`${name} | ${href}`);
  sheet.text[plainKey] = { value: lines.join("\n") };
}


function makeManualHref() {
  // псевдо-ссылка для "ручных" заклинаний, чтобы хранить описание в sheet.text
  return `manual:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rerenderSpellsTabInPlace(root, player, sheet, canEdit) {
  const main = root.querySelector("#sheet-main");
  if (!main) return;
  const scrollTop = main.scrollTop;

  const freshVm = toViewModel(sheet, player.name);
  main.innerHTML = renderSpellsTab(freshVm);

  bindEditableInputs(root, player, canEdit);
  bindSkillBoostDots(root, player, canEdit);
  bindAbilityAndSkillEditors(root, player, canEdit);
  bindNotesEditors(root, player, canEdit);
  bindSlotEditors(root, player, canEdit);
  bindSpellAddAndDesc(root, player, canEdit);
  bindCombatEditors(root, player, canEdit);

  main.scrollTop = scrollTop;
}

// ===== Spells DB parsing =====
const spellDbCache = {
  classes: null,            // [{value,label,url}]
  byClass: new Map(),       // value -> spells array
  descByHref: new Map()     // href -> {name,desc}
};

function parseSpellClassesFromHtml(html) {
  const out = [];
  try {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");

    // 0) актуальная разметка dnd.su (список классов):
    // <li class="if-list__item" data-value="21"><div class="if-list__item-title">Волшебник</div></li>
    // выбранный класс: class="if-list__item active"
    const liItems = Array.from(doc.querySelectorAll('li.if-list__item[data-value]'));
    if (liItems.length) {
      liItems.forEach(li => {
        const val = String(li.getAttribute('data-value') || '').trim();
        const label = (li.querySelector('.if-list__item-title')?.textContent || li.textContent || '').trim();
        if (!val || !label) return;
        out.push({ value: val, label, url: `https://dnd.su/spells/?class=${encodeURIComponent(val)}` });
      });
    }

    // 1) пробуем найти select с классами
    const sel = !out.length ? doc.querySelector('select[name="class"], select#class, select[class*="class"]') : null;
    if (sel) {
      sel.querySelectorAll("option").forEach(opt => {
        const val = (opt.getAttribute("value") || "").trim();
        const label = (opt.textContent || "").trim();
        if (!val) return;
        // часто есть "Все" — пропускаем
        if (/^все/i.test(label)) return;
        out.push({ value: val, label, url: `https://dnd.su/spells/?class=${encodeURIComponent(val)}` });
      });
    }

    // 2) fallback: ищем ссылки ?class=
    if (!out.length) {
      const seen = new Set();
      doc.querySelectorAll('a[href*="?class="]').forEach(a => {
        const href = a.getAttribute("href") || "";
        try {
          const u = new URL(href, "https://dnd.su");
          const val = u.searchParams.get("class");
          const label = (a.textContent || "").trim();
          if (!val || !label) return;
          if (seen.has(val)) return;
          seen.add(val);
          out.push({ value: val, label, url: `https://dnd.su/spells/?class=${encodeURIComponent(val)}` });
        } catch {}
      });
    }
  } catch {}

  // уникализация
  const uniq = new Map();
  out.forEach(c => {
    if (!c?.value) return;
    if (!uniq.has(c.value)) uniq.set(c.value, c);
  });
  return Array.from(uniq.values()).sort((a,b) => String(a.label||"").localeCompare(String(b.label||""), "ru"));
}

function getSpellLevelFromText(text) {
  const t = String(text || "").toLowerCase();

  // "заговор"
  if (t.includes("заговор")) return 0;

  // варианты "уровень 1", "1 уровень", "1-го уровня"
  const m1 = t.match(/уров(ень|ня|не)\s*([1-9])/i);
  if (m1 && m1[2]) return safeInt(m1[2], 0);

  const m2 = t.match(/\b([1-9])\s*уров/i);
  if (m2 && m2[1]) return safeInt(m2[1], 0);

  // иногда на карточках просто цифра уровня отдельно — берём самую "разумную"
  const m3 = t.match(/\b([1-9])\b/);
  if (m3 && m3[1]) return safeInt(m3[1], 0);

  return null;
}

function normalizeAnyUrlToAbs(href) {
  try {
    const u = new URL(String(href || ""), "https://dnd.su");
    let s = u.href;
    if (!s.endsWith("/")) s += "/";
    return s;
  } catch {
    return "";
  }
}

function parseSpellsFromClassHtml(html) {
  const spells = [];
  const seen = new Set();

  try {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");

    // основной список обычно в main
    const scope = doc.querySelector("main") || doc.body || doc;

    // берём ссылки на страницы заклинаний (не на каталог)
    const links = Array.from(scope.querySelectorAll('a[href*="/spells/"]'))
      .filter(a => {
        const h = a.getAttribute("href") || "";
        if (!h) return false;
        if (h.includes("/spells/?")) return false;
        // исключим якоря/комменты
        if (h.includes("#")) return false;
        return true;
      });

    for (const a of links) {
      const abs = normalizeAnyUrlToAbs(a.getAttribute("href"));
      if (!abs || !abs.includes("/spells/")) continue;
      if (seen.has(abs)) continue;

      const name = (a.textContent || "").trim();
      if (!name) continue;

      const card = a.closest(".card") || a.closest("article") || a.parentElement;
      const lvl = getSpellLevelFromText(card ? card.textContent : a.textContent);

      seen.add(abs);
      spells.push({ name, href: abs, level: lvl });
    }
  } catch {}

  // сорт: сначала по level (0..9..unknown), затем по имени
  const lvlKey = (x) => (x.level == null ? 99 : x.level);
  spells.sort((a,b) => {
    const da = lvlKey(a), db = lvlKey(b);
    if (da !== db) return da - db;
    return String(a.name||"").localeCompare(String(b.name||""), "ru");
  });

  return spells;
}



function extractSpellBracketLevel(text) {
  // Ищем уровень в квадратных скобках, как на dnd.su (например: "[1]" или "[Заговор]")
  const t = String(text || "");
  const m = t.match(/\[(.*?)\]/);
  if (!m) return null;
  const inside = String(m[1] || "").trim().toLowerCase();
  if (!inside) return null;
  if (inside.includes("заговор")) return 0;
  const n = parseInt(inside.replace(/[^0-9]/g, ""), 10);
  if (Number.isFinite(n) && n >= 0 && n <= 9) return n;
  return null;
}

function parseSpellsCardsFromHtml(html) {
  // Возвращает заклинания с HTML-карточкой "как на сайте" (насколько возможно)
  const spells = [];
  const seen = new Set();

  try {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const scope = doc.querySelector("main") || doc.body || doc;

    // На странице dnd.su/spells/ каждая запись обычно находится внутри .card / article.
    // Берём все ссылки на страницы заклинаний и вытаскиваем ближайшую карточку.
    const links = Array.from(scope.querySelectorAll('a[href*="/spells/"]'))
      .filter(a => {
        const h = a.getAttribute("href") || "";
        if (!h) return false;
        if (h.includes("/spells/?")) return false;
        if (h.includes("#")) return false;
        return true;
      });

    for (const a of links) {
      const abs = normalizeAnyUrlToAbs(a.getAttribute("href"));
      if (!abs || !abs.includes("/spells/")) continue;
      if (seen.has(abs)) continue;

      const name = (a.textContent || "").trim();
      if (!name) continue;

      const card = a.closest(".card") || a.closest("article") || a.closest("li") || a.parentElement;
      const cardHtml = card ? String(card.outerHTML || "") : "";

      const bracketLevel = extractSpellBracketLevel(card ? card.textContent : a.textContent);
      const level = (bracketLevel != null) ? bracketLevel : getSpellLevelFromText(card ? card.textContent : a.textContent);

      seen.add(abs);
      spells.push({ name, href: abs, level, cardHtml });
    }
  } catch {}

  const lvlKey = (x) => (x.level == null ? 99 : x.level);
  spells.sort((a,b) => {
    const da = lvlKey(a), db = lvlKey(b);
    if (da != db) return da - db;
    return String(a.name||"").localeCompare(String(b.name||""), "ru");
  });

  return spells;
}
async function ensureDbSpellDesc(href) {
  if (spellDbCache.descByHref.has(href)) return spellDbCache.descByHref.get(href);
  const html = await fetchSpellHtml(href);
  const parsed = extractSpellFromHtml(html);
  spellDbCache.descByHref.set(href, parsed);
  return parsed;
}

function openAddSpellPopup({ root, player, sheet, canEdit, level }) {
  const lvl = safeInt(level, 0);
  const title = (lvl === 0) ? "Добавить заговор" : `Добавить заклинание (уровень ${lvl})`;

  const { overlay, close } = openPopup({
    title,
    bodyHtml: `
      <div class="sheet-note" style="margin-bottom:10px;">Выбери способ добавления.</div>
      <div class="popup-actions">
        <button class="popup-btn primary" type="button" data-add-mode="link">Добавить по ссылке</button>
        <button class="popup-btn" type="button" data-add-mode="manual">Вписать вручную</button>
      </div>
      <div style="margin-top:12px;" data-add-body></div>
    `
  });

  const body = overlay.querySelector("[data-add-body]");
  overlay.addEventListener("click", async (e) => {
    const modeBtn = e.target?.closest?.("[data-add-mode]");
    if (!modeBtn || !body) return;
    if (!canEdit) return;

    const mode = modeBtn.getAttribute("data-add-mode");
    if (mode === "link") {
      body.innerHTML = `
        <div class="sheet-note">Вставь ссылку на dnd.su (пример: https://dnd.su/spells/9-bless/)</div>
        <input class="popup-field" type="text" placeholder="https://dnd.su/spells/..." data-link-input>
        <div class="popup-actions" style="margin-top:10px;">
          <button class="popup-btn primary" type="button" data-link-ok>Добавить</button>
          <button class="popup-btn" type="button" data-popup-close>Отмена</button>
        </div>
      `;
      body.querySelector("[data-link-input]")?.focus?.();
      return;
    }

    if (mode === "manual") {
      body.innerHTML = `
        <div class="popup-grid">
          <div>
            <div class="sheet-note">Название</div>
            <input class="popup-field" type="text" placeholder="Например: Волшебная струна" data-manual-name>
          </div>
          <div>
            <div class="sheet-note">Уровень уже выбран: <b>${escapeHtml(String(lvl))}</b></div>
            <div class="sheet-note">Ссылка не нужна.</div>
          </div>
        </div>
        <div style="margin-top:10px;">
          <div class="sheet-note">Описание (как на сайте — с абзацами)</div>
          <textarea class="popup-field" style="min-height:180px; resize:vertical;" data-manual-desc></textarea>
        </div>
        <div class="popup-actions" style="margin-top:10px;">
          <button class="popup-btn primary" type="button" data-manual-ok>Добавить</button>
          <button class="popup-btn" type="button" data-popup-close>Отмена</button>
        </div>
      `;
      body.querySelector("[data-manual-name]")?.focus?.();
      return;
    }
  });

  overlay.addEventListener("click", async (e) => {
    const okLink = e.target?.closest?.("[data-link-ok]");
    if (okLink) {
      if (!canEdit) return;
      const inp = overlay.querySelector("[data-link-input]");
      const rawUrl = inp?.value || "";
      const href = normalizeDndSuUrl(rawUrl);
      if (!href || !href.includes("/spells/")) {
        alert("Нужна ссылка на dnd.su/spells/... (пример: https://dnd.su/spells/9-bless/)");
        return;
      }

      okLink.disabled = true;
      if (inp) inp.disabled = true;

      try {
        const html = await fetchSpellHtml(href);
        const { name, desc } = extractSpellFromHtml(html);
        ensureSpellSaved(sheet, lvl, name, href, desc);
        scheduleSheetSave(player);
        rerenderSpellsTabInPlace(root, player, sheet, canEdit);
        close();
      } catch (err) {
        console.error(err);
        alert("Не удалось получить/распарсить описание с dnd.su. Проверь ссылку.");
      } finally {
        okLink.disabled = false;
        if (inp) inp.disabled = false;
      }
      return;
    }

    const okManual = e.target?.closest?.("[data-manual-ok]");
    if (okManual) {
      if (!canEdit) return;
      const name = (overlay.querySelector("[data-manual-name]")?.value || "").trim();
      const desc = (overlay.querySelector("[data-manual-desc]")?.value || "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
      if (!name) {
        alert("Укажи название.");
        return;
      }
      const href = makeManualHref();
      ensureSpellSaved(sheet, lvl, name, href, desc || "");
      scheduleSheetSave(player);
      rerenderSpellsTabInPlace(root, player, sheet, canEdit);
      close();
      return;
    }
  });
}



async function openSpellDbPopup({ root, player, sheet, canEdit }) {
  const FIXED_CLASS_LABELS = [
    "Волшебник",
    "Бард",
    "Друид",
    "Жрец",
    "Изобретатель",
    "Колдун",
    "Паладин",
    "Следопыт",
    "Чародей"
  ];

  const { overlay, close } = openPopup({
    title: "Выбор из базы dnd.su",
    bodyHtml: `
      <div class="popup-grid">
        <div>
          <div class="sheet-note">Класс</div>
          <select class="popup-field" data-db-class></select>
        </div>
        <div>
          <div class="sheet-note">Добавлять в уровень</div>
          <select class="popup-field" data-db-level>
            <option value="auto" selected>Авто (как в базе)</option>
            ${Array.from({length:10}).map((_,i)=>`<option value="${i}">${i===0?"0 (заговоры)":`Уровень ${i}`}</option>`).join("")}
          </select>
        </div>
      </div>

      <div style="margin-top:10px;">
        <input class="popup-field" type="text" placeholder="Поиск по названию..." data-db-search>
      </div>

      <div style="margin-top:10px;" data-db-list>
        <div class="sheet-note">Загрузка базы…</div>
      </div>
    `
  });

  const classSel = overlay.querySelector("[data-db-class]");
  const levelSel = overlay.querySelector("[data-db-level]");
  const searchInp = overlay.querySelector("[data-db-search]");
  const listBox = overlay.querySelector("[data-db-list]");

  if (!classSel || !listBox) return;

  // 1) тянем классы с dnd.su, но отображаем строго заданный список
  let classMap = new Map(); // label -> value
  try {
    if (!spellDbCache.classes) {
      const html = await fetchSpellHtml("https://dnd.su/spells/");
      spellDbCache.classes = parseSpellClassesFromHtml(html);
    }
    (spellDbCache.classes || []).forEach(c => {
      const label = String(c?.label || "").trim();
      const val = String(c?.value || "").trim();
      if (label && val) classMap.set(label.toLowerCase(), val);
    });
  } catch (err) {
    console.error(err);
  }

  // ВАЖНО: добавляем "Все" для просмотра всей базы
  const options = [
    { value: "all", label: "Все" },
    ...FIXED_CLASS_LABELS.map(l => ({ value: classMap.get(l.toLowerCase()) || l, label: l }))
  ];

  classSel.innerHTML = options
    .map(o => `<option value="${escapeHtml(String(o.value))}">${escapeHtml(String(o.label))}</option>`)
    .join("");

  // ---- helpers ----
  function getUrlForSelectedClass() {
    const rawVal = String(classSel.value || "");
    if (rawVal === "all") return "https://dnd.su/spells/";

    // если похоже на число — это class id
    if (/^\d+$/.test(rawVal)) return `https://dnd.su/spells/?class=${encodeURIComponent(rawVal)}`;

    // иначе fallback: не фильтруем по классу (чтобы всегда работало)
    return "https://dnd.su/spells/";
  }

  function buildSpellRowHtml(s) {
    const safeHref = escapeHtml(String(s.href || ""));
    const safeName = escapeHtml(String(s.name || "(без названия)"));
    const lvlAttr = (s.level == null ? "" : String(s.level));

    // Карточка из базы: пытаемся максимально сохранить HTML с сайта,
    // но обязательно делаем ссылки абсолютными и открывающимися в новой вкладке.
    let cardHtml = String(s.cardHtml || "");
    if (cardHtml) {
      try {
        const doc = new DOMParser().parseFromString(cardHtml, "text/html");
        doc.querySelectorAll('a[href]').forEach(a => {
          a.setAttribute('target', '_blank');
          const abs = normalizeAnyUrlToAbs(a.getAttribute('href'));
          if (abs) a.setAttribute('href', abs);
        });
        cardHtml = (doc.body?.firstElementChild?.outerHTML) || cardHtml;
      } catch {}
    }

    if (!cardHtml) {
      cardHtml = `<div class="db-site-card-fallback"><a href="${safeHref}" target="_blank" class="db-site-link">${safeName}</a></div>`;
    }

    return `
      <div class="db-site-spell" data-db-href="${safeHref}" data-db-level="${escapeHtml(lvlAttr)}">
        <div class="db-site-card">${cardHtml}</div>
        <div class="db-site-actions">
          <button class="popup-btn" type="button" data-db-toggle-desc>Описание</button>
          <button class="popup-btn primary" type="button" data-db-learn>Выучить</button>
        </div>
        <div class="db-site-desc hidden" data-db-desc>Загрузка описания…</div>
      </div>
    `;
  }

  async function loadAndRender() {
    const url = getUrlForSelectedClass();
    const search = (searchInp?.value || "").trim().toLowerCase();
    const forceLevel = (levelSel?.value || "auto");

    listBox.innerHTML = `<div class="sheet-note">Загрузка заклинаний…</div>`;

    // key для кэша: all / class:21 / etc
    const cacheKey = String(classSel.value || "all");

    let spells = spellDbCache.byClass.get(cacheKey);
    try {
      if (!spells) {
        const html = await fetchSpellHtml(url);
        spells = parseSpellsCardsFromHtml(html);
        spellDbCache.byClass.set(cacheKey, spells);
      }
    } catch (err) {
      console.error(err);
      listBox.innerHTML = `<div class="sheet-note">Не удалось загрузить список заклинаний (проверь прокси /api/fetch).</div>`;
      return;
    }

    const filtered = (spells || []).filter(s => {
      if (!search) return true;
      return String(s.name || "").toLowerCase().includes(search);
    });

    // Рендерим одной лентой (как на сайте): карточка + действия + раскрывашка описания
    listBox.innerHTML = filtered.map(buildSpellRowHtml).join("") || `<div class="sheet-note">Ничего не найдено.</div>`;

    // Делегирование событий (чтобы не привязывать 1000+ слушателей)
    listBox.onclick = async (ev) => {
      const descBtn = ev.target?.closest?.('[data-db-toggle-desc]');
      const learnBtn = ev.target?.closest?.('[data-db-learn]');

      if (!descBtn && !learnBtn) return;

      const row = ev.target?.closest?.('[data-db-href]');
      if (!row) return;
      const href = row.getAttribute('data-db-href') || "";
      if (!href) return;

      if (descBtn) {
        const descEl = row.querySelector('[data-db-desc]');
        if (!descEl) return;
        const wasHidden = descEl.classList.contains('hidden');
        descEl.classList.toggle('hidden');
        if (!wasHidden) return;

        try {
          const { desc } = await ensureDbSpellDesc(href);
          descEl.textContent = (desc || "(описание пустое)");
        } catch (err) {
          console.error(err);
          descEl.textContent = "Не удалось загрузить описание.";
        }
        return;
      }

      if (learnBtn) {
        if (!canEdit) return;

        // decide level
        let lvl = null;
        if (forceLevel !== "auto") {
          lvl = safeInt(forceLevel, 0);
        } else {
          const raw = row.getAttribute('data-db-level');
          lvl = (raw != null && raw !== "") ? safeInt(raw, 0) : null;
        }
        if (lvl == null || lvl < 0 || lvl > 9) lvl = 0;

        learnBtn.disabled = true;
        try {
          const { name, desc } = await ensureDbSpellDesc(href);
          ensureSpellSaved(sheet, lvl, name, href, desc);
          scheduleSheetSave(player);
          rerenderSpellsTabInPlace(root, player, sheet, canEdit);

          learnBtn.textContent = "Выучено";
          learnBtn.classList.remove('primary');
          learnBtn.disabled = true;
        } catch (err) {
          console.error(err);
          alert("Не удалось выучить (ошибка загрузки/парсинга).\nПроверь ссылку и доступность dnd.su.");
          learnBtn.disabled = false;
        }
      }
    };
  }

  classSel.addEventListener('change', loadAndRender);
  levelSel?.addEventListener('change', loadAndRender);
  searchInp?.addEventListener('input', () => {
    clearTimeout(searchInp.__t);
    searchInp.__t = setTimeout(loadAndRender, 140);
  });

  // first render
  await loadAndRender();
}


function bindSpellAddAndDesc(root, player, canEdit) {
  if (!root || !player?.sheet?.parsed) return;
  const sheet = player.sheet.parsed;

  if (root.__spellAddBound) return;
  root.__spellAddBound = true;

  root.addEventListener("click", async (e) => {
    const addBtn = e.target?.closest?.("[data-spell-add][data-spell-level]");
    if (addBtn) {
      if (!canEdit) return;
      const lvl = safeInt(addBtn.getAttribute("data-spell-level"), 0);
      openAddSpellPopup({ root, player, sheet, canEdit, level: lvl });
      return;
    }

    const dbBtn = e.target?.closest?.("[data-spell-db]");
    if (dbBtn) {
      await openSpellDbPopup({ root, player, sheet, canEdit });
      return;
    }

    const descBtn = e.target?.closest?.("[data-spell-desc-toggle]");
    if (descBtn) {
      const item = descBtn.closest(".spell-item");
      const desc = item?.querySelector?.(".spell-item-desc");
      if (!desc) return;
      desc.classList.toggle("hidden");
      descBtn.classList.toggle("is-open");
      return;
    }
  });

  // редактирование описания (textarea внутри раскрывашки)
  root.addEventListener("input", (e) => {
    const ta = e.target?.closest?.("[data-spell-desc-editor]");
    if (!ta) return;
    if (!canEdit) return;

    const item = ta.closest(".spell-item");
    const href = item?.getAttribute?.("data-spell-url") || "";
    if (!href) return;

    if (!sheet.text || typeof sheet.text !== "object") sheet.text = {};
    const key = `spell-desc:${href}`;
    if (!sheet.text[key] || typeof sheet.text[key] !== "object") sheet.text[key] = { value: "" };
    sheet.text[key].value = String(ta.value || "");
    scheduleSheetSave(player);
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

  function renderSpellCard({ name, href, desc }) {
    const safeHref = escapeHtml(href || "");
    const safeName = escapeHtml(name || href || "(без названия)");
    const text = String(desc || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const hasDesc = true; // кнопку "Описание" держим активной всегда (можно вписывать вручную)

    const isHttp = /^https?:\/\//i.test(String(href || ""));
    const titleHtml = isHttp
      ? `<a class="spell-item-link" href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeName}</a>`
      : `<span class="spell-item-title">${safeName}</span>`;

    return `
      <div class="spell-item" data-spell-url="${safeHref}">
        <div class="spell-item-head">
          ${titleHtml}
          <button class="spell-desc-btn" type="button" data-spell-desc-toggle>Описание</button>
        </div>
        <div class="spell-item-desc hidden">
          <textarea class="spell-desc-editor" data-spell-desc-editor rows="6" placeholder="Описание (можно редактировать)…">${escapeHtml(text)}</textarea>
          <div class="sheet-note" style="margin-top:6px;">Сохраняется автоматически.</div>
        </div>
      </div>
    `;
  }

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
      const total = Math.max(0, Math.min(12, numLike(s.total, 0)));
      const filled = Math.max(0, Math.min(total, numLike(s.filled, 0)));
      const current = Math.max(0, total - filled); // доступные
      const spellsCount = countByLevel[s.level] || 0;

      const dots = Array.from({ length: total })
        .map((_, i) => {
          const on = i < current;
          return `<span class="slot-dot${on ? " is-available" : ""}" data-slot-level="${s.level}"></span>`;
        })
        .join("");

      return `
        <div class="slot-cell" data-slot-level="${s.level}">
          <div class="slot-top">
            <div class="slot-level">Ур. ${s.level}</div>
            <div class="slot-nums">
              <span class="slot-spells" title="Кол-во заклинаний уровня">${spellsCount}</span>
              <span class="slot-sep">/</span>
              <input class="slot-current slot-current-input" type="number" min="0" max="12" value="${escapeHtml(String(current))}" data-slot-level="${s.level}" title="Доступно ячеек (редактируемое)">
            </div>
          </div>
          <div class="slot-dots" data-slot-dots="${s.level}">
            ${dots || `<span class="slot-dots-empty">—</span>`}
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="slots-frame">
        <div class="slots-grid">
          ${cells}
        </div>
      </div>
    `;
  }

  function renderSpellsByLevel(vm) {
    const spellNameByHref = (vm?.spellNameByHref && typeof vm.spellNameByHref === "object") ? vm.spellNameByHref : {};
    const spellDescByHref = (vm?.spellDescByHref && typeof vm.spellDescByHref === "object") ? vm.spellDescByHref : {};
    const blocks = (vm?.spellsByLevel || []).map(b => {
      const lvl = safeInt(b.level, 0);
      const title = (lvl === 0) ? "Заговоры (0)" : `Уровень ${lvl}`;

      const items = (b.items || []).map(it => {
        if (it.href) {
          const name = spellNameByHref[it.href] || it.text;
          const desc = spellDescByHref[it.href] || "";
          return renderSpellCard({ name, href: it.href, desc });
        }
        return `<span class="sheet-pill">${escapeHtml(it.text)}</span>`;
      }).join("");

      return `
        <div class="sheet-card">
          <div class="spells-level-header">
            <h4 style="margin:0">${escapeHtml(title)}</h4>
            <button class="spell-add-btn" type="button" data-spell-add data-spell-level="${lvl}">${lvl === 0 ? "Добавить заговор" : "Добавить заклинание"}</button>
          </div>

          <div class="spells-level-pills">
            ${items || `<div class="sheet-note">Пока пусто. Добавляй кнопкой выше или через «Выбор из базы».</div>`}
          </div>
        </div>
      `;
    }).join("");

    return `<div class="sheet-grid-2">${blocks}</div>`;
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
          <div class="spells-list-header"><h3 style="margin:0">Список заклинаний</h3><button class="spell-db-btn" type="button" data-spell-db>Выбор из базы</button></div>
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
  const statModByKey = {};
  (vm?.stats || []).forEach(s => { statModByKey[s.k] = safeInt(s.mod, 0); });

  const profBonus = safeInt(vm?.profBonus, 2);

  const abilityOptions = [
    { k: "str", label: "Сила" },
    { k: "dex", label: "Ловкость" },
    { k: "con", label: "Телосложение" },
    { k: "int", label: "Интеллект" },
    { k: "wis", label: "Мудрость" },
    { k: "cha", label: "Харизма" }
  ];

  const diceOptions = ["к4","к6","к8","к10","к12","к20"];

  const calcAtk = (w) => {
    const statMod = safeInt(statModByKey[w.ability] ?? 0, 0);
    const prof = w.prof ? profBonus : 0;
    const extra = safeInt(w.extraAtk, 0);
    return statMod + prof + extra;
  };

  const dmgText = (w) => {
    const n = Math.max(0, safeInt(w.dmgNum, 1));
    const dice = String(w.dmgDice || "к6");
    const type = String(w.dmgType || "").trim();
    return `${n}${dice}${type ? ` ${type}` : ""}`.trim();
  };

  const d20Svg = `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 2 20.5 7v10L12 22 3.5 17V7L12 2Z" fill="currentColor" opacity="0.95"></path>
      <path d="M12 2v20M3.5 7l8.5 5 8.5-5M3.5 17l8.5-5 8.5 5" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"></path>
    </svg>
  `;

  const weapons = Array.isArray(vm?.weapons) ? vm.weapons : [];

  const listHtml = weapons.length
    ? weapons.map(w => {
        if (w.kind === "legacy") {
          // на всякий случай
          return `
            <div class="sheet-card weapon-card legacy">
              <div class="sheet-note">Оружие legacy. Перезагрузи json или добавь оружие через кнопку «Добавить оружие».</div>
            </div>
          `;
        }

        const atk = calcAtk(w);
        const collapsed = !!w.collapsed;
        const title = String(w.name || "");

        return `
          <div class="sheet-card weapon-card" data-weapon-idx="${w.idx}">
            <div class="weapon-head ${collapsed ? "is-collapsed" : "is-expanded"}">
              <input class="weapon-title-input"
                     type="text"
                     value="${escapeHtml(title)}"
                     title="${escapeHtml(title)}"
                     placeholder="Название"
                     data-weapon-field="name">

              <div class="weapon-actions">
                <button class="weapon-btn" type="button" data-weapon-toggle-desc>${collapsed ? "Показать" : "Скрыть"}</button>
                <button class="weapon-btn danger" type="button" data-weapon-del>Удалить</button>
              </div>
            </div>

            <!-- рамка под названием: Бонус атаки + Урон (всегда видима) -->
            <div class="weapon-summary">
              <div class="weapon-sum-item">
                <div class="weapon-sum-label">
                  <span>Атака</span>
                  <button class="weapon-dice-btn" type="button" data-weapon-roll-atk title="Бросок атаки">${d20Svg}</button>
                </div>
                <div class="weapon-sum-val" data-weapon-atk>${escapeHtml(formatMod(atk))}</div>
              </div>

              <div class="weapon-sum-item">
                <div class="weapon-sum-label">
                  <span>Урон</span>
                  <button class="weapon-dice-btn" type="button" data-weapon-roll-dmg title="Бросок урона">${d20Svg}</button>
                </div>
                <div class="weapon-sum-val" data-weapon-dmg>${escapeHtml(dmgText(w))}</div>
              </div>
            </div>

            <!-- всё ниже скрывается кнопкой Скрыть -->
            <div class="weapon-details ${collapsed ? "collapsed" : ""}">
              <div class="weapon-details-grid">
                <div class="weapon-fieldbox">
                  <div class="weapon-fieldlabel">Характеристика</div>
                  <select class="weapon-select" data-weapon-field="ability">
                    ${abilityOptions.map(o => `<option value="${o.k}" ${o.k === w.ability ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
                  </select>
                </div>

                <div class="weapon-fieldbox weapon-fieldbox-inline">
                  <div class="weapon-fieldlabel">Бонус владения</div>
                  <button class="weapon-prof-dot ${w.prof ? "active" : ""}" type="button" data-weapon-prof title="Владение: +${profBonus} к бонусу атаки"></button>
                </div>

                <div class="weapon-fieldbox">
                  <div class="weapon-fieldlabel">Доп. модификатор</div>
                  <input class="weapon-num weapon-extra" type="number" step="1"
                         value="${escapeHtml(String(safeInt(w.extraAtk, 0)))}"
                         data-weapon-field="extraAtk">
                </div>

                <div class="weapon-fieldbox weapon-dmg-edit">
                  <div class="weapon-fieldlabel">Урон (редакт.)</div>
                  <div class="weapon-dmg-mini">
                    <input class="weapon-num weapon-dmg-num" type="number" min="0" step="1"
                           value="${escapeHtml(String(Math.max(0, safeInt(w.dmgNum, 1))))}"
                           data-weapon-field="dmgNum">
                    <select class="weapon-select weapon-dice" data-weapon-field="dmgDice">
                      ${diceOptions.map(d => `<option value="${d}" ${d === w.dmgDice ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")}
                    </select>
                  </div>
                  <input class="weapon-text weapon-dmg-type weapon-dmg-type-full" type="text"
                         value="${escapeHtml(String(w.dmgType || ""))}"
                         placeholder="вид урона (колющий/рубящий/...)"
                         data-weapon-field="dmgType">
                </div>
              </div>

              <div class="weapon-desc">
                <textarea class="sheet-textarea weapon-desc-text" rows="4"
                          placeholder="Описание оружия..."
                          data-weapon-field="desc">${escapeHtml(String(w.desc || ""))}</textarea>
              </div>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="sheet-note">Оружие пока не добавлено. Нажми «Добавить оружие».</div>`;

  return `
    <div class="sheet-section" data-combat-root>
      <div class="combat-toolbar">
        <h3>Бой</h3>
        <button class="weapon-add-btn" type="button" data-weapon-add>Добавить оружие</button>
      </div>

      <div class="weapons-list">
        ${listHtml}
      </div>

      <div class="sheet-card combat-skills-card">
        <h4>Умения и способности</h4>
        <textarea class="sheet-textarea combat-skills-text" rows="6"
                  data-sheet-path="combat.skillsAbilities.value"
                  placeholder="Сюда можно вписать умения/способности, особенности боя, заметки..."></textarea>
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
    bindSpellAddAndDesc(sheetContent, player, canEdit);
   bindCombatEditors(sheetContent, player, canEdit);

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
          bindSpellAddAndDesc(sheetContent, player, canEdit);
           bindCombatEditors(sheetContent, player, canEdit);
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



