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

  function canEditPlayer(player) {
    // client.js передаёт в init() функции getMyRole()/getMyId().
    // Важно: не полагаемся на ctx.myRole/ctx.myId (их может не быть),
    // иначе у игроков отключаются клики/выборы в "Основное".
    const myRole = (typeof ctx?.getMyRole === "function")
      ? (ctx.getMyRole() || "")
      : (ctx?.myRole || ctx?.role || "");
    const myId = (typeof ctx?.getMyId === "function")
      ? (ctx.getMyId() ?? "")
      : (ctx?.myId ?? "");
    if (myRole === "GM") return true;
    const owner = player?.ownerId ?? "";
    return String(owner) && String(myId) && String(owner) === String(myId);
  }


  // состояние модалки
  let openedSheetPlayerId = null;
  let lastCanEdit = false; // GM или владелец текущего открытого персонажа

  // ===== Saved bases overlay state =====
  let savedBasesOverlay = null;
  let savedBasesListCache = [];
  let savedBasesOverlayPlayerId = null;

  function ensureSavedBasesOverlay() {
    if (savedBasesOverlay) return savedBasesOverlay;

    const overlay = document.createElement('div');
    overlay.className = 'saved-bases-overlay hidden';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="saved-bases-modal">
        <div class="saved-bases-head">
          <div>
            <div class="saved-bases-title">Мои сохранённые персонажи</div>
            <div class="saved-bases-sub">Список привязан к вашему уникальному id (не к никнейму).</div>
          </div>
          <button type="button" class="saved-bases-close" title="Закрыть">✕</button>
        </div>

        <div class="saved-bases-body">
          <div class="saved-bases-loading">Загружаю список…</div>
          <div class="saved-bases-empty hidden">Пока нет сохранённых персонажей. Нажмите «Сохранить основу».</div>

          <div class="saved-bases-list" role="list"></div>
        </div>

        <div class="saved-bases-footer">
          <button type="button" class="saved-bases-delete" disabled>Удалить</button>
          <div style="flex:1"></div>
          <button type="button" class="saved-bases-refresh">Обновить</button>
          <button type="button" class="saved-bases-apply" disabled>Загрузить</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    savedBasesOverlay = overlay;

    const closeBtn = overlay.querySelector('.saved-bases-close');
    closeBtn?.addEventListener('click', () => closeSavedBasesOverlay());

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeSavedBasesOverlay();
    });

    overlay.querySelector('.saved-bases-refresh')?.addEventListener('click', () => {
      try {
        openSavedBasesOverlay({ loading: true, playerId: savedBasesOverlayPlayerId });
        ctx?.sendMessage?.({ type: 'listSavedBases' });
      } catch {}
    });

    overlay.querySelector('.saved-bases-apply')?.addEventListener('click', () => {
      const sel = overlay.querySelector('input[name="savedBasePick"]:checked');
      const savedId = sel?.value;
      if (!savedId) return;
      if (!savedBasesOverlayPlayerId) return;
      try {
        ctx?.sendMessage?.({ type: 'applySavedBase', playerId: savedBasesOverlayPlayerId, savedId });
      } catch {}
    });

    overlay.querySelector('.saved-bases-delete')?.addEventListener('click', () => {
      const sel = overlay.querySelector('input[name="savedBasePick"]:checked');
      const savedId = sel?.value;
      if (!savedId) return;
      if (!confirm('Удалить сохранённого персонажа?')) return;
      try {
        ctx?.sendMessage?.({ type: 'deleteSavedBase', savedId });
      } catch {}
    });

    return overlay;
  }

  function openSavedBasesOverlay({ loading = false, playerId = null } = {}) {
    const overlay = ensureSavedBasesOverlay();
    savedBasesOverlayPlayerId = playerId;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');

    const loadingEl = overlay.querySelector('.saved-bases-loading');
    const emptyEl = overlay.querySelector('.saved-bases-empty');
    const listEl = overlay.querySelector('.saved-bases-list');
    const applyBtn = overlay.querySelector('.saved-bases-apply');
    const delBtn = overlay.querySelector('.saved-bases-delete');

    if (loadingEl) loadingEl.style.display = loading ? '' : 'none';
    emptyEl?.classList.add('hidden');
    if (listEl) listEl.innerHTML = '';
    if (applyBtn) applyBtn.disabled = true;
    if (delBtn) delBtn.disabled = true;
  }

  function closeSavedBasesOverlay() {
    if (!savedBasesOverlay) return;
    savedBasesOverlay.classList.add('hidden');
    savedBasesOverlay.setAttribute('aria-hidden', 'true');
    savedBasesOverlayPlayerId = null;
  }

  function renderSavedBasesList(list) {
    const overlay = ensureSavedBasesOverlay();
    const loadingEl = overlay.querySelector('.saved-bases-loading');
    const emptyEl = overlay.querySelector('.saved-bases-empty');
    const listEl = overlay.querySelector('.saved-bases-list');
    const applyBtn = overlay.querySelector('.saved-bases-apply');
    const delBtn = overlay.querySelector('.saved-bases-delete');

    if (loadingEl) loadingEl.style.display = 'none';
    if (!listEl) return;

    listEl.innerHTML = '';

    const arr = Array.isArray(list) ? list : [];
    savedBasesListCache = arr;

    if (!arr.length) {
      emptyEl?.classList.remove('hidden');
      if (applyBtn) applyBtn.disabled = true;
      if (delBtn) delBtn.disabled = true;
      return;
    }

    emptyEl?.classList.add('hidden');

    arr.forEach(item => {
      const row = document.createElement('label');
      row.className = 'saved-bases-row';
      const dt = item?.updatedAt ? new Date(item.updatedAt) : null;
      const when = dt && !isNaN(dt.getTime())
        ? dt.toLocaleString()
        : '';
      row.innerHTML = `
        <input type="radio" name="savedBasePick" value="${escapeHtml(String(item.id || ''))}">
        <div class="saved-bases-row-main">
          <div class="saved-bases-row-name">${escapeHtml(item.name || 'Персонаж')}</div>
          <div class="saved-bases-row-meta">${escapeHtml(when)}</div>
        </div>
      `;
      listEl.appendChild(row);
    });

    listEl.querySelectorAll('input[name="savedBasePick"]').forEach(inp => {
      inp.addEventListener('change', () => {
        if (applyBtn) applyBtn.disabled = false;
        if (delBtn) delBtn.disabled = false;
      });
    });

    // auto-select first
    const first = listEl.querySelector('input[name="savedBasePick"]');
    if (first) {
      first.checked = true;
      if (applyBtn) applyBtn.disabled = false;
      if (delBtn) delBtn.disabled = false;
    }
  }

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

  function abilityModFromScore(score) {
    const s = Number(score);
    if (!Number.isFinite(s)) return 0;
    // D&D 5e: modifier = floor((score - 10) / 2)
    return Math.floor((s - 10) / 2);
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


  // Спелл-метрики: авто-формула бонуса атаки (проф. + модификатор выбранной характеристики)
  function computeSpellAttack(sheet) {
    const base = String(sheet?.spellsInfo?.base?.code || sheet?.spellsInfo?.base?.value || "int").trim() || "int";
    const prof = getProfBonus(sheet);
    const score = safeInt(sheet?.stats?.[base]?.score, 10);
    const mod = scoreToModifier(score);
    return prof + mod;
  }

// ================== MODAL HELPERS ==================
  function openModal() {
    if (!sheetModal) return;
    sheetModal.classList.remove('hidden');
    sheetModal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    if (!sheetModal) return;
    hideHpPopup();
    hideExhPopup();
    hideCondPopup();
    sheetModal.classList.add('hidden');
    sheetModal.setAttribute('aria-hidden', 'true');
    openedSheetPlayerId = null;

    if (sheetTitle) sheetTitle.textContent = "Информация о персонаже";
    if (sheetSubtitle) sheetSubtitle.textContent = "";
    if (sheetActions) sheetActions.innerHTML = "";
    if (sheetContent) sheetContent.innerHTML = "";
  }


  // ================== HP POPUP ==================
  let hpPopupEl = null;

  // snapshot of latest players array (to avoid stale closures after .json import / refresh)
  let lastPlayersSnapshot = [];

  function rememberPlayersSnapshot(players) {
    if (Array.isArray(players)) lastPlayersSnapshot = players;
  }

  function getOpenedPlayerSafe() {
    if (!openedSheetPlayerId) return null;
    return (lastPlayersSnapshot || []).find(x => x && x.id === openedSheetPlayerId) || null;
  }

  function ensureHpPopup() {
    if (hpPopupEl) return hpPopupEl;

    hpPopupEl = document.createElement('div');
    hpPopupEl.className = 'hp-popover hidden';
    hpPopupEl.innerHTML = `
      <div class="hp-popover__backdrop" data-hp-close></div>
      <div class="hp-popover__panel" role="dialog" aria-label="Здоровье" aria-modal="false">
        <div class="hp-popover__head">
          <div class="hp-popover__title">Здоровье</div>
          <button class="hp-popover__x" type="button" data-hp-close title="Закрыть">✕</button>
        </div>

        <div class="hp-popover__grid">
          <div class="hp-row">
            <div class="hp-label">Здоровье макс.</div>
            <input class="hp-input" type="number" min="0" max="999" step="1" data-hp-field="max">
          </div>
          <div class="hp-row">
            <div class="hp-label">Здоровья осталось</div>
            <input class="hp-input" type="number" min="0" max="999" step="1" data-hp-field="cur">
          </div>
          <div class="hp-row">
            <div class="hp-label">Временное здоровье</div>
            <input class="hp-input" type="number" min="0" max="999" step="1" data-hp-field="temp">
          </div>

          <div class="hp-divider"></div>

          <div class="hp-row hp-row--delta">
            <div class="hp-label">Изменить здоровье</div>
            <div class="hp-delta">
              <button class="hp-delta__btn" type="button" data-hp-delta="-">−</button>
              <input class="hp-input hp-input--delta" type="number" min="0" max="999" step="1" value="0" data-hp-field="delta">
              <button class="hp-delta__btn" type="button" data-hp-delta="+">+</button>
            </div>
            <div class="hp-note">Ограничение: 0…максимум</div>
          </div>
        </div>
      </div>
    `;
    sheetModal?.appendChild(hpPopupEl);
    setHpPopupEditable(!!lastCanEdit);

    // close / delta buttons
    hpPopupEl.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      if (t.closest('[data-hp-close]')) {
        hideHpPopup();
        return;
      }

      const deltaBtn = t.closest('[data-hp-delta]');
      if (deltaBtn) {
        const sign = deltaBtn.getAttribute('data-hp-delta');
        applyHpDelta(sign === '+' ? +1 : -1);
      }
    });

    // escape closes
    hpPopupEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideHpPopup();
    });

    // inputs update sheet (always use current opened player from snapshot)
    hpPopupEl.addEventListener('input', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;

      const f = el.getAttribute('data-hp-field');
      if (!f || f === 'delta') return;
      if (!lastCanEdit) return;

      const player = getOpenedPlayerSafe();
      if (!player) return;
      const sheet = player.sheet?.parsed;
      if (!sheet) return;

      if (!sheet.vitality) sheet.vitality = {};
      if (!sheet.vitality["hp-max"]) sheet.vitality["hp-max"] = { value: 0 };
      if (!sheet.vitality["hp-current"]) sheet.vitality["hp-current"] = { value: 0 };
      if (!sheet.vitality["hp-temp"]) sheet.vitality["hp-temp"] = { value: 0 };

      const maxEl = hpPopupEl.querySelector('[data-hp-field="max"]');
      const curEl = hpPopupEl.querySelector('[data-hp-field="cur"]');
      const tempEl = hpPopupEl.querySelector('[data-hp-field="temp"]');

      const max = Number(maxEl?.value ?? sheet.vitality["hp-max"].value) || 0;
      const cur = Number(curEl?.value ?? sheet.vitality["hp-current"].value) || 0;
      const temp = Number(tempEl?.value ?? sheet.vitality["hp-temp"].value) || 0;

      const clampedMax = Math.max(0, Math.trunc(max));
      const clampedCur = Math.max(0, Math.min(clampedMax, Math.trunc(cur)));
      const clampedTemp = Math.max(0, Math.trunc(temp));

      sheet.vitality["hp-max"].value = clampedMax;
      sheet.vitality["hp-current"].value = clampedCur;
      sheet.vitality["hp-temp"].value = clampedTemp;

      syncHpPopupInputs(sheet);
      markModalInteracted(player.id);
      scheduleSheetSave(player);
      if (sheetContent) updateHeroChips(sheetContent, sheet);
    });

    return hpPopupEl;
  }

  function syncHpPopupInputs(sheet) {
    if (!hpPopupEl || !sheet) return;
    const max = Number(sheet?.vitality?.["hp-max"]?.value) || 0;
    const cur = Number(sheet?.vitality?.["hp-current"]?.value) || 0;
    const temp = Number(sheet?.vitality?.["hp-temp"]?.value) || 0;

    const maxEl = hpPopupEl.querySelector('[data-hp-field="max"]');
    const curEl = hpPopupEl.querySelector('[data-hp-field="cur"]');
    const tempEl = hpPopupEl.querySelector('[data-hp-field="temp"]');

    if (maxEl) maxEl.value = String(max);
    if (curEl) curEl.value = String(cur);
    if (tempEl) tempEl.value = String(temp);
  }

  function setHpPopupEditable(can) {
    if (!hpPopupEl) return;
    const inputs = hpPopupEl.querySelectorAll('input.hp-input');
    inputs.forEach(inp => {
      const isDelta = inp.getAttribute('data-hp-field') === 'delta';
      // delta input можно менять всем, но кнопки применения/изменения - только редактору
      if (!can && !isDelta) inp.setAttribute('disabled', 'disabled');
      else inp.removeAttribute('disabled');
    });

    const btns = hpPopupEl.querySelectorAll('.hp-delta__btn');
    btns.forEach(b => {
      if (!can) b.setAttribute('disabled', 'disabled');
      else b.removeAttribute('disabled');
    });
  }

  function showHpPopup() {
    const el = ensureHpPopup();
    const player = getOpenedPlayerSafe();
    if (!player) return;
    const sheet = player.sheet?.parsed;
    if (!sheet) return;

    if (!sheet.vitality) sheet.vitality = {};
    if (!sheet.vitality["hp-max"]) sheet.vitality["hp-max"] = { value: 0 };
    if (!sheet.vitality["hp-current"]) sheet.vitality["hp-current"] = { value: 0 };
    if (!sheet.vitality["hp-temp"]) sheet.vitality["hp-temp"] = { value: 0 };

    syncHpPopupInputs(sheet);
    setHpPopupEditable(!!lastCanEdit);
    el.classList.remove('hidden');

    const first = el.querySelector('[data-hp-field="cur"]');
    first?.focus?.();
  }

  function hideHpPopup() {
    hpPopupEl?.classList.add('hidden');
  }

  function applyHpDelta(mult) {
    if (!lastCanEdit) return;
    const player = getOpenedPlayerSafe();
    if (!player) return;
    const sheet = player.sheet?.parsed;
    if (!sheet?.vitality) return;

    const deltaEl = hpPopupEl?.querySelector('[data-hp-field="delta"]');
    const delta = Math.max(0, Math.trunc(Number(deltaEl?.value ?? 0) || 0));
    if (!delta) return;

    if (!sheet.vitality["hp-max"]) sheet.vitality["hp-max"] = { value: 0 };
    if (!sheet.vitality["hp-current"]) sheet.vitality["hp-current"] = { value: 0 };
    if (!sheet.vitality["hp-temp"]) sheet.vitality["hp-temp"] = { value: 0 };

    const max = Number(sheet?.vitality?.["hp-max"]?.value) || 0;
    const cur = Number(sheet?.vitality?.["hp-current"]?.value) || 0;
    const temp = Number(sheet?.vitality?.["hp-temp"]?.value) || 0;

    // mult: +1 = heal current (temp НЕ пополняется кнопкой "+")
    // mult: -1 = damage (сначала снимаем временные хиты, затем текущее здоровье)
    let nextCur = cur;
    let nextTemp = temp;

    if (mult > 0) {
      nextCur = Math.max(0, Math.min(max, cur + delta));
      // temp unchanged
    } else {
      const spentTemp = Math.min(temp, delta);
      nextTemp = Math.max(0, temp - delta);
      const remaining = Math.max(0, delta - spentTemp);
      nextCur = Math.max(0, Math.min(max, cur - remaining));
    }

    sheet.vitality["hp-current"].value = nextCur;
    sheet.vitality["hp-temp"].value = nextTemp;

    syncHpPopupInputs(sheet);
    markModalInteracted(player.id);
    scheduleSheetSave(player);
    if (sheetContent) updateHeroChips(sheetContent, sheet);
  }
  
  // ================== EXHAUSTION + CONDITIONS POPUPS ==================
  let exhPopupEl = null;
  let condPopupEl = null;

  const EXHAUSTION_LEVELS = [
    { lvl: 0, text: "Истощение отсутствует" },
    { lvl: 1, text: "Помеха на проверки характеристик" },
    { lvl: 2, text: "Скорость уменьшается вдвое" },
    { lvl: 3, text: "Помеха на броски атаки и спасброски" },
    { lvl: 4, text: "Максимальные хиты уменьшаются вдвое" },
    { lvl: 5, text: "Скорость уменьшается до 0" },
    { lvl: 6, text: "Смерть" }
  ];

  const CONDITIONS_DB = [
    { name: "Ослеплённое", desc: "Ослепленное существо не может видеть и автоматически проваливает любую проверку характеристик, зависящую от зрения.\nБроски атаки против существа совершаются с преимуществом, а броски атаки существа совершаются с помехой." },
    { name: "Заворожённое", desc: "Заворожённое существо не может напасть на заклинателя или использовать против заклинателя вредоносную способность или магические эффекты.\nЗаклинатель совершает с преимуществом любую проверку характеристик связанную с социальным взаимодействием с существом." },
    { name: "Оглохшее", desc: "Оглохшее существо не может слышать и автоматически проваливает любую проверку характеристики, которая связана со слухом." },
    { name: "Испуганное", desc: "Испуганное существо совершает с помехой проверки характеристик и броски атаки если источник его страха находится в пределах прямой видимости существа.\nСущество не может добровольно приблизиться к источнику своего страха." },
    { name: "Схваченное", desc: "Скорость схваченного существа становится 0, и он не может извлечь выгоду из какого-либо бонуса к своей скорости.\nПерсонаж выходит из состояния \"схвачен\", если схватившее его существо недееспособно (см. состояние).\nСостояние также заканчивается, если эффект удаляет схваченное существо из досягаемости захвата или эффекта захвата, например, когда существо отбрасывается заклинанием Громовой волны." },
    { name: "Недееспособное", desc: "Недееспособное существо не может предпринимать ни действия, ни реакции." },
    { name: "Невидимое", desc: "Невидимое существо невозможно увидеть без помощи магии или особых чувств. Для определения возможности Скрыться невидимого существа считается что оно находится в местности, видимость которого крайне затруднена. Местоположение существа можно определить по любому шуму, который оно издает, или по следам, которые оно оставляет.\nБроски атаки против существа совершаются с помехой, а броски атаки существа - с преимуществом." },
    { name: "Парализованное", desc: "Парализованное существо недееспособно (см. состояние) и не может двигаться или говорить.\nСущество автоматически проваливает спасброски по Силе и Ловкости.\nБроски атаки против существа совершаются с преимуществом.\nЛюбая атака, которая поражает существо, является критическим попаданием, если нападающий находится в пределах 5 футов от существа." },
    { name: "Окаменевшее", desc: "Окаменевшее существо превращается вместе с любыми неволшебными предметами, который оно носит или несет, в твердую неодушевленную субстанцию (обычно камень). Его вес увеличивается в десять раз и оно перестает стареть.\nСущество недееспособно (см. состаяние), не может двигаться или говорить и не знает о своем окружении.\nБроски атаки против существа совершаются с преимуществом.\nСущество автоматически проваливает спасброски по Силе и Ловкости.\nУ окаменевшего существа устойчивость ко всем повреждениям.\nСущество невосприимчиво к яду и болезням, хотя яд или болезнь уже в его организме приостановлены, а не нейтрализованы." },
    { name: "Отравленное", desc: "Отравленное существо совершает с помехой броски атаки и проверки характеристик." },
    { name: "Распластанное", desc: "Если существо не поднимается на ноги и не оканчивает таким образом действие этого состояния, то единственный вариант движения распластанного существа это ползание.\nСущество совершает броски атаки с помехой.\nБроски атаки против существа совершаются с преимуществом, если нападающий находится в пределах 5 футов от существа. В противном случае, броски атаки совершаются с помехой." },
    { name: "Обездвиженное", desc: "Скорость обездвиженного существа становится 0 и никакие эффекты не могут повысить его скорость.\nБроски атаки против существа совершаются с преимуществом, а броски атаки существа совершаются с помехой.\nСущество совершает спасброски Ловкости с помехой." },
    { name: "Оглушенное", desc: "Оглушенное существо недееспособно (см. состояние), не может двигаться и может говорить только запинаясь.\nСущество автоматически проваливает спасброски по Силе и Ловкости.\nБроски атаки против существа совершаются с преимуществом." },
    { name: "Без сознания", desc: "Бессознательное существо недееспособно (см. состояние), не может двигаться или говорить и не осознает своего окружения.\nСущество роняет то, что держало, и падает ничком, получая состояние \"Распластанное\".\nСущество автоматически проваливает спасброски по Силе и Ловкости.\nБроски атаки против существа совершаются с преимуществом.\nЛюбая атака, которая поражает существо, является критическим попаданием, если нападающий находится в пределах 5 футов от существа." }
  ];

