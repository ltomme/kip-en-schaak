// Kippenschaak: bediening en weergave. De spelregels staan in kippenschaak-rules.js.

const COLOR_NAMES = { w: "Wit", b: "Zwart" };

const el = {
  board: document.getElementById("ks-board"),
  status: document.getElementById("ks-status"),
  news: document.getElementById("ks-news"),
  eggs: document.getElementById("ks-eggs"),
  moves: document.getElementById("ks-moves"),
  undo: document.getElementById("ks-undo"),
  flip: document.getElementById("ks-flip"),
  autoFlip: document.getElementById("ks-autoflip"),
  restart: document.getElementById("ks-restart"),
  promo: document.getElementById("ks-promo")
};

let game;

function newGame() {
  game = {
    state: ksNewGame(),
    history: [],        // { state, notation, lastMove, news }
    selected: null,
    lastMove: null,
    flipped: false,
    news: "Wit begint. Tip: klik je dame en dan je koning om een ei te leggen."
  };
  render();
}

function status() {
  return gameStatus(game.state);
}

// ---------- Zetten uitvoeren ----------

function onSquareClick(i) {
  const st = status();
  if (st.over) return;
  const s = game.state;
  const piece = s.sq[i];

  if (game.selected !== null) {
    const options = st.moves.filter((m) => m.from === game.selected && m.to === i);
    if (options.length) {
      if (options.some((m) => m.promo)) askPromotion(options);
      else play(options[0]);
      return;
    }
  }
  // (De)selecteren van een eigen stuk; eieren zelf zijn niet te verplaatsen.
  game.selected = piece && colorOf(piece) === s.turn && !isEgg(piece) && game.selected !== i ? i : null;
  render();
}

function askPromotion(options) {
  el.promo.replaceChildren();
  for (const m of options) {
    const btn = document.createElement("button");
    btn.className = "ks-promo-btn";
    btn.innerHTML = pieceHtml(game.state.turn === "w" ? m.promo.toUpperCase() : m.promo);
    btn.setAttribute("aria-label", `Promoveer tot ${PIECE_NAMES[m.promo]}`);
    btn.addEventListener("click", () => {
      el.promo.hidden = true;
      play(m);
    });
    el.promo.append(btn);
  }
  el.promo.hidden = false;
}

function play(m) {
  const before = game.state;
  const mover = COLOR_NAMES[before.turn];
  const { state, result } = applyMove(before, m, Math.random);
  const notation = describeMove(before, m, state, result);

  let news;
  if (m.kind === "lay") news = `🥚 ${mover} legde een ei op ${squareName(result.eggAt)}!`;
  else if (m.kind === "hatch") news = `🐣 Het ei op ${squareName(m.to)} is uitgekomen: ${mover.toLowerCase()} krijgt een ${PIECE_NAMES[result.hatched]}!`;
  else if (m.kind === "breakEgg") news = `🍳 ${mover} heeft het ei op ${squareName(m.to)} kapotgemaakt.`;
  else news = "";

  game.history.push({ state: before, notation, lastMove: game.lastMove, news: game.news });
  game.state = state;
  game.lastMove = m;
  game.selected = null;
  game.news = news;
  if (el.autoFlip.checked) game.flipped = state.turn === "b";
  render();
}

function undo() {
  const prev = game.history.pop();
  if (!prev) return;
  game.state = prev.state;
  game.lastMove = prev.lastMove;
  game.news = prev.news;
  game.selected = null;
  if (el.autoFlip.checked) game.flipped = game.state.turn === "b";
  el.promo.hidden = true;
  render();
}

// ---------- Weergave ----------

// De kip vervangt het paard (zelfde bewegingen). Vormen staan er twee keer in:
// eerst met omtrek, dan zonder, zodat de lijnen tussen de vormen wegvallen.
const CHICKEN_SHAPES = `
  <path d="M66 50 C70 36 80 28 90 26 C88 36 90 46 84 56 Z"/>
  <ellipse cx="54" cy="62" rx="30" ry="22"/>
  <circle cx="34" cy="34" r="13"/>
  <path d="M26 42 C28 52 34 56 40 56 L46 46 Z"/>`;

function chickenSvg(color) {
  return `<svg class="ks-chicken ${color === "w" ? "white" : "black"}" viewBox="0 0 100 100" aria-label="kip">
    <path class="ks-chicken-red" d="M26 23 C24 14 30 12 32 18 C33 10 40 10 39 18 C42 13 48 16 44 23 Z"/>
    <g class="ks-chicken-body-outline">${CHICKEN_SHAPES}</g>
    <g class="ks-chicken-body">${CHICKEN_SHAPES}</g>
    <path class="ks-chicken-wing" d="M44 60 C52 54 66 56 70 64 C62 70 50 70 44 60 Z"/>
    <path class="ks-chicken-beak" d="M22 31 L11 36 L22 39 Z"/>
    <path class="ks-chicken-red" d="M23 40 C18 44 20 50 25 48 C27 46 26 42 25 40 Z"/>
    <circle class="ks-chicken-eye" cx="30" cy="31" r="2.6"/>
    <path class="ks-chicken-legs" d="M46 83 L44 94 M38 95 L50 95 M62 83 L64 94 M58 95 L70 95"/>
  </svg>`;
}

