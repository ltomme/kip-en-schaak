// Word Landskampioen!: speel 8 partijen tegelijk tegen Leuven Centraal en haal minstens 4½.
// Regels uit kippenschaak-rules.js (zonder eieren) en chess-notation.js; tegenstander is Stockfish
// (js/vendor/stockfish) in een Web Worker.

const BOARDS = 8;
const NEEDED = 4.5;
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const TITLES_KEY = "kip-en-schaak:landskampioen:titels";

// Niveaus: Elo van Leuven Centraal rond het gekozen niveau (bord 1 sterkst, bord 8 zwakst).
// Kuiken speelt op Skill Level 0 en doet daarnaast geregeld een willekeurige zet.
const LEVELS = {
  kuiken: { name: "🐣 Kuiken", elo: null },
  kip: { name: "🐔 Kip", elo: 1500 },
  haan: { name: "🐓 Haan", elo: 2000 },
  glen: { name: "🦅 Glen", elo: 2600 }
};
const BOARD_OFFSETS = [175, 125, 75, 25, -25, -75, -125, -175];
const KUIKEN_RANDOM = [0.15, 0.2, 0.25, 0.3, 0.3, 0.35, 0.4, 0.45];   // kans op een willekeurige zet per bord
const ELO_MIN = 1320, ELO_MAX = 3190;                                // bereik van UCI_Elo in Stockfish

// Eerste zet van Leuven Centraal, zodat niet elk bord dezelfde opening krijgt.
// Sleutel: de zetten tot nu toe (UCI).
const OPENINGS = {
  "": ["e2e4", "d2d4", "c2c4", "g1f3"],
  "e2e4": ["e7e5", "c7c5", "e7e6", "c7c6"],
  "d2d4": ["d7d5", "g8f6"],
  "c2c4": ["e7e5", "g8f6", "c7c5"],
  "g1f3": ["d7d5", "g8f6"]
};

// Tempo: één klok voor al je partijen samen, met increment per zet.
const TEMPOS = {
  blitz: { name: "⚡ Blitz", base: 5 * 60, inc: 3 },
  rapid: { name: "⏱️ Rapid", base: 15 * 60, inc: 5 },
  klassiek: { name: "🐢 Klassiek", base: 45 * 60, inc: 10 },
  geen: { name: "♾️ Zonder klok", base: null, inc: 0 }
};

const el = {
  setup: document.getElementById("setup"),
  levelChoices: document.getElementById("level-choices"),
  tempoChoices: document.getElementById("tempo-choices"),
  start: document.getElementById("start-btn"),
  play: document.getElementById("play"),
  score: document.getElementById("team-score"),
  needed: document.getElementById("needed"),
  clock: document.getElementById("lk-clock"),
  board: document.getElementById("board"),
  boardTitle: document.getElementById("board-title"),
  boardState: document.getElementById("board-state"),
  moves: document.getElementById("board-moves"),
  draw: document.getElementById("btn-draw"),
  resign: document.getElementById("btn-resign"),
  minis: document.getElementById("minis"),
  feedback: document.getElementById("lk-feedback"),
  loading: document.getElementById("lk-loading")
};

let match = null;
let choice = { level: "kip", tempo: "rapid" };

// ---------- Stockfish ----------

// Eén worker voor alle borden; verzoeken worden één voor één afgehandeld.
const engine = {
  worker: null,
  ready: null,
  queue: Promise.resolve(),
  listener: null
};

const ENGINE_TIMEOUT_MS = 20000;

// Start Stockfish; faalt (reject) als de worker niet laadt of niet op tijd antwoordt.
// Een lokaal geopend bestand (file://) mag geen Web Worker starten.
function startEngine() {
  if (engine.ready) return engine.ready;
  engine.ready = new Promise((resolve, reject) => {
    if (location.protocol === "file:") return reject(new Error("file"));
    const timer = setTimeout(() => reject(new Error("timeout")), ENGINE_TIMEOUT_MS);
    try {
      engine.worker = new Worker("js/vendor/stockfish/stockfish-19-lite-single.js");
    } catch (err) {
      clearTimeout(timer);
      return reject(err);
    }
    engine.worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || "worker")); };
    engine.worker.onmessage = (e) => engine.listener?.(String(e.data));
    engine.listener = (line) => { if (line === "readyok") { clearTimeout(timer); resolve(); } };
    engine.worker.postMessage("uci");
    engine.worker.postMessage("isready");
  });
  engine.ready.catch(() => { engine.ready = null; });   // volgende match: opnieuw proberen
  return engine.ready;
}

