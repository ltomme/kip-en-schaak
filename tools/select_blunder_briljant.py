"""Zoekt blunders en briljante offers in geanalyseerde Lichess-partijen.

Gebruik:
    python tools/select_blunder_briljant.py <invoer.pgn> js/data/blunder-briljant.js --stockfish <pad/naar/stockfish>

- Blunder: door Lichess gemarkeerd met ?? (winstkans zakt >= 30%), terwijl de
  stelling voor de zet nog niet beslist was.
- Briljant: een stukoffer (het gezette stuk staat onbeschermd of kan door een
  goedkoper stuk geslagen worden) dat de tegenstander aanneemt. Stockfish moet
  bevestigen dat het offer de beste zet is, dat het voordeel geeft, en dat geen
  enkele andere zet dat ook doet.

Alle grenzen gaan over de winstkans (dezelfde sigmoïde als Lichess), niet over
de ruwe evaluatie: van +10 naar +8 is geen verschil, van +1 naar -1 wel.

De gevonden kandidaten worden bewaard in <invoer.pgn>.kandidaten.json, zodat je
de Stockfish-stap met andere grenzen kan herhalen zonder opnieuw te scannen.

Vereist: pip install chess, en Stockfish (https://stockfishchess.org/download/)
"""
import argparse
import io
import json
import math
import os
import random
import re
import sys

import chess
import chess.engine
import chess.pgn

PER_TYPE = 120
CONTEXT_AFTER = 6                     # zetten die na de onthulling getoond worden
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}

# Grenzen voor briljant (winstkans in %, voor de speler die het offer brengt)
MAX_WP_BEFORE = 75                    # stelling was nog niet gewonnen (~+3)
MIN_WP_SACRIFICE = 55                 # het offer zelf geeft voordeel (~+0.5)
MAX_WP_ALTERNATIVE = 55               # geen enkele andere zet geeft voordeel
MIN_GAP = 10                          # offer is duidelijk beter dan het beste alternatief

hdr = re.compile(r'^\[(\w+) "(.*)"\]$')


def win_pct(cp):
    # Formule van Lichess (winstkans, 0-100)
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def cp_of(pov_score):
    return pov_score.score(mate_score=10000)


def fmt_eval(white_score):
    if white_score.is_mate():
        m = white_score.mate()
        return f"#{m}" if m > 0 else f"-#{-m}"
    return f"{white_score.score() / 100:+.1f}"


def is_sacrifice(board_after, move, captured):
    """Het gezette stuk kan door de tegenstander voordelig geslagen worden."""
    if move.promotion:
        return False
    piece = board_after.piece_at(move.to_square)
    if piece is None or piece.piece_type in (chess.PAWN, chess.KING):
        return False
    value = VALUES[piece.piece_type]
    attackers = board_after.attackers(not piece.color, move.to_square)
    if not attackers:
        return False
    cheapest = min(VALUES[board_after.piece_at(sq).piece_type] for sq in attackers)
    defended = bool(board_after.attackers(piece.color, move.to_square))
    hanging = cheapest < value or not defended
    return hanging and value - captured >= 2


def is_blunder(node, before_wp, after_wp):
    return chess.pgn.NAG_BLUNDER in node.nags and 25 <= before_wp <= 85 and before_wp - after_wp >= 30


# ---------- Stap 1: kandidaten zoeken in de PGN ----------

def scan(h, movetext, rng):
    if '[%eval' not in movetext:
        return None
    try:
        we, be = int(h['WhiteElo']), int(h['BlackElo'])
        base, inc = map(int, h['TimeControl'].split('+'))
    except (KeyError, ValueError):
        return None
    if base + 40 * inc < 180:         # geen bullet
        return None

    game = chess.pgn.read_game(io.StringIO(movetext))
    nodes = list(game.mainline())
    if any(n.eval() is None for n in nodes[:-1]):
        return None

    board = game.board()
    moves = [n.move for n in nodes]
    found = {"blunder": [], "briljant": []}
    prev_eval = None                  # evaluatie voor de zet (na de vorige zet)
    for i, node in enumerate(nodes):
        move = node.move
        mover = board.turn
        fen_before = board.fen()
        captured_piece = board.piece_at(move.to_square)
        captured = VALUES[captured_piece.piece_type] if captured_piece else 0
        if board.is_en_passant(move):
            captured = 1
        board.push(move)
        after = node.eval()
        if prev_eval is not None and after is not None and i >= 10 and not board.is_game_over():
            before_wp = win_pct(cp_of(prev_eval.pov(mover)))
            after_wp = win_pct(cp_of(after.pov(mover)))
            accepted = i + 1 < len(nodes) and nodes[i + 1].move.to_square == move.to_square
            if is_blunder(node, before_wp, after_wp):
                found["blunder"].append((i, prev_eval, after, fen_before))
            elif (accepted and is_sacrifice(board, move, captured)
                  and before_wp <= MAX_WP_BEFORE and after_wp - before_wp >= -2
                  and not node.nags & {chess.pgn.NAG_MISTAKE, chess.pgn.NAG_DUBIOUS_MOVE}):
                found["briljant"].append((i, prev_eval, after, fen_before))
        prev_eval = after

    # Max. 1 stelling per partij; offers zijn zeldzamer, dus die krijgen voorrang.
    kind = "briljant" if found["briljant"] else "blunder" if found["blunder"] else None
    if kind is None:
        return None
    i, ev_before, ev_after, fen_before = rng.choice(found[kind])
    replay = game.board()
    san, uci = [], []
    for m in moves[: i + 1 + CONTEXT_AFTER]:
        san.append(replay.san(m))
        uci.append(m.uci())
        replay.push(m)
    return {
        "id": h['Site'].rsplit('/', 1)[-1],
        "type": kind,
        "ply": i + 1,                 # aantal halve zetten t.e.m. de te raden zet
        "mover": "white" if i % 2 == 0 else "black",
        "whiteElo": we, "blackElo": be,
        "timeControl": f"{base // 60}+{inc}" if base % 60 == 0 else f"{base}s+{inc}",
        "evalBefore": fmt_eval(ev_before.white()), "evalAfter": fmt_eval(ev_after.white()),
        "san": san, "uci": uci,
        "fen": fen_before,            # enkel intern, voor Stockfish
    }


