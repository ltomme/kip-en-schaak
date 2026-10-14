// Elo-ladder: Hitster, maar met schaakpartijen.
// Plaats elke nieuwe partij op de juiste plek in je tijdlijn van gemiddelde Elo's.

const GOAL = 10;
const LIVES = 3;
const AUTOPLAY_MS = 700;
const ANSWER_SECONDS = 60;
const BEST_KEY = "kip-en-schaak:elo-ladder:best";

const SPEEDS = { blitz: "Blitz", rapid: "Rapid", classical: "Klassiek" };

const el = {
  intro: document.getElementById("intro"),
  play: document.getElementById("play"),
  start: document.getElementById("start-btn"),
  board: document.getElementById("board"),
  moves: document.getElementById("moves"),
  moveCounter: document.getElementById("move-counter"),
  info: document.getElementById("game-info"),
  timeline: document.getElementById("timeline"),
  hint: document.getElementById("timeline-hint"),
  feedback: document.getElementById("feedback"),
  score: document.getElementById("score"),
  lives: document.getElementById("lives"),
  best: document.getElementById("best"),
  clock: document.getElementById("clock"),
  clockBar: document.getElementById("clock-bar"),
  btnFirst: document.getElementById("btn-first"),
  btnPrev: document.getElementById("btn-prev"),
  btnPlay: document.getElementById("btn-play"),
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
  const deck = shuffle(ELO_GAMES);
  if (state) {
    stopAutoplay();
    stopClock();
  }
  state = {
    deck,
    timeline: [deck.pop()],
    current: null,
    positions: [],
    ply: 0,
    timer: null,        // interval voor afspelen
    clock: null,        // interval voor de afteltimer
    deadline: 0,
    score: 0,
    lives: LIVES,
    phase: "guess",     // guess | reveal | over
    reveal: null        // { game, index, correct }
  };
  el.intro.hidden = true;
  el.play.hidden = false;
  nextCard();
}

function nextCard() {
  state.reveal = null; // een foute kaart verdwijnt, zoals in Hitster
  state.current = state.deck.pop();
  state.positions = buildPositions(state.current.uci);
  state.phase = "guess";
  el.feedback.hidden = true;
  showPly(0);
  renderInfo();
  renderMoves();
  renderTimeline();
  renderStatus();
  startClock();
  document.querySelector(".status-bar").scrollIntoView({ behavior: "smooth" });
}

// ---------- Timer ----------

function startClock() {
  stopClock();
  state.deadline = Date.now() + ANSWER_SECONDS * 1000;
  renderClock();
  state.clock = setInterval(renderClock, 200);
}

function stopClock() {
  clearInterval(state.clock);
  state.clock = null;
}

function renderClock() {
  const msLeft = Math.max(0, state.deadline - Date.now());
  const secondsLeft = Math.ceil(msLeft / 1000);
  el.clock.textContent = secondsLeft;
  el.clockBar.style.width = `${(msLeft / (ANSWER_SECONDS * 1000)) * 100}%`;
  el.clockBar.parentElement.classList.toggle("urgent", secondsLeft <= 10);
  if (msLeft === 0 && state.phase === "guess") guess(null); // tijd op = fout
}

// ---------- Bord en zetten ----------

function showPly(ply) {
  const max = state.positions.length - 1;
  state.ply = Math.max(0, Math.min(max, ply));
  renderBoard(el.board, state.positions[state.ply], state.current.uci[state.ply - 1]);
  el.moveCounter.textContent = `Zet ${Math.ceil(state.ply / 2)} / ${Math.ceil(max / 2)}`;
  for (const m of el.moves.querySelectorAll(".move")) {
    m.classList.toggle("active", +m.dataset.ply === state.ply);
  }
  // Enkel de zettenlijst scrollen, niet de hele pagina.
  const active = el.moves.querySelector(".move.active");
  if (active) el.moves.scrollTop = active.offsetTop - el.moves.clientHeight / 2;
  if (state.ply === max) stopAutoplay();
}