// Zoekt een zet in de stelling na `moves` (UCI vanaf de beginstelling).
// Geeft { move, score } terug; score in centipionnen voor de speler aan zet.
function askEngine({ moves, elo, skill, movetime }) {
  const job = engine.queue.then(() => new Promise((resolve) => {
    let score = 0;
    engine.listener = (line) => {
      const cp = line.match(/ score cp (-?\d+)/);
      const mate = line.match(/ score mate (-?\d+)/);
      if (cp) score = +cp[1];
      if (mate) score = +mate[1] > 0 ? 10000 : -10000;
      const best = line.match(/^bestmove (\S+)/);
      if (best) resolve({ move: best[1], score });
    };
    const w = engine.worker;
    w.postMessage(`setoption name UCI_LimitStrength value ${elo ? "true" : "false"}`);
    if (elo) w.postMessage(`setoption name UCI_Elo value ${elo}`);
    w.postMessage(`setoption name Skill Level value ${skill ?? 20}`);
    w.postMessage(`position startpos${moves.length ? " moves " + moves.join(" ") : ""}`);
    w.postMessage(`go movetime ${movetime}`);
  }));
  engine.queue = job.catch(() => {});
  return job;
}

// ---------- Partijen ----------

function newBoard(i) {
  const level = LEVELS[choice.level];
  const elo = level.elo && Math.max(ELO_MIN, Math.min(ELO_MAX, level.elo + BOARD_OFFSETS[i]));
  const pos = fromFen(START);
  return {
    number: i + 1,
    you: i % 2 === 0 ? "w" : "b",          // jij wit op de oneven borden
    elo,
    random: level.elo ? 0 : KUIKEN_RANDOM[i],
    pos,
    uci: [],
    san: [],
    halfmove: 0,                           // voor de 50-zettenregel
    seen: new Map([[positionKey(pos), 1]]),// voor drievoudige herhaling
    lastMove: null,
    thinking: false,
    note: "",                              // bv. antwoord op een remiseaanbod
    result: null,                          // punten voor jou: 1, 0.5 of 0
    reason: ""
  };
}

function positionKey(pos) {
  const c = pos.castling;
  return pos.sq.map((p) => p ?? ".").join("") + pos.turn + (c.K ? "K" : "") + (c.Q ? "Q" : "") + (c.k ? "k" : "") + (c.q ? "q" : "") + (pos.ep ?? "-");
}

function insufficientMaterial(pos) {
  const rest = pos.sq.filter((p) => p && typeOf(p) !== "k");
  return rest.length === 0 || (rest.length === 1 && ["b", "n"].includes(typeOf(rest[0])));
}

// Speelt een legale zet op een bord en kijkt of de partij daarmee gedaan is.
function playOn(b, m) {
  const piece = b.pos.sq[m.from];
  b.note = "";
  b.san.push(sanOf(b.pos, m));
  b.uci.push(uciOf(m));
  b.pos = applyMove(b.pos, m).state;
  b.lastMove = m;
  b.halfmove = typeOf(piece) === "p" || m.kind === "capture" || m.kind === "ep" ? 0 : b.halfmove + 1;
  const key = positionKey(b.pos);
  b.seen.set(key, (b.seen.get(key) ?? 0) + 1);

  const moves = legalMoves(b.pos);
  if (!moves.length) {
    if (inCheck(b.pos, b.pos.turn)) finishBoard(b, b.pos.turn === b.you ? 0 : 1, "schaakmat");
    else finishBoard(b, 0.5, "pat");
  } else if (b.halfmove >= 100) finishBoard(b, 0.5, "50-zettenregel");
  else if (b.seen.get(key) >= 3) finishBoard(b, 0.5, "drievoudige herhaling");
  else if (insufficientMaterial(b.pos)) finishBoard(b, 0.5, "onvoldoende materiaal");
}

function finishBoard(b, points, reason) {
  b.result = points;
  b.reason = reason;
  b.thinking = false;
}

const ongoing = (b) => b.result === null;
const yourTurn = (b) => ongoing(b) && !b.thinking && b.pos.turn === b.you;

