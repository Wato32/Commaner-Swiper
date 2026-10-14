const STORAGE_KEY = "commander-tinder-likes";
const SEEN_KEY = "commander-tinder-seen";
const PROFILE_KEY = "commander-tinder-profile";

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
const profileOpenBtn = document.getElementById("profile-open");
const profileModalEl = document.getElementById("profile-modal");
const profileCloseBtn = document.getElementById("profile-close");
const profileBackdrop = document.getElementById("profile-backdrop");
const saveProfileBtn = document.getElementById("save-profile");

// Profil-Elemente
const favoriteColorsEl = document.getElementById("favorite-colors");
const favoriteMechanicsEl = document.getElementById("favorite-mechanics");
const colorFilterButtons = document.querySelectorAll('.color-filter-btn');
const mechanicButtons = document.querySelectorAll('[data-mechanic]');

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
  cardCache: new Map(), // Suchanfrage -> komplett geladene Kartenliste
  loading: false,
};

let loadToken = 0;

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function updateLikesCount() {
  likesCountEl.textContent = String(state.likes.length);
}

function saveLikes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.likes));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...state.seen]));
  } catch (error) {
    console.error("Likes konnten nicht gespeichert werden:", error);
  }
  updateLikesCount();
}

// Profil-Speicherungsfunktionen
function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch (error) {
    console.error("Profil konnte nicht gespeichert werden:", error);
    return false;
  }
}

function loadProfile() {
  return loadJson(PROFILE_KEY, null);
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

// ---------------------------------------------------------------
// Themes (aus Regeltext und Kreaturentypen abgeleitet)
// ---------------------------------------------------------------
const THEMES = [
  { key: "tribal",      label: "Tribal" }, // Sonderfall, siehe detectThemes
  { key: "lifegain",    label: "Lifegain",           re: /\bgains? (?:\w+ ){0,3}life\b|lifelink|whenever you gain life/ },
  { key: "counters",    label: "+1/+1 Counter",      re: /\+1\/\+1 counter|\bproliferate\b/ },
  { key: "tokens",      label: "Tokens",             re: /\bcreates? [^.]*\btoken|tokens? you control|populate/ },
  { key: "graveyard",   label: "Graveyard",          re: /graveyard|\bunearth\b|\bflashback\b|\bescape\b|\bdelve\b/ },
  { key: "sacrifice",   label: "Sacrifice",          re: /\bsacrifices?\b|whenever [^.]*\bdies\b/ },
  { key: "spellslinger",label: "Spellslinger",       re: /instant or sorcery|whenever you cast (?:an? )?(?:noncreature|instant|sorcery)|\bmagecraft\b|\bstorm\b|\bcopy target (?:instant|sorcery)/ },
  { key: "artifacts",   label: "Artifacts",          re: /\bartifacts?\b|\btreasure\b|\bclues?\b|\bfood\b|\bvehicles?\b/ },
  { key: "enchantments",label: "Enchantments",       re: /\benchantments?\b|\bauras?\b|constellation|\bsagas?\b/ },
  { key: "carddraw",    label: "Card Draw",          re: /\bdraws? (?:a|an|two|three|four|x|that many|cards?)\b|whenever you draw/ },
  { key: "landfall",    label: "Landfall / Ramp",    re: /landfall|additional land|search your library for [^.]*\bland\b|put [^.]*\bland cards? [^.]*onto the battlefield|play lands? from/ },
  { key: "mill",        label: "Mill",               re: /\bmills?\b|puts? the top [^.]*cards? of (?:their|your|target [^.]*) library into/ },
  { key: "voltron",     label: "Voltron / Equipment",re: /\bequip\b|equipped creature|attach|\bdouble strike\b|\bcommander damage\b|aura (?:and|or) equipment/ },
  { key: "infect",      label: "Infect / Gift",      re: /\binfect\b|poison counter|\btoxic\b/ },
  { key: "drain",       label: "Drain / Burn",       re: /each opponent loses|deals? \d+ damage to (?:each|any|target) (?:opponent|player)|deals? damage to each opponent/ },
];

const THEME_LABELS = Object.fromEntries(THEMES.map((t) => [t.key, t.label]));

// Mehrzahl-Formen eines Kreaturentyps (Elf -> Elves, Wolf -> Wolves, Sphinx -> Sphinxes)
function creatureTypeRegex(type) {
  const t = type.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forms = [`${t}`, `${t}s`, `${t}es`];
  if (t.endsWith("f")) forms.push(`${t.slice(0, -1)}ves`);
  if (t.endsWith("fe")) forms.push(`${t.slice(0, -2)}ves`);
  return new RegExp(`\\b(?:${forms.join("|")})\\b`);
}

function detectThemes({ name = "", faces = [] }) {
  const found = [];

  // Eigenen Namen aus dem Text entfernen, sonst zählt "Goblin Chainwhirler" als Goblin-Tribal
  const names = [name, name.split(",")[0], ...faces.map((f) => f.name || "")]
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 2);
  let text = faces.map((f) => f.text || "").join("\n").toLowerCase();
  names.sort((a, b) => b.length - a.length).forEach((n) => {
    text = text.split(n).join(" ");
  });

  // Tribal: eigene Kreaturentypen tauchen im Regeltext auf (oder "gewählter Typ")
  const subtypes = new Set();
  faces.forEach((f) => {
    if (!/\bcreature\b/i.test(f.type || "") || !f.type.includes("—")) return;
    f.type.split("—")[1].trim().split(/\s+/).filter(Boolean).forEach((s) => subtypes.add(s));
  });
  const tribes = [...subtypes].filter((s) => creatureTypeRegex(s).test(text));
  if (tribes.length) {
    found.push({ key: "tribal", label: THEME_LABELS.tribal, detail: tribes.join("/") });
  } else if (/choose a creature type|of the chosen type|\bchangeling\b|creature type/.test(text)) {
    found.push({ key: "tribal", label: THEME_LABELS.tribal, detail: "beliebiger Typ" });
  }

  THEMES.forEach((theme) => {
    if (theme.re && theme.re.test(text)) {
      found.push({ key: theme.key, label: theme.label });
    }
  });
  return found;
}