function startAutoplay() {
  stopAutoplay();
  if (state.ply === state.positions.length - 1) showPly(0);
  state.timer = setInterval(() => showPly(state.ply + 1), AUTOPLAY_MS);
  el.btnPlay.textContent = "⏸";
  el.btnPlay.setAttribute("aria-label", "Pauzeer");
}

function stopAutoplay() {
  clearInterval(state.timer);
  state.timer = null;
  el.btnPlay.textContent = "▶";
  el.btnPlay.setAttribute("aria-label", "Speel af");
}

function renderMoves() {
  el.moves.replaceChildren();
  state.current.san.forEach((san, i) => {
    if (i % 2 === 0) {
      const num = document.createElement("span");
      num.className = "move-number";
      num.textContent = `${i / 2 + 1}.`;
      el.moves.append(num);
    }
    const btn = document.createElement("button");
    btn.className = "move";
    btn.dataset.ply = i + 1;
    btn.textContent = san;
    btn.addEventListener("click", () => {
      stopAutoplay();
      showPly(i + 1);
    });
    el.moves.append(btn);
  });
}

function resultText(g) {
  const res = { "1-0": "Wit wint", "0-1": "Zwart wint", "1/2-1/2": "Remise" }[g.result];
  return g.termination === "Time forfeit" ? `${res} (op tijd)` : res;
}

function renderInfo() {
  const g = state.current;
  el.info.innerHTML = "";
  const items = [
    ["Tempo", `${SPEEDS[g.speed] ?? g.speed} · ${g.timeControl}`],
    ["Opening", g.opening || "—"],
    ["Uitslag", resultText(g)]
  ];
  for (const [label, value] of items) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    el.info.append(dt, dd);
  }
}

// ---------- Tijdlijn ----------

function makeCard(game, extraClass = "") {
  const card = document.createElement("div");
  card.className = `elo-card ${extraClass}`;
  card.innerHTML = `
    <span class="elo-card-avg">${game.avgElo}</span>
    <span class="elo-card-detail">W ${game.whiteElo} · Z ${game.blackElo}</span>
    <span class="elo-card-detail">${SPEEDS[game.speed] ?? game.speed} ${game.timeControl}</span>`;
  return card;
}

function makeSlot(index) {
  const slot = document.createElement("button");
  slot.className = "elo-slot";
  slot.textContent = "+";
  slot.setAttribute("aria-label", slotLabel(index));
  slot.disabled = state.phase !== "guess";
  slot.addEventListener("click", () => guess(index));
  return slot;
}

function slotLabel(index) {
  const t = state.timeline;
  if (index === 0) return `Plaats onder ${t[0].avgElo}`;
  if (index === t.length) return `Plaats boven ${t[t.length - 1].avgElo}`;
  return `Plaats tussen ${t[index - 1].avgElo} en ${t[index].avgElo}`;
}

function renderTimeline() {
  el.timeline.replaceChildren();
  const cards = state.timeline.map((g) => makeCard(g));

  // Bij een fout tonen we de kaart even op zijn echte plek.
  if (state.reveal && !state.reveal.correct) {
    const at = correctIndex(state.reveal.game);
    cards.splice(at, 0, makeCard(state.reveal.game, "wrong"));
  }
  if (state.reveal && state.reveal.correct) {
    cards[state.reveal.index].classList.add("correct");
  }

  if (state.phase === "guess") {
    el.timeline.append(makeSlot(0));
    cards.forEach((card, i) => el.timeline.append(card, makeSlot(i + 1)));
    el.hint.textContent = "Klik op een + om de partij op de juiste plek te leggen.";
  } else {
    el.timeline.append(...cards);
    el.hint.textContent = "";
  }

  const highlighted = el.timeline.querySelector(".correct, .wrong");
  if (highlighted) {
    el.timeline.scrollTo({
      left: highlighted.offsetLeft - (el.timeline.clientWidth - highlighted.offsetWidth) / 2,
      behavior: "smooth"
    });
  }
}

function correctIndex(game) {
  const i = state.timeline.findIndex((g) => g.avgElo > game.avgElo);
  return i === -1 ? state.timeline.length : i;
}

