# Kip en Schaak

Website voor de schaakpodcast **Kip en Schaak**. Statische site (HTML/CSS/JS), geen build-stap nodig.

## Structuur

```
index.html             Homepagina (logo, nieuwste aflevering, spellen)
afleveringen.html      Alle afleveringen met zoekfunctie
over-ons.html          De hosts
contact.html           Contact
spellen.html           Overzicht van de spelletjes
elo-ladder.html        Spel: Elo-ladder (Hitster met schaakpartijen)
blunder-briljant.html  Spel: Blunder of briljant?
kippenschaak.html      Spel: Kippenschaak (schaak met eieren, 2 spelers)
bestraf-glen.html      Spel: Bestraf Glen! (beste reactie op Glens blunders)
css/styles.css         Opmaak en kleuren (aanpasbaar via CSS-variabelen bovenaan)
css/games.css          Extra opmaak voor de spellen
js/episodes.js         Lijst met afleveringen — hier voeg je nieuwe afleveringen toe
js/main.js             Rendert afleveringen (alle + zoeken, of enkel de nieuwste)
js/nav.js              Mobiel menu en jaartal (gedeeld door alle pagina's)
js/board.js            Eenvoudig schaakbord dat UCI-zetten afspeelt
js/elo-ladder.js       Spellogica van de Elo-ladder
js/blunder-briljant.js Spellogica van Blunder of briljant?
js/kippenschaak-rules.js  Spelregels van Kippenschaak (schaak + eieren)
js/kippenschaak.js     Bediening en weergave van Kippenschaak
js/board-input.js      Klikken en slepen op een bord (gedeeld)
js/bestraf-glen.js     Spellogica van Bestraf Glen!
js/data/elo-games.js   315 Lichess-partijen voor de Elo-ladder (gegenereerd)
js/data/blunder-briljant.js  120 blunders + 120 briljante offers (gegenereerd)
js/data/glen-blunders.js     Blunders van Glen met oplossing (gegenereerd)
tools/                 Scripts om nieuwe partijen en stellingen te selecteren
assets/                Logo (van het YouTube-kanaal), favicon en hostfoto's
```

## Lokaal bekijken

Open `index.html` rechtstreeks in je browser, of start een lokale server:

```
npx serve .
```

## Nieuwe aflevering toevoegen

Voeg bovenaan in `js/episodes.js` een object toe. `youtube` is de video-ID (het stuk na `watch?v=`):

```js
{
  label: "S3 · E2",
  title: "Titel",
  date: "2026-10-21",
  description: "Korte omschrijving.",
  youtube: "abcdefghijk"
}
```

De thumbnail komt automatisch van YouTube; de speler laadt pas na een klik.

**Let op:** YouTube-video's spelen niet af als je `index.html` rechtstreeks opent (file://). Gebruik `npx serve .` of `python -m http.server`.

## Nog in te vullen

- Bio's en foto's van de hosts (`over-ons.html`)
- Eventuele extra platformen (bv. Apple Podcasts) als icoon in de bovenbalk (`social-links` in elke pagina)

## Elo-ladder: nieuwe partijen

De partijen komen uit de [Lichess-database](https://database.lichess.org/) (CC0):
15 partijen per Elo-band van 100 punten (700–2800), enkel blitz/rapid/klassiek,
spelers max. 150 Elo uit elkaar, 15–80 zetten. Nieuwe set maken:

```
curl -r 0-157286399 https://database.lichess.org/standard/lichess_db_standard_rated_2026-09.pgn.zst -o part.pgn.zst
zstd -dc part.pgn.zst > part.pgn        # foutmelding op het einde is normaal (afgeknipt bestand)
pip install chess
python tools/select_elo_games.py part.pgn js/data/elo-games.js
```

## Blunder of briljant: nieuwe stellingen

Gebruikt dezelfde Lichess-dump (enkel partijen met engine-analyse) plus
[Stockfish](https://stockfishchess.org/download/):

- **Blunder:** door Lichess gemarkeerd met `??` in een stelling die nog niet beslist was.
- **Briljant:** Lichess kent geen "briljant", dus het script zoekt stukoffers die de
  tegenstander aanneemt. Stockfish bevestigt dat het offer de beste zet is, dat het
  voordeel geeft, en dat geen enkele andere zet dat ook doet.

Alle grenzen gaan over de winstkans (dezelfde sigmoïde als Lichess). Ze staan
bovenaan in het script en zijn aanpasbaar.

```
python tools/select_blunder_briljant.py part.pgn js/data/blunder-briljant.js --stockfish <pad/naar/stockfish.exe>
```

De eerste keer duurt het scannen ~10 minuten; de gevonden kandidaten worden bewaard
in `part.pgn.kandidaten.json`, zodat een nieuwe Stockfish-ronde meteen start.

## Bestraf Glen!: nieuwe blunders

Download Glens blitzpartijen met evaluaties (Lichess weigert de standaard-User-Agent van curl,
en geeft anoniem max. 10.000 partijen per keer; ga verder met `&until=<tijd van de oudste>`).
Zet zijn Lichess-naam niet in deze repository: de site mag niet naar zijn account leiden.

```
curl -A "kip-en-schaak" "https://lichess.org/api/games/user/<naam>?perfType=blitz&clocks=true&evals=true&opening=true" -o glen.pgn
python tools/select_glen_blunders.py glen.pgn js/data/glen-blunders.js --player <naam> --stockfish <pad/naar/stockfish.exe>
```

## Publiceren

Werkt op elke statische host: GitHub Pages, Netlify, Cloudflare Pages, …