async function engineMove(b) {
  const m0 = match;
  b.thinking = true;
  render();
  const delay = 300 + Math.random() * 500;   // een mens denkt ook even na
  let uci;
  const book = OPENINGS[b.uci.join(" ")];
  if (book) {
    await new Promise((r) => setTimeout(r, delay));
    uci = book[Math.floor(Math.random() * book.length)];
  } else if (b.random && Math.random() < b.random) {
    await new Promise((r) => setTimeout(r, delay));
    const moves = legalMoves(b.pos);
    uci = uciOf(moves[Math.floor(Math.random() * moves.length)]);
  } else {
    const level = b.elo ? { elo: b.elo } : { skill: 0 };
    uci = (await askEngine({ moves: b.uci, movetime: Math.round(delay), ...level })).move;
  }
  if (match !== m0 || m0.over || !ongoing(b)) return;   // intussen opgegeven, vlag gevallen of opnieuw gestart
  b.thinking = false;
  playOn(b, findMove(b.pos, uci));
  // Wacht je nog nergens anders op? Spring dan naar dit bord.
  if (!yourTurn(current())) match.selected = b.number - 1;
  afterMove();
}

// ---------- Wedstrijd ----------

function startMatch() {
  if (match) stopClock();
  const tempo = TEMPOS[choice.tempo];
  match = {
    boards: Array.from({ length: BOARDS }, (_, i) => newBoard(i)),
    selected: 0,
    pieceSelected: null,
    engineReady: false,                  // pas zetten als Leuven Centraal er echt is
    timeLeft: tempo.base == null ? null : tempo.base * 1000,
    inc: tempo.inc * 1000,
    lastTick: null,
    clock: null,
    over: false,
    level: choice.level,
    tempo: choice.tempo
  };
  el.setup.hidden = true;
  el.play.hidden = false;
  el.feedback.hidden = true;
  el.loading.hidden = false;
  render();

  el.loading.textContent = "Leuven Centraal komt de zaal binnen…";
  const m0 = match;
  startEngine().then(() => {
    if (match !== m0) return;
    match.engineReady = true;
    el.loading.hidden = true;
    for (const b of match.boards) if (b.pos.turn !== b.you) engineMove(b);
    startClock();
    render();
  }, (err) => {
    if (match !== m0) return;
    match.over = true;
    el.loading.textContent = err.message === "file"
      ? "Leuven Centraal is niet komen opdagen: de schaakcomputer kan niet starten vanuit een lokaal geopend bestand. Speel online via ltomme.github.io/kip-en-schaak."
      : "Leuven Centraal is niet komen opdagen: de schaakcomputer kon niet starten in deze browser. Probeer de pagina te herladen.";
    render();
  });
}

function current() {
  return match.boards[match.selected];
}

function afterMove() {
  if (match.boards.every((b) => !ongoing(b))) return endMatch();
  render();
}

// Na je zet: naar het volgende bord waar je aan zet bent.
function nextWaitingBoard() {
  for (let k = 1; k <= BOARDS; k++) {
    const i = (match.selected + k) % BOARDS;
    if (yourTurn(match.boards[i])) return i;
  }
  return match.selected;
}

function tryMove(from, to) {
  const b = current();
  if (!match.engineReady || match.over || !yourTurn(b) || from === null || to === null) return false;
  const options = legalMoves(b.pos).filter((m) => m.from === from && m.to === to);
  if (!options.length) return false;
  playOn(b, options.find((m) => m.promo === "q") ?? options[0]);   // promotie: altijd een dame
  match.pieceSelected = null;
  if (match.timeLeft != null) match.timeLeft += match.inc;
  if (ongoing(b)) engineMove(b);
  match.selected = nextWaitingBoard();
  afterMove();
  return true;
}

function resign() {
  const b = current();
  if (!ongoing(b) || match.over) return;
  if (!confirm(`Bord ${b.number} opgeven?`)) return;
  finishBoard(b, 0, "opgegeven");
  match.selected = nextWaitingBoard();
  afterMove();
}

async function offerDraw() {
  const b = current();
  if (!yourTurn(b) || match.over) return;
  const m0 = match;
  b.note = "Leuven Centraal denkt na over je remiseaanbod…";
  b.thinking = true;
  render();
  // Volle sterkte, ook als hij zelf zwakker speelt: een tegenstander weet wel of hij beter staat.
  const { score } = await askEngine({ moves: b.uci, movetime: 400 });
  if (match !== m0 || m0.over || !ongoing(b)) return;
  b.thinking = false;
  const forOpponent = -score;                        // jij bent aan zet, dus score is voor jou
  const threshold = b.elo ? 30 : 150;
  if (b.uci.length >= 20 && forOpponent <= threshold) {
    finishBoard(b, 0.5, "remise aanvaard");
    match.selected = nextWaitingBoard();
    afterMove();
  } else {
    b.note = b.uci.length < 20
      ? "Remise geweigerd: daarvoor is het nog veel te vroeg."
      : "Remise geweigerd: Leuven Centraal denkt dat het beter staat.";
    render();
  }
}