// ================== LANGUAGES (Learn popup) ==================
const LANGUAGES_DB = {
  common: [
    { id: "giant", name: "Великаний", typical: "Огры, великаны", script: "Дварфская" },
    { id: "gnomish", name: "Гномий", typical: "Гномы", script: "Дварфская" },
    { id: "goblin", name: "Гоблинский", typical: "Гоблиноиды", script: "Дварфская" },
    { id: "dwarvish", name: "Дварфский", typical: "Дварфы", script: "Дварфская" },
    { id: "common", name: "Общий", typical: "Люди", script: "Общая" },
    { id: "orc", name: "Орочий", typical: "Орки", script: "Дварфская" },
    { id: "halfling", name: "Полуросликов", typical: "Полурослики", script: "Общая" },
    { id: "elvish", name: "Эльфийский", typical: "Эльфы", script: "Эльфийская" }
  ],
  exotic: [
    { id: "abyssal", name: "Бездны", typical: "Демоны", script: "Инфернальная" },
    { id: "deep_speech", name: "Глубинная Речь", typical: "Иллитиды, бехолдеры", script: "-" },
    { id: "draconic", name: "Драконий", typical: "Драконы, драконорождённые", script: "Драконья" },
    { id: "infernal", name: "Инфернальный", typical: "Дьяволы", script: "Инфернальная" },
    { id: "celestial", name: "Небесный", typical: "Небожители", script: "Небесная" },
    { id: "primordial", name: "Первичный", typical: "Элементали", script: "Дварфская" },
    { id: "undercommon", name: "Подземный", typical: "Купцы Подземья", script: "Эльфийская" },
    { id: "sylvan", name: "Сильван", typical: "Фейские существа", script: "Эльфийская" }
  ]
};

function extractLanguagesHint(profText) {
  const t = String(profText || "");
  const m = t.match(/Знание\s+языков\s*:\s*([^\n\r]+)/i);
  return (m && m[1]) ? String(m[1]).trim() : "";
}

function normalizeLanguagesLearned(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(x => x && typeof x === "object")
    .map(x => ({
      id: String(x.id || ""),
      name: String(x.name || ""),
      typical: String(x.typical || ""),
      script: String(x.script || ""),
      category: String(x.category || "")
    }))
    .filter(x => x.name);
}


