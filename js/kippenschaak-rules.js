// Spelregels van Kippenschaak: gewoon schaak, plus eieren.
//
// - Ei leggen: de dame "slaat" de eigen koning (zelfde lijn, niets ertussen).
//   Dame en koning blijven staan; er verschijnt een ei van jouw kleur op een
//   willekeurig leeg veld op je eigen helft. Max. 1 eigen ei tegelijk, niet
//   als je schaak staat. Na een ei moet je eerst zelf een pionzet of een
//   slagzet spelen (zoals bij de 50-zettenregel) voor je opnieuw mag leggen.
//   Een ei kapotmaken telt niet als slaan, tenzij met een pion.
// - Uitbroeden: je eigen paard springt op je ei. Er komt een willekeurig stuk
//   uit (kans omgekeerd evenredig met de waarde) en het paard keert terug.
// - Ei kapot: elk vijandig stuk dat op het ei landt, breekt het.
// - Een ei is een obstakel: eigen stukken (behalve paarden) kunnen er niet op
//   of door, en het blokkeert lijnen van lopers, torens en dames.
//
// Bord: index 0 = a8, 63 = h1. Stukken in FEN-letters (hoofdletter = wit),
// eieren als "O" (wit) en "o" (zwart).

const KS_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const HATCH_WEIGHTS = { p: 1, n: 1 / 3, b: 1 / 3, r: 1 / 5, q: 1 / 9 };
const KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const fileOf = (i) => i % 8;
const rankOf = (i) => 8 - Math.floor(i / 8);          // 1..8
const idx = (file, rank) => (8 - rank) * 8 + file;
const onBoard = (file, rank) => file >= 0 && file < 8 && rank >= 1 && rank <= 8;
const colorOf = (p) => (p ? (p === p.toUpperCase() ? "w" : "b") : null);
const typeOf = (p) => (p ? p.toLowerCase() : null);
const isEgg = (p) => typeOf(p) === "o";
const other = (c) => (c === "w" ? "b" : "w");
const squareName = (i) => "abcdefgh"[fileOf(i)] + rankOf(i);

function ksNewGame() {
  const sq = [];
  for (const row of KS_START.split("/")) {
    for (const ch of row) {
      if (/\d/.test(ch)) sq.push(...Array(+ch).fill(null));
      else sq.push(ch);
    }
  }
  return { sq, turn: "w", castling: { K: true, Q: true, k: true, q: true }, ep: null, eggLock: { w: false, b: false } };
}

function cloneState(s) {
  return { sq: s.sq.slice(), turn: s.turn, castling: { ...s.castling }, ep: s.ep, eggLock: { ...(s.eggLock ?? { w: false, b: false }) }, noEggs: s.noEggs };
}

function findKing(s, color) {
  return s.sq.indexOf(color === "w" ? "K" : "k");
}

// Wordt veld i aangevallen door kleur `by`? Eieren vallen niet aan, maar blokkeren wel.
function isAttacked(s, i, by) {
  const f = fileOf(i), r = rankOf(i);
  const at = (ff, rr) => (onBoard(ff, rr) ? s.sq[idx(ff, rr)] : undefined);
  const mine = (p, t) => p && colorOf(p) === by && typeOf(p) === t;

  const pawnDir = by === "w" ? -1 : 1;              // aanvallende pion staat een rij lager (wit)
  if (mine(at(f - 1, r + pawnDir), "p") || mine(at(f + 1, r + pawnDir), "p")) return true;
  for (const [df, dr] of KNIGHT_JUMPS) if (mine(at(f + df, r + dr), "n")) return true;
  for (const [df, dr] of KING_STEPS) if (mine(at(f + df, r + dr), "k")) return true;

  const ray = (dirs, types) => {
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (onBoard(ff, rr)) {
        const p = s.sq[idx(ff, rr)];
        if (p) {
          if (colorOf(p) === by && types.includes(typeOf(p))) return true;
          break;
        }
        ff += df; rr += dr;
      }
    }
    return false;
  };
  return ray(ROOK_DIRS, ["r", "q"]) || ray(BISHOP_DIRS, ["b", "q"]);
}

function inCheck(s, color) {
  return isAttacked(s, findKing(s, color), other(color));
}

function hasOwnEgg(s, color) {
  return s.sq.includes(color === "w" ? "O" : "o");
}

// Mag deze kleur (los van de stelling van dame en koning) een ei leggen?
// `noEggs` zet de eierregels helemaal uit (gewoon schaak, bv. in Bestraf Glen! en Word Landskampioen!).
function canLayEgg(s, color) {
  return !s.noEggs && !hasOwnEgg(s, color) && !(s.eggLock && s.eggLock[color]);
}

function emptyOwnHalf(s, color) {
  const out = [];
  s.sq.forEach((p, i) => {
    const r = rankOf(i);
    if (!p && (color === "w" ? r <= 4 : r >= 5)) out.push(i);
  });
  return out;
}