function endMatch() {
  match.over = true;
  stopClock();
  const { you, them } = totals();
  const champion = you >= NEEDED;
  if (champion) localStorage.setItem(TITLES_KEY, getTitles() + 1);
  let title, text;
  if (champion) {
    title = "🏆 Landskampioen!";
    text = `${fmt(you)}–${fmt(them)} tegen Leuven Centraal. De beker is voor jou, en geen enkele kip die daar nog aan twijfelt.`;
  } else if (you === 4) {
    title = "4–4. Net niet.";
    text = "Een gelijkspel in de laatste ronde, en de titel is weg. Waar hebben we dat nog gezien?";
  } else {
    title = "Geen titel dit jaar";
    text = `${fmt(you)}–${fmt(them)}: Leuven Centraal was te sterk. Volgend seizoen beter?`;
  }
  el.feedback.className = `feedback ${champion ? "is-correct" : "is-wrong"}`;
  el.feedback.innerHTML = `
    <h3>${title}</h3>
    <p>${text}</p>
    <p>Niveau ${LEVELS[match.level].name} · ${TEMPOS[match.tempo].name} · titels gewonnen: <strong>${getTitles()}</strong></p>
    <div class="feedback-actions">
      <button class="btn btn-primary" id="lk-again">Nog eens</button>
      <button class="btn btn-ghost" id="lk-setup">Ander niveau of tempo</button>
    </div>`;
  el.feedback.hidden = false;
  document.getElementById("lk-again").addEventListener("click", startMatch);
  document.getElementById("lk-setup").addEventListener("click", showSetup);
  render();
  el.feedback.scrollIntoView({ behavior: "smooth", block: "center" });
}

function totals() {
  let you = 0, them = 0;
  for (const b of match.boards) if (!ongoing(b)) { you += b.result; them += 1 - b.result; }
  return { you, them };
}

const fmt = (x) => (Number.isInteger(x) ? String(x) : `${Math.floor(x) || ""}½`);
const getTitles = () => +(localStorage.getItem(TITLES_KEY) ?? 0);

// ---------- Klok ----------

function startClock() {
  if (match.timeLeft == null) return;
  match.lastTick = Date.now();
  match.clock = setInterval(tick, 200);
}

function stopClock() {
  clearInterval(match?.clock);
}

// De klok loopt zolang er minstens één bord op jouw zet wacht.
function tick() {
  if (match.over) return;
  const now = Date.now();
  if (match.boards.some(yourTurn)) match.timeLeft -= now - match.lastTick;
  match.lastTick = now;
  if (match.timeLeft <= 0) {
    match.timeLeft = 0;
    for (const b of match.boards) if (ongoing(b)) finishBoard(b, 0, "vlag gevallen");
    endMatch();
    return;
  }
  renderClock();
}

function renderClock() {
  if (match.timeLeft == null) {
    el.clock.textContent = "∞";
    return;
  }
  const s = Math.ceil(match.timeLeft / 1000);
  el.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  el.clock.parentElement.classList.toggle("urgent", s <= 30);
}

// ---------- Weergave ----------

function render() {
  const { you, them } = totals();
  el.score.textContent = `${fmt(you) || 0} – ${fmt(them) || 0}`;
  const left = NEEDED - you;
  const open = match.boards.filter(ongoing).length;
  el.needed.textContent = left <= 0 ? "Titel binnen! 🏆"
    : left > open ? "Titel niet meer haalbaar"
    : `Nog ${fmt(left)} nodig uit ${open}`;
  renderClock();
  renderMain();
  renderMinis();
}

function stateText(b) {
  if (!match.engineReady) return match.over ? "" : "Wachten op Leuven Centraal…";
  if (!ongoing(b)) return `${b.result === 1 ? "Gewonnen" : b.result === 0 ? "Verloren" : "Remise"} (${b.reason})`;
  if (b.note) return b.note;
  if (b.thinking) return "Leuven Centraal denkt na…";
  if (b.pos.turn === b.you) return inCheck(b.pos, b.pos.turn) ? "Jouw zet: schaak!" : "Jouw zet";
  return "Leuven Centraal aan zet";
}

