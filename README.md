# Signal

Next.js-Projekt (App Router, Tailwind 4, Supabase) mit zwei Teilen:

- **`/`**: die bestehende Signal-Oberfläche (`app/page.tsx`).
- **`/arbitrage`**: Dashboard des Arbitrage-Moduls. Der zugehörige Worker liegt in `worker/`.

## Schnellstart

Voraussetzungen: [Node.js 22](https://nodejs.org) und Git. Ein kostenloses Projekt auf [supabase.com](https://supabase.com).

```bash
git clone https://github.com/Anonyme123dsf/signal.git
cd signal
npm run setup        # fragt nach Supabase-URL, Key und einem Passwort, installiert alles
```

Die URL steht in Supabase unter Integrations → Data API als "API URL". Der Key unter Project Settings → API Keys:
entweder `service_role` (Legacy API keys, beginnt mit `eyJ`) oder ein Secret key (beginnt mit `sb_secret_`). Beide gehen.

Dann einmalig den Inhalt von `supabase/setup.sql` im Supabase SQL-Editor einfügen und auf "Run" klicken.

```bash
npm run start:all    # startet Dashboard und Worker zusammen, Strg+C beendet beide
```

Im Browser http://localhost:3000/arbitrage öffnen, Benutzer `admin`, Passwort aus der Einrichtung.

Ohne Supabase und ohne Internet zum Ausprobieren: `npm run demo` (Mock-Börsen, alles im Speicher, Ausgabe im Terminal).

## Arbitrage-Modul

Ziel: Preisunterschiede für dasselbe Gut über mehrere Märkte hinweg erkennen, nach Gebühren bewerten,
als Paper-Trade abwickeln und, wo ein Inserat mit Kontakt beteiligt ist, Käufer und Verkäufer per E-Mail
zusammenführen. Nachrichten werden nie ohne Freigabe verschickt, Echthandel ist bewusst nicht implementiert.

```
worker/ (dauerhaft laufender Prozess)              Supabase (Postgres)          Next.js (Vercel)
┌─────────────────────────────────────────┐        ┌────────────────────┐        ┌────────────────────┐
│ Adapter: ccxt | mock | listings         │ ─────▶ │ latest_prices      │ ◀───── │ /arbitrage         │
│ Engine:  Spreads nach Gebühren          │ ─────▶ │ opportunities      │ ◀───── │ Paper-Trade,       │
│ Paper:   freigegebene Deals ausführen   │ ◀───── │ deals              │ ◀───── │ Verwerfen          │
│ Comms:   Entwürfe, Versand, IMAP-Abruf  │ ◀───── │ messages, contacts │ ◀───── │ Freigeben          │
│                                         │ ◀───── │ listings           │ ◀───── │ Inserat erfassen   │
└─────────────────────────────────────────┘        └────────────────────┘        └────────────────────┘
```

### Ablauf pro Zyklus (Standard alle 2 s)

1. Alle Adapter liefern Bid/Ask je Symbol, dazu die Kreuz-Paare für Dreiecke (siehe unten).
   Börsenkurse landen in `latest_prices`.
2. Die Cross-Engine (`worker/src/engine/spread.ts`) bewertet jedes Marktpaar: Kauf zum Ask, Verkauf zum Bid,
   abzüglich Taker-Gebühren beider Seiten, Slippage-Aufschlag und optional Abhebegebühr.
   Menge = `TRADE_SIZE_QUOTE / Ask`, begrenzt durch die verfügbare Tiefe.
3. Die Dreiecks-Engine (`worker/src/engine/triangle.ts`) bewertet auf jeder Börse alle Pfade
   Startwährung → A → B → Startwährung in beiden Richtungen.
4. Routen über `MIN_NET_SPREAD_BPS` werden als Gelegenheit gespeichert oder aktualisiert.
   Nicht mehr gesehene Gelegenheiten laufen nach `OPPORTUNITY_TTL_MS` ab.
5. Ist ein Inserat mit Kontakt beteiligt, entsteht pro Inserat ein Nachrichtenentwurf (Status `draft`).
6. Ab `AUTO_PAPER_BPS` wird automatisch ein Paper-Deal angelegt; sonst per Klick im Dashboard.
7. Freigegebene Deals werden zu aktuellen Kursen simuliert (PnL inklusive Gebühren), freigegebene
   Nachrichten verschickt, der Posteingang per IMAP auf Antworten mit der Kennung `[SIG-XXXXXX]` geprüft.
8. Alle `SPREAD_SAMPLE_INTERVAL_MS` wird jede bewertete Börsenroute in `spread_samples` geschrieben,
   auch mit negativem Netto-Spread. Einmal pro Stunde werden Messpunkte älter als `SPREAD_HISTORY_DAYS` gelöscht.

### Dreiecks-Arbitrage

Ein Dreieck braucht drei Handelspaare auf derselben Börse, zum Beispiel BTC/EUR, ETH/EUR und ETH/BTC.
Der Worker leitet die Kreuz-Paare aus `SYMBOLS` selbst ab (aus BTC/EUR und ETH/EUR werden ETH/BTC und BTC/ETH
angefragt, der Adapter behält das Paar, das die Börse kennt). Pro Börse und Paar von Zwischenwährungen entstehen
zwei Pfade, etwa EUR→BTC→ETH→EUR und EUR→ETH→BTC→EUR. Gewinnt der eine, verliert der andere.

Rechnung pro Schritt: Kaufen zum Ask mal `(1 + Slippage)`, Verkaufen zum Bid mal `(1 − Slippage)`, jeweils
abzüglich Taker-Gebühr. Brutto-Spread = Produkt der rohen Kurse minus 1, Netto-Spread = Endbetrag / Startbetrag
minus 1. Der Startbetrag ist `TRADE_SIZE_QUOTE`, begrenzt durch die Orderbuchtiefe jedes Schritts (Rückrechnung
über die vorherigen Schritte). In der Tabelle `opportunities` steht ein Dreieck mit `kind = 'triangle'`,
`symbol` = Pfad, `buy_price = 1`, `sell_price` = Brutto-Multiplikator und den drei Schritten in `legs`.

Paper-Ausführung: Der Pfad wird zu den aktuellen Kursen der Börse neu durchgerechnet, mit demselben Startbetrag.
Alle drei Ausführungen stehen im Deal unter `fills`, die Gebühr je Schritt in der Quote-Währung des Paars
(bei ETH/BTC also in BTC). Kippt der Kurs zwischen Erkennen und Ausführen, wird der Paper-PnL negativ. Genau das
soll sichtbar werden.

Warum Dreiecke für ein Studienprojekt interessant sind: kein Transfer zwischen Börsen, kein Bestand auf zwei
Seiten, kein Gegenparteirisiko. Dafür drei Gebühren statt zwei; auf großen Börsen ist der Netto-Spread fast
immer negativ. Die Verlaufsseite zeigt, wie oft er positiv wird.

### Spread-Historie

Die Seite `/arbitrage/history` liest über zwei Postgres-Funktionen aus `supabase/migrations/0002_triangles_and_history.sql`:

- `spread_route_stats(since, threshold_bps)`: pro Route Anzahl Messpunkte, Durchschnitt, Median, P90, Maximum,
  Anteil über 0 bps und Anteil über der Schwelle.
- `spread_route_series(since, bucket_seconds)`: Durchschnitt und Maximum je Route in Zeitfenstern für das Diagramm.

Zeiträume 1 h, 6 h, 24 h und 7 Tage (Fenster 1, 5, 15 bzw. 60 Minuten), Filter nach Art (Cross, Dreieck) und
frei wählbare Schwelle. Das Diagramm zeigt bis zu sechs Routen, alle Routen stehen in der Tabelle darunter,
die Zeitreihe zusätzlich als Tabellenansicht.

Speicherbedarf: Mit vier Börsen, zwei Symbolen und Dreiecken sind es rund 30 Routen. Bei einem Messpunkt pro
Minute ergibt das etwa 45.000 Zeilen pro Tag, rund 5 MB. Mit `SPREAD_HISTORY_DAYS=14` bleibt die Tabelle unter 100 MB.

### Zugriffsschutz

Unter `/arbitrage` werden Paper-Deals angelegt und E-Mails freigegeben. `proxy.ts` schützt den Bereich deshalb
mit HTTP Basic Auth: `DASHBOARD_PASSWORD` setzen (optional `DASHBOARD_USER`, Standard `admin`). Ohne Passwort ist
der Bereich in Produktion gesperrt und antwortet mit 503; lokal unter `npm run dev` bleibt er offen.

### Einrichtung

1. Supabase-Projekt anlegen und die Migrationen aus `supabase/migrations/` der Reihe nach im SQL-Editor ausführen
   (`0001_arbitrage.sql`, `0002_triangles_and_history.sql`, `0003_paper_balances.sql`).
   Alle Tabellen haben RLS ohne Policies: Zugriff nur mit dem Service-Role-Key, der nie in den Browser darf.
2. Dashboard: `.env.local` nach `.env.example` anlegen, dann

   ```bash
   npm install
   npm run dev          # http://localhost:3000/arbitrage
   ```

3. Worker: `worker/.env` nach `worker/.env.example` anlegen, dann

   ```bash
   cd worker
   npm install
   npm run dev          # echte Börsenkurse (nur öffentliche Daten, kein API-Key nötig)
   npm run demo         # ohne Datenbank und Internet: Mock-Börsen, In-Memory-Store, Mails im Log
   npm test             # Engine- und End-to-End-Tests
   ```

   Der Worker gehört nicht auf Vercel (Serverless beendet lange Prozesse). Ein kleiner VPS, ein Raspberry Pi
   oder der eigene Rechner reichen. Zwei fertige Wege:

   - systemd: `worker/deploy/signal-worker.service` (Anleitung im Kopf der Datei).
   - Docker: `docker build -f worker/Dockerfile -t signal-worker .` und `docker run --rm --env-file worker/.env signal-worker`.

### Robustheit im Betrieb

- **Backoff je Adapter:** Liefert eine Börse dreimal in Folge keine Preise, wird sie 60 s ausgesetzt, danach
  120 s, 240 s und so weiter bis höchstens 10 min. Die anderen Adapter laufen normal weiter. Das steht im
  Heartbeat unter `skippedAdapters` und im Log.
- **Kursalter:** Paper-Deals werden nicht gegen Kurse gefüllt, die älter als `MAX_QUOTE_AGE_MS` sind (Standard 30 s).
  Der Deal schlägt dann mit klarer Meldung fehl, die Gelegenheit bleibt offen.
- **Heartbeat:** `worker_heartbeats` enthält je Worker den letzten Zyklus mit Anzahl Preise, Routen, Dreiecken,
  Fehlern und Dauer. Das Dashboard zeigt den Worker als offline, wenn der Heartbeat älter als 20 s ist.

### Paper-Bestände

Ohne `PAPER_BALANCES` simuliert der Worker Deals ohne Bestandsprüfung. Mit `PAPER_BALANCES`, etwa
`kraken:EUR=1000,kraken:BTC=0.01,bitvavo:EUR=1000,bitvavo:BTC=0.01`, gilt:

- Vor jeder Ausführung werden die Bestandsveränderungen aller Schritte in Reihenfolge durchgespielt. Ein Cross-Deal
  braucht Quote-Währung auf der Kaufbörse und Basis auf der Verkaufsbörse (vorfinanziert). Ein Dreieck braucht nur
  den Startbetrag, die weiteren Schritte leben vom Ertrag des vorherigen.
- Reicht der Bestand nicht, schlägt der Deal mit klarer Meldung fehl und die Gelegenheit bleibt offen.
- Nach der Ausführung werden die Bestände umgebucht. Die Seite `/arbitrage/balances` zeigt sie je Börse mit Startwert,
  Veränderung und Bewertung zum Mittelkurs in EUR.
- Startbestände werden nur angelegt, wenn die Zeile noch fehlt. `PAPER_BALANCES_RESET=true` setzt alles zurück.

So wird sichtbar, was Cross-Arbitrage wirklich kostet: Bestand auf beiden Seiten, der nach jedem Deal weiter
auseinanderläuft und irgendwann umgeschichtet werden muss.

### Benachrichtigungen

`ALERT_EMAIL` setzen, dann schickt der Worker über den konfigurierten Mailer eine E-Mail, sobald eine neue Gelegenheit
mindestens `ALERT_BPS` netto erreicht, pro Route höchstens einmal je `ALERT_COOLDOWN_MS`. Die Mail enthält Route,
Brutto, Kosten, Netto, Einsatz, erwarteten Gewinn, die Schritte und den Link aus `DASHBOARD_URL`. Jede Benachrichtigung
wird als gesendete Nachricht mit Kennung `ALR-…` gespeichert und im Dashboard unter Nachrichten gezeigt.
Es wird dabei nichts ausgeführt.

### CSV-Export

Auf der Verlaufsseite gibt es "CSV exportieren": alle Messpunkte des gewählten Zeitraums und der gewählten Art
als CSV, per Keyset-Pagination gestreamt, für Excel, R oder Python. Route: `/arbitrage/history/export?range=7d&kind=cross`.

### CI

`.github/workflows/ci.yml` lintet und baut das Dashboard und führt Typecheck und Tests des Workers aus, bei jedem
Push und Pull Request.

### Konfiguration (Auszug, vollständig in `worker/.env.example`)

| Variable | Bedeutung |
| --- | --- |
| `ADAPTERS` | `ccxt,listings` im Betrieb, `mock,listings` zum Entwickeln |
| `EXCHANGES` | CCXT-IDs, Standard `kraken,bitstamp,coinbase,bitvavo` |
| `SYMBOLS` | z. B. `BTC/EUR,ETH/EUR` |
| `TRADE_SIZE_QUOTE` | Einsatz pro Deal in EUR |
| `MIN_NET_SPREAD_BPS` / `AUTO_PAPER_BPS` | Schwellen für Speichern bzw. automatischen Paper-Deal |
| `TRANSFER_MODEL` | `prefunded` (Bestand auf beiden Börsen) oder `withdraw` (Abhebegebühr einrechnen) |
| `TRIANGULAR` / `TRIANGLE_START` | Dreiecke bewerten, Startwährung (leer = Quote des ersten Symbols) |
| `SPREAD_SAMPLE_INTERVAL_MS` / `SPREAD_HISTORY_DAYS` | Takt und Aufbewahrung der Spread-Historie |
| `PAPER_BALANCES` | Startbestände je Börse; leer = keine Bestandsführung |
| `ALERT_EMAIL` / `ALERT_BPS` / `ALERT_COOLDOWN_MS` | Benachrichtigungen über neue Gelegenheiten |
| `MAX_QUOTE_AGE_MS` | Paper-Deals nicht gegen ältere Kurse füllen |
| `MAILER` | `console`, `smtp` oder `resend`; dazu `MAIL_FROM` und Zugangsdaten |
| `IMAP_*` | Postfach für Antworten, leer = aus |

Gebühren stehen in der Tabelle `markets` und überschreiben die Defaults aus `worker/src/markets.ts`.

### Neuen Markt anbinden

`worker/src/adapters/types.ts` definiert die Schnittstelle: `markets()` liefert Märkte mit Gebühren,
`fetchQuotes(symbols)` liefert Bid/Ask. Neue Klasse anlegen, in `worker/src/adapters/registry.ts` registrieren,
in `ADAPTERS` eintragen. Engine, Store und Dashboard bleiben unverändert.

### Grenzen und rechtliche Hinweise

- Auf liquiden Kryptobörsen sind Spreads zwischen großen Handelspaaren meist kleiner als die Gebühren und in
  Millisekunden weg. Sinnvoll sind EUR-Bücher kleinerer Börsen, wenig gehandelte Paare und langsame Märkte wie Inserate.
  Erst über Tage Paper-Traden und die Verteilung der Netto-Spreads ansehen, dann entscheiden.
- Bei `TRANSFER_MODEL=prefunded` muss Bestand auf beiden Börsen liegen und regelmäßig umgeschichtet werden.
- Kleinanzeigen-Plattformen verbieten Scraping und automatisierte Nachrichten. Inserate werden deshalb manuell erfasst,
  Nachrichten gehen erst nach Freigabe und mit Hinweis auf die Systemunterstützung raus.
- Vermittlung von Wertpapieren oder Derivaten ist in Deutschland erlaubnispflichtig (WpIG/KWG). Gewerblicher Warenhandel
  bringt Gewährleistungs- und Widerrufspflichten. Vor einem Echtbetrieb rechtlich prüfen lassen.
- Ein Bot, der sich selbst E-Mail-Konten anlegt, ist nicht vorgesehen. Stattdessen eine eigene Domain mit Postfach
  (SMTP/IMAP oder Resend) verwenden.

## Next.js

Standardbefehle: `npm run dev`, `npm run build`, `npm run start`, `npm run lint`.
Deployment des Dashboards über [Vercel](https://vercel.com/new); die Umgebungsvariablen aus `.env.example` dort setzen.
