const STORAGE_KEY = "commander-tinder-likes";
const SEEN_KEY = "commander-tinder-seen";

// Affiliate ID variable (to be filled in later)
const AFFILIATE_ID = '';

const deckEl = document.getElementById("deck");
const statusEl = document.getElementById("status");
const emptyStateEl = document.getElementById("empty-state");
const likesCountEl = document.getElementById("likes-count");
const likesGridEl = document.getElementById("likes-grid");
const likesModalEl = document.getElementById("likes-modal");
const likesContainerEl = document.getElementById("likes-container");
const likeDetailViewEl = document.getElementById("like-detail-view");
const detailBackBtnEl = document.getElementById("detail-back-btn");
const detailContentEl = document.getElementById("detail-content");
const oracleBlockEl = document.getElementById("oracle-block");
const edhrecBlockEl = document.getElementById("edhrec-block");
const intelPanelEl = document.getElementById("intel-panel");
const cardmarketLinkEl = document.getElementById("cardmarket-link");

const likeBtn = document.getElementById("like-btn");
const dislikeBtn = document.getElementById("dislike-btn");

function getCardmarketUrl(cardName) {
  let url = `https://www.cardmarket.com/de/Magic/Products/Search?searchString=${encodeURIComponent(cardName)}`;
  if (AFFILIATE_ID && AFFILIATE_ID.trim() !== '') {
    url += `&idAffiliate=${AFFILIATE_ID}`;
  }
  return url;
}

const state = {
  queue: [],
  likes: loadJson(STORAGE_KEY, []),
  seen: new Set(loadJson(SEEN_KEY, [])),
  selectedColor: ["all"],
  dragging: false,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
  busy: false,
  synergyToken: 0,
  synergyCache: new Map(),
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLikes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.likes));
  localStorage.setItem(SEEN_KEY, JSON.stringify([...state.seen]));
  likesCountEl.textContent = String(state.likes.length);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageFor(card) {
  const faces = card.card_faces?.[0]?.image_uris;
  return (
    card.image_uris?.art_crop ||
    faces?.art_crop ||
    card.image_uris?.normal ||
    faces?.normal ||
    ""
  );
}

function oracleFaces(card) {
  if (Array.isArray(card.card_faces) && card.card_faces.length) {
    return card.card_faces.map((face) => ({
      name: face.name,
      type: face.type_line || "",
      text: face.oracle_text || "",
      mana_cost: face.mana_cost || "",
      cmc: face.cmc ?? 0,
    }));
  }
  return [
    {
      name: card.name,
      type: card.type_line || "",
      text: card.oracle_text || "",
      mana_cost: card.mana_cost || "",
      cmc: card.cmc ?? 0,
    },
  ];
}

// Robuste Hilfsfunktion zum Auslesen von Mana-Kosten und CMC
function getCardMana(card) {
  if (card.card_faces && card.card_faces.length > 0) {
    return {
      mana_cost: card.card_faces[0].mana_cost || card.mana_cost || "",
      cmc: card.card_faces[0].cmc !== undefined ? card.card_faces[0].cmc : (card.cmc ?? "")
    };
  }
  return {
    mana_cost: card.mana_cost || "",
    cmc: card.cmc ?? ""
  };
}

function summarize(card) {
  const manaInfo = getCardMana(card);
  return {
    id: card.id,
    name: card.name,
    type: card.type_line,
    colors: card.colors || [],
    image: imageFor(card),
    scryfall: card.scryfall_uri,
    set: card.set_name,
    faces: oracleFaces(card),
    mana_cost: manaInfo.mana_cost,
    cmc: manaInfo.cmc,
    eurPrice: card.prices?.eur || 'N/A',
    edhrecRank: card.edhrec_rank ? `#${card.edhrec_rank}` : 'Unranked',
  };
}