function pieceHtml(p) {
  if (isEgg(p)) return `<span class="ks-egg ${colorOf(p) === "w" ? "white" : "black"}" aria-label="ei"></span>`;
  if (typeOf(p) === "n") return chickenSvg(colorOf(p));
  return `<span class="piece ${colorOf(p) === "w" ? "white" : "black"}">${GLYPHS[typeOf(p)]}</span>`;
}

function render() {
  const s = game.state;
  const st = status();
  const targets = new Map();
  if (game.selected !== null) {
    for (const m of st.moves.filter((m) => m.from === game.selected)) targets.set(m.to, m.kind);
  }
  const lastSquares = game.lastMove ? [game.lastMove.from, game.lastMove.to] : [];
  const kingInCheck = st.check || st.mate ? findKing(s, s.turn) : -1;

  el.board.replaceChildren();
  for (let d = 0; d < 64; d++) {
    const i = game.flipped ? 63 - d : d;
    const sq = document.createElement("button");
    const dark = (Math.floor(d / 8) + (d % 8)) % 2 === 1;
    sq.className = `square ${dark ? "dark" : "light"}`;
    sq.setAttribute("aria-label", squareName(i));
    if (lastSquares.includes(i)) sq.classList.add("last-move");
    if (i === game.selected) sq.classList.add("selected");
    if (i === kingInCheck) sq.classList.add("in-check");
    if (targets.has(i)) {
      const kind = targets.get(i);
      sq.classList.add("target", `target-${kind}`);
      sq.title = kind === "lay" ? "Ei leggen" : kind === "hatch" ? "Ei uitbroeden" : kind === "breakEgg" ? "Ei kapotmaken" : "";
    }
    if (s.sq[i]) sq.innerHTML = pieceHtml(s.sq[i]);
    sq.addEventListener("click", () => onSquareClick(i));
    el.board.append(sq);
  }

  // Status
  if (st.over) {
    el.status.className = "ks-status over";
    el.status.textContent = st.mate
      ? `Schaakmat! ${COLOR_NAMES[other(s.turn)]} wint. 🏆`
      : "Pat: remise.";
  } else {
    el.status.className = `ks-status ${s.turn === "w" ? "turn-white" : "turn-black"}`;
    el.status.textContent = `${COLOR_NAMES[s.turn]} aan zet${st.check ? " — schaak!" : ""}`;
  }
  el.eggs.replaceChildren();
  for (const color of ["w", "b"]) {
    const li = document.createElement("li");
    const eggAt = s.sq.indexOf(color === "w" ? "O" : "o");
    li.textContent = eggAt !== -1 ? `🥚 ${COLOR_NAMES[color]}: ei op ${squareName(eggAt)}`
      : canLayEgg(s, color) ? `🥚 ${COLOR_NAMES[color]}: mag een ei leggen`
      : `⏳ ${COLOR_NAMES[color]}: eerst een pionzet of slagzet`;
    li.className = canLayEgg(s, color) ? "ready" : "waiting";
    el.eggs.append(li);
  }

  el.news.textContent = game.news;
  el.news.hidden = !game.news;

  // Zettenlijst
  el.moves.replaceChildren();
  const notations = game.history.map((h) => h.notation);
  for (let i = 0; i < notations.length; i += 2) {
    const num = document.createElement("span");
    num.className = "move-number";
    num.textContent = `${i / 2 + 1}.`;
    el.moves.append(num);
    for (const n of [notations[i], notations[i + 1]]) {
      const span = document.createElement("span");
      span.className = "ks-move";
      span.textContent = n ?? "";
      el.moves.append(span);
    }
  }
  el.moves.scrollTop = el.moves.scrollHeight;
  el.undo.disabled = game.history.length === 0;
}

// ---------- Bediening ----------

el.undo.addEventListener("click", undo);
el.restart.addEventListener("click", () => {
  if (game.history.length === 0 || confirm("Nieuwe partij beginnen? De huidige partij gaat verloren.")) newGame();
});
el.flip.addEventListener("click", () => {
  game.flipped = !game.flipped;
  render();
});
el.autoFlip.addEventListener("change", () => {
  if (el.autoFlip.checked) game.flipped = game.state.turn === "b";
  render();
});

newGame();
