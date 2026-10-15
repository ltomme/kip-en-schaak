// Bestraf Glen!: vind de beste reactie op een blunder van Glen.
// Zetten worden gecontroleerd met de regels uit kippenschaak-rules.js (zonder eieren).

const LIVES = 3;
const INTRO_MS = 1000;   // zo lang zie je de stelling voor Glens zet
const BEST_KEY = "kip-en-schaak:bestraf-glen:best";
const FILES = "abcdefgh";
const GLEN = "Glen (IM, FIDE 2345)";

const el = {
  intro: document.getElementById("intro"),
  play: document.getElementById("play"),
  start: document.getElementById("start-btn"),
  board: document.getElementById("board"),
  hint: document.getElementById("board-hint"),
  prompt: document.getElementById("prompt"),
  move: document.getElementById("the-move"),
  meta: document.getElementById("meta"),
  feedback: document.getElementById("feedback"),
  line: document.getElementById("line"),
  score: document.getElementById("score"),
  lives: document.getElementById("lives"),
  streak: document.getElementById("streak"),
  best: document.getElementById("best")
};

let state;

// ---------- Stellingen en notatie ----------

function fromFen(fen) {
  const [board, turn, castling, ep] = fen.split(" ");
  return {
    sq: fenToSquares(board),
    turn,
    castling: { K: castling.includes("K"), Q: castling.includes("Q"), k: castling.includes("k"), q: castling.includes("q") },
    ep: ep === "-" ? null : squareIndex(ep),
    eggLock: { w: true, b: true }   // gewoon schaak: geen eieren leggen
  };
}

const uciOf = (m) => squareName(m.from) + squareName(m.to) + (m.promo ?? "");
const findMove = (pos, uci) => legalMoves(pos).find((m) => uciOf(m) === uci);

// Standaard algebraïsche notatie (Nf3, exd5, O-O, e8=Q+ ...).
function sanOf(pos, m) {
  let san;
  if (m.kind === "castle") {
    san = fileOf(m.to) === 6 ? "O-O" : "O-O-O";
  } else {
    const piece = typeOf(pos.sq[m.from]);
    const capture = m.kind === "capture" || m.kind === "ep";
    if (piece === "p") {
      san = (capture ? FILES[fileOf(m.from)] + "x" : "") + squareName(m.to) + (m.promo ? "=" + m.promo.toUpperCase() : "");
    } else {
      const rivals = legalMoves(pos).filter((o) => o.to === m.to && o.from !== m.from && typeOf(pos.sq[o.from]) === piece);
      let from = "";
      if (rivals.length) {
        if (!rivals.some((o) => fileOf(o.from) === fileOf(m.from))) from = FILES[fileOf(m.from)];
        else if (!rivals.some((o) => rankOf(o.from) === rankOf(m.from))) from = String(rankOf(m.from));
        else from = squareName(m.from);
      }
      san = piece.toUpperCase() + from + (capture ? "x" : "") + squareName(m.to);
    }
  }
  const after = applyMove(pos, m).state;
  if (inCheck(after, after.turn)) san += legalMoves(after).length ? "+" : "#";
  return san;
}

// "24." voor wit, "24…" voor zwart; fullmove komt uit de FEN.
function moveLabel(fullmove, color, san) {
  return `${fullmove}${color === "w" ? "." : "…"} ${san}`;
}

// ---------- Spelverloop ----------

function newGame() {
  if (state) clearTimeout(state.timer);
  state = {
    deck: shuffle(GLEN_PUZZLES),
    score: 0,
    lives: LIVES,
    streak: 0,
    current: null,
    pos: null,
    lastMove: null,
    selected: null,
    phase: "intro",      // intro → solve → answered → over
    flipped: false,
    timer: null,
    line: []             // stellingen van de beste variant, om door te bladeren
  };
  el.intro.hidden = true;
  el.play.hidden = false;
  nextPuzzle();
}