// Dame en koning op dezelfde lijn zonder iets ertussen?
function queenSeesKing(s, q, k) {
  const df = Math.sign(fileOf(k) - fileOf(q)), dr = Math.sign(rankOf(k) - rankOf(q));
  const straight = fileOf(k) === fileOf(q) || rankOf(k) === rankOf(q);
  const diagonal = Math.abs(fileOf(k) - fileOf(q)) === Math.abs(rankOf(k) - rankOf(q));
  if (!straight && !diagonal) return false;
  let ff = fileOf(q) + df, rr = rankOf(q) + dr;
  while (idx(ff, rr) !== k) {
    if (s.sq[idx(ff, rr)]) return false;
    ff += df; rr += dr;
  }
  return true;
}

// Alle zetten volgens de bewegingsregels, nog zonder te controleren of de eigen koning veilig staat.
function pseudoMoves(s) {
  const c = s.turn, moves = [];
  const add = (from, to, kind = "normal", extra = {}) => moves.push({ from, to, kind, ...extra });

  s.sq.forEach((p, from) => {
    if (!p || colorOf(p) !== c || isEgg(p)) return;
    const t = typeOf(p), f = fileOf(from), r = rankOf(from);

    // Doel: leeg = gewoon, vijand (ook vijandig ei) = slaan, eigen ei = enkel voor paarden.
    const target = (to) => {
      const q = s.sq[to];
      if (!q) return "empty";
      if (colorOf(q) !== c) return isEgg(q) ? "enemyEgg" : "enemy";
      return isEgg(q) ? "ownEgg" : "own";
    };

    if (t === "p") {
      const dir = c === "w" ? 1 : -1, startRank = c === "w" ? 2 : 7, lastRank = c === "w" ? 8 : 1;
      const pushOrPromo = (to, kind) => {
        if (rankOf(to) === lastRank) for (const promo of ["q", "r", "b", "n"]) add(from, to, kind, { promo });
        else add(from, to, kind);
      };
      if (onBoard(f, r + dir) && target(idx(f, r + dir)) === "empty") {
        pushOrPromo(idx(f, r + dir), "normal");
        if (r === startRank && target(idx(f, r + 2 * dir)) === "empty") add(from, idx(f, r + 2 * dir), "double");
      }
      for (const df of [-1, 1]) {
        if (!onBoard(f + df, r + dir)) continue;
        const to = idx(f + df, r + dir), tg = target(to);
        if (tg === "enemy") pushOrPromo(to, "capture");
        else if (tg === "enemyEgg") pushOrPromo(to, "breakEgg");
        else if (to === s.ep) add(from, to, "ep");
      }
      return;
    }

    if (t === "n") {
      for (const [df, dr] of KNIGHT_JUMPS) {
        if (!onBoard(f + df, r + dr)) continue;
        const to = idx(f + df, r + dr), tg = target(to);
        if (tg === "empty") add(from, to);
        else if (tg === "enemy") add(from, to, "capture");
        else if (tg === "enemyEgg") add(from, to, "breakEgg");
        else if (tg === "ownEgg") add(from, to, "hatch");
      }
      return;
    }

    const slide = (dirs) => {
      for (const [df, dr] of dirs) {
        let ff = f + df, rr = r + dr;
        while (onBoard(ff, rr)) {
          const to = idx(ff, rr), tg = target(to);
          if (tg === "empty") add(from, to);
          else {
            if (tg === "enemy") add(from, to, "capture");
            else if (tg === "enemyEgg") add(from, to, "breakEgg");
            break;
          }
          ff += df; rr += dr;
        }
      }
    };
    if (t === "b") slide(BISHOP_DIRS);
    if (t === "r") slide(ROOK_DIRS);
    if (t === "q") {
      slide([...ROOK_DIRS, ...BISHOP_DIRS]);
      // Ei leggen: dame "slaat" eigen koning.
      const k = findKing(s, c);
      if (canLayEgg(s, c) && queenSeesKing(s, from, k) && emptyOwnHalf(s, c).length > 0) add(from, k, "lay");
    }

    if (t === "k") {
      for (const [df, dr] of KING_STEPS) {
        if (!onBoard(f + df, r + dr)) continue;
        const to = idx(f + df, r + dr), tg = target(to);
        if (tg === "empty") add(from, to);
        else if (tg === "enemy") add(from, to, "capture");
        else if (tg === "enemyEgg") add(from, to, "breakEgg");
      }
      // Rokade: velden ertussen leeg (eieren blokkeren), niet door of uit schaak.
      const home = c === "w" ? 1 : 8;
      if (f === 4 && r === home && !isAttacked(s, from, other(c))) {
        const rights = c === "w" ? ["K", "Q"] : ["k", "q"];
        const rook = c === "w" ? "R" : "r";
        if (s.castling[rights[0]] && s.sq[idx(7, home)] === rook &&
            !s.sq[idx(5, home)] && !s.sq[idx(6, home)] &&
            !isAttacked(s, idx(5, home), other(c)) && !isAttacked(s, idx(6, home), other(c))) {
          add(from, idx(6, home), "castle");
        }
        if (s.castling[rights[1]] && s.sq[idx(0, home)] === rook &&
            !s.sq[idx(1, home)] && !s.sq[idx(2, home)] && !s.sq[idx(3, home)] &&
            !isAttacked(s, idx(3, home), other(c)) && !isAttacked(s, idx(2, home), other(c))) {
          add(from, idx(2, home), "castle");
        }
      }
    }
  });
  return moves;
}