function openLanguagesPopup(player) {
  if (!player?.sheet?.parsed) return;
  if (!canEditPlayer(player)) return;

  const renderCol = (title, items, category) => {
    const rows = items.map(l => `
      <div class="lss-lang-row" data-lang-id="${escapeHtml(l.id)}">
        <div class="lss-lang-row-head">
          <div class="lss-lang-row-name">${escapeHtml(l.name)}</div>
          <button class="popup-btn primary" type="button"
            data-lang-learn="${escapeHtml(l.id)}"
            data-lang-cat="${escapeHtml(category)}">Выучить</button>
        </div>
        <div class="lss-lang-row-meta">Типичный представитель - ${escapeHtml(l.typical)}; Письменность - ${escapeHtml(l.script)}</div>
      </div>
    `).join("");

    return `
      <div class="lss-lang-col">
        <div class="lss-lang-col-title">${escapeHtml(title)}</div>
        ${rows}
      </div>
    `;
  };

  const { overlay, close } = openPopup({
    title: "Выучить язык",
    bodyHtml: `
      <div class="lss-lang-popup-grid">
        ${renderCol("Обычные языки", LANGUAGES_DB.common, "common")}
        ${renderCol("Экзотические языки", LANGUAGES_DB.exotic, "exotic")}
      </div>
    `
  });

  overlay.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-lang-learn]");
    if (!btn) return;

    const id = String(btn.getAttribute("data-lang-learn") || "").trim();
    const cat = String(btn.getAttribute("data-lang-cat") || "").trim();

    const all = [
      ...LANGUAGES_DB.common.map(x => ({ ...x, category: "common" })),
      ...LANGUAGES_DB.exotic.map(x => ({ ...x, category: "exotic" }))
    ];
    const found = all.find(x => x.id === id);
    if (!found) return;

    const sheet = player.sheet.parsed;
    if (!sheet.info || typeof sheet.info !== "object") sheet.info = {};
    if (!Array.isArray(sheet.info.languagesLearned)) sheet.info.languagesLearned = [];

    const already = sheet.info.languagesLearned.some(x =>
      String(x?.id || "") === id || String(x?.name || "") === found.name
    );

    if (!already) {
      sheet.info.languagesLearned.push({
        id: found.id,
        name: found.name,
        typical: found.typical,
        script: found.script,
        category: cat || found.category || ""
      });
    }

    markModalInteracted(player.id);
    scheduleSheetSave(player);
    close();
    renderSheetModal(player, { force: true });
  });
}

