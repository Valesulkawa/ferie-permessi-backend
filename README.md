# ferie-permessi-backend

Backend Node.js/Express per la gestione di richieste ferie, permessi e mutua, con persistenza su PostgreSQL, invio email di notifica e generazione report Excel.

## Panoramica

Il repository contiene tre blocchi distinti:

- `server.js`: backend Express principale usato per le API applicative.
- `functions/`: progetto Firebase Functions separato, al momento ancora scaffold di default.
- `build/`: build statica frontend configurata per Firebase Hosting.

Il runtime effettivo dell'applicazione e' il server Express in root. Le SQLite versionate (`db.sqlite`, `database.sqlite`) non vengono usate dal codice attuale: il backend lavora con PostgreSQL tramite `DATABASE_URL`.

## Stack

- Node.js
- Express
- PostgreSQL (`pg`)
- Nodemailer
- ExcelJS
- Firebase Hosting / Cloud Functions (cartella separata, non integrata con `server.js`)

## Struttura

```text
.
|-- build/                 # frontend statico per Firebase Hosting
|-- functions/             # progetto Firebase Functions separato
|   |-- index.js           # scaffold Firebase
|   `-- package.json
|-- server.js              # entrypoint del backend Express
|-- firebase.json          # config Hosting + Functions
|-- package.json           # dipendenze e script backend
|-- db.sqlite              # artefatto legacy, non usato dal server corrente
`-- database.sqlite        # artefatto legacy, non usato dal server corrente
```

## Requisiti

- Node.js 22 consigliato
- npm
- Un database PostgreSQL raggiungibile dall'ambiente locale

## Variabili ambiente

Il backend legge queste variabili:

- `PORT`: porta HTTP locale. Default `5001`.
- `DATABASE_URL`: stringa di connessione PostgreSQL. Obbligatoria.
- `MAIL_FROM`: mittente email mostrato nelle notifiche.
- `MAIL_TO`: destinatario delle notifiche.
- `RESEND_API_KEY`: se valorizzata usa Resend; altrimenti tenta il fallback SMTP definito nel codice.

Esempio: vedi [`.env.example`](/Users/valesulkawa/Documents/New project/ferie-permessi-backend-codex/.env.example).

## Avvio locale

1. Installa le dipendenze root:

```bash
npm install
```

2. Crea il file ambiente:

```bash
cp .env.example .env
```

3. Compila almeno `DATABASE_URL` con un Postgres valido.

4. Avvia il backend:

```bash
npm start
```

Per default il server espone `http://localhost:5001`.

### Verifica rapida

Con il server avviato:

```bash
curl http://localhost:5001/api/health
```

Risultato atteso:

- `200` con `{ "ok": true, "db": true, ... }` se API e database sono disponibili
- `503` se il database non e' raggiungibile

## Come si avvia davvero il progetto

Dal codice attuale il flusso di bootstrap e' questo:

1. `server.js` crea una `Pool` PostgreSQL usando `DATABASE_URL`.
2. All'avvio esegue `initDb()` e crea, se mancanti, le tabelle:
   - `richieste`
   - `date_bloccate`
3. Configura middleware Express (`cors`, `body-parser`).
4. Inizializza il sistema email:
   - Resend se `RESEND_API_KEY` e' presente
   - fallback SMTP altrimenti
5. Espone le API e apre l'ascolto su `PORT` oppure `5001`.

Se `DATABASE_URL` manca, il server logga l'errore; senza un database valido gli endpoint che leggono o scrivono dati falliranno.

## API principali

### Pubbliche

- `POST /api/richieste`
  Inserisce una richiesta ferie, permesso o mutua. Effettua validazioni, controllo date bloccate e anti-duplicato.

- `GET /api/richieste`
  Restituisce tutte le richieste in ordine decrescente.

- `GET /api/health`
  Health check applicativo e database.

### Admin

- `POST /api/admin/login`
  Restituisce un JWT admin.

- `GET /api/admin/email-status`
  Mostra provider email attivo e stato del transporter.

- `GET /api/admin/richieste`
  Lista richieste con filtri opzionali `nome` e `mese`.

- `DELETE /api/admin/richieste`
  Elimina richieste selezionate.

- `GET /api/admin/date-bloccate`
  Elenca le date bloccate.

- `POST /api/admin/date-bloccate`
  Aggiunge una data bloccata.

- `DELETE /api/admin/date-bloccate/:data`
  Rimuove una data bloccata.

- `POST /api/admin/test-mail`
  Invia una mail di test.

- `GET /api/admin/report?month=YYYY-MM`
  Genera un report `.xlsx` mensile.

## Firebase

`firebase.json` configura:

- `hosting.public = build`
- rewrite totale verso `index.html`
- una codebase Functions con source `functions/`

La cartella `functions/` puo' essere avviata separatamente:

```bash
cd functions
npm install
npm run serve
```

Al momento `functions/index.js` contiene solo lo scaffold standard Firebase, quindi non replica la logica del backend Express.

## Note operative

- `npm test` non esegue test reali: lo script attuale e' un placeholder.
- In questa sessione il bootstrap e' stato verificato fino al punto di avvio del server; il bind sulla porta `5001` non era consentito dal sandbox locale.
- Il repository contiene configurazione legacy e artefatti non piu' allineati al runtime attuale, in particolare i file SQLite e lo scaffold Firebase Functions.
- Parte della configurazione sensibile email/admin e' ancora hardcoded nel codice applicativo. Conviene spostarla in variabili ambiente prima di usare il progetto in produzione.

## Worktree e branch di lavoro

Per questa inizializzazione e' stato creato un worktree dedicato sul branch:

- `codex/inizializzazione`

Il clone principale e' rimasto su `main`, senza modifiche dirette.