// Wandelt Scryfall Mana-Kosten (z.B. "{2}{U}{R}") in echte HTML-Icons um
function renderManaCostIcons(manaCostString) {
  if (!manaCostString) return "";
  
  const matches = manaCostString.match(/\{([^}]+)\}/g);
  if (!matches) return escapeHtml(manaCostString);

  return matches.map(match => {
    const symbol = match.replace(/\{|\}/g, "").toLowerCase();
    
    if (!isNaN(symbol)) {
      return `<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-stone-700 text-stone-200 text-[10px] font-bold border border-stone-500/40">${symbol}</span>`;
    }
    
    let bgClass = "bg-stone-600";
    
    switch (symbol) {
      case 'w': bgClass = "bg-[#f8f1d4] text-stone-900 border-amber-200/50"; break;
      case 'u': bgClass = "bg-blue-600 text-white border-blue-400/50"; break;
      case 'b': bgClass = "bg-[#2e2a33] text-stone-200 border-stone-600"; break;
      case 'r': bgClass = "bg-red-600 text-white border-red-400/50"; break;
      case 'g': bgClass = "bg-green-600 text-white border-green-400/50"; break;
      case 'c': bgClass = "bg-stone-500 text-white border-stone-400/50"; break;
    }

    return `<span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold border shadow-sm ${bgClass}">${symbol.toUpperCase()}</span>`;
  }).join("");
}

function edhrecSlug(name) {
  const front = String(name).split(" // ")[0];
  return front
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function fetchCommanders() {
  statusEl.textContent = "Commanders werden beschworen…";
  const collected = [];
  
  const isAllSelected = !state.selectedColor || 
                        state.selectedColor.includes("all") || 
                        state.selectedColor.length === 0;

  let url = `https://api.scryfall.com/cards/search?q=is%3Acommander+game%3Apaper+-is%3Adigital&unique=cards&order=edhrec`;

  try {
    while (url) {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) break;
        throw new Error("Scryfall antwortet nicht");
      }
      const data = await res.json();
      collected.push(...(data.data || []));
      url = data.next_page;
    }
    
    const summarizedCards = collected.map(summarize);
    
    let filteredCards = summarizedCards;
    if (!isAllSelected) {
      filteredCards = filterCardsByColors(summarizedCards, state.selectedColor);
    }
    
    return shuffle(filteredCards.filter((card) => card.image && !state.seen.has(card.id)));
  } catch (error) {
    statusEl.textContent = "Karten konnten nicht geladen werden.";
    console.error(error);
    return [];
  }
}

function colorPips(colors) {
  if (!colors.length) return `<span class="color-pip pip-C" title="Farblos"></span>`;
  return colors.map((c) => `<span class="color-pip pip-${c}" title="${c}"></span>`).join("");
}

function oraclePreview(card) {
  return (card.faces || [])
    .map((face) => face.text)
    .filter(Boolean)
    .join("\n")
    .replace(/\n+/g, " ");
}

function oracleMarkup(card) {
  const faces = card.faces?.length ? card.faces : [{ name: card.name, type: card.type, text: "" }];
  const multi = faces.length > 1;
  return faces
    .map((face) => {
      const title = multi
        ? `<p class="mb-1 font-semibold text-mtg-gold">${escapeHtml(face.name)}</p>`
        : "";
      const type = multi && face.type
        ? `<p class="mb-1 text-xs text-stone-400">${escapeHtml(face.type)}</p>`
        : "";
      const text = escapeHtml(face.text || "Kein Regeltext vorhanden.");
      return `<div class="mb-3 last:mb-0">${title}${type}<p class="oracle-full text-sm text-stone-200">${text}</p></div>`;
    })
    .join("");
}