function bindLanguagesUi(root, player, canEdit) {
  if (!root) return;
  if (root.__langWired) return;
  root.__langWired = true;

  // Делегирование: кнопка открытия попапа + удаление выученного языка
  root.addEventListener("click", (e) => {
    const openBtn = e.target?.closest?.("[data-lang-popup-open]");
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (!canEdit) return;
      openLanguagesPopup(player);
      return;
    }

    const rm = e.target?.closest?.("[data-lang-remove-id]");
    if (rm) {
      e.preventDefault();
      e.stopPropagation();
      if (!canEdit) return;
      const id = String(rm.getAttribute("data-lang-remove-id") || "").trim();
      if (!id) return;
      const sheet = player?.sheet?.parsed;
      if (!sheet?.info || typeof sheet.info !== "object") return;
      if (!Array.isArray(sheet.info.languagesLearned)) return;

      sheet.info.languagesLearned = sheet.info.languagesLearned.filter(x => {
        const xid = String(x?.id || x?.name || "");
        return xid !== id;
      });

      markModalInteracted(player.id);
      scheduleSheetSave(player);
      renderSheetModal(player, { force: true });
    }
  });
}



  function parseCondList(s) {
    if (!s || typeof s !== "string") return [];
    return s.split(",").map(x => x.trim()).filter(Boolean);
  }
  function setCondList(sheet, arr) {
    const s = Array.from(new Set(arr.map(x => String(x).trim()).filter(Boolean))).join(", ");
    sheet.conditions = s;
    return s;
  }
  // ВАЖНО: "Истощение" и "Состояние" не связаны.
  // sheet.exhaustion хранит только уровень (0..6),
  // sheet.conditions хранит выбранное состояние (строка) или пусто.

  function ensureExhPopup() {
    if (exhPopupEl) return exhPopupEl;
    exhPopupEl = document.createElement("div");
    exhPopupEl.className = "mini-popover hidden";
    exhPopupEl.innerHTML = `
      <div class="mini-popover__backdrop" data-exh-close></div>
      <div class="mini-popover__panel mini-popover__panel--wide" role="dialog" aria-label="Истощение">
        <div class="mini-popover__head">
          <div class="mini-popover__title">Истощение</div>
          <button class="mini-popover__x" type="button" data-exh-close>✕</button>
        </div>
        <div class="mini-popover__body">
          <div class="exh-table">
            <div class="exh-row exh-row--head">
              <div>Уровень</div><div>Эффект</div>
            </div>
            ${EXHAUSTION_LEVELS.map(r => `
              <button class="exh-row" type="button" data-exh-set="${r.lvl}">
                <div class="exh-lvl">${r.lvl}</div>
                <div class="exh-txt">${escapeHtml(r.text)}</div>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
    sheetModal?.appendChild(exhPopupEl);

    exhPopupEl.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-exh-close]")) { hideExhPopup(); return; }
      const btn = t.closest("[data-exh-set]");
      if (btn) {
        const lvl = Math.max(0, Math.min(6, safeInt(btn.getAttribute("data-exh-set"), 0)));
        const player = getOpenedPlayerSafe();
        if (!player) return;
        if (!canEditPlayer(player)) return;
        const sheet = player.sheet?.parsed;
        if (!sheet) return;
        sheet.exhaustion = lvl;
        // sync visible input without full re-render
        try {
          const exInput = sheetContent?.querySelector('[data-sheet-path="exhaustion"]');
          if (exInput && exInput instanceof HTMLInputElement) exInput.value = String(lvl);
        } catch {}

        markModalInteracted(player.id);
        scheduleSheetSave(player);
        hideExhPopup();
      }
    });

    exhPopupEl.addEventListener("keydown", (e) => { if (e.key === "Escape") hideExhPopup(); });
    return exhPopupEl;
  }

  function showExhPopup() { ensureExhPopup().classList.remove("hidden"); }
  function hideExhPopup() { exhPopupEl?.classList.add("hidden"); }

  function ensureCondPopup() {
    if (condPopupEl) return condPopupEl;
    condPopupEl = document.createElement("div");
    condPopupEl.className = "mini-popover hidden";
    condPopupEl.innerHTML = `
      <div class="mini-popover__backdrop" data-cond-close></div>
      <div class="mini-popover__panel mini-popover__panel--wide" role="dialog" aria-label="Состояния">
        <div class="mini-popover__head">
          <div class="mini-popover__title">Состояния</div>
          <button class="mini-popover__x" type="button" data-cond-close>✕</button>
        </div>
        <div class="mini-popover__body">
          <button class="cond-clear" type="button" data-cond-clear>Убрать состояние</button>
          <div class="cond-list">
            ${CONDITIONS_DB.map((c, i) => `
              <div class="cond-item" data-cond-name="${escapeHtml(c.name)}">
                <div class="cond-item__row">
                  <button class="cond-item__name" type="button" data-cond-toggle="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>
                  <button class="cond-item__descbtn" type="button" data-cond-desc="${i}">Описание</button>
                </div>
                <div class="cond-item__desc hidden" data-cond-descbox="${i}">${escapeHtml(c.desc).replace(/\n/g, "<br>")}</div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
    sheetModal?.appendChild(condPopupEl);

    condPopupEl.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-cond-close]")) { hideCondPopup(); return; }

      if (t.closest("[data-cond-clear]")) {
        const player = getOpenedPlayerSafe();
        if (!player) return;
        if (!canEditPlayer(player)) return;
        const sheet = player.sheet?.parsed;
        if (!sheet) return;

        // очищаем только состояние (истощение не трогаем)
        sheet.conditions = "";

        markModalInteracted(player.id);
        scheduleSheetSave(player);

        try {
          const input = sheetContent?.querySelector('[data-sheet-path="conditions"]');
          if (input && input instanceof HTMLInputElement) input.value = sheet.conditions || "";
          const condChip = sheetContent?.querySelector('[data-cond-open]');
          if (condChip) condChip.classList.toggle('has-value', !!String(sheet.conditions || '').trim());
        } catch {}
        return;
      }

      const descBtn = t.closest("[data-cond-desc]");
      if (descBtn) {
        const i = descBtn.getAttribute("data-cond-desc");
        const box = condPopupEl.querySelector(`[data-cond-descbox="${i}"]`);
        if (box) box.classList.toggle("hidden");
        return;
      }

      const tog = t.closest("[data-cond-toggle]");
      if (tog) {
        const name = (tog.getAttribute("data-cond-toggle") || "").trim();
        if (!name) return;
        const player = getOpenedPlayerSafe();
        if (!player) return;
        if (!canEditPlayer(player)) return;
        const sheet = player.sheet?.parsed;
        if (!sheet) return;

        // одиночный выбор: повторный клик по выбранному состоянию = снять
        const cur = String(sheet.conditions || "").trim();
        const already = cur.toLowerCase() === name.toLowerCase();
        sheet.conditions = already ? "" : name;

        markModalInteracted(player.id);
        scheduleSheetSave(player);

        try {
          const input = sheetContent?.querySelector('[data-sheet-path="conditions"]');
          if (input && input instanceof HTMLInputElement) input.value = sheet.conditions || "";
          const condChip = sheetContent?.querySelector('[data-cond-open]');
          if (condChip) condChip.classList.toggle('has-value', !!String(sheet.conditions || '').trim());
        } catch {}
        return;
      }
    });

    condPopupEl.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCondPopup(); });
    return condPopupEl;
  }

  function showCondPopup() { ensureCondPopup().classList.remove("hidden"); }
  function hideCondPopup() { condPopupEl?.classList.add("hidden"); }
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

    // HP chip -> popup (делегирование, без привязки к старым player)
    sheetContent?.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const chip = t.closest('[data-hp-open]');
      if (chip) showHpPopup();
    });

    sheetContent?.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const chip = t.closest('[data-hp-open]');
      if (!chip) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showHpPopup();
      }
    });

    // Inspiration chip toggle
    sheetContent?.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const chip = t.closest('[data-hero="insp"]');
      if (!chip) return;
      const player = getOpenedPlayerSafe();
      if (!player) return;
      if (!canEditPlayer(player)) return;
      const sheet = player.sheet?.parsed;
      if (!sheet) return;
      sheet.inspiration = safeInt(sheet.inspiration, 0) ? 0 : 1;
      markModalInteracted(player.id);
      scheduleSheetSave(player);
      updateHeroChips(sheetContent, sheet);
    });

    // Exhaustion/Conditions popups
    sheetContent?.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      const ex = t.closest('[data-exh-open]');
      if (ex) { showExhPopup(); return; }

      const co = t.closest('[data-cond-open]');
      if (co) { showCondPopup(); return; }
    });
  }

  // Прямая привязка кликов к текущему DOM (на случай, если делегирование не сработало
  // из-за disabled input / особенностей браузера). Вызывается после каждого рендера модалки.
  function wireQuickBasicInteractions(root) {
    if (!root || root.__basicQuickWired) return;
    root.__basicQuickWired = true;

    // Вдохновение (звезда)
    const inspChip = root.querySelector('[data-hero="insp"]');
    if (inspChip) {
      inspChip.addEventListener('click', (e) => {
        e.stopPropagation();
        const player = getOpenedPlayerSafe();
        if (!player) return;
        if (!canEditPlayer(player)) return;
        const sheet = player.sheet?.parsed;
        if (!sheet) return;
        sheet.inspiration = safeInt(sheet.inspiration, 0) ? 0 : 1;
        markModalInteracted(player.id);
        scheduleSheetSave(player);
        updateHeroChips(root, sheet);
      });
    }

    // Истощение/Состояние: открытие попапов кликом по рамке
    const exhChip = root.querySelector('[data-exh-open]');
    if (exhChip) exhChip.addEventListener('click', (e) => { e.stopPropagation(); showExhPopup(); });

    const condChip = root.querySelector('[data-cond-open]');
    if (condChip) condChip.addEventListener('click', (e) => { e.stopPropagation(); showCondPopup(); });
  }

  // keep condition chip highlight in sync when user edits the field manually
  sheetContent?.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const inp = t.closest('[data-sheet-path="conditions"]');
    if (!inp) return;
    const chip = sheetContent?.querySelector('[data-cond-open]');
    if (chip) chip.classList.toggle('has-value', !!String(inp.value || '').trim());
  });



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
        classArchetype: { value: "" },
        level: { value: 1 },
        race: { value: "" },
        raceArchetype: { value: "" },
        languagesLearned: [],
        background: { value: "" },
        alignment: { value: "" }
      },
      vitality: {
        "hp-max": { value: 0 },
        "hp-current": { value: 0 },
        "hp-temp": { value: 0 },
        ac: { value: 0 },
        speed: { value: 0 }
      },
      proficiency: 0,
      inspiration: 0,
      exhaustion: 0,
      conditions: "",
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
          gender: { value: "" },
          height: { value: "" },
          weight: { value: "" },
          age: { value: "" },
          eyes: { value: "" },
          skin: { value: "" },
          hair: { value: "" }
        },
        entries: []
      },
      text: {
        // Инвентарь: свободные заметки (редактируются во вкладке "Инвентарь")
        inventoryItems: { value: "" },
        inventoryTreasures: { value: "" }
      },
      combat: {
        skillsAbilities: { value: "" }
      },
      weaponsList: [],
      coins: { cp: { value: 0 }, sp: { value: 0 }, ep: { value: 0 }, gp: { value: 0 }, pp: { value: 0 } },
      // в какую монету пересчитывать общий итог (по умолчанию ЗМ)
      coinsView: { denom: "gp" }
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
    const hpTemp = get(sheet, 'vitality.hp-temp.value', 0);
    const ac = get(sheet, 'vitality.ac.value', '-');
    const spd = get(sheet, 'vitality.speed.value', '-');

    const inspiration = safeInt(get(sheet, 'inspiration', 0), 0) ? 1 : 0;
    const exhaustion = Math.max(0, Math.min(6, safeInt(get(sheet, 'exhaustion', 0), 0)));
    const conditions = (typeof get(sheet, 'conditions', "") === "string") ? get(sheet, 'conditions', "") : "";

    const statKeys = ["str","dex","con","int","wis","cha"];
    const stats = statKeys.map(k => {
      const s = sheet?.stats?.[k] || {};
      const label = s.label || ({ str:"Сила", dex:"Ловкость", con:"Телосложение", int:"Интеллект", wis:"Мудрость", cha:"Харизма" })[k];
      const score = safeInt(s.score, 10);
      const mod = safeInt(s.modifier, 0);
      const saveProf = !!(sheet?.saves?.[k]?.isProf);
      return { k, label, score, mod, check: calcCheckBonus(sheet, k), save: calcSaveBonus(sheet, k), saveProf, skills: [] };
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
    const languagesHint = extractLanguagesHint(profText);
    const languagesLearned = normalizeLanguagesLearned(sheet?.info?.languagesLearned);

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

    const coinsViewDenom = String(sheet?.coinsView?.denom || "gp").toLowerCase();

    return { name, cls, lvl, race, hp, hpCur, hpTemp, ac, spd, inspiration, exhaustion, conditions, stats, passive, profLines, profText, languagesHint, languagesLearned, personality, notesDetails, notesEntries, spellsInfo, slots, spellsByLevel, spellsPlainByLevel, spellNameByHref, spellDescByHref, profBonus: getProfBonus(sheet), weapons, coins, coinsViewDenom };
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

  // ===== Coins helpers =====
  const COIN_TO_CP = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

  function coinsTotalCp(sheet) {
    const cp = safeInt(sheet?.coins?.cp?.value, 0);
    const sp = safeInt(sheet?.coins?.sp?.value, 0);
    const ep = safeInt(sheet?.coins?.ep?.value, 0);
    const gp = safeInt(sheet?.coins?.gp?.value, 0);
    const pp = safeInt(sheet?.coins?.pp?.value, 0);
    return cp * 1 + sp * 10 + ep * 50 + gp * 100 + pp * 1000;
  }

  function fmtCoinNumber(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return "0";
    const rounded = Math.round(n * 100) / 100;
    return (Math.abs(rounded - Math.round(rounded)) < 1e-9)
      ? String(Math.round(rounded))
      : String(rounded);
  }

  function updateCoinsTotal(root, sheet) {
    if (!root || !sheet) return;
    const out = root.querySelector('[data-coins-total]');
    if (!out) return;

    let denom = String(sheet?.coinsView?.denom || "gp").toLowerCase();
    const denomSel = root.querySelector('[data-coins-total-denom]');
    if (denomSel && denomSel.value) denom = String(denomSel.value).toLowerCase();

    const base = COIN_TO_CP[denom] || 100;
    const total = coinsTotalCp(sheet) / base;
    out.value = fmtCoinNumber(total);
  }

  
  // ===== LIVE UI UPDATERS (без полного ререндера) =====
  function updateHeroChips(root, sheet) {
    if (!root || !sheet) return;
    const ac = safeInt(sheet?.vitality?.ac?.value, 0);
    const hp = safeInt(sheet?.vitality?.["hp-max"]?.value, 0);
    const hpCur = safeInt(sheet?.vitality?.["hp-current"]?.value, 0);
    const spd = safeInt(sheet?.vitality?.speed?.value, 0);

    const acEl = root.querySelector('[data-hero-val="ac"]');
    if (acEl) {
      if (acEl.tagName === "INPUT" || acEl.tagName === "TEXTAREA") acEl.value = String(ac);
      else acEl.textContent = String(ac);
    }

    const hpEl = root.querySelector('[data-hero-val="hp"]');
    const hpTemp = safeInt(sheet?.vitality?.["hp-temp"]?.value, 0);
    if (hpEl) hpEl.textContent = (hpTemp > 0 ? `(${hpTemp}) ${hpCur}/${hp}` : `${hpCur}/${hp}`);

    // HP "liquid" fill in chip (shrinks right-to-left)
    const hpChip = root.querySelector('[data-hero="hp"]');
    if (hpChip) {
      const ratio = (hp > 0) ? Math.max(0, Math.min(1, hpCur / hp)) : 0;
      const pct = Math.round(ratio * 100);
      hpChip.style.setProperty('--hp-fill-pct', `${pct}%`);
    }


    // Inspiration star (SVG)
    const inspChip = root.querySelector('[data-hero="insp"] .insp-star');
    if (inspChip) {
      const on = !!safeInt(sheet?.inspiration, 0);
      inspChip.classList.toggle('on', on);
    }

    const spdEl = root.querySelector('[data-hero-val="speed"]');
    if (spdEl) {
      if (spdEl.tagName === "INPUT" || spdEl.tagName === "TEXTAREA") spdEl.value = String(spd);
      else spdEl.textContent = String(spd);
    }
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
  main.innerHTML = renderActiveTab("combat", freshVm, canEdit);

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
        // Авто-пересчёт метрик заклинаний при изменении бонуса мастерства
        if (player?._activeSheetTab === "spells" && (path === "proficiency" || path === "proficiencyCustom")) {
          const s = player.sheet?.parsed;
          if (s) rerenderSpellsTabInPlace(root, player, s, canEdit);
        }

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


        // Истощение (0..6) и Состояние (строка) не связаны
        if (path === "exhaustion") {
          const ex = Math.max(0, Math.min(6, safeInt(getByPath(player.sheet.parsed, "exhaustion"), 0)));
          setByPath(player.sheet.parsed, "exhaustion", ex);
        }

        if (path === "name.value") player.name = val || player.name;

        // keep hp popup synced after re-render
    try {
      if (hpPopupEl && !hpPopupEl.classList.contains('hidden')) {
        const pNow = getOpenedPlayerSafe();
        if (pNow?.sheet?.parsed) syncHpPopupInputs(pNow.sheet.parsed);
      }
    } catch {}

// live updates
if (path === "proficiency" || path === "proficiencyCustom") {
  // пересчитать навыки/пассивы + проверка/спасбросок (т.к. зависят от бонуса владения)
  updateSkillsAndPassives(root, player.sheet.parsed);
  try {
    ["str","dex","con","int","wis","cha"].forEach(k => updateDerivedForStat(root, player.sheet.parsed, k));
  } catch {}

  // обновить подсказку у кружков спасбросков
  root.querySelectorAll('.lss-save-dot[data-save-key]').forEach(d => {
    const statKey = d.getAttribute('data-save-key');
    if (statKey) d.title = `Владение спасброском: +${getProfBonus(player.sheet.parsed)} к спасброску`;
  });

  updateWeaponsBonuses(root, player.sheet.parsed);
}
        if (path === "vitality.ac.value" || path === "vitality.hp-max.value" || path === "vitality.hp-current.value" || path === "vitality.speed.value") {
          updateHeroChips(root, player.sheet.parsed);
        }

        // Если мы сейчас на вкладке "Заклинания" — пересчитываем метрики при изменении владения
        if (player?._activeSheetTab === "spells" && (path === "proficiency" || path === "proficiencyCustom")) {
          const s = player.sheet?.parsed;
          if (s) rerenderSpellsTabInPlace(root, player, s, canEdit);
        }

        // Монеты: обновляем пересчёт итога без полного ререндера
        if (path.startsWith("coins.") || path.startsWith("coinsView.")) {
          updateCoinsTotal(root, player.sheet.parsed);
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

  // ===== clickable dot binding (saving throws proficiency) =====
  function bindSaveProfDots(root, player, canEdit) {
    if (!root || !player?.sheet?.parsed) return;

    const sheet = player.sheet.parsed;
    const dots = root.querySelectorAll('.lss-save-dot[data-save-key]');
    dots.forEach(dot => {
      const statKey = dot.getAttribute('data-save-key');
      if (!statKey) return;

      dot.classList.add('clickable');
      dot.classList.toggle('active', !!sheet?.saves?.[statKey]?.isProf);
      dot.title = `Владение спасброском: +${getProfBonus(sheet)} к спасброску`;

      if (!canEdit) return;

      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!canEdit) return;

        if (!sheet.saves || typeof sheet.saves !== 'object') sheet.saves = {};
        if (!sheet.saves[statKey] || typeof sheet.saves[statKey] !== 'object') {
          sheet.saves[statKey] = { name: statKey, isProf: false, bonus: 0 };
        }

        sheet.saves[statKey].isProf = !sheet.saves[statKey].isProf;
        dot.classList.toggle('active', !!sheet.saves[statKey].isProf);
        dot.title = `Владение спасброском: +${getProfBonus(sheet)} к спасброску`;

        // обновить значение спасброска в UI
        const ability = dot.closest('.lss-ability');
        const saveInp = ability?.querySelector(`.lss-pill-val[data-kind="save"][data-stat-key="${CSS.escape(statKey)}"]`);
        if (saveInp) {
          const v = formatMod(calcSaveBonus(sheet, statKey));
          if (saveInp.tagName === 'INPUT' || saveInp.tagName === 'TEXTAREA') saveInp.value = v;
          else saveInp.textContent = v;
        }

        scheduleSheetSave(player);
      });
    });
  }

  // ===== dice buttons (checks/saves/skills) =====
  function bindStatRollButtons(root, player) {
    if (!root || !player?.sheet?.parsed) return;
    const sheet = player.sheet.parsed;

    const btns = root.querySelectorAll('.lss-dice-btn[data-roll-kind]');
    btns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const kind = btn.getAttribute('data-roll-kind');
        let bonus = 0;
        let kindText = 'Бросок d20';

        if (kind === 'skill') {
          const skillKey = btn.getAttribute('data-skill-key');
          if (!skillKey) return;
          bonus = calcSkillBonus(sheet, skillKey);
          const label = sheet?.skills?.[skillKey]?.label || skillKey;
          kindText = `${label}: d20${bonus ? formatMod(bonus) : ''}`;
        }

        if (kind === 'check') {
          const statKey = btn.getAttribute('data-stat-key');
          if (!statKey) return;
          bonus = calcCheckBonus(sheet, statKey);
          const label = sheet?.stats?.[statKey]?.label || statKey;
          kindText = `${label}: Проверка d20${bonus ? formatMod(bonus) : ''}`;
        }

        if (kind === 'save') {
          const statKey = btn.getAttribute('data-stat-key');
          if (!statKey) return;
          bonus = calcSaveBonus(sheet, statKey);
          const label = sheet?.stats?.[statKey]?.label || statKey;
          kindText = `${label}: Спасбросок d20${bonus ? formatMod(bonus) : ''}`;
        }

        // бросок в общую панель кубиков (и в лог/"Броски других")
        if (window.DicePanel?.roll) {
          await window.DicePanel.roll({ sides: 20, count: 1, bonus, kindText });
        }
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

  // ===== Inventory (coins) editors =====
  function bindInventoryEditors(root, player, canEdit) {
    if (!root) return;
    // как и в bindSlotEditors: root (sheetContent) переиспользуется.
    // Храним актуальные ссылки, чтобы монеты не писались в sheet старого игрока.
    root.__invCoinsState = { player, canEdit };
    const getState = () => root.__invCoinsState || { player, canEdit };

    if (root.__invCoinsBound) return;
    root.__invCoinsBound = true;

    root.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-coin-op][data-coin-key]");
      if (!btn) return;

      const { player: curPlayer, canEdit: curCanEdit } = getState();
      if (!curCanEdit) return;

      const sheet = curPlayer?.sheet?.parsed;
      if (!sheet || typeof sheet !== "object") return;

      const op = btn.getAttribute("data-coin-op");
      const key = btn.getAttribute("data-coin-key");
      if (!key) return;

      const box = btn.closest(`[data-coin-box="${key}"]`) || root;
      const deltaInp = box.querySelector(`[data-coin-delta="${key}"]`);
      const coinInp = root.querySelector(`input[data-sheet-path="coins.${key}.value"]`);
      if (!coinInp) return;

      const delta = Math.max(0, safeInt(deltaInp?.value, 1));
      const cur = Math.max(0, safeInt(coinInp.value, 0));
      const next = (op === "plus") ? (cur + delta) : Math.max(0, cur - delta);

      setByPath(sheet, `coins.${key}.value`, next);
      coinInp.value = String(next);

      updateCoinsTotal(root, sheet);
      scheduleSheetSave(curPlayer);
    });
  }

  // ===== Slots (spell slots) editors =====