function nextPuzzle() {
  const p = (state.current = state.deck.pop());
  state.pos = fromFen(p.fen);
  state.lastMove = null;
  state.selected = null;
  state.phase = "intro";
  state.flipped = p.glenColor === "white";          // jij speelt de tegenstander: die onderaan
  state.fullmove = +p.fen.split(" ")[5];

  el.feedback.hidden = true;
  el.line.hidden = true;
  el.prompt.textContent = "Glen denkt na…";
  el.move.textContent = "";
  const clock = p.clock == null ? "" : ` · Glen had nog ${Math.floor(p.clock / 60)}:${String(p.clock % 60).padStart(2, "0")}`;
  el.meta.textContent = `${GLEN} · blitz ${p.timeControl} · ${p.year}${clock}`;
  el.hint.textContent = "";
  renderStatus();
  render();
  document.querySelector(".status-bar").scrollIntoView({ behavior: "smooth" });

  state.timer = setTimeout(() => {
    const m = findMove(state.pos, p.blunder);
    state.pos = applyMove(state.pos, m).state;
    state.lastMove = m;
    state.phase = "solve";
    el.prompt.textContent = `Glen (${p.glenColor === "white" ? "wit" : "zwart"}) speelde`;
    el.move.textContent = moveLabel(state.fullmove, p.glenColor === "white" ? "w" : "b", p.blunderSan) + "??";
    el.hint.textContent = `Jij speelt ${p.glenColor === "white" ? "zwart" : "wit"}. Bestraf hem!`;
    render();
  }, INTRO_MS);
}

function tryMove(from, to) {
  if (state.phase !== "solve" || from === null || to === null) return false;
  const options = legalMoves(state.pos).filter((m) => m.from === from && m.to === to);
  if (!options.length) return false;
  answer(options.find((m) => m.promo === "q") ?? options[0]);   // promotie: altijd een dame
  return true;
}

function answer(m) {
  const p = state.current;
  const correct = p.solutions.includes(uciOf(m));
  const yourSan = sanOf(state.pos, m);
  state.phase = "answered";
  state.selected = null;

  if (correct) {
    state.score++;
    state.streak++;
  } else {
    state.streak = 0;
    state.lives--;
  }
  const over = state.lives <= 0 || state.deck.length === 0;
  if (over) {
    state.phase = "over";
    if (state.score > getBest()) localStorage.setItem(BEST_KEY, state.score);
  }

  // Bord: na een juiste zet blijft jouw zet staan; anders tonen we de beste zet.
  buildLine(p);
  const shown = correct ? m : findMove(state.pos, p.solutions[0]);
  state.lastMove = shown;
  state.pos = applyMove(state.pos, shown).state;
  render();
  renderStatus();
  renderFeedback(correct, yourSan, over);
}

// Stellingen van de beste variant (vanaf de stelling na Glens blunder).
function buildLine(p) {
  let pos = state.pos;
  state.line = [{ pos, lastMove: state.lastMove }];
  for (const san of p.pv) {
    const m = legalMoves(pos).find((o) => sanOf(pos, o) === san);
    if (!m) break;
    pos = applyMove(pos, m).state;
    state.line.push({ pos, lastMove: m, san });
  }
}

// ---------- Weergave ----------

function render() {
  const s = state.pos;
  const targets = new Map();
  if (state.selected !== null && state.phase === "solve") {
    for (const m of legalMoves(s).filter((m) => m.from === state.selected)) targets.set(m.to, m.kind);
  }
  const last = state.lastMove ? [state.lastMove.from, state.lastMove.to] : [];
  const checkedKing = inCheck(s, s.turn) ? findKing(s, s.turn) : -1;

  el.board.replaceChildren();
  for (let d = 0; d < 64; d++) {
    const i = state.flipped ? 63 - d : d;
    const sq = document.createElement("button");
    const dark = (Math.floor(d / 8) + (d % 8)) % 2 === 1;
    sq.className = `square ${dark ? "dark" : "light"}`;
    sq.dataset.index = i;
    sq.setAttribute("aria-label", squareName(i));
    if (last.includes(i)) sq.classList.add("last-move");
    if (i === state.selected) sq.classList.add("selected");
    if (i === checkedKing) sq.classList.add("in-check");
    if (targets.has(i)) sq.classList.add("target", `target-${targets.get(i)}`);
    if (s.sq[i]) sq.innerHTML = pieceImg(s.sq[i]);
    el.board.append(sq);
  }
}