function cardMarkup(card, index) {
  const z = 20 - index;
  const scale = 1 - Math.min(index, 2) * 0.035;
  const y = Math.min(index, 2) * 10;
  
  const manaCost = card.mana_cost || "";
  
  return `
    <article
      class="swipe-card"
      data-id="${escapeHtml(card.id)}"
      style="z-index:${z}; transform: translateY(${y}px) scale(${scale});"
    >
      <div class="frame relative">
        <div class="art">
          <img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" draggable="false" />
          <div class="stamp like">LIKE</div>
          <div class="stamp nope">NOPE</div>
        </div>
        <div class="bg-[#120f18] p-3 pt-2">
          <div class="flex items-start justify-between gap-2">
            <h2 class="font-display text-xl leading-tight text-mtg-parchment">${escapeHtml(card.name)}</h2>
            <div class="flex items-center gap-1 shrink-0">
              ${renderManaCostIcons(manaCost)}
            </div>
          </div>
          <p class="mt-0.5 text-xs text-stone-300">${escapeHtml(card.type)}</p>
          <div class="mt-1.5 flex items-center justify-between">
            <div class="flex items-center gap-1.5">${colorPips(card.colors)}</div>
            <span class="rounded-full bg-mtg-gold/10 px-2 py-0.5 text-xs font-semibold text-mtg-gold">${card.edhrecRank}</span>
          </div>
          <p class="oracle-clip mt-2 text-xs leading-snug text-stone-300">${escapeHtml(oraclePreview(card))}</p>
        </div>
      </div>
    </article>
  `;
}

function renderIntel(card) {
  if (!card) {
    intelPanelEl.classList.add("opacity-40");
    oracleBlockEl.innerHTML = `<p class="text-stone-500">Kein Commander mehr in der Queue.</p>`;
    edhrecBlockEl.innerHTML = "";
    if (cardmarketLinkEl) {
      cardmarketLinkEl.href = "#";
    }
    return;
  }

  intelPanelEl.classList.remove("opacity-40");
  
  const manaCost = card.mana_cost || "";

  oracleBlockEl.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="font-display text-[11px] tracking-[0.22em] text-mtg-gold uppercase">Regeltext</p>
        <h2 class="mt-1 font-display text-2xl text-mtg-parchment">${escapeHtml(card.name)}</h2>
      </div>
      <div class="flex items-center gap-1 shrink-0 pt-1">
        ${renderManaCostIcons(manaCost)}
      </div>
    </div>
    <p class="mt-1 text-sm text-stone-400">${escapeHtml(card.type)}</p>
    <div class="mt-2 flex items-center gap-2">
      <span class="rounded-full bg-mtg-gold/10 px-2 py-0.5 text-xs font-semibold text-mtg-gold">${card.edhrecRank}</span>
    </div>
    <div class="mt-2 text-sm">
      <span class="font-semibold">Preis:</span> 
      <span>${card.eurPrice === 'N/A' ? 'Preis n.v.' : card.eurPrice + ' €'}</span>
    </div>
    <div class="mt-4 rounded-xl border border-white/5 bg-black/25 p-4">${oracleMarkup(card)}</div>
  `;
  loadSynergyCards(card);
  
  if (cardmarketLinkEl) {
    cardmarketLinkEl.href = getCardmarketUrl(card.name);
    const priceInfo = document.createElement('div');
    priceInfo.className = 'mt-2 text-sm';
    priceInfo.innerHTML = `<span>Ca. ${card.eurPrice === 'N/A' ? 'Preis n.v.' : card.eurPrice + ' €'} auf Cardmarket</span>`;
    const existingPriceInfo = cardmarketLinkEl.parentNode.querySelector('.mt-2.text-sm');
    if (existingPriceInfo) {
      existingPriceInfo.remove();
    }
    cardmarketLinkEl.parentNode.appendChild(priceInfo);
  }
}

function renderSynergySection(card, synergyCards) {
  const slug = edhrecSlug(card.name);
  const edhrecUrl = `https://edhrec.com/commanders/${slug}`;
  
  const link = `
    <a
      href="${edhrecUrl}"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center rounded-full border border-mtg-gold/50 px-4 py-2 text-sm font-semibold text-mtg-parchment transition hover:bg-mtg-gold/10"
    >
      Auf EDHREC ansehen
    </a>
  `;

  const items = synergyCards.length
    ? synergyCards
        .map((item) => {
          const img = item.image_uris?.small || item.card_faces?.[0]?.image_uris?.small || "";
          return `
            <a href="${item.scryfall_uri}" target="_blank" rel="noopener noreferrer" class="w-[92px] shrink-0 transform transition duration-200 hover:scale-110">
              <img
                src="${img}"
                alt="${escapeHtml(item.name)}"
                class="aspect-[5/7] w-full rounded-lg border border-mtg-gold/20 object-cover"
              />
              <p class="mt-1 line-clamp-2 text-[11px] leading-tight text-stone-200">${escapeHtml(item.name)}</p>
              <p class="text-[10px] text-emerald-400">Verwandt</p>
            </a>
          `;
        })
        .join("")
    : `<p class="text-sm text-stone-400">Keine spezifischen Karten gefunden.</p>`;

  if (likeDetailViewEl && !likeDetailViewEl.classList.contains("hidden")) {
    const synergyContainer = detailContentEl.querySelector(".synergy-row");
    if (synergyContainer) {
      synergyContainer.innerHTML = items;
    }
  } else {
    edhrecBlockEl.innerHTML = `
      <div class="flex items-end justify-between gap-3">
        <div>
          <p class="font-display text-[11px] tracking-[0.22em] text-mtg-gold uppercase">Thematische Synergien</p>
          <p class="mt-1 text-xs text-stone-400">Passende Karten & Typen</p>
        </div>
        ${link}
      </div>
      <div class="synergy-row mt-4">${items}</div>
    `;
  }
}