def scan_pgn(path):
    rng = random.Random(7)
    items = []
    h, mv = {}, []
    with open(path, encoding='utf8', errors='replace') as f:
        for line in f:
            line = line.rstrip('\n')
            m = hdr.match(line)
            if m:
                if mv:
                    item = scan(h, ' '.join(mv), rng)
                    if item:
                        items.append(item)
                    h, mv = {}, []
                h[m.group(1)] = m.group(2)
            elif line:
                mv.append(line)
        if mv:
            item = scan(h, ' '.join(mv), rng)
            if item:
                items.append(item)
    return items


# ---------- Stap 2: offers controleren met Stockfish ----------

def verify_briljant(engine, item, limit):
    board = chess.Board(item["fen"])
    played = chess.Move.from_uci(item["uci"][item["ply"] - 1])
    mover = board.turn
    infos = engine.analyse(board, limit, multipv=3)
    if len(infos) < 2:                # gedwongen zet is niet briljant
        return False
    if infos[0]["pv"][0] != played:   # het offer moet de beste zet zijn
        return False
    sac_wp = win_pct(cp_of(infos[0]["score"].pov(mover)))
    alt_wp = win_pct(cp_of(infos[1]["score"].pov(mover)))
    if sac_wp < MIN_WP_SACRIFICE or alt_wp > MAX_WP_ALTERNATIVE or sac_wp - alt_wp < MIN_GAP:
        return False
    item["altMove"] = board.san(infos[1]["pv"][0])
    item["altEval"] = fmt_eval(infos[1]["score"].white())
    return True


def add_best_reply(engine, item, limit):
    """Na een blunder: de beste reactie van de tegenstander volgens Stockfish."""
    board = chess.Board()
    for u in item["uci"][: item["ply"]]:
        board.push_uci(u)
    info = engine.analyse(board, limit)
    item["bestReply"] = board.san(info["pv"][0])
    item["bestReplyEval"] = fmt_eval(info["score"].white())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--stockfish", required=True)
    ap.add_argument("--depth", type=int, default=16)
    ap.add_argument("--seconds", type=float, default=0.5, help="max. rekentijd per stelling")
    args = ap.parse_args()

    cache = args.src + ".kandidaten.json"
    if os.path.exists(cache):
        with open(cache, encoding='utf8') as f:
            items = json.load(f)
        print(f"kandidaten uit cache: {cache}", file=sys.stderr)
    else:
        items = scan_pgn(args.src)
        with open(cache, 'w', encoding='utf8') as f:
            json.dump(items, f)

    blunders = [x for x in items if x["type"] == "blunder"]
    candidates = [x for x in items if x["type"] == "briljant"]
    print(f"kandidaten: {len(blunders)} blunders, {len(candidates)} offers", file=sys.stderr)

    # Controleren in willekeurige volgorde en stoppen zodra er genoeg zijn:
    # alle kandidaten nagaan kan uren duren.
    random.Random(7).shuffle(candidates)
    briljant = []
    with chess.engine.SimpleEngine.popen_uci(args.stockfish) as engine:
        engine.configure({"Threads": max(1, (os.cpu_count() or 2) - 1), "Hash": 256})
        for n, item in enumerate(candidates, 1):
            if verify_briljant(engine, item, chess.engine.Limit(depth=args.depth, time=args.seconds)):
                briljant.append(item)
            if n % 25 == 0:
                print(f"  {n}/{len(candidates)} gecontroleerd, {len(briljant)} briljant", file=sys.stderr)
            if len(briljant) >= PER_TYPE:
                break
        print(f"briljant na Stockfish: {len(briljant)}", file=sys.stderr)

        rng = random.Random(7)
        chosen_blunders = rng.sample(blunders, min(PER_TYPE, len(blunders)))
        for item in chosen_blunders:
            add_best_reply(engine, item, chess.engine.Limit(depth=args.depth, time=args.seconds))

    out = chosen_blunders + rng.sample(briljant, min(PER_TYPE, len(briljant)))
    for item in out:
        item.pop("fen", None)
    with open(args.dst, 'w', encoding='utf8') as f:
        f.write("// Stellingen uit de Lichess-database (CC0), gegenereerd met tools/select_blunder_briljant.py\n")
        f.write("const BB_PUZZLES = ")
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(";\n")


if __name__ == "__main__":
    main()