// index === null betekent: de tijd is op.
function guess(index) {
  if (state.phase !== "guess") return;
  const g = state.current;
  const t = state.timeline;
  let correct = false;
  if (index !== null) {
    const lower = index === 0 ? -Infinity : t[index - 1].avgElo;
    const upper = index === t.length ? Infinity : t[index].avgElo;
    correct = lower <= g.avgElo && g.avgElo <= upper; // gelijke Elo mag aan beide kanten
  }

  stopAutoplay();
  stopClock();
  if (correct) {
    t.splice(index, 0, g);
    state.score++;
  } else {
    state.lives--;
  }
  state.reveal = { game: g, index, correct, timeout: index === null };
  state.phase = state.score >= GOAL || state.lives <= 0 ? "over" : "reveal";

  renderTimeline();
  renderStatus();
  renderFeedback();
}

// ---------- Status en feedback ----------

function getBest() {
  return +(localStorage.getItem(BEST_KEY) ?? 0);
}

function renderStatus() {
  el.score.textContent = `${state.score} / ${GOAL}`;
  el.lives.textContent = "🥚".repeat(state.lives) + "🍳".repeat(LIVES - state.lives);
  el.lives.setAttribute("aria-label", `${state.lives} levens over`);
  el.best.textContent = getBest();
}

function renderFeedback() {
  const { game, correct, timeout } = state.reveal;
  const lichess = `https://lichess.org/${game.id}`;
  let title, text, button;

  if (correct) {
    title = "Juist! 🐔";
    text = `Gemiddelde Elo: <strong>${game.avgElo}</strong> (wit ${game.whiteElo}, zwart ${game.blackElo}).`;
  } else if (timeout) {
    title = "Tijd is op! ⏰";
    text = `Deze partij had een gemiddelde Elo van <strong>${game.avgElo}</strong> (wit ${game.whiteElo}, zwart ${game.blackElo}).`;
  } else {
    title = "Mis! 🍳";
    text = `Deze partij had een gemiddelde Elo van <strong>${game.avgElo}</strong> (wit ${game.whiteElo}, zwart ${game.blackElo}).`;
  }

  if (state.phase === "over") {
    if (state.score > getBest()) localStorage.setItem(BEST_KEY, state.score);
    renderStatus();
    title = state.score >= GOAL ? "Gewonnen! 🏆" : "Game over";
    text += state.score >= GOAL
      ? ` Je hebt ${GOAL} partijen correct gerangschikt. Echte grootmeesterkip!`
      : ` Je eindscore: <strong>${state.score}</strong>.`;
    button = "Opnieuw spelen";
  } else {
    button = "Volgende partij";
  }

  el.feedback.className = `feedback ${correct ? "is-correct" : "is-wrong"}`;
  el.feedback.innerHTML = `
    <h3>${title}</h3>
    <p>${text}</p>
    <div class="feedback-actions">
      <button class="btn btn-primary" id="feedback-next">${button}</button>
      <a class="btn btn-ghost" href="${lichess}" target="_blank" rel="noopener">Bekijk op Lichess</a>
    </div>`;
  el.feedback.hidden = false;
  document.getElementById("feedback-next").addEventListener("click", () => {
    state.phase === "over" ? newGame() : nextCard();
  });
  document.getElementById("feedback-next").focus({ preventScroll: true });
}

// ---------- Bediening ----------

el.start.addEventListener("click", newGame);
el.btnFirst.addEventListener("click", () => { stopAutoplay(); showPly(0); });
el.btnPrev.addEventListener("click", () => { stopAutoplay(); showPly(state.ply - 1); });
el.btnNext.addEventListener("click", () => { stopAutoplay(); showPly(state.ply + 1); });
el.btnLast.addEventListener("click", () => { stopAutoplay(); showPly(Infinity); });
el.btnPlay.addEventListener("click", () => (state.timer ? stopAutoplay() : startAutoplay()));

document.addEventListener("keydown", (e) => {
  if (!state || el.play.hidden || e.target.matches("input, textarea")) return;
  if (e.key === "ArrowLeft") { stopAutoplay(); showPly(state.ply - 1); }
  if (e.key === "ArrowRight") { stopAutoplay(); showPly(state.ply + 1); }
});

el.best.textContent = getBest();