async function loadSynergyCards(card) {
  const token = ++state.synergyToken;
  const cacheKey = card.id;

  edhrecBlockEl.innerHTML = `
    <p class="font-display text-[11px] tracking-[0.22em] text-mtg-gold uppercase">Synergien</p>
    <p class="mt-2 text-sm text-stone-400">Passende Karten werden geladen…</p>
  `;

  if (state.synergyCache.has(cacheKey)) {
    if (token !== state.synergyToken) return;
    renderSynergySection(card, state.synergyCache.get(cacheKey));
    return;
  }

  const typeLine = card.type || "";
  const subTypes = typeLine.split("—")[1] || "";
  const firstSubtype = subTypes.trim().split(" ")[0] || "";
  
  const colorsQuery = card.colors.length > 0 ? `id<=${card.colors.join("")}` : `id=c`;
  
  let searchUrl = `https://api.scryfall.com/cards/search?q=${colorsQuery}+is%3Aspell`;
  if (firstSubtype && firstSubtype.length > 2) {
    searchUrl += `+t%3A${encodeURIComponent(firstSubtype)}`;
  }
  searchUrl += `&order=random`;

  try {
    const res = await fetch(searchUrl);
    let results = [];
    if (res.ok) {
      const data = await res.json();
      results = (data.data || []).filter((item) => item.id !== card.id).slice(0, 6);
    }
    
    if (results.length < 3) {
      const fallbackRes = await fetch(`https://api.scryfall.com/cards/search?q=${colorsQuery}+is%3Aspell&order=random`);
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        results = (fallbackData.data || []).filter((item) => item.id !== card.id).slice(0, 6);
      }
    }

    state.synergyCache.set(cacheKey, results);
    if (token !== state.synergyToken) return;
    renderSynergySection(card, results);
  } catch (error) {
    console.error(error);
    if (token !== state.synergyToken) return;
    renderSynergySection(card, []);
  }
}

function renderDeck() {
  const visible = state.queue.slice(0, 3);
  deckEl.innerHTML = visible.map((card, i) => cardMarkup(card, i)).join("");
  emptyStateEl.classList.toggle("hidden", state.queue.length > 0);
  statusEl.textContent = state.queue.length
    ? `${state.queue.length} Commanders warten auf dein Urteil`
    : "Keine weiteren Commanders";
  bindTopCard();
  renderIntel(state.queue[0] || null);
}

