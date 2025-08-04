import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';

const app = express();
const PORT = 5001;

// ✅ Log globale per ogni richiesta
app.use((req, res, next) => {
  console.log(`➡ ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database SQLite
const dbPromise = open({
  filename: './database.sqlite',
  driver: sqlite3.Database
});

// Creazione tabella richieste
(async () => {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS richieste (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT,
      nome TEXT,
      email TEXT,
      giorni TEXT,
      ore TEXT,
      oraInizio TEXT,
      oraFine TEXT,
      motivazione TEXT,
      note TEXT,
      stato TEXT,
      dataRichiesta TEXT
    )
  `);
})();

// Creazione tabella date bloccate
(async () => {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS date_bloccate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT UNIQUE
    )
  `);
})();

// Configurazione email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'latelierpermessi@gmail.com',
    pass: 'axidghirhhflyfyr'
  }
});

// === LOGIN ADMIN JWT ===
const JWT_SECRET = 'chiave_super_segreta';
const ADMIN_EMAIL = 'daniele.rizzioli@gmail.com';
const ADMIN_PASSWORD = '01o@JgpC!#@x^smu$*';

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  const emailNormalizzata = email?.trim().toLowerCase() || '';
  const passwordNormalizzata = password?.trim() || '';

  if (emailNormalizzata === ADMIN_EMAIL.toLowerCase() && passwordNormalizzata === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin', email }, JWT_SECRET, { expiresIn: '2h' });
    return res.json({ message: 'Login effettuato con successo!', token });
  }

  res.status(401).json({ message: 'Credenziali non valide.' });
});

// Middleware protezione admin
const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(403).json({ message: 'Token mancante' });
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ message: 'Token non valido o scaduto' });
  }
};

// ✅ Endpoint richieste protetto admin con filtri
app.get('/api/admin/richieste', requireAdmin, async (req, res) => {
  const { nome, mese } = req.query;
  const db = await dbPromise;

  let query = 'SELECT * FROM richieste WHERE 1=1';
  const params = [];

  if (nome && nome !== 'Tutti') {
    query += ' AND nome = ?';
    params.push(nome);
  }

  if (mese && mese !== 'Tutti') {
    query += " AND strftime('%m', dataRichiesta) = ?";
    params.push(mese.padStart(2, '0'));
  }

  query += ' ORDER BY dataRichiesta DESC';
  const richieste = await db.all(query, params);
  res.json(richieste);
});

// ✅ Eliminazione richieste selezionate
app.delete('/api/admin/richieste', requireAdmin, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'Nessuna richiesta selezionata.' });
  }

  const db = await dbPromise;
  const placeholders = ids.map(() => '?').join(',');
  await db.run(`DELETE FROM richieste WHERE id IN (${placeholders})`, ids);
  res.json({ message: 'Richieste eliminate correttamente.' });
});

// ✅ Endpoint date bloccate
app.get('/api/admin/date-bloccate', requireAdmin, async (req, res) => {
  const db = await dbPromise;
  const date = await db.all('SELECT data FROM date_bloccate ORDER BY data ASC');
  res.json(date.map(d => d.data));
});

app.post('/api/admin/date-bloccate', requireAdmin, async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ message: 'Data mancante.' });

  const db = await dbPromise;
  try {
    await db.run('INSERT INTO date_bloccate (data) VALUES (?)', [data]);
    res.json({ message: 'Data bloccata aggiunta correttamente.' });
  } catch (err) {
    res.status(400).json({ message: 'La data è già bloccata.' });
  }
});

app.delete('/api/admin/date-bloccate/:data', requireAdmin, async (req, res) => {
  const { data } = req.params;
  const db = await dbPromise;
  await db.run('DELETE FROM date_bloccate WHERE data = ?', [data]);
  res.json({ message: 'Data bloccata rimossa correttamente.' });
});

// ✅ Endpoint invio richieste dipendenti con validazione date bloccate
app.post('/api/richieste', async (req, res) => {
  const { tipo, nome, email, giorni, ore, oraInizio, oraFine, motivazione, note } = req.body;

  if (!nome || !email || !giorni ||
    (tipo !== 'Mutua' && !motivazione) || // motivazione non richiesta per Mutua
    (tipo === 'Permesso' && (!ore && (!oraInizio || !oraFine)))) {
  return res.status(400).json({ message: "Compila tutti i campi obbligatori." });
}

  const db = await dbPromise;
  const dateBloccate = await db.all('SELECT data FROM date_bloccate');
  const dateBloccateSet = new Set(dateBloccate.map(d => d.data));

  // 🔒 Verifica se una delle date richieste è bloccata (solo per Ferie e Permessi)
  console.log("DEBUG tipo ricevuto:", tipo);
  if (tipo && tipo.trim().toLowerCase() !== 'mutua') {
    const dateRichieste = giorni.map(g => new Date(g).toISOString().split('T')[0]);
    const dateNonConsentite = [...new Set(dateRichieste.filter(d => dateBloccateSet.has(d)))];

    if (dateNonConsentite.length > 0 && tipo.trim().toLowerCase() !== 'mutua') {
      const giorniFormattati = dateNonConsentite
        .map(d => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }))
        .join(', ');
      return res.status(400).json({ message: `❌ Impossibile richiedere ferie/permessi nel giorno ${giorniFormattati}.` });
    }
  }

  const oggi = new Date();
  const primoGiorno = new Date(giorni[0]);
  const diffGiorni = Math.floor((primoGiorno - oggi) / (1000 * 60 * 60 * 24));
  const stato = tipo === 'Mutua'
    ? 'Grazie per averci inviato la comunicazione.'
    : diffGiorni < 5
      ? 'Richiesta in fase di accettazione perché non richiesta entro i 5gg di anticipo'
      : 'La tua richiesta è stata inviata correttamente. A breve ti verrà comunicato l\'esito.';

  await db.run(
    `INSERT INTO richieste (tipo, nome, email, giorni, ore, oraInizio, oraFine, motivazione, note, stato, dataRichiesta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tipo, nome, email, JSON.stringify(giorni), ore || '', oraInizio || '', oraFine || '', motivazione, note || '', stato, oggi.toISOString()]
  );

  try {
    await transporter.sendMail({
      from: 'latelierpermessi@gmail.com',
      to: 'latelierpermessi@gmail.com',
      subject: `Nuova richiesta di ${tipo} da ${nome}`,
      text: `
📩 Nuova richiesta ricevuta:

👤 Nome: ${nome}
📧 Email: ${email}
🏷️ Tipo richiesta: ${tipo}
📅 Giorni: ${giorni.join(' - ')}
⏰ Ore: ${ore || (oraInizio && oraFine ? `${oraInizio}-${oraFine}` : 'N/A')}
📝 Motivazione: ${motivazione || 'N/A'}
🗒️ Note: ${note || 'Nessuna'}
📌 Stato: ${stato}
      `
    });

    res.json({ message: 'Richiesta inviata con successo!', stato });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Errore nell\'invio dell\'email.' });
  }
});

// ✅ Endpoint richieste dipendenti
app.get('/api/richieste', async (req, res) => {
  const db = await dbPromise;
  const richieste = await db.all('SELECT * FROM richieste');
  res.json(richieste);
});

app.listen(PORT, () => console.log(`✅ Backend avviato su http://localhost:${PORT}`));