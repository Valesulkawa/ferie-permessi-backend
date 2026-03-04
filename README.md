# ferie-permessi-backend

Repository sanitizzato per portfolio: backend Node.js/Express per richieste di assenza, con persistenza PostgreSQL, invio notifiche e report Excel.

## Panoramica

Il runtime principale e' [server.js](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/server.js). Il repository contiene anche:

- [build/index.html](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/build/index.html): placeholder statico neutro.
- [functions/index.js](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/functions/index.js): scaffold minimo per la cartella `functions`.
- [demo/requests.demo.json](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/demo/requests.demo.json): richieste fittizie.
- [demo/date-bloccate.demo.json](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/demo/date-bloccate.demo.json): date bloccate fittizie.

Gli artefatti SQLite legacy con dati reali sono stati rimossi.

## Struttura

```text
.
|-- build/
|-- demo/
|-- functions/
|-- .env.example
|-- firebase.json
|-- package.json
`-- server.js
```

## Requisiti

- Node.js 22 consigliato
- npm
- PostgreSQL accessibile dall'ambiente di esecuzione

## Variabili ambiente

Le variabili disponibili sono documentate in [.env.example](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/.env.example).

Obbligatorie:

- `DATABASE_URL`

Raccomandate:

- `APP_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `MAIL_FROM`
- `MAIL_TO`

Opzionali:

- `DB_SSL`
- `MAIL_API_URL`
- `MAIL_API_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`

## Avvio locale

```bash
npm install
cp .env.example .env
npm start
```

Il bootstrap fa questo:

1. Crea la pool PostgreSQL da `DATABASE_URL`.
2. Inizializza le tabelle `richieste` e `date_bloccate`.
3. Configura middleware HTTP e autenticazione admin.
4. Tenta l'invio notifiche tramite `MAIL_API_*` o fallback SMTP.
5. Espone le API sulla porta configurata.

In questa sessione l'avvio completo non era verificabile fino al bind della porta per limiti del sandbox, ma l'entrypoint e i prerequisiti sono stati controllati dal codice e dall'installazione dipendenze.

## API principali

- `POST /api/richieste`: crea una richiesta ferie, permesso o mutua.
- `GET /api/richieste`: lista richieste.
- `GET /api/health`: verifica applicazione e database.
- `POST /api/admin/login`: genera token admin.
- `GET /api/admin/email-status`: stato del provider mail.
- `GET /api/admin/richieste`: lista admin con filtri.
- `DELETE /api/admin/richieste`: elimina richieste selezionate.
- `GET /api/admin/date-bloccate`: elenca date bloccate.
- `POST /api/admin/date-bloccate`: aggiunge data bloccata.
- `DELETE /api/admin/date-bloccate/:data`: rimuove data bloccata.
- `POST /api/admin/test-mail`: invio test.
- `GET /api/admin/report?month=YYYY-MM`: esporta report Excel.

## Demo

Per mostrare il progetto in portfolio senza dati reali:

- usa [demo/requests.demo.json](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/demo/requests.demo.json) come set di richieste esempio;
- usa [demo/date-bloccate.demo.json](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/demo/date-bloccate.demo.json) come calendario bloccato;
- configura credenziali demo in `.env`, ad esempio `admin@example.com` e password non riusata altrove;
- punta `MAIL_TO` a una casella tecnica o disattiva i provider mail lasciando vuote le variabili opzionali.

Esempio di import manuale via API, una richiesta per volta:

```bash
curl -X POST "$BASE_URL/api/richieste" \
  -H "Content-Type: application/json" \
  -d @demo/requests.demo.json
```

Nota: il file contiene un array JSON; per invii reali via `curl` conviene estrarre un singolo oggetto per richiesta oppure usare un piccolo script di bootstrap.

## Deployment

Per un deployment portfolio pulito:

1. Crea un database PostgreSQL dedicato all'ambiente demo.
2. Imposta tutte le variabili ambiente da [.env.example](/Users/valesulkawa/Documents/New%20project/ferie-permessi-backend-codex/.env.example), sostituendo i valori demo.
3. Avvia il servizio con `npm start`.
4. Verifica `GET /api/health` prima di caricare dati demo.
5. Se vuoi un frontend statico di accompagnamento, pubblica la cartella `build/` come placeholder oppure sostituiscila con la build reale del client.

Il repository non contiene piu':

- email personali;
- nomi di persone reali;
- segreti hardcoded;
- database locali con dati reali;
- riferimenti nominativi del progetto originale.

## Note

- `npm test` e' ancora un placeholder.
- La cartella `functions/` non replica la logica del backend root.
- Il branch di lavoro resta `codex/inizializzazione`; `main` non viene modificato direttamente.