function bindSlotEditors(root, player, canEdit) {
  if (!root || !player?.sheet) return;

  // IMPORTANT:
  // sheetContent (root) переиспользуется между открытиями модалки и при импорте .json.
  // Если повесить обработчики один раз и замкнуть player в closure — появится рассинхрон:
  // клики/правки будут менять sheet старого игрока, а UI будет рендериться по новому.
  // Поэтому храним актуальные ссылки на player/canEdit прямо на root и берём их в момент события.
  root.__spellSlotsState = { player, canEdit };

  const getState = () => root.__spellSlotsState || { player, canEdit };

  const getSheet = () => {
    const { player: curPlayer } = getState();
    const s = curPlayer?.sheet?.parsed;
    if (!s || typeof s !== "object") return null;
    if (!s.spells || typeof s.spells !== "object") s.spells = {};
    return s;
  };

  const inputs = root.querySelectorAll(".slot-current-input[data-slot-level]");
  inputs.forEach(inp => {
    const lvl = safeInt(inp.getAttribute("data-slot-level"), 0);
    if (!lvl) return;

    if (!canEdit) { inp.disabled = true; return; }

    const handler = () => {
      const sheet = getSheet();
      if (!sheet) return;

      // desired = итоговое число ячеек (0..12)
      // Требование: если уменьшаем число — лишние ячейки должны удаляться целиком (а не просто "разряжаться").
      // Если увеличиваем — новые ячейки считаем заряженными.
      const desiredTotal = Math.max(0, Math.min(12, safeInt(inp.value, 0)));

      const key = `slots-${lvl}`;
      if (!sheet.spells[key] || typeof sheet.spells[key] !== "object") {
        sheet.spells[key] = { value: 0, filled: 0 };
      }

      const totalPrev = numLike(sheet.spells[key].value, 0);
      const filledPrev = numLike(sheet.spells[key].filled, 0);
      const currentPrev = Math.max(0, totalPrev - filledPrev);

      // total slots = desiredTotal (уменьшение удаляет лишние)
      const total = desiredTotal;

      // current (заряжено): при увеличении — полностью заряжаем, при уменьшении — не больше total
      const current = (total > totalPrev) ? total : Math.min(currentPrev, total);

      setMaybeObjField(sheet.spells[key], "value", total);
      setMaybeObjField(sheet.spells[key], "filled", Math.max(0, total - current));

      // update dots in UI without full rerender
      const dotsWrap = root.querySelector(`.slot-dots[data-slot-dots="${lvl}"]`);
      if (dotsWrap) {
        const totalForUi = Math.max(0, Math.min(12, numLike(sheet.spells[key].value, 0)));
        const dots = Array.from({ length: totalForUi })
          .map((_, i) => `<span class="slot-dot${i < current ? " is-available" : ""}" data-slot-level="${lvl}"></span>`)
          .join("");
        dotsWrap.innerHTML = dots || `<span class="slot-dots-empty">—</span>`;
      }

      inp.value = String(total);
      const { player: curPlayer } = getState();
      scheduleSheetSave(curPlayer);
    };

    inp.addEventListener("input", handler);
    inp.addEventListener("change", handler);
  });

  // кликабельные кружки: синий = доступно, пустой = использовано
  if (!root.__spellSlotsDotsBound) {
    root.__spellSlotsDotsBound = true;
    root.addEventListener("click", async (e) => {
      const { player: curPlayer, canEdit: curCanEdit } = getState();

      // ===== 🎲 Атака заклинанием (d20 + бонус атаки) =====
      // (должно работать независимо от клика по слотам)
      const rollHeaderBtn = e.target?.closest?.("[data-spell-roll-header]");
      const rollSpellBtn = e.target?.closest?.("[data-spell-roll]");

      if (rollHeaderBtn || rollSpellBtn) {
        const sheet = getSheet();
        if (!sheet) return;

        const bonus = computeSpellAttack(sheet);

        let lvl = 0;
        let title = "";
        if (rollSpellBtn) {
          const item = rollSpellBtn.closest(".spell-item");
          lvl = safeInt(item?.getAttribute?.("data-spell-level"), 0);
          title = (item?.querySelector?.(".spell-item-link")?.textContent || item?.querySelector?.(".spell-item-title")?.textContent || "").trim();
        }

        // Бонус для броска берём из видимого поля "Бонус атаки" (если есть),
        // чтобы итог в панели "Бросок" совпадал с тем, что видит игрок.
        const atkInput = root.querySelector('[data-spell-attack-bonus]');
        const uiBonus = atkInput ? safeInt(atkInput.value, bonus) : bonus;

        // В панели "Бросок" не показываем текст "Атака заклинанием" — только число.
        // А в журнал/другим игрокам отправляем отдельное событие с понятным названием.
        let rollRes = null;
        if (window.DicePanel?.roll) {
          rollRes = await window.DicePanel.roll({
            sides: 20,
            count: 1,
            bonus: uiBonus,
            // Показываем в панели "Бросок" так же, как атака оружием:
            // "Заклинания: d20+X" (X берётся из поля "Бонус атаки" в разделе Заклинаний)
            kindText: `Заклинания: d20${formatMod(uiBonus)}`,
            silent: true
          });
        }

        try {
          if (typeof sendMessage === 'function' && rollRes) {
            const r = rollRes.rolls?.[0];
            const b = Number(rollRes.bonus) || 0;
            const bonusTxt = b ? ` ${b >= 0 ? '+' : '-'} ${Math.abs(b)}` : '';
            const nameTxt = title ? ` (${title})` : '';
            sendMessage({
              type: 'log',
              text: `Атака заклинанием${nameTxt}: d20(${r})${bonusTxt} => ${rollRes.total}`
            });

            sendMessage({
              type: 'diceEvent',
              event: {
                kindText: `Атака заклинанием${nameTxt}`,
                sides: 20,
                count: 1,
                bonus: b,
                rolls: [r],
                total: rollRes.total,
                crit: (r === 1 ? 'crit-fail' : r === 20 ? 'crit-success' : '')
              }
            });
          }
        } catch {}

        // если бросок был из конкретного заклинания — тратим 1 ячейку соответствующего уровня (кроме заговоров)
        if (rollSpellBtn && lvl > 0) {
          if (!curCanEdit) return;

          if (!sheet.spells || typeof sheet.spells !== "object") sheet.spells = {};
          const key = `slots-${lvl}`;
          if (!sheet.spells[key] || typeof sheet.spells[key] !== "object") sheet.spells[key] = { value: 0, filled: 0 };

          const total = Math.max(0, Math.min(12, numLike(sheet.spells[key].value, 0)));
          const filled = Math.max(0, Math.min(total, numLike(sheet.spells[key].filled, 0)));
          const available = Math.max(0, total - filled);

          if (available > 0) {
            setMaybeObjField(sheet.spells[key], "filled", Math.min(total, filled + 1));

            // обновим UI кружков конкретного уровня без полного ререндера
            const dotsWrap = root.querySelector(`.slot-dots[data-slot-dots="${lvl}"]`);
            if (dotsWrap) {
              const filled2 = Math.max(0, Math.min(total, numLike(sheet.spells[key].filled, 0)));
              const available2 = Math.max(0, total - filled2);
              const dots = Array.from({ length: total })
                .map((_, i) => `<span class="slot-dot${i < available2 ? " is-available" : ""}" data-slot-level="${lvl}"></span>`)
                .join("");
              dotsWrap.innerHTML = dots || `<span class="slot-dots-empty">—</span>`;
            }

            scheduleSheetSave(curPlayer);
          }
        }

        return;
      }

      // ===== слоты =====
      const dot = e.target?.closest?.(".slot-dot[data-slot-level]");
      if (!dot) return;

      if (!curCanEdit) return;

      const sheet = getSheet();
      if (!sheet) return;

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

      scheduleSheetSave(curPlayer);
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


function cleanupSpellDesc(raw) {
  let s = String(raw || "");

  // normalize newlines
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // remove injected commentsAccess tail (sometimes прилетает из html)
  s = s.replace(/window\.commentsAccess\s*=\s*\{[\s\S]*?\}\s*;?/g, "");
  s = s.replace(/window\.commentsAccess[\s\S]*?;?/g, "");

  // fix glued words like "вызовВремя" -> "вызов\nВремя"
  s = s.replace(/([0-9a-zа-яё])([A-ZА-ЯЁ])/g, "$1\n$2");

  // trim each line + collapse excessive blank lines
  s = s
    .split("\n")
    .map(l => l.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

function extractSpellFromHtml(html) {
  const rawHtml = String(html || "");

  let name = "";
  let desc = "";

  try {
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");

    // name
    name = (doc.querySelector('h2.card-title[itemprop="name"]')?.textContent || "").trim();

    // main description: from <ul class="params card__article-body"> ... until comments block
    const startEl = doc.querySelector('ul.params.card__article-body');
    if (startEl) {
      // best-effort: take text of this block (it usually contains all params + описание)
      desc = (startEl.innerText || startEl.textContent || "");
    }

    // fallback: slice between markers if DOM layout changed
    if (!desc) {
      const start = rawHtml.indexOf('<ul class="params card__article-body"');
      const end = rawHtml.indexOf('<section class="comments-block');
      if (start !== -1 && end !== -1 && end > start) {
        const slice = rawHtml.slice(start, end);
        const wrap = document.createElement("div");
        wrap.innerHTML = slice;
        desc = (wrap.innerText || wrap.textContent || "");
      }
    }
  } catch {
    name = name || "";
    desc = desc || "";
  }

  desc = cleanupSpellDesc(desc);

  return { name: name || "(без названия)", desc: desc || "" };
}



function ensureSpellSaved(sheet, level, name, href, desc) {
  if (!sheet.text || typeof sheet.text !== "object") sheet.text = {};

  // store meta
  sheet.text[`spell-name:${href}`] = { value: String(name || "").trim() };
  sheet.text[`spell-desc:${href}`] = { value: cleanupSpellDesc(desc || "") };

  // append to plain list if absent
  const plainKey = `spells-level-${level}-plain`;
  const cur = String(sheet.text?.[plainKey]?.value ?? "");
  const lines = cur.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const already = lines.some(l => l.includes(href));
  if (!already) lines.push(`${name} | ${href}`);
  sheet.text[plainKey] = { value: lines.join("\n") };
}



function deleteSpellSaved(sheet, href) {
  if (!sheet || !href) return;

  if (!sheet.text || typeof sheet.text !== "object") sheet.text = {};

  // remove meta
  delete sheet.text[`spell-name:${href}`];
  delete sheet.text[`spell-desc:${href}`];

  // remove from all plain lists
  for (let lvl = 0; lvl <= 9; lvl++) {
    const plainKey = `spells-level-${lvl}-plain`;
    const cur = String(sheet.text?.[plainKey]?.value ?? "");
    if (!cur) continue;
    const lines = cur.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const next = lines.filter(l => !l.includes(href));
    if (next.length) sheet.text[plainKey] = { value: next.join("\n") };
    else delete sheet.text[plainKey];
  }
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
  bindSaveProfDots(root, player, canEdit);
  bindStatRollButtons(root, player);
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
        <div class="sheet-note">Загрузка классов…</div>
      </div>
    `
  });

  const classSel = overlay.querySelector("[data-db-class]");
  const levelSel = overlay.querySelector("[data-db-level]");
  const searchInp = overlay.querySelector("[data-db-search]");
  const listBox = overlay.querySelector("[data-db-list]");

  if (!classSel || !listBox) return;

  // 1) classes
  try {
    if (!spellDbCache.classes) {
      const html = await fetchSpellHtml("https://dnd.su/spells/");
      spellDbCache.classes = parseSpellClassesFromHtml(html);
    }
    const classes = spellDbCache.classes || [];
    classSel.innerHTML = classes.map(c => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`).join("");
    if (!classes.length) {
      listBox.innerHTML = `<div class="sheet-note">Не удалось получить список классов с dnd.su.</div>`;
      return;
    }
  } catch (err) {
    console.error(err);
    listBox.innerHTML = `<div class="sheet-note">Не удалось загрузить базу (проверь соединение / прокси /api/fetch).</div>`;
    return;
  }

  async function loadAndRenderClass() {
    const classVal = classSel.value;
    const search = (searchInp?.value || "").trim().toLowerCase();
    const forceLevel = (levelSel?.value || "auto");

    listBox.innerHTML = `<div class="sheet-note">Загрузка заклинаний…</div>`;

    let spells = spellDbCache.byClass.get(classVal);
    try {
      if (!spells) {
        const url = `https://dnd.su/spells/?class=${encodeURIComponent(classVal)}`;
        const html = await fetchSpellHtml(url);
        spells = parseSpellsFromClassHtml(html);
        spellDbCache.byClass.set(classVal, spells);
      }
    } catch (err) {
      console.error(err);
      listBox.innerHTML = `<div class="sheet-note">Не удалось загрузить список заклинаний этого класса.</div>`;
      return;
    }

    const filtered = (spells || []).filter(s => {
      if (!search) return true;
      return String(s.name || "").toLowerCase().includes(search);
    });

    // group by level (0..9, null)
    const groups = new Map();
    for (const s of filtered) {
      const lvl = (s.level == null ? "?" : String(s.level));
      if (!groups.has(lvl)) groups.set(lvl, []);
      groups.get(lvl).push(s);
    }

    const order = ["0","1","2","3","4","5","6","7","8","9","?"];
    const htmlGroups = order
      .filter(k => groups.has(k) && groups.get(k).length)
      .map(k => {
        const title = (k === "0") ? "Заговоры (0)" : (k === "?" ? "Уровень не определён" : `Уровень ${k}`);
        const rows = groups.get(k).map(s => {
          const safeHref = escapeHtml(s.href);
          const safeName = escapeHtml(s.name);
          return `
            <div class="db-spell-row" data-db-href="${safeHref}" data-db-level="${escapeHtml(String(s.level ?? ""))}">
              <div class="db-spell-head">
                <button class="popup-btn" type="button" data-db-toggle style="padding:6px 10px;">${safeName}</button>
                <div class="db-spell-controls">
                  <button class="popup-btn primary" type="button" data-db-learn>Выучить</button>
                </div>
              </div>
              <div class="db-spell-desc hidden" data-db-desc>Загрузка описания…</div>
            </div>
          `;
        }).join("");
        return `
          <div class="sheet-card" style="margin:10px 0;">
            <h4 style="margin:0 0 6px 0;">${escapeHtml(title)}</h4>
            ${rows}
          </div>
        `;
      }).join("");

    listBox.innerHTML = htmlGroups || `<div class="sheet-note">Ничего не найдено.</div>`;

    // click handling inside listBox
    listBox.querySelectorAll("[data-db-toggle]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("[data-db-href]");
        const descEl = row?.querySelector("[data-db-desc]");
        if (!row || !descEl) return;

        const href = row.getAttribute("data-db-href");
        if (!href) return;

        const isHidden = descEl.classList.contains("hidden");
        // toggle
        descEl.classList.toggle("hidden");
        if (!isHidden) return;

        // load desc if needed
        try {
          const { name, desc } = await ensureDbSpellDesc(href);
          descEl.textContent = desc || "(описание пустое)";
          // обновим кнопку названием (если на странице оно отличается)
          btn.textContent = name || btn.textContent;
        } catch (err) {
          console.error(err);
          descEl.textContent = "Не удалось загрузить описание.";
        }
      });
    });

    listBox.querySelectorAll("[data-db-learn]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!canEdit) return;
        const row = btn.closest("[data-db-href]");
        if (!row) return;
        const href = row.getAttribute("data-db-href");
        if (!href) return;

        // decide level
        let lvl = null;
        if (forceLevel !== "auto") lvl = safeInt(forceLevel, 0);
        else {
          const raw = row.getAttribute("data-db-level");
          lvl = (raw != null && raw !== "") ? safeInt(raw, 0) : null;
        }
        if (lvl == null || lvl < 0 || lvl > 9) {
          // fallback: спросим у пользователя через подсказку
          lvl = 0;
        }

        btn.disabled = true;
        try {
          const { name, desc } = await ensureDbSpellDesc(href);
          ensureSpellSaved(sheet, lvl, name, href, desc);
          scheduleSheetSave(player);
          rerenderSpellsTabInPlace(root, player, sheet, canEdit);

          // визуально отметим "выучено"
          btn.textContent = "Выучено";
          btn.classList.remove("primary");
          btn.disabled = true;
        } catch (err) {
          console.error(err);
          alert("Не удалось выучить (ошибка загрузки/парсинга).");
          btn.disabled = false;
        }
      });
    });
  }

  classSel.addEventListener("change", loadAndRenderClass);
  levelSel?.addEventListener("change", loadAndRenderClass);
  searchInp?.addEventListener("input", () => {
    // лёгкий debounce
    clearTimeout(searchInp.__t);
    searchInp.__t = setTimeout(loadAndRenderClass, 120);
  });

  // initial render
  await loadAndRenderClass();
}

