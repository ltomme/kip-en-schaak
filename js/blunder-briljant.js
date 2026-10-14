// Blunder of briljant? Raad of een zet uit een echte partij een blunder of een offer was.

const LIVES = 3;
const ANSWER_SECONDS = 20;
const INTRO_MS = 1000;   // zo lang zie je de stelling voor de zet
const BEST_KEY = "kip-en-schaak:blunder-briljant:best";

const el = {
  intro: document.getElementById("intro"),
  play: document.getElementById("play"),
  start: document.getElementById("start-btn"),
  board: document.getElementById("board"),
  moves: document.getElementById("moves"),
  moveCounter: document.getElementById("move-counter"),
  mover: document.getElementById("mover"),
  theMove: document.getElementById("the-move"),
  meta: document.getElementById("meta"),
  choices: document.getElementById("choices"),
  feedback: document.getElementById("feedback"),
  lives: document.getElementById("lives"),
  score: document.getElementById("score"),
  streak: document.getElementById("streak"),
  best: document.getElementById("best"),
  clock: document.getElementById("clock"),
  clockBar: document.getElementById("clock-bar"),
  btnFirst: document.getElementById("btn-first"),
  btnPrev: document.getElementById("btn-prev"),
  btnMove: document.getElementById("btn-move"),
  btnNext: document.getElementById("btn-next"),
  btnLast: document.getElementById("btn-last")
};

let state;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newGame() {
  if (state) {
    stopClock();
    clearTimeout(state.intro);
  }
  state = {
    blunders: shuffle(BB_PUZZLES.filter((p) => p.type === "blunder")),
    briljant: shuffle(BB_PUZZLES.filter((p) => p.type === "briljant")),
    score: 0,
    lives: LIVES,
    streak: 0,
    current: null,
    positions: [],
    ply: 0,
    answered: false,
    intro: null,        // timeout die de zet speelt
    clock: null,        // interval van de afteltimer
    deadline: 0
  };
  el.intro.hidden = true;
  el.play.hidden = false;
  nextPuzzle();
}

function nextPuzzle() {
  // Elke vraag apart 50/50, zodat je niet op een patroon kan gokken.
  let pool = Math.random() < 0.5 ? state.blunders : state.briljant;
  if (pool.length === 0) pool = pool === state.blunders ? state.briljant : state.blunders;
  state.current = pool.pop();
  state.positions = buildPositions(state.current.uci);
  state.answered = false;

  el.feedback.hidden = true;
  el.choices.hidden = false;
  setChoicesEnabled(false);

  renderQuestion();
  renderMoves();
  renderStatus();
  renderClock(ANSWER_SECONDS * 1000);
  document.querySelector(".status-bar").scrollIntoView({ behavior: "smooth" });

  // Eerst de stelling ervoor, na een seconde wordt de zet gespeeld en loopt de klok.
  showPly(state.current.ply - 1);
  state.intro = setTimeout(() => {
    showPly(state.current.ply);
    setChoicesEnabled(true);
    startClock();
  }, INTRO_MS);
}

function setChoicesEnabled(enabled) {
  for (const b of el.choices.querySelectorAll("button")) b.disabled = !enabled;
}

// ---------- Timer ----------

function startClock() {
  stopClock();
  state.deadline = Date.now() + ANSWER_SECONDS * 1000;
  tick();
  state.clock = setInterval(tick, 200);
}

function stopClock() {
  clearInterval(state.clock);
  state.clock = null;
}

function tick() {
  const msLeft = Math.max(0, state.deadline - Date.now());
  renderClock(msLeft);
  if (msLeft === 0 && !state.answered) answer(null); // tijd op = fout
}

function renderClock(msLeft) {
  const secondsLeft = Math.ceil(msLeft / 1000);
  el.clock.textContent = secondsLeft;
  el.clockBar.style.width = `${(msLeft / (ANSWER_SECONDS * 1000)) * 100}%`;
  el.clockBar.parentElement.classList.toggle("urgent", secondsLeft <= 5);
}

// ---------- Weergave ----------

