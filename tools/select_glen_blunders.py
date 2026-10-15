"""Zoekt blunders van één speler en de beste reactie erop, voor "Bestraf Glen!".

Gebruik:
    python tools/select_glen_blunders.py <partijen.pgn> js/data/glen-blunders.js --player <lichessnaam> --stockfish <pad/naar/stockfish>

De PGN komt van https://lichess.org/api/games/user/<speler> (met evals=true).
De uitvoer bevat bewust niets waarmee je het Lichess-account kan terugvinden:
geen partij-ID, geen namen of ratings van tegenstanders, enkel het jaar.

- Blunder: een zet van de speler waarbij zijn winstkans (Lichess-evaluatie) met
  minstens 30% zakt, en de tegenstander daarna duidelijk beter staat.
- Stockfish moet bevestigen dat er voor de tegenstander één of twee duidelijk
  beste zetten zijn: dat zijn de oplossingen van de puzzel.

Vereist: pip install chess, en Stockfish.
"""
import argparse
import io
import json
import os
import random
import re
import sys

import chess
import chess.engine
import chess.pgn

sys.path.insert(0, os.path.dirname(__file__))
from select_blunder_briljant import cp_of, fmt_eval, win_pct  # noqa: E402

TARGET = 200
MIN_DROP = 30             # winstkans die de speler verliest door de blunder
MIN_WP_PUNISH = 70        # winstkans van de tegenstander na de beste reactie
SOLUTION_MARGIN = 5       # zetten binnen deze marge van de beste tellen ook als juist
MIN_GAP = 15              # de beste niet-oplossing moet zoveel slechter zijn
MAX_SIMPLE_SHARE = 0.25   # max. aandeel "neem gewoon terug op het veld van de blunder"
PV_LENGTH = 6

hdr = re.compile(r'^\[(\w+) "(.*)"\]$')


def read_games(path):
    """Geeft (headers, movetext) per partij, zonder alles in één keer te parsen."""
    h, mv = {}, []
    with open(path, encoding="utf8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            m = hdr.match(line)
            if m:
                if mv:
                    yield h, " ".join(mv)
                    h, mv = {}, []
                h[m.group(1)] = m.group(2)
            elif line:
                mv.append(line)
    if mv:
        yield h, " ".join(mv)


def find_candidates(path, player, rng):
    """Max. één blunder per partij, als (headers, bord voor de blunder, node van de blunder)."""
    out = []
    for h, movetext in read_games(path):
        if "[%eval" not in movetext or player not in (h.get("White"), h.get("Black")):
            continue
        if "FEN" in h:   # partij vanuit een andere beginstelling (bv. thematoernooi)
            continue
        color = chess.WHITE if h["White"] == player else chess.BLACK
        game = chess.pgn.read_game(io.StringIO(movetext))
        board = game.board()
        prev_eval, found = None, []
        for i, node in enumerate(game.mainline()):
            mover = board.turn
            before = board.copy(stack=False)
            board.push(node.move)
            after = node.eval()
            if (mover == color and i >= 10 and prev_eval is not None and after is not None
                    and not board.is_game_over()):
                wp_before = win_pct(cp_of(prev_eval.pov(color)))
                wp_after = win_pct(cp_of(after.pov(color)))
                if wp_before - wp_after >= MIN_DROP and wp_after <= 100 - MIN_WP_PUNISH:
                    found.append((before, node, prev_eval, after))
            prev_eval = after
        if found:
            out.append((h, color, *rng.choice(found)))
    return out


def verify(engine, cand, limit):
    """Geeft de puzzel terug als Stockfish een duidelijke oplossing vindt, anders None."""
    h, color, before, node, ev_before, ev_after = cand
    blunder = node.move
    pos = before.copy(stack=False)
    pos.push(blunder)
    opp = pos.turn
    if pos.legal_moves.count() < 2:
        return None
    infos = engine.analyse(pos, limit, multipv=4)
    scored = [(info["pv"][0], win_pct(cp_of(info["score"].pov(opp))), info) for info in infos]
    best_move, best_wp, best_info = scored[0]
    if best_wp < MIN_WP_PUNISH or (best_move.promotion and best_move.promotion != chess.QUEEN):
        return None
    solutions = [m for m, wp, _ in scored if wp >= best_wp - SOLUTION_MARGIN and wp >= MIN_WP_PUNISH]
    rest = [wp for m, wp, _ in scored if m not in solutions]
    if len(solutions) > 2 or (rest and best_wp - max(rest) < MIN_GAP):
        return None
    if len(solutions) >= pos.legal_moves.count():
        return None  # elke zet is goed: geen puzzel

    # Wat had de speler beter gespeeld?
    glen_best = engine.analyse(before, limit)["pv"][0]

    pv_board = pos.copy(stack=False)
    pv = []
    for m in best_info["pv"][:PV_LENGTH]:
        pv.append(pv_board.san(m))
        pv_board.push(m)

    played = node.next().move if node.next() else None
    base, inc = h["TimeControl"].split("+")
    clock = node.clock()
    return {
        "glenColor": "white" if color == chess.WHITE else "black",
        "year": int(h["UTCDate"][:4]),
        "timeControl": f"{int(base) // 60}+{inc}",
        "clock": None if clock is None else round(clock),
        "fen": before.fen(),                     # stelling voor de blunder
        "blunder": blunder.uci(),
        "blunderSan": before.san(blunder),
        "glenBest": before.san(glen_best),
        "evalBefore": fmt_eval(ev_before.white()),
        "evalAfter": fmt_eval(ev_after.white()),
        "solutions": [m.uci() for m in solutions],
        "bestSan": pv[0],
        "bestEval": fmt_eval(best_info["score"].white()),
        "pv": pv,
        "played": pos.san(played) if played else None,
        "playedOk": played in solutions if played else False,
        "simple": pos.is_capture(best_move) and best_move.to_square == blunder.to_square,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--player", required=True, help="Lichess-naam (komt niet in de uitvoer)")
    ap.add_argument("--stockfish", required=True)
    ap.add_argument("--depth", type=int, default=16)
    ap.add_argument("--seconds", type=float, default=0.5)
    args = ap.parse_args()

    rng = random.Random(7)
    candidates = find_candidates(args.src, args.player, rng)
    rng.shuffle(candidates)
    print(f"kandidaten: {len(candidates)} partijen met een blunder", file=sys.stderr)

    limit = chess.engine.Limit(depth=args.depth, time=args.seconds)
    puzzles, simple = [], 0
    with chess.engine.SimpleEngine.popen_uci(args.stockfish) as engine:
        engine.configure({"Threads": max(1, (os.cpu_count() or 2) - 1), "Hash": 256})
        for n, cand in enumerate(candidates, 1):
            p = verify(engine, cand, limit)
            if p and p["simple"] and simple >= MAX_SIMPLE_SHARE * TARGET:
                p = None
            if p:
                simple += p["simple"]
                puzzles.append(p)
            if n % 50 == 0:
                print(f"  {n}/{len(candidates)} gecontroleerd, {len(puzzles)} puzzels", file=sys.stderr)
            if len(puzzles) >= TARGET:
                break
    print(f"puzzels: {len(puzzles)} (waarvan {simple} eenvoudig terugslaan)", file=sys.stderr)

    with open(args.dst, "w", encoding="utf8") as f:
        f.write("// Blunders van Glen, gegenereerd met tools/select_glen_blunders.py\n")
        f.write("const GLEN_PUZZLES = ")
        json.dump(puzzles, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


if __name__ == "__main__":
    main()