function renderMain() {
  const b = current();
  const opponent = b.elo ? `±${b.elo}` : "Kuiken";
  el.boardTitle.textContent = `Bord ${b.number} · jij met ${b.you === "w" ? "wit" : "zwart"} · Leuven Centraal (${opponent})`;
  el.boardState.textContent = stateText(b);
  el.draw.disabled = !match.engineReady || !yourTurn(b) || match.over;
  el.resign.disabled = !match.engineReady || !ongoing(b) || match.over;

  const s = b.pos;
  const targets = new Map();
  if (match.pieceSelected !== null && yourTurn(b)) {
    for (const m of legalMoves(s).filter((m) => m.from === match.pieceSelected)) targets.set(m.to, m.kind);
  }
  const last = b.lastMove ? [b.lastMove.from, b.lastMove.to] : [];
  const checked = ongoing(b) && inCheck(s, s.turn) ? findKing(s, s.turn) : -1;
  const flipped = b.you === "b";

  el.board.replaceChildren();
  for (let d = 0; d < 64; d++) {
    const i = flipped ? 63 - d : d;
    const sq = document.createElement("button");
    sq.className = `square ${(Math.floor(d / 8) + (d % 8)) % 2 ? "dark" : "light"}`;
    sq.dataset.index = i;
    sq.setAttribute("aria-label", squareName(i));
    if (last.includes(i)) sq.classList.add("last-move");
    if (i === match.pieceSelected) sq.classList.add("selected");
    if (i === checked) sq.classList.add("in-check");
    if (targets.has(i)) sq.classList.add("target", `target-${targets.get(i)}`);
    if (s.sq[i]) sq.innerHTML = pieceImg(s.sq[i]);
    el.board.append(sq);
  }

  el.moves.textContent = b.san.map((san, k) => (k % 2 === 0 ? `${k / 2 + 1}. ${san}` : san)).join(" ") || "Nog geen zetten.";
}

function renderMinis() {
  if (el.minis.children.length !== BOARDS) {
    el.minis.replaceChildren();
    match.boards.forEach((_, i) => {
      const btn = document.createElement("button");
      btn.className = "lk-mini";
      btn.innerHTML = `<span class="lk-mini-label"></span><div class="board lk-mini-board"></div><span class="lk-mini-state"></span>`;
      btn.addEventListener("click", () => {
        match.selected = i;
        match.pieceSelected = null;
        render();
      });
      el.minis.append(btn);
    });
  }
  match.boards.forEach((b, i) => {
    const btn = el.minis.children[i];
    btn.classList.toggle("selected", i === match.selected);
    const waiting = yourTurn(b) && match.engineReady && !match.over;
    btn.classList.toggle("waiting", waiting);
    btn.classList.toggle("done", !ongoing(b));
    btn.querySelector(".lk-mini-label").textContent = `Bord ${b.number} ${b.you === "w" ? "⚪" : "⚫"}`;
    btn.querySelector(".lk-mini-state").textContent = !ongoing(b)
      ? (b.result === 1 ? "1–0 ✔" : b.result === 0 ? "0–1 ✘" : "½–½")
      : b.thinking ? "denkt…" : waiting ? "jouw zet" : "";
    renderBoard(btn.querySelector(".lk-mini-board"), b.pos.sq, b.lastMove ? uciOf(b.lastMove) : null, b.you === "b");
  });
}

// ---------- Keuzescherm ----------

function renderChoices(container, options, key) {
  container.replaceChildren();
  for (const [id, opt] of Object.entries(options)) {
    const btn = document.createElement("button");
    btn.className = "lk-choice";
    btn.classList.toggle("active", choice[key] === id);
    const detail = key === "level"
      ? (opt.elo ? `±${opt.elo} Elo` : "blundert vrolijk mee")
      : (opt.base == null ? "denk zo lang je wil" : `${opt.base / 60} min + ${opt.inc} s per zet`);
    btn.innerHTML = `<strong>${opt.name}</strong><span>${detail}</span>`;
    btn.addEventListener("click", () => {
      choice[key] = id;
      renderChoices(container, options, key);
    });
    container.append(btn);
  }
}

function showSetup() {
  if (match) {
    match.over = true;
    stopClock();
  }
  el.play.hidden = true;
  el.setup.hidden = false;
  renderChoices(el.levelChoices, LEVELS, "level");
  renderChoices(el.tempoChoices, TEMPOS, "tempo");
}

// ---------- Bediening ----------

enableBoardInput(el.board, {
  disabled: () => !match || !match.engineReady || match.over || !yourTurn(current()),
  selected: () => match.pieceSelected,
  select: (i) => { match.pieceSelected = i; renderMain(); },
  canDrag: (i) => Boolean(current().pos.sq[i]) && colorOf(current().pos.sq[i]) === current().you,
  tryMove,
  pieceHtml: (i) => pieceImg(current().pos.sq[i]),
  redraw: renderMain
});

el.start.addEventListener("click", startMatch);
el.draw.addEventListener("click", offerDraw);
el.resign.addEventListener("click", resign);
showSetup();