function bindSpellAddAndDesc(root, player, canEdit) {
  if (!root || !player?.sheet?.parsed) return;

  // IMPORTANT:
  // sheetContent (root) переиспользуется между открытиями модалки.
  // Нельзя один раз повесить обработчики с замыканием на player/canEdit,
  // иначе при открытии "Инфы" другого игрока (или после импорта .json, который меняет объект)
  // события будут применяться к старому sheet.
  // Поэтому храним актуальный контекст на root и читаем его в момент события.
  root.__spellAddState = { player, canEdit };

  const getState = () => root.__spellAddState || { player, canEdit };
  const getSheet = () => getState().player?.sheet?.parsed;

  // listeners вешаем один раз
  if (root.__spellAddInit) {
    // контекст обновили выше
    return;
  }
  root.__spellAddInit = true;

  root.addEventListener("click", async (e) => {
    const { player: curPlayer, canEdit: curCanEdit } = getState();

    const addBtn = e.target?.closest?.("[data-spell-add][data-spell-level]");
    if (addBtn) {
      if (!curCanEdit) return;
      const sheet = getSheet();
      if (!sheet) return;

      const lvl = safeInt(addBtn.getAttribute("data-spell-level"), 0);
      openAddSpellPopup({ root, player: curPlayer, sheet, canEdit: curCanEdit, level: lvl });
      return;
    }

    const dbBtn = e.target?.closest?.("[data-spell-db]");
    if (dbBtn) {
      const sheet = getSheet();
      if (!sheet) return;
      await openSpellDbPopup({ root, player: curPlayer, sheet, canEdit: curCanEdit });
      return;
    }

    const delBtn = e.target?.closest?.("[data-spell-delete]");
    if (delBtn) {
      if (!curCanEdit) return;
      const sheet = getSheet();
      if (!sheet) return;

      const item = delBtn.closest(".spell-item");
      const href = item?.getAttribute?.("data-spell-url") || "";
      if (!href) return;
      if (!confirm("Удалить это заклинание?")) return;

      deleteSpellSaved(sheet, href);
      scheduleSheetSave(curPlayer);
      rerenderSpellsTabInPlace(root, curPlayer, sheet, curCanEdit);
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

  // выбор базовой характеристики (STR/DEX/CON/INT/WIS/CHA)
  root.addEventListener("change", (e) => {
    const sel = e.target?.closest?.("[data-spell-base-ability]");
    if (!sel) return;
    const { player: curPlayer, canEdit: curCanEdit } = getState();
    if (!curCanEdit) return;

    const sheet = getSheet();
    if (!sheet) return;

    if (!sheet.spellsInfo || typeof sheet.spellsInfo !== "object") sheet.spellsInfo = {};
    if (!sheet.spellsInfo.base || typeof sheet.spellsInfo.base !== "object") sheet.spellsInfo.base = { code: "" };

    sheet.spellsInfo.base.code = String(sel.value || "").trim();

    // если пользователь не задал ручной бонус атаки — просто перерисуем, чтобы пересчитать формулу
    scheduleSheetSave(curPlayer);
    rerenderSpellsTabInPlace(root, curPlayer, sheet, curCanEdit);
  });

  // ручное редактирование бонуса атаки
  root.addEventListener("input", (e) => {
    const atk = e.target?.closest?.("[data-spell-attack-bonus]");
    if (atk) {
      const { player: curPlayer, canEdit: curCanEdit } = getState();
      if (!curCanEdit) return;

      const sheet = getSheet();
      if (!sheet) return;

      if (!sheet.spellsInfo || typeof sheet.spellsInfo !== "object") sheet.spellsInfo = {};
      if (!sheet.spellsInfo.mod || typeof sheet.spellsInfo.mod !== "object") sheet.spellsInfo.mod = { customModifier: "" };

      const v = String(atk.value || "").trim();
      const computed = computeSpellAttack(sheet);

      if (v === "") {
        // пусто = вернуть авто-расчет
        delete sheet.spellsInfo.mod.customModifier;
        if ("value" in sheet.spellsInfo.mod) delete sheet.spellsInfo.mod.value;
      } else {
        const n = parseModInput(v, computed);
        // если ввели ровно авто-значение — не фиксируем "ручной" модификатор, чтобы формула продолжала работать
        if (n === computed) {
          delete sheet.spellsInfo.mod.customModifier;
          if ("value" in sheet.spellsInfo.mod) delete sheet.spellsInfo.mod.value;
        } else {
          sheet.spellsInfo.mod.customModifier = String(n);
        }
      }

      scheduleSheetSave(curPlayer);
      // не перерисовываем на каждый ввод — чтобы курсор не прыгал
      return;
    }

    // редактирование описания (textarea внутри раскрывашки)
    const ta = e.target?.closest?.("[data-spell-desc-editor]");
    if (!ta) return;
    const { player: curPlayer, canEdit: curCanEdit } = getState();
    if (!curCanEdit) return;

    const sheet = getSheet();
    if (!sheet) return;

    const item = ta.closest(".spell-item");
    const href = item?.getAttribute?.("data-spell-url") || "";
    if (!href) return;

    if (!sheet.text || typeof sheet.text !== "object") sheet.text = {};
    const key = `spell-desc:${href}`;
    if (!sheet.text[key] || typeof sheet.text[key] !== "object") sheet.text[key] = { value: "" };
    sheet.text[key].value = cleanupSpellDesc(String(ta.value || ""));
    scheduleSheetSave(curPlayer);
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
    const d20SvgMini = `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M12 2 20.5 7v10L12 22 3.5 17V7L12 2Z" fill="currentColor" opacity="0.95"></path>
        <path d="M12 2v20M3.5 7l8.5 5 8.5-5M3.5 17l8.5-5 8.5 5" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"></path>
      </svg>
    `;

    const blocks = vm.stats.map(s => {
      const skillRows = (s.skills || []).map(sk => {
        const dotClass = (sk.boostLevel === 1) ? "boost1" : (sk.boostLevel === 2) ? "boost2" : "";
        return `
          <div class="lss-skill-row">
            <div class="lss-skill-left">
              <span class="lss-dot ${dotClass}" data-skill-key="${escapeHtml(sk.key)}"></span>
              <span class="lss-skill-name" title="${escapeHtml(sk.label)}">
                <span class="lss-skill-name-text">
                  ${escapeHtml(sk.label)}
                  <span class="lss-boost">${sk.boostStars ? ` ${escapeHtml(sk.boostStars)}` : ""}</span>
                </span>
              </span>
              <button class="lss-dice-btn" type="button" data-roll-kind="skill" data-skill-key="${escapeHtml(sk.key)}" title="Бросок: d20${escapeHtml(formatMod(sk.bonus))}">${d20SvgMini}</button>
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
              <div class="lss-pill-label-row">
                <span class="lss-pill-label">ПРОВЕРКА</span>
                <button class="lss-dice-btn" type="button" data-roll-kind="check" data-stat-key="${escapeHtml(s.k)}" title="Бросок проверки">
                  ${d20SvgMini}
                </button>
              </div>
              <input class="lss-pill-val lss-pill-val-input" type="text" value="${escapeHtml(formatMod(s.check))}" data-stat-key="${escapeHtml(s.k)}" data-kind="check">
            </div>
            <div class="lss-pill">
              <div class="lss-pill-label-row">
                <button class="lss-save-dot ${s.saveProf ? "active" : ""}" type="button" data-save-key="${escapeHtml(s.k)}" title="Владение спасброском"></button>
                <span class="lss-pill-label">СПАСБРОСОК</span>
                <button class="lss-dice-btn" type="button" data-roll-kind="save" data-stat-key="${escapeHtml(s.k)}" title="Бросок спасброска">
                  ${d20SvgMini}
                </button>
              </div>
              <input class="lss-pill-val lss-pill-val-input" type="text" value="${escapeHtml(formatMod(s.save))}" data-stat-key="${escapeHtml(s.k)}" data-kind="save">
            </div>
          </div>

          <div class="lss-ability-divider"></div>

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
        <div class="lss-passive-rowlist">
          ${rows}
        </div>
      </div>
    `;
  }

  function renderProfBox(vm) {
  const hint = String(vm.languagesHint || "").trim();
  const learned = Array.isArray(vm.languagesLearned) ? vm.languagesLearned : [];

  const learnedHtml = learned.length
    ? learned.map(l => `
        <div class="lss-lang-pill">
          <div class="lss-lang-pill-head">
            <div class="lss-lang-pill-name">${escapeHtml(l.name)}</div>
            <button class="lss-lang-pill-x" type="button" title="Удалить язык" data-lang-remove-id="${escapeHtml(String(l.id || l.name || ""))}">✕</button>
          </div>
          <div class="lss-lang-pill-meta"><span class="lss-lang-lbl">Типичный представитель</span> - ${escapeHtml(l.typical || "-")}; <span class="lss-lang-lbl">Письменность</span> - ${escapeHtml(l.script || "-")}</div>
        </div>
      `).join("")
    : `<div class="sheet-note">Пока языки не выбраны</div>`;

  // всегда показываем блок, даже без загруженного файла
  return `
    <div class="lss-profbox">
      <div class="lss-passives-title">ПРОЧИЕ ВЛАДЕНИЯ И ЗАКЛИНАНИЯ</div>

      <!-- Языки: на всю ширину блока -->
      <div class="lss-langbox lss-langbox--full">
        <div class="lss-langbox-head">
          <div class="lss-langbox-head-left">
            <div class="lss-langbox-title">ЯЗЫКИ</div>
            <div class="lss-langbox-head-hint ${hint ? "" : "hidden"}">
              <span class="lss-langbox-head-hint-label">Знание языков:</span>
              <span class="lss-langbox-head-hint-val">${escapeHtml(hint)}</span>
            </div>
          </div>
          <button class="lss-lang-learn-btn" type="button" data-lang-popup-open>Выучить язык</button>
        </div>

        <div class="lss-langbox-list lss-langbox-list--cols3">
          ${learnedHtml}
        </div>
      </div>

      <!-- Прочие владения/заклинания: тоже на всю ширину -->
      <textarea class="lss-prof-text lss-prof-text--full" rows="8" data-sheet-path="text.profPlain.value"
        placeholder="Например: владения, инструменты, языки, заклинания...">${escapeHtml(vm.profText || "")}</textarea>
    </div>
  `;
}


  function renderBasicTab(vm, canEdit) {
    return `
      <div class="sheet-section">
        <div class="sheet-topline">
          <div class="sheet-chip sheet-chip--exh" data-exh-open title="Истощение">
            <div class="k">Истощение</div>
            <!-- readonly: выбор идёт через список; так клик по полю тоже открывает окно -->
            <input class="sheet-chip-input" type="number" min="0" max="6" ${canEdit ? "" : "disabled"} readonly data-sheet-path="exhaustion" value="${escapeHtml(String(vm.exhaustion))}">
          </div>
          <div class="sheet-chip sheet-chip--cond ${String(vm.conditions||"").trim() ? "has-value" : ""}" data-cond-open title="Состояние">
            <div class="k">Состояние</div>
            <!-- readonly: состояние выбирается из списка (и очищается кнопкой) -->
            <input class="sheet-chip-input sheet-chip-input--wide" type="text" ${canEdit ? "" : "disabled"} readonly data-sheet-path="conditions" value="${escapeHtml(String(vm.conditions || ""))}">
          </div>
        </div>

        <h3>Основное</h3>

        <div class="sheet-card sheet-card--profile">
          <h4>Профиль</h4>

          <div class="profile-grid">
            <div class="profile-col">
              <div class="kv"><div class="k">Имя</div><div class="v"><input type="text" data-sheet-path="name.value" style="width:180px"></div></div>
              <div class="kv"><div class="k">Класс</div><div class="v"><input type="text" data-sheet-path="info.charClass.value" style="width:180px"></div></div>
              <div class="kv"><div class="k">Архетип класса</div><div class="v"><input type="text" data-sheet-path="info.classArchetype.value" style="width:180px"></div></div>
              <div class="kv"><div class="k">Уровень</div><div class="v"><input type="number" min="1" max="20" data-sheet-path="info.level.value" style="width:90px"></div></div>
            </div>

            <div class="profile-col">
              <div class="kv"><div class="k">Раса</div><div class="v"><input type="text" data-sheet-path="info.race.value" style="width:180px"></div></div>
              <div class="kv"><div class="k">Архетип расы</div><div class="v"><input type="text" data-sheet-path="info.raceArchetype.value" style="width:180px"></div></div>
              <div class="kv"><div class="k">Предыстория</div><div class="v"><input type="text" data-sheet-path="info.background.value" style="width:180px"></div></div>
              <div class="kv"><div class="k">Мировоззрение</div><div class="v"><input type="text" data-sheet-path="info.alignment.value" style="width:180px"></div></div>
            </div>
          </div>
        </div>

        <div class="sheet-section" style="margin-top:12px;">
          <h3>Характеристики и навыки</h3>
          ${renderAbilitiesGrid(vm)}
        </div>

        <div class="lss-bottom-stack">
          ${renderPassives(vm)}
          ${renderProfBox(vm)}
        </div>
      </div>
    `;
  }

  // ================== RENDER: SPELLS ==================

  
function renderSpellCard({ level, name, href, desc }) {
    const safeHref = escapeHtml(href || "");
    const safeName = escapeHtml(name || href || "(без названия)");
    const text = cleanupSpellDesc(desc || "");
    const lvl = safeInt(level, 0);

    const isHttp = /^https?:\/\//i.test(String(href || ""));
    const titleHtml = isHttp
      ? `<a class="spell-item-link" href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeName}</a>`
      : `<span class="spell-item-title">${safeName}</span>`;

    const diceSvg = `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M12 2 20.5 7v10L12 22 3.5 17V7L12 2Z" fill="currentColor" opacity="0.95"></path>
        <path d="M12 2v20M3.5 7l8.5 5 8.5-5M3.5 17l8.5-5 8.5 5" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"></path>
      </svg>
    `;

    return `
      <div class="spell-item" data-spell-url="${safeHref}" data-spell-level="${lvl}">
        <div class="spell-item-head">
          ${titleHtml}
          <button class="spell-dice-btn" type="button" data-spell-roll title="Бросок атаки">${diceSvg}</button>
          <div class="spell-item-actions">
            <button class="spell-desc-btn" type="button" data-spell-desc-toggle>Описание</button>
            <button class="spell-del-btn" type="button" data-spell-delete>Удалить</button>
          </div>
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
      const current = Math.max(0, total - filled); // доступные (для кружков)
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
              <input class="slot-current slot-current-input" type="number" min="0" max="12" value="${escapeHtml(String(total))}" data-slot-level="${s.level}" title="Всего ячеек (редактируемое)">
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
          return renderSpellCard({ level: lvl, name, href: it.href, desc });
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
    const base = (vm?.spellsInfo?.base || "").trim() || "int";

    const statScoreByKey = {};
    (vm?.stats || []).forEach(s => { statScoreByKey[s.k] = safeInt(s.score, 10); });

    const prof = safeInt(vm?.profBonus, 0);
    const abilScore = safeInt(statScoreByKey[base], 10);
    const abilMod = abilityModFromScore(abilScore);

    const computedAttack = prof + abilMod;
    const computedSave = 8 + prof + abilMod;

    const rawSave = (vm?.spellsInfo?.save ?? "").toString().trim();
    const saveVal = rawSave !== "" ? String(numLike(rawSave, computedSave)) : String(computedSave);

    // Бонус атаки: всегда по формуле Владение + модификатор выбранной характеристики
    // (ручной оверрайд хранится в sheet.spellsInfo.mod.customModifier и применяется в updateSpellsMetrics)
    const atkVal = String(computedAttack);

    const abilityOptions = [
      ["str","Сила"],
      ["dex","Ловкость"],
      ["con","Телосложение"],
      ["int","Интеллект"],
      ["wis","Мудрость"],
      ["cha","Харизма"],
    ];

    return `
      <div class="sheet-section">
        <h3>Заклинания</h3>

        <div class="sheet-card spells-metrics-card fullwidth">
          <div class="spell-metric spell-metric-full">
            <div class="spell-metric-label">Характеристика</div>
            <div class="spell-metric-val spell-metric-control">
              <select class="spell-ability-select" data-spell-base-ability>
                ${abilityOptions.map(([k,l]) => `<option value="${k}" ${k===base?'selected':''}>${l}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="spell-metrics">
            <div class="spell-metric">
              <div class="spell-metric-label">СЛ спасброска</div>
              <div class="spell-metric-val">${escapeHtml(String(saveVal))}</div>
            </div>

            <div class="spell-metric">
              <div class="spell-metric-label spell-metric-label-row">Бонус атаки
  <button class="spell-dice-btn spell-dice-btn--header" type="button" data-spell-roll-header title="Бросок атаки">
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 2 20.5 7v10L12 22 3.5 17V7L12 2Z" fill="currentColor" opacity="0.95"></path>
      <path d="M12 2v20M3.5 7l8.5 5 8.5-5M3.5 17l8.5-5 8.5 5" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"></path>
    </svg>
  </button>
</div>
              <div class="spell-metric-val spell-metric-control">
                <input class="spell-attack-input" data-spell-attack-bonus type="number" step="1" min="-20" max="30" value="${escapeHtml(String(atkVal))}" />
              </div>
            </div>
          </div>
          <div class="sheet-note" style="margin-top:8px;">
            Бонус атаки по умолчанию: <b>Владение</b> (${prof}) + <b>модификатор выбранной характеристики</b> (${formatMod(abilMod)}).
          </div>
        </div>

        <div class="sheet-card fullwidth" style="margin-top:10px;">
          <h4>Ячейки</h4>
          ${renderSlots(vm)}
          <div class="sheet-note" style="margin-top:6px;">
            Формат: <b>кол-во заклинаний</b> / <b>всего ячеек</b> (второе число редактируемое, max 12). Кружки показывают доступные (неиспользованные) ячейки.
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
    const denom = String(vm?.coinsViewDenom || "gp").toLowerCase();

    const exchangeTooltip = `
      <div class="exchange-tooltip" role="tooltip">
        <div class="exchange-title">Обменный курс</div>
        <div class="exchange-table">
          <div class="ex-row ex-head">
            <div class="ex-cell">Монета</div>
            <div class="ex-cell">ММ</div>
            <div class="ex-cell">СМ</div>
            <div class="ex-cell">ЭМ</div>
            <div class="ex-cell">ЗМ</div>
            <div class="ex-cell">ПМ</div>
          </div>
          <div class="ex-row">
            <div class="ex-cell">Медная (мм)</div>
            <div class="ex-cell">1</div>
            <div class="ex-cell">1/10</div>
            <div class="ex-cell">1/50</div>
            <div class="ex-cell">1/100</div>
            <div class="ex-cell">1/1,000</div>
          </div>
          <div class="ex-row">
            <div class="ex-cell">Серебряная (см)</div>
            <div class="ex-cell">10</div>
            <div class="ex-cell">1</div>
            <div class="ex-cell">1/5</div>
            <div class="ex-cell">1/10</div>
            <div class="ex-cell">1/100</div>
          </div>
          <div class="ex-row">
            <div class="ex-cell">Электрумовая (эм)</div>
            <div class="ex-cell">50</div>
            <div class="ex-cell">5</div>
            <div class="ex-cell">1</div>
            <div class="ex-cell">1/2</div>
            <div class="ex-cell">1/20</div>
          </div>
          <div class="ex-row">
            <div class="ex-cell">Золотая (зм)</div>
            <div class="ex-cell">100</div>
            <div class="ex-cell">10</div>
            <div class="ex-cell">2</div>
            <div class="ex-cell">1</div>
            <div class="ex-cell">1/10</div>
          </div>
          <div class="ex-row">
            <div class="ex-cell">Платиновая (пм)</div>
            <div class="ex-cell">1,000</div>
            <div class="ex-cell">100</div>
            <div class="ex-cell">20</div>
            <div class="ex-cell">10</div>
            <div class="ex-cell">1</div>
          </div>
        </div>
      </div>
    `;


    const coinBox = (key, title, abbr, row) => `
      <div class="coin-box" data-coin-box="${escapeHtml(key)}" data-coin-row="${row}">
        <div class="coin-top">
          <div class="coin-pill coin-pill--${escapeHtml(key)}">${escapeHtml(title)} <span class="coin-pill__abbr">(${escapeHtml(abbr)})</span></div>
        </div>

        <div class="coin-line">
          <input
            class="coin-value"
            type="number"
            min="0"
            max="999999"
            data-sheet-path="coins.${escapeHtml(key)}.value"
          />

          <div class="coin-adjust">
            <button class="coin-btn coin-btn--minus" data-coin-op="minus" data-coin-key="${escapeHtml(key)}">-</button>
            <input class="coin-delta" type="number" min="0" max="999999" value="1" data-coin-delta="${escapeHtml(key)}" />
            <button class="coin-btn coin-btn--plus" data-coin-op="plus" data-coin-key="${escapeHtml(key)}">+</button>
          </div>
        </div>
      </div>
    `;

    const totalBox = `
      <div class="coin-box coin-box--total" data-coin-box="total">
        <div class="coin-top coin-top--between">
          <div class="coin-pill">Итог</div>
          <select class="coin-select" data-coins-total-denom data-sheet-path="coinsView.denom">
            <option value="cp" ${denom === "cp" ? "selected" : ""}>мм</option>
            <option value="sp" ${denom === "sp" ? "selected" : ""}>см</option>
            <option value="ep" ${denom === "ep" ? "selected" : ""}>эм</option>
            <option value="gp" ${denom === "gp" ? "selected" : ""}>зм</option>
            <option value="pp" ${denom === "pp" ? "selected" : ""}>пм</option>
          </select>
        </div>

        <div class="coin-line">
          <input class="coin-value coin-total" type="text" readonly data-coins-total value="0" />
          <div class="coin-total-hint">по курсу D&D</div>
        </div>
      </div>
    `;

    return `
      <div class="sheet-section">
        <h3>Инвентарь</h3>

        <div class="sheet-card fullwidth coins-card">
          <div class="coins-head">
            <h4 style="margin:0">Монеты</h4>
            <div class="exchange-pill" tabindex="0">
              Обменный курс
              ${exchangeTooltip}
            </div>
          </div>

          <div class="coins-grid coins-grid--row1">
            ${coinBox("cp", "Медная", "мм", 1)}
            ${coinBox("sp", "Серебряная", "см", 1)}
            ${coinBox("gp", "Золотая", "зм", 1)}
          </div>

          <div class="coins-grid coins-grid--row2">
            ${coinBox("ep", "Электрумовая", "эм", 2)}
            ${coinBox("pp", "Платиновая", "пм", 2)}
            ${totalBox}
          </div>
        </div>

        <div class="sheet-card fullwidth" style="margin-top:10px">
          <h4>Предметы</h4>
          <textarea class="sheet-textarea" rows="6" data-sheet-path="text.inventoryItems.value" placeholder="Список предметов (можно редактировать)..."></textarea>
        </div>

        <div class="sheet-card fullwidth" style="margin-top:10px">
          <h4>Сокровища</h4>
          <textarea class="sheet-textarea" rows="6" data-sheet-path="text.inventoryTreasures.value" placeholder="Сокровища, драгоценности, артефакты (можно редактировать)..."></textarea>
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
              <div class="kv"><div class="k">Пол</div><div class="v"><input type="text" data-sheet-path="notes.details.gender.value" style="width:140px"></div></div>
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


  function renderActiveTab(tabId, vm, canEdit) {
    if (tabId === "basic") return renderBasicTab(vm, canEdit);
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
    const canEdit = (myRole === "GM" || String(player.ownerId) === String(myId));
    lastCanEdit = !!canEdit;

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

      // ===== Мои сохранённые персонажи (привязка к уникальному userId) =====
      // Работает даже если пользователь заходит под разными никами.
      // Сохраняем/загружаем только для персонажа "Основа".
      const savedWrap = document.createElement('div');
      savedWrap.className = 'saved-bases-actions';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Сохранить основу';
      saveBtn.title = 'Сохранить текущую "Инфу" в ваш личный список (по userId)';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.textContent = 'Загрузить основу';
      loadBtn.title = 'Открыть список сохранённых персонажей и выбрать, кого загрузить';

      // доступно только если это действительно "Основа"
      if (!player.isBase) {
        saveBtn.disabled = true;
        loadBtn.disabled = true;
      }

      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!player.isBase) return;
        try {
          const sheet = player.sheet || { parsed: createEmptySheet(player.name) };
          ctx?.sendMessage?.({
            type: 'saveSavedBase',
            playerId: player.id,
            sheet
          });
        } catch (err) {
          console.error(err);
          alert('Не удалось сохранить');
        }
      });

      loadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!player.isBase) return;
        openSavedBasesOverlay({ loading: true, playerId: player.id });
        try {
          ctx?.sendMessage?.({ type: 'listSavedBases' });
        } catch (err) {
          console.error(err);
        }
      });

      savedWrap.appendChild(saveBtn);
      savedWrap.appendChild(loadBtn);
      sheetActions.appendChild(savedWrap);
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
            <div class="sheet-chip sheet-chip--insp" data-hero="insp" title="Вдохновение" ${canEdit ? "" : "data-readonly"}>
              <div class="k">Вдохновение</div>
              <svg class="insp-star ${vm.inspiration ? "on" : ""}" viewBox="0 0 24 24" aria-label="Вдохновение" role="img">
                <path d="M12 2.6l2.93 5.94 6.56.95-4.75 4.63 1.12 6.53L12 17.9l-5.86 3.08 1.12-6.53L2.5 9.49l6.56-.95L12 2.6z"></path>
              </svg>
            </div>
            <div class="sheet-chip" data-hero="prof" title="Бонус мастерства">
              <div class="k">Владение</div>
              <input class="sheet-chip-input" type="number" min="0" max="10" ${canEdit ? "" : "disabled"} data-sheet-path="proficiency" value="${escapeHtml(String(vm.profBonus))}">
            </div>

            <div class="sheet-chip" data-hero="ac">
              <div class="k">Броня</div>
              <input class="sheet-chip-input" type="number" min="0" max="40" ${canEdit ? "" : "disabled"} data-sheet-path="vitality.ac.value" data-hero-val="ac" value="${escapeHtml(String(vm.ac))}">
            </div>
            <div class="sheet-chip sheet-chip--hp" data-hero="hp" data-hp-open role="button" tabindex="0" style="--hp-fill-pct:${escapeHtml(String(vm.hp ? Math.max(0, Math.min(100, Math.round((Number(vm.hpCur) / Math.max(1, Number(vm.hp))) * 100))) : 0))}%">
              <div class="hp-liquid" aria-hidden="true"></div>
              <div class="k">Здоровье</div>
              <div class="v" data-hero-val="hp">${escapeHtml(String((Number(vm.hpTemp)||0)>0 ? `(${Number(vm.hpTemp)}) ${vm.hpCur}/${vm.hp}` : `${vm.hpCur}/${vm.hp}`))}</div>
            </div>
            <div class="sheet-chip" data-hero="speed">
              <div class="k">Скорость</div>
              <input class="sheet-chip-input" type="number" min="0" max="200" ${canEdit ? "" : "disabled"} data-sheet-path="vitality.speed.value" data-hero-val="speed" value="${escapeHtml(String(vm.spd))}">
            </div>
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
        ${renderActiveTab(activeTab, vm, canEdit)}
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
    bindLanguagesUi(sheetContent, player, canEdit);
    bindSkillBoostDots(sheetContent, player, canEdit);
    bindSaveProfDots(sheetContent, player, canEdit);
    bindStatRollButtons(sheetContent, player);
    bindAbilityAndSkillEditors(sheetContent, player, canEdit);
    bindNotesEditors(sheetContent, player, canEdit);
    bindSlotEditors(sheetContent, player, canEdit);
    bindSpellAddAndDesc(sheetContent, player, canEdit);
    bindCombatEditors(sheetContent, player, canEdit);
    bindInventoryEditors(sheetContent, player, canEdit);
    updateCoinsTotal(sheetContent, player.sheet?.parsed);

    // важное: быстрые клики "Вдохновение" / "Истощение" / "Состояние"
    // (на некоторых браузерах клики по input могут не доходить, если он disabled)
    wireQuickBasicInteractions(sheetContent);

    const tabButtons = sheetContent.querySelectorAll(".sheet-tab");
    const main = sheetContent.querySelector("#sheet-main");

    tabButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const tabId = btn.dataset.tab;
        if (!tabId) return;

        activeTab = tabId;
        player._activeSheetTab = tabId;
        if (player?.id) { const st = getUiState(player.id); st.activeTab = tabId; }

        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        if (main) {
          const freshSheet = player.sheet?.parsed || createEmptySheet(player.name);
          const freshVm = toViewModel(freshSheet, player.name);
          main.innerHTML = renderActiveTab(activeTab, freshVm, canEdit);

          bindEditableInputs(sheetContent, player, canEdit);
          bindSkillBoostDots(sheetContent, player, canEdit);
          bindSaveProfDots(sheetContent, player, canEdit);
          bindStatRollButtons(sheetContent, player);
          bindAbilityAndSkillEditors(sheetContent, player, canEdit);
          bindNotesEditors(sheetContent, player, canEdit);
          bindSlotEditors(sheetContent, player, canEdit);
          bindSpellAddAndDesc(sheetContent, player, canEdit);
          bindCombatEditors(sheetContent, player, canEdit);
          bindInventoryEditors(sheetContent, player, canEdit);
          bindLanguagesUi(sheetContent, player, canEdit);
          updateCoinsTotal(sheetContent, player.sheet?.parsed);
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
    rememberPlayersSnapshot([player]);
    renderSheetModal(player);
    openModal();
  }

  function refresh(players) {
    if (!openedSheetPlayerId) return;
    if (!Array.isArray(players)) return;
    rememberPlayersSnapshot(players);
    const pl = players.find(x => x.id === openedSheetPlayerId);
    if (pl) renderSheetModal(pl);
  }

  // callbacks are called from client.js when server answers
  function onSavedBasesList(list) {
    // если модалка уже открыта — показываем список поверх
    openSavedBasesOverlay({ loading: false, playerId: savedBasesOverlayPlayerId || openedSheetPlayerId });
    renderSavedBasesList(list);
  }

  function onSavedBaseSaved(msg) {
    try {
      // лёгкое уведомление в actions
      const t = document.createElement('div');
      t.className = 'sheet-note';
      t.textContent = `Сохранено: ${msg?.name || 'Персонаж'}`;
      sheetActions?.appendChild(t);
      setTimeout(() => { try { t.remove(); } catch {} }, 2600);
    } catch {}
  }

  function onSavedBaseApplied() {
    // сервер уже применил sheet и разошлёт state
    closeSavedBasesOverlay();
  }

  function onSavedBaseDeleted(msg) {
    // удалили — просто перезапросим список
    try {
      openSavedBasesOverlay({ loading: true, playerId: savedBasesOverlayPlayerId || openedSheetPlayerId });
      ctx?.sendMessage?.({ type: 'listSavedBases' });
    } catch {}
  }

  window.InfoModal = {
    init,
    open,
    refresh,
    close: closeModal,
    onSavedBasesList,
    onSavedBaseSaved,
    onSavedBaseApplied,
    onSavedBaseDeleted
  };
})();