// Voert een zet uit en geeft de nieuwe stelling terug.
// `rng` (0..1) bepaalt het eierveld en het uitgebroede stuk; zonder rng worden
// eieren niet geplaatst/uitgebroed (enkel gebruikt voor de schaakcontrole).
function applyMove(s, m, rng = null) {
  const n = cloneState(s);
  const c = s.turn;
  const piece = s.sq[m.from];
  let result = {};

  if (m.kind === "lay") {
    if (rng) {
      const options = emptyOwnHalf(s, c);
      const at = options[Math.floor(rng() * options.length)];
      n.sq[at] = c === "w" ? "O" : "o";
      result = { eggAt: at };
    }
  } else if (m.kind === "hatch") {
    // Het paard blijft staan; het ei blijft voor de schaakcontrole een obstakel.
    if (rng) {
      const backRank = c === "w" ? 1 : 8;
      const weights = Object.entries(HATCH_WEIGHTS).filter(([t]) => !(t === "p" && rankOf(m.to) === backRank));
      const total = weights.reduce((sum, [, w]) => sum + w, 0);
      let x = rng() * total, type = weights[weights.length - 1][0];
      for (const [t, w] of weights) {
        if ((x -= w) < 0) { type = t; break; }
      }
      n.sq[m.to] = c === "w" ? type.toUpperCase() : type;
      result = { hatched: type };
    }
  } else {
    n.sq[m.to] = m.promo ? (c === "w" ? m.promo.toUpperCase() : m.promo) : piece;
    n.sq[m.from] = null;
    if (m.kind === "ep") n.sq[idx(fileOf(m.to), rankOf(m.from))] = null;
    if (m.kind === "castle") {
      const home = rankOf(m.from);
      const kingSide = fileOf(m.to) === 6;
      n.sq[idx(kingSide ? 5 : 3, home)] = n.sq[idx(kingSide ? 7 : 0, home)];
      n.sq[idx(kingSide ? 7 : 0, home)] = null;
    }
  }

  // Rokaderechten: koning of toren verplaatst, of toren geslagen.
  const touch = (i) => {
    if (i === idx(4, 1)) { n.castling.K = n.castling.Q = false; }
    if (i === idx(4, 8)) { n.castling.k = n.castling.q = false; }
    if (i === idx(7, 1)) n.castling.K = false;
    if (i === idx(0, 1)) n.castling.Q = false;
    if (i === idx(7, 8)) n.castling.k = false;
    if (i === idx(0, 8)) n.castling.q = false;
  };
  if (m.kind !== "lay" && m.kind !== "hatch") { touch(m.from); touch(m.to); }

  // Eierslot: na een ei pas opnieuw na een eigen pionzet of slagzet.
  if (m.kind === "lay") n.eggLock[c] = true;
  else if (typeOf(piece) === "p" || m.kind === "capture" || m.kind === "ep") n.eggLock[c] = false;

  n.ep = m.kind === "double" ? idx(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) / 2) : null;
  n.turn = other(c);
  return { state: n, result };
}

function legalMoves(s) {
  const checked = inCheck(s, s.turn);
  return pseudoMoves(s).filter((m) => {
    if (m.kind === "lay" && checked) return false;
    const { state } = applyMove(s, m);
    return !isAttacked(state, findKing(state, s.turn), state.turn);
  });
}

function gameStatus(s) {
  const moves = legalMoves(s);
  if (moves.length > 0) return { over: false, check: inCheck(s, s.turn), moves };
  return { over: true, mate: inCheck(s, s.turn), moves };
}

// Korte notatie, bv. "e4", "🐔xf7+", "Q🥚 c3", "🐔🐣 d4 → loper". De kip is het paard.
const PIECE_NAMES = { p: "pion", n: "kip", b: "loper", r: "toren", q: "dame", k: "koning" };
const PIECE_LETTERS = { p: "", n: "🐔", b: "B", r: "R", q: "Q", k: "K" };

function describeMove(before, m, after, result) {
  const piece = typeOf(before.sq[m.from]);
  const letter = PIECE_LETTERS[piece];
  const check = inCheck(after, after.turn) ? (legalMoves(after).length ? "+" : "#") : "";
  if (m.kind === "lay") return `${letter}🥚 ${squareName(result.eggAt)}`;
  if (m.kind === "hatch") return `${letter}🐣 ${squareName(m.to)} → ${PIECE_NAMES[result.hatched]}${check}`;
  if (m.kind === "castle") return (fileOf(m.to) === 6 ? "O-O" : "O-O-O") + check;
  const capture = ["capture", "ep", "breakEgg"].includes(m.kind);
  const from = piece === "p" && capture ? "abcdefgh"[fileOf(m.from)] : letter;
  const egg = m.kind === "breakEgg" ? "🍳" : "";
  const promo = m.promo ? `=${m.promo.toUpperCase()}` : "";
  return `${from}${capture ? "x" : ""}${squareName(m.to)}${egg}${promo}${check}`;
}
