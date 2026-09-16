# Signal

Next.js-Projekt (App Router, Tailwind 4, Supabase) mit zwei Teilen:

- **`/`**: die bestehende Signal-Oberfläche (`app/page.tsx`).
- **`/arbitrage`**: Dashboard des Arbitrage-Moduls. Der zugehörige Worker liegt in `worker/`.

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

1. Alle Adapter liefern Bid/Ask je Symbol. Börsenkurse landen in `latest_prices`.
2. Die Engine (`worker/src/engine/spread.ts`) prüft jedes Marktpaar: Kauf zum Ask, Verkauf zum Bid,
   abzüglich Taker-Gebühren beider Seiten, Slippage-Aufschlag und optional Abhebegebühr.
   Menge = `TRADE_SIZE_QUOTE / Ask`, begrenzt durch die verfügbare Tiefe.
3. Kandidaten über `MIN_NET_SPREAD_BPS` werden als Gelegenheit gespeichert oder aktualisiert.
   Nicht mehr gesehene Gelegenheiten laufen nach `OPPORTUNITY_TTL_MS` ab.
4. Ist ein Inserat mit Kontakt beteiligt, entsteht pro Inserat ein Nachrichtenentwurf (Status `draft`).
5. Ab `AUTO_PAPER_BPS` wird automatisch ein Paper-Deal angelegt; sonst per Klick im Dashboard.
6. Freigegebene Deals werden zu aktuellen Kursen simuliert (PnL inklusive Gebühren), freigegebene
   Nachrichten verschickt, der Posteingang per IMAP auf Antworten mit der Kennung `[SIG-XXXXXX]` geprüft.

### Einrichtung

1. Supabase-Projekt anlegen und `supabase/migrations/0001_arbitrage.sql` im SQL-Editor ausführen.
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
   oder der eigene Rechner reichen; `npm start` unter systemd oder pm2 laufen lassen.

### Konfiguration (Auszug, vollständig in `worker/.env.example`)

| Variable | Bedeutung |
| --- | --- |
| `ADAPTERS` | `ccxt,listings` im Betrieb, `mock,listings` zum Entwickeln |
| `EXCHANGES` | CCXT-IDs, Standard `kraken,bitstamp,coinbase,bitvavo` |
| `SYMBOLS` | z. B. `BTC/EUR,ETH/EUR` |
| `TRADE_SIZE_QUOTE` | Einsatz pro Deal in EUR |
| `MIN_NET_SPREAD_BPS` / `AUTO_PAPER_BPS` | Schwellen für Speichern bzw. automatischen Paper-Deal |
| `TRANSFER_MODEL` | `prefunded` (Bestand auf beiden Börsen) oder `withdraw` (Abhebegebühr einrechnen) |
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
