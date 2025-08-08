import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import pg from 'pg'; // <-- Postgres

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 5001;

// ====== DB: Postgres via DATABASE_URL ======
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL non configurata su Render.');
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // richiesto su Render
});

// Creazione tabelle se non esistono
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS richieste (
      id SERIAL PRIMARY KEY,
      tipo TEXT,
      nome TEXT,
      email TEXT,
      giorni TEXT,        -- JSON in stringa come prima
      ore TEXT,
      oraInizio TEXT,
      oraFine TEXT,
      motivazione TEXT,
      note TEXT,
      stato TEXT,
      dataRichiesta TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS date_bloccate (
      id SERIAL PRIMARY KEY,
      data TEXT UNIQUE
    );
  `);
}
initDb().catch(err => {
  console.error('❌ Errore init DB:', err);
  process.exit(1);
});

// ====== Middleware
app.use((req, res, next) => {
  console.log(`➡ ${req.method} ${req.url}`);
  next();
});
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ====== Email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'latelierpermessi@gmail.com',
    pass: 'axidghirhhflyfyr'
  }
});

// ====== Auth admin
const JWT_SECRET = 'chiave_super_segreta';
const ADMIN_EMAIL = 'daniele.rizzioli@gmail.com';
const ADMIN_PASSWORD = '01o@JgpC!#@x^smu$*';

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  const emailN = (email || '').trim().toLowerCase();
  const passN  = (password || '').trim();

  if (emailN === ADMIN_EMAIL.toLowerCase() && passN === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin', email }, JWT_SECRET, { expiresIn: '2h' });
    return res.json({ message: 'Login effettuato con successo!', token });
  }
  res.status(401).json({ message: 'Credenziali non valide.' });
});

const requireAdmin = (req, res, next) => {
  const hdr = req.headers.authorization;
  if (!hdr) return res.status(403).json({ message: 'Token mancante' });
  const token = hdr.split(' ')[1];
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ message: 'Token non valido o scaduto' });
  }
};

// ====== Admin: lista richieste con filtri
app.get('/api/admin/richieste', requireAdmin, async (req, res) => {
  const { nome, mese } = req.query;
  let sql = `SELECT * FROM richieste WHERE 1=1`;
  const params = [];

  if (nome && nome !== 'Tutti') {
    params.push(nome);
    sql += ` AND nome = $${params.length}`;
  }
  if (mese && mese !== 'Tutti') {
    // dataRichiesta è TIMESTAMPTZ
    params.push(mese.toString().padStart(2, '0'));
    sql += ` AND to_char(dataRichiesta, 'MM') = $${params.length}`;
  }

  sql += ` ORDER BY dataRichiesta DESC`;

  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

// ====== Admin: elimina richieste selezionate
app.delete('/api/admin/richieste', requireAdmin, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'Nessuna richiesta selezionata.' });
  }
  await pool.query(`DELETE FROM richieste WHERE id = ANY($1::int[])`, [ids]);
  res.json({ message: 'Richieste eliminate correttamente.' });
});

// ====== Admin: date bloccate
app.get('/api/admin/date-bloccate', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(`SELECT data FROM date_bloccate ORDER BY data ASC`);
  res.json(rows.map(r => r.data));
});

app.post('/api/admin/date-bloccate', requireAdmin, async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ message: 'Data mancante.' });
  try {
    await pool.query(`INSERT INTO date_bloccate (data) VALUES ($1)`, [data]);
    res.json({ message: 'Data bloccata aggiunta correttamente.' });
  } catch (err) {
    res.status(400).json({ message: 'La data è già bloccata.' });
  }
});

app.delete('/api/admin/date-bloccate/:data', requireAdmin, async (req, res) => {
  const { data } = req.params;
  await pool.query(`DELETE FROM date_bloccate WHERE data = $1`, [data]);
  res.json({ message: 'Data bloccata rimossa correttamente.' });
});

// ====== Dipendenti: invio richiesta + validazioni
app.post('/api/richieste', async (req, res) => {
  const { tipo, nome, email, giorni, ore, oraInizio, oraFine, motivazione, note } = req.body;

  if (!nome || !email || !giorni ||
      (tipo !== 'Mutua' && !motivazione) ||
      (tipo === 'Permesso' && (!ore && (!oraInizio || !oraFine)))) {
    return res.status(400).json({ message: "Compila tutti i campi obbligatori." });
  }

  // blocco date (solo Ferie/Permesso)
  if (tipo && tipo.trim().toLowerCase() !== 'mutua') {
    const { rows } = await pool.query(`SELECT data FROM date_bloccate`);
    const set = new Set(rows.map(r => r.data));
    const richiesteISO = giorni.map(g => new Date(g).toISOString().split('T')[0]);
    const nonConsentite = [...new Set(richiesteISO.filter(d => set.has(d)))];
    if (nonConsentite.length > 0) {
      const giorniFmt = nonConsentite
        .map(d => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }))
        .join(', ');
      return res.status(400).json({ message: `❌ Impossibile richiedere ferie/permessi nel giorno ${giorniFmt}.` });
    }
  }

  const oggi = new Date();
  const primoGiorno = new Date(giorni[0]);
  const diffGiorni = Math.floor((primoGiorno - oggi) / (1000 * 60 * 60 * 24));
  const stato = (tipo === 'Mutua')
    ? 'Grazie per averci inviato la comunicazione.'
    : (diffGiorni < 5
        ? 'Richiesta in fase di accettazione perché non richiesta entro i 5gg di anticipo'
        : 'La tua richiesta è stata inviata correttamente. A breve ti verrà comunicato l\'esito.');

  await pool.query(
    `INSERT INTO richieste (tipo, nome, email, giorni, ore, oraInizio, oraFine, motivazione, note, stato)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      tipo, nome, email,
      JSON.stringify(giorni),
      ore || '', oraInizio || '', oraFine || '',
      motivazione || '', note || '', stato
    ]
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

// ====== Dipendenti: lista
app.get('/api/richieste', async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM richieste ORDER BY dataRichiesta DESC`);
  res.json(rows);
});

app.listen(PORT, () => console.log(`✅ Backend avviato su http://localhost:${PORT}`));