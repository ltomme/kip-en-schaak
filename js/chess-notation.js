// Gewoon schaak bovenop kippenschaak-rules.js: stelling uit FEN, UCI en SAN-notatie.

const FILES = "abcdefgh";

function fromFen(fen) {
  const [board, turn, castling, ep] = fen.split(" ");
  return {
    sq: fenToSquares(board),
    turn,
    castling: { K: castling.includes("K"), Q: castling.includes("Q"), k: castling.includes("k"), q: castling.includes("q") },
    ep: ep === "-" ? null : squareIndex(ep),
    noEggs: true                    // gewoon schaak: geen eieren leggen
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
