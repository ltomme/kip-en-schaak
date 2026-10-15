// Minimaal schaakbord: rekent posities uit UCI-zetten en tekent ze.
// Geen legaliteitscontrole nodig: de zetten komen uit echte Lichess-partijen.

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

// Gevulde glyphs voor beide kleuren; de kleur zelf komt uit CSS.
// U+FE0E vraagt om tekst in plaats van emoji (anders tekent iOS de pion ♟ als emoji).
const GLYPHS = Object.fromEntries(
  Object.entries({ k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }).map(([t, g]) => [t, g + "︎"])
);

function fenToSquares(fen) {
  const squares = [];
  for (const row of fen.split("/")) {
    for (const ch of row) {
      if (/\d/.test(ch)) squares.push(...Array(+ch).fill(null));
      else squares.push(ch);
    }
  }
  return squares; // index 0 = a8, 63 = h1
}

function squareIndex(name) {
  const file = name.charCodeAt(0) - 97;
  const rank = +name[1];
  return (8 - rank) * 8 + file;
}

function applyUci(squares, uci) {
  const next = squares.slice();
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  const piece = next[from];
  const isWhite = piece === piece.toUpperCase();

  // Rokade: koning verplaatst twee lijnen, dus de toren mee verplaatsen.
  if (piece.toLowerCase() === "k" && Math.abs(to - from) === 2) {
    const rookFrom = to > from ? from + 3 : from - 4;
    const rookTo = to > from ? from + 1 : from - 1;
    next[rookTo] = next[rookFrom];
    next[rookFrom] = null;
  }

  // En passant: pion slaat diagonaal naar een leeg veld.
  if (piece.toLowerCase() === "p" && (to - from) % 8 !== 0 && !next[to]) {
    next[isWhite ? to + 8 : to - 8] = null;
  }

  next[to] = uci[4] ? (isWhite ? uci[4].toUpperCase() : uci[4]) : piece;
  next[from] = null;
  return next;
}

// Alle posities van een partij: positions[0] is de beginstelling.
function buildPositions(uciMoves) {
  const positions = [fenToSquares(START_FEN)];
  for (const uci of uciMoves) {
    positions.push(applyUci(positions[positions.length - 1], uci));
  }
  return positions;
}

// flipped = true: zwart onderaan.
function renderBoard(container, squares, lastUci, flipped = false) {
  const highlight = lastUci
    ? [squareIndex(lastUci.slice(0, 2)), squareIndex(lastUci.slice(2, 4))]
    : [];

  if (container.children.length !== 64) {
    container.replaceChildren();
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement("div");
      const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
      sq.className = `square ${dark ? "dark" : "light"}`;
      container.append(sq);
    }
  }

  squares.forEach((piece, i) => {
    const sq = container.children[flipped ? 63 - i : i];
    sq.classList.toggle("last-move", highlight.includes(i));
    if (!piece) {
      sq.textContent = "";
      return;
    }
    const isWhite = piece === piece.toUpperCase();
    sq.innerHTML = `<span class="piece ${isWhite ? "white" : "black"}">${GLYPHS[piece.toLowerCase()]}</span>`;
  });
}