function topCardEl() {
  return deckEl.querySelector(".swipe-card");
}

function bindTopCard() {
  const card = topCardEl();
  if (!card) return;

  card.addEventListener("pointerdown", onPointerDown);
  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerup", onPointerUp);
  card.addEventListener("pointercancel", onPointerUp);
}

function onPointerDown(event) {
  if (state.busy) return;
  const card = topCardEl();
  if (!card) return;
  state.dragging = true;
  state.startX = event.clientX;
  state.startY = event.clientY;
  state.dx = 0;
  state.dy = 0;
  card.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!state.dragging) return;
  const card = topCardEl();
  if (!card) return;
  state.dx = event.clientX - state.startX;
  state.dy = event.clientY - state.startY;
  const rot = state.dx / 18;
  card.style.transform = `translate(${state.dx}px, ${state.dy}px) rotate(${rot}deg)`;
  const likeStamp = card.querySelector(".stamp.like");
  const nopeStamp = card.querySelector(".stamp.nope");
  likeStamp.style.opacity = String(Math.min(1, Math.max(0, state.dx / 120)));
  nopeStamp.style.opacity = String(Math.min(1, Math.max(0, -state.dx / 120)));
}

function onPointerUp() {
  if (!state.dragging) return;
  state.dragging = false;
  const threshold = 110;
  if (state.dx > threshold) {
    decide(true);
  } else if (state.dx < -threshold) {
    decide(false);
  } else {
    resetTopCard();
  }
}

function resetTopCard() {
  const card = topCardEl();
  if (!card) return;
  card.style.transition = "transform 180ms ease";
  card.style.transform = "";
  card.querySelector(".stamp.like").style.opacity = "0";
  card.querySelector(".stamp.nope").style.opacity = "0";
  window.setTimeout(() => {
    if (card) card.style.transition = "";
  }, 200);
}

function decide(liked) {
  if (state.busy || !state.queue.length) return;
  state.busy = true;
  const current = state.queue[0];
  const card = topCardEl();
  const dir = liked ? 1 : -1;
  state.synergyToken += 1;

  if (card) {
    card.style.transition = "transform 280ms ease, opacity 280ms ease";
    card.style.transform = `translate(${dir * 520}px, ${state.dy || -20}px) rotate(${dir * 22}deg)`;
    card.style.opacity = "0";
    card.querySelector(liked ? ".stamp.like" : ".stamp.nope").style.opacity = "1";
  }

  state.seen.add(current.id);
  if (liked && !state.likes.some((item) => item.id === current.id)) {
    state.likes.unshift(summarize(current));
  }
  saveLikes();

  window.setTimeout(() => {
    state.queue.shift();
    state.dx = 0;
    state.dy = 0;
    state.busy = false;
    renderDeck();
  }, 260);
}

