"""Kiest een gebalanceerde set partijen per Elo-band uit een (stuk van een) Lichess-PGN-dump.

Gebruik:
    python tools/select_elo_games.py <invoer.pgn> js/data/elo-games.js

De dump komt van https://database.lichess.org (CC0). Een volledige maanddump is
~30 GB; de eerste ~150 MB (gedecomprimeerd met zstd) is ruim genoeg.
Vereist: pip install chess
"""
import re, random, json, io, sys, chess.pgn
SRC, DST = sys.argv[1], sys.argv[2]
random.seed(42)
PER_BAND, LO, HI = 15, 700, 2800
bands = {b: [] for b in range(LO, HI, 100)}
seen = {b: 0 for b in bands}
hdr = re.compile(r'^\[(\w+) "(.*)"\]$')
def flush(h, moves):
    try:
        we, be = int(h['WhiteElo']), int(h['BlackElo'])
    except (KeyError, ValueError): return
    tc = h.get('TimeControl', '-')
    if tc == '-' : return
    base, inc = map(int, tc.split('+'))
    if base + 40 * inc < 180: return          # geen bullet
    if abs(we - be) > 150: return
    if h.get('Termination') not in ('Normal', 'Time forfeit'): return
    if h.get('Result') not in ('1-0', '0-1', '1/2-1/2'): return
    avg = (we + be) / 2
    b = int(avg // 100 * 100)
    if b not in bands: return
    fullmoves = len(re.findall(r'\d+\.\s', moves))   # zetnummers van wit
    if fullmoves < 15 or fullmoves > 80: return
    seen[b] += 1                               # reservoir sampling per band
    if len(bands[b]) < PER_BAND: bands[b].append((h, moves))
    else:
        j = random.randrange(seen[b])
        if j < PER_BAND: bands[b][j] = (h, moves)
def speed(base, inc):
    # Zelfde indeling als Lichess (geschatte duur = basis + 40 x increment)
    est = base + 40 * inc
    return 'blitz' if est < 480 else 'rapid' if est < 1500 else 'classical'

h, mv = {}, []
with open(SRC, encoding='utf8', errors='replace') as f:
    for line in f:
        line = line.rstrip('\n')
        m = hdr.match(line)
        if m:
            if mv: flush(h, ' '.join(mv)); h, mv = {}, []
            h[m.group(1)] = m.group(2)
        elif line: mv.append(line)
    if mv: flush(h, ' '.join(mv))
out = []
for b, items in bands.items():
    for h, moves in items:
        g = chess.pgn.read_game(io.StringIO(moves))
        board, san, uci = g.board(), [], []
        for m in g.mainline_moves():
            san.append(board.san(m)); uci.append(m.uci()); board.push(m)
        base, inc = map(int, h['TimeControl'].split('+'))
        out.append({
            "id": h['Site'].rsplit('/', 1)[-1],
            "whiteElo": int(h['WhiteElo']), "blackElo": int(h['BlackElo']),
            "avgElo": round((int(h['WhiteElo']) + int(h['BlackElo'])) / 2),
            "timeControl": f"{base // 60}+{inc}" if base % 60 == 0 else f"{base}s+{inc}",
            "speed": speed(base, inc),
            "result": h['Result'], "termination": h['Termination'],
            "opening": h.get('Opening', ''),
            "san": san, "uci": uci,
        })
print({b: f"{len(v)}/{seen[b]}" for b, v in bands.items()}, file=sys.stderr)
print("games:", len(out), file=sys.stderr)
with open(DST, 'w', encoding='utf8') as f:
    f.write("// Partijen uit de Lichess-database (CC0), gegenereerd met tools/select_elo_games.py\n")
    f.write("const ELO_GAMES = ")
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(";\n")