function themeChips(card) {
  if (!card.themes?.length) return "";
  return `<div class="mt-2 flex flex-wrap gap-1.5">${card.themes
    .map(
      (t) =>
        `<span class="rounded-full border border-mtg-gold/30 bg-mtg-gold/10 px-2 py-0.5 text-[11px] font-semibold text-mtg-parchment">${escapeHtml(
          t.label + (t.detail ? ` (${t.detail})` : "")
        )}</span>`
    )
    .join("")}</div>`;
}

function summarize(card) {
  const manaInfo = getCardMana(card);
  const faces = oracleFaces(card);
  return {
    id: card.id,
    name: card.name,
    type: card.type_line,
    colors: card.colors || card.card_faces?.[0]?.colors || [],
    image: imageFor(card),
    scryfall: card.scryfall_uri,
    set: card.set_name,
    faces,
    themes: detectThemes({ name: card.name, faces }),
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

// Farbfilter schon bei Scryfall anwenden -> deutlich weniger Seiten
function buildQuery() {
  let q = "is:commander game:paper -is:digital";
  const colors = (state.selectedColor || []).filter((c) => c !== "all");
  if (!colors.length) return q;

  const parts = [];
  if (colors.includes("C")) parts.push("c:c");
  const real = colors.filter((c) => c !== "C");
  if (real.length) parts.push(`c=${real.join("").toLowerCase()}`);
  return parts.length > 1 ? `${q} (${parts.join(" or ")})` : `${q} ${parts[0]}`;
}

function usableCards(cards) {
  return shuffle(
    filterCardsByColors(cards, state.selectedColor).filter(
      (card) => card.image && !state.seen.has(card.id)
    )
  );
}

// Lädt Seite für Seite: die erste Karte erscheint nach dem ersten Request,
// der Rest wird im Hintergrund nachgeladen und unter die Warteschlange gemischt.
async function loadDeck() {
  const token = ++loadToken;
  const stale = () => token !== loadToken;
  const query = buildQuery();

  const cached = state.cardCache.get(query);
  if (cached) {
    state.loading = false;
    state.queue = usableCards(cached);
    renderDeck();
    return;
  }

  state.loading = true;
  state.queue = [];
  renderDeck();

  const all = [];
  let url = `https://api.scryfall.com/cards/search?${new URLSearchParams({
    q: query,
    unique: "cards",
    order: "edhrec",
  })}`;

  try {
    while (url) {
      const res = await fetch(url);
      if (stale()) return;
      if (!res.ok) {
        if (res.status === 404) break; // keine Treffer
        throw new Error("Scryfall antwortet nicht");
      }
      const data = await res.json();
      if (stale()) return;

      const page = (data.data || []).map(summarize);
      all.push(...page);

      const before = state.queue.length;
      const visible = state.queue.slice(0, 3);
      state.queue = [...visible, ...shuffle([...state.queue.slice(3), ...usableCards(page)])];

      // Deck nur neu zeichnen, wenn sich die sichtbaren Karten ändern
      if (before < 3 && !state.busy && !state.dragging) renderDeck();
      else updateStatus();

      url = data.next_page;
      if (url) await new Promise((resolve) => setTimeout(resolve, 75));
    }

    state.cardCache.set(query, all);
  } catch (error) {
    console.error(error);
    if (stale()) return;
    statusEl.textContent = "Karten konnten nicht geladen werden.";
  }

  if (stale()) return;
  state.loading = false;
  if (state.queue.length === 0) renderDeck();
  else updateStatus();
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
    ${themeChips(card)}
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

function updateStatus() {
  if (state.queue.length) {
    statusEl.textContent =
      `${state.queue.length} Commanders warten auf dein Urteil` +
      (state.loading ? " (lade weitere…)" : "");
  } else {
    statusEl.textContent = state.loading ? "Commanders werden beschworen…" : "Keine weiteren Commanders";
  }
}

function renderDeck() {
  const visible = state.queue.slice(0, 3);
  deckEl.innerHTML = visible.map((card, i) => cardMarkup(card, i)).join("");
  emptyStateEl.classList.toggle("hidden", state.queue.length > 0 || state.loading);
  updateStatus();
  bindTopCard();
  renderIntel(state.queue[0] || null);

  // Bilder der nächsten Karten vorladen, damit sie sofort da sind
  state.queue.slice(3, 8).forEach((card) => {
    const img = new Image();
    img.src = card.image;
  });
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

// ---------------------------------------------------------------
// Match-Logik (Profil: Farben + Mechaniken)
// ---------------------------------------------------------------
const MECHANIC_LABELS = {
  "trample": "Trample",
  "first-strike": "First Strike",
  "vigilance": "Vigilance",
  "deathtouch": "Deathtouch",
  "lifelink": "Lifelink",
  "double-strike": "Double Strike",
  "haste": "Haste",
  "hexproof": "Hexproof",
  "flying": "Flying",
  "indestructible": "Indestructible",
};

// Punkte: Farben 2 (alle Kartenfarben in Favoriten) / 1 (teilweise),
//         Mechaniken 1 pro Treffer (max. 2), Themes 1 pro Treffer (max. 2).
// Match ab: 3 Punkten, sobald mehrere Kategorien im Profil gewählt sind.
//           Bei nur einer Kategorie: Farben 2, Mechaniken/Themes 1 Punkt.
function evaluateMatch(card) {
  const profile = loadProfile();
  if (!profile) return null;

  const favColors = (profile.favoriteColors || []).filter((c) => c !== "all");
  const favMechs = profile.favoriteMechanics || [];
  const favThemes = profile.favoriteThemes || [];
  const categories = [favColors.length, favMechs.length, favThemes.length].filter(Boolean).length;
  if (!categories) return null;

  const reasons = [];
  let score = 0;

  if (favColors.length) {
    const cardColors = card.colors?.length ? card.colors : ["C"];
    const hits = cardColors.filter((c) => favColors.includes(c));
    if (hits.length === cardColors.length) {
      score += 2;
      reasons.push(`Farben passen (${cardColors.join("")})`);
    } else if (hits.length) {
      score += 1;
      reasons.push(`Farbe teilweise (${hits.join("")})`);
    }
  }

  if (favMechs.length) {
    const text = (card.faces || []).map((f) => f.text || "").join("\n").toLowerCase();
    const hits = favMechs.filter((m) => new RegExp(`\\b${m.replace(/-/g, " ")}\\b`).test(text));
    score += Math.min(2, hits.length);
    hits.forEach((m) => reasons.push(MECHANIC_LABELS[m] || m));
  }

  if (favThemes.length) {
    const hits = (card.themes || []).filter((t) => favThemes.includes(t.key));
    score += Math.min(2, hits.length);
    hits.forEach((t) => reasons.push(t.label + (t.detail ? ` (${t.detail})` : "")));
  }

  const threshold = categories > 1 ? 3 : favColors.length ? 2 : 1;
  return { isMatch: score >= threshold, score, reasons };
}

let matchTimer = null;
function showMatch(card, match) {
  let el = document.getElementById("match-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "match-toast";
    el.className =
      "pointer-events-none fixed inset-x-0 top-24 z-[70] flex justify-center px-4 opacity-0 transition-opacity duration-300";
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="rounded-2xl border border-mtg-gold bg-mtg-panel/95 px-6 py-4 text-center shadow-card">
      <p class="font-display text-2xl tracking-[0.2em] text-mtg-gold">IT'S A MATCH!</p>
      <p class="mt-1 text-sm text-mtg-parchment">${escapeHtml(card.name)}</p>
      <p class="mt-1 text-xs text-stone-300">${escapeHtml(match.reasons.join(" · "))}</p>
    </div>`;
  requestAnimationFrame(() => el.classList.remove("opacity-0"));
  clearTimeout(matchTimer);
  matchTimer = setTimeout(() => el.classList.add("opacity-0"), 2400);
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
  const match = liked ? evaluateMatch(current) : null;
  if (liked && !state.likes.some((item) => item.id === current.id)) {
    state.likes.unshift({ ...current, match: match?.isMatch ? match : null });
  }
  saveLikes();
  if (match?.isMatch) showMatch(current, match);

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
        <article class="overflow-hidden rounded-xl border border-mtg-gold/20 bg-black/30 relative" data-id="${escapeHtml(card.id)}">
          <button 
            type="button" 
            data-remove="${escapeHtml(card.id)}" 
            class="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-rose-900/80 text-xs text-rose-200 hover:bg-rose-800/80"
            aria-label="Karte entfernen"
          >
            ×
          </button>
          ${card.match ? `<span class="absolute left-2 top-2 z-10 rounded-full bg-mtg-gold/90 px-2 py-0.5 text-[10px] font-bold text-black" title="${escapeHtml(card.match.reasons.join(" · "))}">★ Match</span>` : ""}
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
          ${themeChips(card)}
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

const mainFilterButtons = document.querySelectorAll("#main-color-filter .color-filter-btn");

mainFilterButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const color = btn.getAttribute("data-color");

    if (color === "all") {
      selectedColors.clear();
      selectedColors.add("all");
    } else {
      selectedColors.delete("all");
      if (selectedColors.has(color)) selectedColors.delete(color);
      else selectedColors.add(color);
      if (selectedColors.size === 0) selectedColors.add("all");
    }

    mainFilterButtons.forEach((b) =>
      b.classList.toggle("active", selectedColors.has(b.getAttribute("data-color")))
    );

    state.selectedColor = Array.from(selectedColors);
    state.seen.clear();
    saveLikes();

    await loadDeck();
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
  if (profileModalEl.classList.contains("flex")) {
    if (event.key === "Escape") closeProfile();
    return;
  }
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

// ---------------------------------------------------------------
// Profil-System
// ---------------------------------------------------------------
const profileColorBtns = () => document.querySelectorAll("#favorite-colors .color-filter-btn");
const profileMechanicBtns = () => document.querySelectorAll("#favorite-mechanics button");
const profileThemeBtns = () => document.querySelectorAll("#favorite-themes button");

function renderThemeButtons() {
  const container = document.getElementById("favorite-themes");
  if (!container) return;
  container.innerHTML = THEMES.map(
    (t) =>
      `<button type="button" data-theme="${t.key}" class="rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-stone-300 transition hover:bg-white/10">${escapeHtml(t.label)}</button>`
  ).join("");
}

function initProfileSystem() {
  renderThemeButtons();
  profileOpenBtn.addEventListener("click", openProfile);
  profileCloseBtn.addEventListener("click", closeProfile);
  profileBackdrop.addEventListener("click", closeProfile);
  saveProfileBtn.addEventListener("click", saveProfileToStorage);

  // Lieblingsfarben: "Alle" ist exklusiv, einzelne Farben schalten "Alle" ab
  profileColorBtns().forEach((btn) => {
    btn.addEventListener("click", () => {
      const color = btn.getAttribute("data-color");
      if (color === "all") {
        const turnOn = !btn.classList.contains("active");
        profileColorBtns().forEach((b) => b.classList.remove("active"));
        btn.classList.toggle("active", turnOn);
      } else {
        profileColorBtns().forEach((b) => {
          if (b.getAttribute("data-color") === "all") b.classList.remove("active");
        });
        btn.classList.toggle("active");
      }
    });
  });

  // Lieblings-Mechaniken: einfaches Ein/Aus
  profileMechanicBtns().forEach((btn) => {
    btn.addEventListener("click", () => btn.classList.toggle("active"));
  });

  // Lieblings-Themes: einfaches Ein/Aus
  profileThemeBtns().forEach((btn) => {
    btn.addEventListener("click", () => btn.classList.toggle("active"));
  });
}

function openProfile() {
  loadProfileIntoForm();
  profileModalEl.classList.remove("hidden");
  profileModalEl.classList.add("flex");
  profileModalEl.setAttribute("aria-hidden", "false");
}

function closeProfile() {
  profileModalEl.classList.add("hidden");
  profileModalEl.classList.remove("flex");
  profileModalEl.setAttribute("aria-hidden", "true");
}

function saveProfileToStorage() {
  const favoriteColors = Array.from(document.querySelectorAll("#favorite-colors .color-filter-btn.active"))
    .map((btn) => btn.getAttribute("data-color"));

  const favoriteMechanics = Array.from(document.querySelectorAll("#favorite-mechanics button.active"))
    .map((btn) => btn.getAttribute("data-mechanic"));

  const favoriteThemes = Array.from(document.querySelectorAll("#favorite-themes button.active"))
    .map((btn) => btn.getAttribute("data-theme"));

  const ok = saveProfile({ favoriteColors, favoriteMechanics, favoriteThemes });

  saveProfileBtn.textContent = ok ? "Gespeichert ✓" : "Speichern fehlgeschlagen";
  window.setTimeout(() => {
    saveProfileBtn.textContent = "Profil speichern";
    if (ok) closeProfile();
  }, 600);
}

function loadProfileIntoForm() {
  // Erst alles zurücksetzen, dann gespeicherte Auswahl anwenden
  profileColorBtns().forEach((b) => b.classList.remove("active"));
  profileMechanicBtns().forEach((b) => b.classList.remove("active"));
  profileThemeBtns().forEach((b) => b.classList.remove("active"));

  const profile = loadProfile();
  if (!profile) return;

  profileColorBtns().forEach((btn) => {
    if (profile.favoriteColors?.includes(btn.getAttribute("data-color"))) {
      btn.classList.add("active");
    }
  });

  profileMechanicBtns().forEach((btn) => {
    if (profile.favoriteMechanics?.includes(btn.getAttribute("data-mechanic"))) {
      btn.classList.add("active");
    }
  });

  profileThemeBtns().forEach((btn) => {
    if (profile.favoriteThemes?.includes(btn.getAttribute("data-theme"))) {
      btn.classList.add("active");
    }
  });
}

initProfileSystem();

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
async function boot() {
  updateLikesCount();
  await loadDeck();
}

boot();