function moveLabel(ply, san) {
  const num = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${num}. ${san}` : `${num}… ${san}`;
}

function pieceName(san) {
  const names = { K: "koning", Q: "dame", R: "toren", B: "loper", N: "paard" };
  return names[san[0]] ?? "pion";
}

function renderQuestion() {
  const p = state.current;
  const color = p.mover === "white" ? "Wit" : "Zwart";
  el.mover.textContent = `${color} speelt`;
  el.theMove.textContent = moveLabel(p.ply, p.san[p.ply - 1]);
  el.meta.textContent = `Elo wit ${p.whiteElo} · zwart ${p.blackElo} · ${p.timeControl}`;
}

function maxPly() {
  return state.answered ? state.positions.length - 1 : state.current.ply;
}

function showPly(ply) {
  state.ply = Math.max(0, Math.min(maxPly(), ply));
  const flipped = state.current.mover === "black";
  renderBoard(el.board, state.positions[state.ply], state.current.uci[state.ply - 1], flipped);
  el.board.classList.toggle("at-question", state.ply === state.current.ply);

  const diff = state.ply - state.current.ply;
  el.moveCounter.textContent =
    diff === 0 ? "De te raden zet" :
    diff < 0 ? `${-diff} halve zet${diff === -1 ? "" : "ten"} ervoor` :
    `${diff} halve zet${diff === 1 ? "" : "ten"} erna`;

  for (const m of el.moves.querySelectorAll(".move")) {
    m.classList.toggle("active", +m.dataset.ply === state.ply);
  }
  const active = el.moves.querySelector(".move.active");
  if (active) el.moves.scrollTop = active.offsetTop - el.moves.clientHeight / 2;
}

function renderMoves() {
  el.moves.replaceChildren();
  const p = state.current;
  const last = state.answered ? p.san.length : p.ply;
  for (let i = 0; i < last; i++) {
    if (i % 2 === 0) {
      const num = document.createElement("span");
      num.className = "move-number";
      num.textContent = `${i / 2 + 1}.`;
      el.moves.append(num);
    }
    const btn = document.createElement("button");
    btn.className = "move";
    if (i === p.ply - 1) btn.classList.add("question-move");
    btn.dataset.ply = i + 1;
    btn.textContent = i === p.ply - 1 && state.answered ? `${p.san[i]}${p.type === "blunder" ? "??" : "!!"}` : p.san[i];
    btn.addEventListener("click", () => showPly(i + 1));
    el.moves.append(btn);
  }
}

function renderStatus() {
  el.lives.textContent = "🥚".repeat(state.lives) + "🍳".repeat(LIVES - state.lives);
  el.lives.setAttribute("aria-label", `${state.lives} levens over`);
  el.score.textContent = state.score;
  el.streak.textContent = state.streak;
  el.best.textContent = getBest();
}

function getBest() {
  return +(localStorage.getItem(BEST_KEY) ?? 0);
}

// ---------- Antwoorden ----------

// choice === null betekent: de tijd is op.
function answer(choice) {
  if (state.answered) return;
  const p = state.current;
  const correct = choice === p.type;
  state.answered = true;
  stopClock();
  if (correct) {
    state.score++;
    state.streak++;
  } else {
    state.streak = 0;
    state.lives--;
  }
  for (const b of el.choices.querySelectorAll("button")) b.disabled = true;

  const outOfPuzzles = state.blunders.length + state.briljant.length === 0;
  const finished = state.lives <= 0 || outOfPuzzles;
  if (finished && state.score > getBest()) localStorage.setItem(BEST_KEY, state.score);

  renderMoves();
  showPly(p.ply);
  renderStatus();
  renderFeedback(correct, finished, choice === null);
}

function bestReplyText(p) {
  if (!p.bestReply) return "";
  const opponent = p.mover === "white" ? "zwart" : "wit";
  const replyLabel = moveLabel(p.ply + 1, p.bestReply);
  const played = p.san[p.ply];
  const inGame = played === p.bestReply
    ? "En dat vond de tegenstander ook."
    : played ? `In de partij speelde ${opponent} ${played}.` : "";
  return ` De beste reactie voor ${opponent}: <strong>${replyLabel}</strong>. ${inGame}`;
}

function renderFeedback(correct, finished, timeout) {
  const p = state.current;
  const move = moveLabel(p.ply, p.san[p.ply - 1]);
  const verdict = p.type === "blunder"
    ? `${move} was een <strong>blunder</strong>.`
    : `${move} was een <strong>briljant offer</strong>: de ${pieceName(p.san[p.ply - 1])} mocht genomen worden, maar het is de enige sterke zet.` +
      (p.altMove ? ` De beste andere zet, ${p.altMove}, geeft <strong>${p.altEval}</strong> (voor wit).` : "");
  const evals = `Evaluatie voor wit: <strong>${p.evalBefore}</strong> → <strong>${p.evalAfter}</strong>.`;

  let title = correct ? "Juist! 🐔" : timeout ? "Tijd is op! ⏰" : "Mis! 🍳";
  let extra = "Bekijk het vervolg met ▶.";
  let button = "Volgende stelling";
  if (finished) {
    title = state.lives > 0 ? "Alle stellingen gespeeld! 🏆" : "Game over";
    extra = `Je eindscore: <strong>${state.score}</strong>. ` + (
      state.score >= 25 ? "Jij ziet wat Stockfish ziet." :
      state.score >= 12 ? "Sterk! Bijna grootmeesterkip." :
      state.score >= 5 ? "Niet slecht, maar er zit nog een kip in je schaakbord." :
      "Oei. Misschien toch eens een aflevering herbeluisteren?");
    button = "Opnieuw spelen";
  }

  el.feedback.className = `feedback ${correct ? "is-correct" : "is-wrong"}`;
  el.feedback.innerHTML = `
    <h3>${title}</h3>
    <p>${verdict} ${evals}${p.type === "blunder" ? bestReplyText(p) : ""}</p>
    <p>${extra}</p>
    <div class="feedback-actions">
      <button class="btn btn-primary" id="feedback-next">${button}</button>
      <a class="btn btn-ghost" href="https://lichess.org/${p.id}#${p.ply}" target="_blank" rel="noopener">Bekijk op Lichess</a>
    </div>`;
  el.choices.hidden = true;
  el.feedback.hidden = false;
  document.getElementById("feedback-next").addEventListener("click", () => (finished ? newGame() : nextPuzzle()));
  document.getElementById("feedback-next").focus({ preventScroll: true });
}

// ---------- Bediening ----------

el.start.addEventListener("click", newGame);
el.choices.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-answer]");
  if (btn) answer(btn.dataset.answer);
});
el.btnFirst.addEventListener("click", () => showPly(0));
el.btnPrev.addEventListener("click", () => showPly(state.ply - 1));
el.btnMove.addEventListener("click", () => showPly(state.current.ply));
el.btnNext.addEventListener("click", () => showPly(state.ply + 1));
el.btnLast.addEventListener("click", () => showPly(Infinity));

document.addEventListener("keydown", (e) => {
  if (!state || el.play.hidden) return;
  if (e.key === "ArrowLeft") showPly(state.ply - 1);
  if (e.key === "ArrowRight") showPly(state.ply + 1);
});

el.best.textContent = getBest();