function renderStatus() {
  el.score.textContent = state.score;
  el.streak.textContent = state.streak;
  el.lives.textContent = "🥚".repeat(state.lives) + "🍳".repeat(LIVES - state.lives);
  el.lives.setAttribute("aria-label", `${state.lives} levens over`);
  el.best.textContent = getBest();
}

function getBest() {
  return +(localStorage.getItem(BEST_KEY) ?? 0);
}

function renderFeedback(correct, yourSan, over) {
  const p = state.current;
  const you = p.glenColor === "white" ? "b" : "w";
  const label = (san) => moveLabel(state.fullmove + (you === "w" ? 1 : 0), you, san);
  const alt = p.solutions.length > 1 ? " (er was nog een tweede goede zet)" : "";

  let title, verdict;
  if (correct) {
    title = "Juist! 🐔";
    verdict = `<strong>${label(yourSan)}</strong> straft Glen af${alt}.`;
  } else {
    title = "Mis! 🍳";
    verdict = `${label(yourSan)} is niet goed genoeg. De beste zet was <strong>${label(p.bestSan)}</strong>${alt}.`;
  }
  const opponent = p.playedOk
    ? "Zijn tegenstander vond het in de partij ook."
    : p.played ? `Zijn tegenstander speelde in de partij ${p.played}, en Glen ontsnapte.` : "";
  const details = `Evaluatie voor wit: <strong>${p.evalBefore}</strong> → <strong>${p.evalAfter}</strong> na Glens blunder,
    <strong>${p.bestEval}</strong> na ${p.bestSan}. ${opponent} Glen had beter ${p.glenBest} gespeeld.`;

  let end = "";
  if (over) {
    title = state.lives > 0 ? "Alle blunders bestraft! 🏆" : "Game over";
    end = `<p>Je eindscore: <strong>${state.score}</strong>. ${endMessage(state.score)}</p>`;
  }

  el.feedback.className = `feedback ${correct ? "is-correct" : "is-wrong"}`;
  el.feedback.innerHTML = `
    <h3>${title}</h3>
    <p>${verdict}</p>
    <p>${details}</p>
    ${end}
    <div class="feedback-actions">
      <button class="btn btn-primary" id="feedback-next">${over ? "Opnieuw spelen" : "Volgende blunder"}</button>
    </div>`;
  el.feedback.hidden = false;
  document.getElementById("feedback-next").addEventListener("click", () => (over ? newGame() : nextPuzzle()));
  document.getElementById("feedback-next").focus({ preventScroll: true });
  renderLine(you);
}

// De beste variant als klikbare zetten.
function renderLine(you) {
  el.line.replaceChildren();
  const label = document.createElement("p");
  label.className = "glen-line-label";
  label.textContent = "Beste variant (klik om te bekijken):";
  el.line.append(label);
  let color = you, full = state.fullmove + (you === "w" ? 1 : 0);
  state.line.slice(1).forEach((step, k) => {
    const btn = document.createElement("button");
    btn.className = "glen-line-move";
    btn.textContent = color === "w" || k === 0 ? moveLabel(full, color, step.san) : step.san;
    btn.addEventListener("click", () => {
      state.pos = step.pos;
      state.lastMove = step.lastMove;
      render();
      for (const b of el.line.querySelectorAll(".glen-line-move")) b.classList.toggle("active", b === btn);
    });
    el.line.append(btn);
    if (color === "b") full++;
    color = color === "w" ? "b" : "w";
  });
  el.line.hidden = false;
}

function endMessage(score) {
  return score >= 25 ? "Glen durft je niet meer uit te dagen." :
    score >= 12 ? "Sterk! Glen zal het voelen." :
    score >= 5 ? "Niet slecht, maar Glen lacht nog in zijn vuistje." :
    "Oei. Misschien heeft Glen toch gelijk dat hij geen blunders maakt.";
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Bediening ----------

enableBoardInput(el.board, {
  disabled: () => state.phase !== "solve",
  selected: () => state.selected,
  select: (i) => { state.selected = i; render(); },
  canDrag: (i) => Boolean(state.pos.sq[i]) && colorOf(state.pos.sq[i]) === state.pos.turn,
  tryMove,
  pieceHtml: (i) => pieceImg(state.pos.sq[i]),
  redraw: render
});

el.start.addEventListener("click", newGame);
