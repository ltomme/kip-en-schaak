// Klikken en slepen (muis en touch) op een bord van <button class="square" data-index="…">.
// De pagina beslist via callbacks wat er mag en wat er gebeurt:
//   disabled()        → true als er nu niets gezet mag worden
//   selected()        → index van het geselecteerde veld, of null
//   select(i)         → selecteer veld i (of null) en teken het bord opnieuw
//   canDrag(i)        → mag het stuk op veld i opgepakt worden?
//   tryMove(from, to) → speel de zet als die legaal is; geeft true terug als dat zo is
//   pieceHtml(i)      → HTML van het stuk op veld i (voor het sleepbeeld)
//   redraw()          → teken het bord opnieuw (na een geannuleerde sleepbeweging)

const DRAG_THRESHOLD = 5;   // pixels voor een klik een sleepbeweging wordt

function enableBoardInput(board, h) {
  let press = null;         // { index, x, y, pointerId, drag, wasSelected, ghost }

  const squareAt = (x, y) => {
    const sq = document.elementFromPoint(x, y)?.closest(".square");
    return sq && board.contains(sq) ? +sq.dataset.index : null;
  };

  const click = (i) => {
    if (h.disabled() || h.tryMove(h.selected(), i)) return;
    h.select(h.canDrag(i) && h.selected() !== i ? i : null);
  };

  board.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || press) return;
    const sq = e.target.closest(".square");
    if (!sq || h.disabled()) return;
    const i = +sq.dataset.index;
    e.preventDefault();
    // Een eigen stuk dat zelf een doel van de geselecteerde zet is (bv. de koning bij ei leggen),
    // geldt als doelveld en niet als iets om op te pakken.
    const isTarget = h.selected() !== null && h.selected() !== i && h.isTarget?.(h.selected(), i);
    const drag = h.canDrag(i) && !isTarget;
    press = { index: i, x: e.clientX, y: e.clientY, pointerId: e.pointerId, drag, wasSelected: h.selected() === i, ghost: null };
    if (drag && h.selected() !== i) h.select(i);
    board.setPointerCapture(e.pointerId);
  });

  board.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.pointerId || !press.drag) return;
    if (!press.ghost) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
      const size = board.querySelector(".square").getBoundingClientRect().width;
      press.ghost = document.createElement("div");
      press.ghost.className = "ks-ghost";
      press.ghost.style.width = press.ghost.style.height = `${size}px`;
      press.ghost.innerHTML = h.pieceHtml(press.index);
      document.body.append(press.ghost);
      board.querySelector(`[data-index="${press.index}"]`)?.classList.add("drag-origin");
    }
    press.ghost.style.left = `${e.clientX}px`;
    press.ghost.style.top = `${e.clientY}px`;
    const over = squareAt(e.clientX, e.clientY);
    for (const s of board.querySelectorAll(".drag-over")) s.classList.remove("drag-over");
    if (over !== null) board.querySelector(`[data-index="${over}"]`).classList.add("drag-over");
  });

  const endPress = (e, cancelled) => {
    if (!press || e.pointerId !== press.pointerId) return;
    const p = press;
    press = null;
    if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
    if (p.ghost) {
      p.ghost.remove();
      // Loslaten op een legaal veld speelt de zet; anders keert het stuk terug (en blijft geselecteerd).
      if (cancelled || !h.tryMove(p.index, squareAt(e.clientX, e.clientY))) h.redraw();
      return;
    }
    if (cancelled) return;
    if (p.drag) {
      // Gewone klik op een eigen stuk: selectie stond al aan; nogmaals klikken zet ze uit.
      if (p.wasSelected) h.select(null);
    } else if (squareAt(e.clientX, e.clientY) === p.index) {
      click(p.index);
    }
  };

  board.addEventListener("pointerup", (e) => endPress(e, false));
  board.addEventListener("pointercancel", (e) => endPress(e, true));

  // Toetsenbord: Enter/spatie op een veld geeft een click zonder pointer (detail 0).
  board.addEventListener("click", (e) => {
    const sq = e.target.closest(".square");
    if (sq && e.detail === 0) click(+sq.dataset.index);
  });
}