function renderLikes() {
  if (!state.likes.length) {
    likesGridEl.innerHTML = `
      <p class="col-span-full py-10 text-center text-stone-400">
        Noch keine Likes. Swipe nach rechts oder tippe auf das Herz.
      </p>`;
    return;
  }

  likesGridEl.innerHTML = state.likes
    .map(
      (card) => `
        <article class="overflow-hidden rounded-xl border border-mtg-gold/20 bg-black/30" data-id="${escapeHtml(card.id)}">
          <img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" class="aspect-[5/7] w-full object-cover" />
          <div class="p-3">
            <h3 class="font-display text-sm text-mtg-parchment">${escapeHtml(card.name)}</h3>
            <div class="mt-2 flex items-center justify-between gap-2">
              <div class="flex gap-1">${colorPips(card.colors)}</div>
              <button type="button" data-remove="${escapeHtml(card.id)}" class="text-xs text-rose-300 hover:text-rose-200">
                Entfernen
              </button>
            </div>
            <div class="mt-1 flex justify-end">
              ${renderManaCostIcons(card.mana_cost)}
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function showLikeDetail(card) {
  likesGridEl.classList.add("hidden");
  likeDetailViewEl.classList.remove("hidden");
  
  const manaCost = card.mana_cost || "";
  
  detailContentEl.innerHTML = `
    <div class="mb-6">
      <div class="flex items-start gap-4">
        <img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" class="aspect-[5/7] w-32 rounded-lg border border-mtg-gold/20 object-cover" />
        <div class="flex-1">
          <div class="flex items-center justify-between">
            <p class="font-display text-[11px] tracking-[0.22em] text-mtg-gold uppercase">Regeltext</p>
            <div class="flex items-center gap-1">${renderManaCostIcons(manaCost)}</div>
          </div>
          <h2 class="mt-1 font-display text-2xl text-mtg-parchment">${escapeHtml(card.name)}</h2>
          <p class="mt-1 text-sm text-stone-400">${escapeHtml(card.type)}</p>
          <div class="mt-2 text-sm">
            <span class="font-semibold">Preis:</span> 
            <span>${card.eurPrice === 'N/A' ? 'Preis n.v.' : card.eurPrice + ' €'}</span>
          </div>
          <div class="mt-2 flex items-center gap-1">${colorPips(card.colors)}</div>
        </div>
      </div>
      <div class="mt-4 rounded-xl border border-white/5 bg-black/25 p-4">${oracleMarkup(card)}</div>
    </div>
    
    <div class="mb-6">
      <div class="flex items-end justify-between gap-3">
        <div>
          <p class="font-display text-[11px] tracking-[0.22em] text-mtg-gold uppercase">Thematische Synergien</p>
          <p class="mt-1 text-xs text-stone-400">Passende Karten & Typen</p>
        </div>
        <a
          href="https://edhrec.com/commanders/${edhrecSlug(card.name)}"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center rounded-full border border-mtg-gold/50 px-4 py-2 text-sm font-semibold text-mtg-parchment transition hover:bg-mtg-gold/10"
        >
          Auf EDHREC ansehen
        </a>
      </div>
      <div class="synergy-row mt-4"></div>
    </div>
    
    <div>
      <a 
        id="cardmarket-link-detail"
        href="${getCardmarketUrl(card.name)}" 
        target="_blank" 
        rel="noopener noreferrer"
        class="inline-flex items-center justify-center gap-2 rounded-lg border border-mtg-gold/50 bg-mtg-panel/90 px-4 py-2 text-sm font-semibold text-mtg-parchment shadow-glow transition hover:border-mtg-gold hover:bg-mtg-gold/10"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6h-1V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v2H5c-1.1 0-2 .9-2 2v13c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7 12c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm-5-8h10V7H7v3z"/>
        </svg>
        Auf Cardmarket suchen
      </a>
    </div>
  `;
  
  loadSynergyCards(card);
}

function hideLikeDetail() {
  likeDetailViewEl.classList.add("hidden");
  likesGridEl.classList.remove("hidden");
}

function openLikes() {
  renderLikes();
  likesModalEl.classList.remove("hidden");
  likesModalEl.classList.add("flex");
  likesModalEl.setAttribute("aria-hidden", "false");
}

function closeLikes() {
  likesModalEl.classList.add("hidden");
  likesModalEl.classList.remove("flex");
  likesModalEl.setAttribute("aria-hidden", "true");
}

let selectedColors = new Set(["all"]);

document.querySelectorAll(".color-filter-btn").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const target = e.currentTarget;
    const color = target.getAttribute("data-color");
    
    if (color === "all") {
      selectedColors.clear();
      selectedColors.add("all");
      document.querySelectorAll(".color-filter-btn").forEach((b) => b.classList.remove("border-mtg-gold", "bg-mtg-gold/20", "active"));
      target.classList.add("border-mtg-gold", "bg-mtg-gold/20", "active");
      document.getElementById('color-filters').style.display = 'flex';
    } else {
      if (selectedColors.has("all")) {
        selectedColors.delete("all");
        document.querySelector("[data-color='all']").classList.remove("border-mtg-gold", "bg-mtg-gold/20", "active");
        document.getElementById('color-filters').style.display = 'flex';
      }
      
      if (selectedColors.has(color)) {
        selectedColors.delete(color);
        target.classList.remove("border-mtg-gold", "bg-mtg-gold/20", "active");
      } else {
        selectedColors.add(color);
        target.classList.add("border-mtg-gold", "bg-mtg-gold/20", "active");
      }
      
      if (selectedColors.size === 0) {
        selectedColors.add("all");
        document.querySelector("[data-color='all']").classList.add("border-mtg-gold", "bg-mtg-gold/20", "active");
        document.getElementById('color-filters').style.display = 'flex';
      }
    }
    
    state.selectedColor = Array.from(selectedColors);
    state.seen.clear();
    saveLikes();
    
    const cards = await fetchCommanders();
    state.queue = cards;
    renderDeck();
  });
});

function filterCardsByColors(cards, selectedColors) {
  if (!selectedColors || selectedColors.includes("all") || selectedColors.length === 0) {
    return cards;
  }
  
  const colors = selectedColors.filter(color => color !== "all");
  if (colors.length === 0) return cards;
  
  return cards.filter(card => {
    if (!card.colors || card.colors.length === 0) {
      return colors.includes("C");
    }
    
    const cardColors = new Set(card.colors);
    const selectedColorSet = new Set(colors);
    
    if (cardColors.size !== selectedColorSet.size) return false;
    
    for (const color of cardColors) {
      if (!selectedColorSet.has(color)) return false;
    }
    return true;
  });
}

likeBtn.addEventListener("click", () => decide(true));
dislikeBtn.addEventListener("click", () => decide(false));
document.getElementById("likes-open").addEventListener("click", openLikes);
document.getElementById("likes-close").addEventListener("click", closeLikes);
document.getElementById("likes-backdrop").addEventListener("click", closeLikes);
document.getElementById("reload-deck").addEventListener("click", () => {
  state.seen.clear();
  saveLikes();
  boot();
});

likesGridEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  const id = button.getAttribute("data-remove");
  state.likes = state.likes.filter((card) => card.id !== id);
  saveLikes();
  renderLikes();
});

document.addEventListener("keydown", (event) => {
  if (likesModalEl.classList.contains("flex")) {
    if (event.key === "Escape") closeLikes();
    return;
  }
  if (event.key === "ArrowRight") decide(true);
  if (event.key === "ArrowLeft") decide(false);
});

document.addEventListener("click", (e) => {
  if (e.target.matches("#likes-open")) {
    openLikes();
  }
  
  if (e.target.matches("#likes-close") || e.target.closest("#likes-close")) {
    closeLikes();
  }
  
  if (e.target.closest("#likes-grid") && !e.target.matches("[data-remove]")) {
    const cardElement = e.target.closest("article");
    if (cardElement) {
      // Finde die Karte direkt über die ID aus dem data-id Attribut
      const cardId = cardElement.getAttribute('data-id');
      const card = state.likes.find(c => c.id === cardId);
      if (card) {
        showLikeDetail(card);
      }
    }
  }
  
  if (e.target.matches("#detail-back-btn")) {
    hideLikeDetail();
  }
});

likesGridEl.addEventListener("click", (e) => {
  if (e.target.matches("[data-remove]")) {
    const id = e.target.getAttribute("data-remove");
    state.likes = state.likes.filter((card) => card.id !== id);
    saveLikes();
    renderLikes();
  }
});

async function boot() {
  save_likes_safe = true;
  saveLikes();
  const cards = await fetchCommanders();
  state.queue = cards;
  renderDeck();
}

boot();