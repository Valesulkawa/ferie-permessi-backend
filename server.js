import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import pg from 'pg'; // <-- Postgres

import ExcelJS from 'exceljs';

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

// ---------- Util per date/ore e festività IT ----------
const pad2 = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;

function easterDateUTC(year) { // Computus gregoriano
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-based
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}

function italianHolidays(year) {
  const set = new Set([
    `${year}-01-01`, // Capodanno
    `${year}-01-06`, // Epifania
    `${year}-04-25`, // Liberazione
    `${year}-05-01`, // Lavoro
    `${year}-06-02`, // Repubblica
    `${year}-08-15`, // Ferragosto
    `${year}-11-01`, // Ognissanti
    `${year}-12-08`, // Immacolata
    `${year}-12-25`, // Natale
    `${year}-12-26`, // S. Stefano
  ]);
  // Pasquetta (lunedì dopo Pasqua)
  const easter = easterDateUTC(year);
  const pasquetta = new Date(Date.UTC(year, easter.getUTCMonth(), easter.getUTCDate() + 1));
  set.add(toISO(pasquetta));
  return set;
}

function businessDaysInMonth(year, month /*1-12*/, holidaysSet) {
  const out = [];
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCMonth() === month - 1) {
    const dow = d.getUTCDay(); // 0=Sun
    const iso = toISO(d);
    if (dow >= 1 && dow <= 5 && !holidaysSet.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function minutesDiffConsideringLunch(startHHMM, endHHMM) {
  const toMin = (s) => { const [H, M] = s.split(':').map(Number); return H * 60 + M; };
  const s = toMin(startHHMM);
  const e = toMin(endHHMM);
  if (e <= s) return 0;
  let diff = e - s;
  const L1 = 12 * 60 + 30, L2 = 13 * 60 + 30;
  const overlap = Math.max(0, Math.min(e, L2) - Math.max(s, L1));
  return diff - overlap;
}

function permessoMinutes(ore, oraInizio, oraFine) {
  if (ore === '10:00-12:30') return 150;     // 2.5h
  if (ore === '13:30-19:00') return 330;     // 5.5h
  if (ore && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(ore)) {
    const [a, b] = ore.split('-');
    return minutesDiffConsideringLunch(a, b);
  }
  if (oraInizio && oraFine) return minutesDiffConsideringLunch(oraInizio, oraFine);
  return 0;
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

// ====== Admin: report mensile in Excel ======
app.get('/api/admin/report', requireAdmin, async (req, res) => {
  const { month } = req.query; // es. '2025-08'
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ message: 'Parametro "month" (YYYY-MM) mancante o invalido.' });
  }
  const year = Number(month.slice(0, 4));
  const mon  = Number(month.slice(5, 7));

  const holidays = italianHolidays(year);
  const workdays = businessDaysInMonth(year, mon, holidays);
  const workdaysSet = new Set(workdays);
  const oreTeorichePerPersona = workdays.length * 8;

  // Prendiamo solo richieste che "tocchino" il mese (match sulla stringa dei giorni)
  const like = `%${month}-%`;
  const { rows } = await pool.query(
    `SELECT * FROM richieste WHERE giorni LIKE $1`,
    [like]
  );

  // Aggregazione
  const perPersona = new Map(); // nome -> { ferieMin, permMin, mutuaMin, dettagli:[], byDay: { [iso]: { ferie?:true, mutua?:true, permMin?:number } } }

  const addPersona = (nome) => {
    if (!perPersona.has(nome)) perPersona.set(nome, {
      ferieMin: 0,
      permMin: 0,
      mutuaMin: 0,
      dettagli: [],
      byDay: {}
    });
    return perPersona.get(nome);
  };

  const FULL_DAY_MIN = 8 * 60;

  for (const r of rows) {
    const nome = r.nome || 'Senza nome';
    const tipo = (r.tipo || '').trim();
    let giorni = [];
    try { giorni = JSON.parse(r.giorni || '[]'); } catch { giorni = []; }
    const note  = r.note || '';
    const oraInizio = r.oraInizio || r.orainizio || '';
    const oraFine   = r.oraFine   || r.orafine   || '';
    const oreString = r.ore || '';

    const p = addPersona(nome);

    // FERIE o MUTUA: intervallo
    if ((tipo === 'Ferie' || tipo === 'Mutua') && Array.isArray(giorni) && giorni.length === 2) {
      const d0 = new Date(giorni[0] + 'T00:00:00Z');
      const d1 = new Date(giorni[1] + 'T00:00:00Z');
      for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = toISO(d);
        if (workdaysSet.has(iso)) {
          if (tipo === 'Ferie') p.ferieMin += FULL_DAY_MIN;
          else p.mutuaMin += FULL_DAY_MIN;
          p.dettagli.push({ nome, data: iso, tipo, ore: 8, note });
          // Mark byDay for calendar
          p.byDay[iso] = p.byDay[iso] || {};
          if (tipo === 'Ferie') p.byDay[iso].ferie = true;
          else p.byDay[iso].mutua = true;
        }
      }
      continue;
    }

    // PERMESSO: singolo giorno
    if (tipo === 'Permesso' && Array.isArray(giorni) && giorni.length >= 1) {
      const iso = giorni[0];
      if (workdaysSet.has(iso)) {
        const min = permessoMinutes(oreString, oraInizio, oraFine);
        if (min > 0) {
          p.permMin += min;
          p.dettagli.push({ nome, data: iso, tipo, ore: +(min/60).toFixed(2), note: oreString || `${oraInizio}-${oraFine}` });
          // Mark byDay for calendar
          p.byDay[iso] = p.byDay[iso] || {};
          p.byDay[iso].permMin = (p.byDay[iso].permMin || 0) + min;
        }
      }
      continue;
    }
  }

  // === Workbook: un solo foglio "Riepilogo" con mese testuale e stile ===
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ferie/Permessi App';
  wb.created = new Date();

  const mesiIT = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const meseTesto = `${mesiIT[mon - 1]} ${year}`;

  // unico foglio
  const ws = wb.addWorksheet('Riepilogo');

  // colonne dinamiche: Nome | Riga | Mese | 1..N | Ore lavorate | Ferie (ore) | Permessi (ore) | Mutua (ore)
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const colDefs = [
    { header: 'Nome', key: 'nome', width: 24 },
    { header: 'Riga', key: 'tipo', width: 6 },   // O = ore lavorate, P = permessi
    { header: 'Mese', key: 'mese', width: 18 },
  ];
  for (let i = 1; i <= lastDay; i++) colDefs.push({ header: String(i), key: `d${i}`, width: 6 });
  colDefs.push({ header: 'Ore lavorate', key: 'oreLav', width: 14 });
  colDefs.push({ header: 'Ferie (ore)', key: 'ferieOre', width: 12 });
  colDefs.push({ header: 'Permessi (ore)', key: 'permOre', width: 14 });
  colDefs.push({ header: 'Mutua (ore)', key: 'mutuaOre', width: 12 });
  ws.columns = colDefs;

  // helper per capire se giorno è lavorativo e se weekend
  const isWeekend = (iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    const dow = d.getUTCDay(); // 0=dom,6=sab
    return dow === 0 || dow === 6;
  };
  const allISO = Array.from({ length: lastDay }, (_, i) => `${year}-${pad2(mon)}-${pad2(i + 1)}`);

  // Intestazione: riempimento e bold
  const header = ws.getRow(1);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } }; // verde chiaro
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

  // Evidenzia colonne weekend in grigio
  for (let i = 1; i <= lastDay; i++) {
    const iso = allISO[i - 1];
    if (isWeekend(iso)) {
      const col = ws.getColumn(2 + i); // dopo Nome(1) e Mese(2)
      col.eachCell((cell, row) => {
        if (row === 1) return; // header già colorato
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }; // grigio chiaro
      });
    }
  }

  // righe dati (due righe per persona: O = ore lavorate, P = permessi)
  for (const [nome, agg] of perPersona.entries()) {
    const ferieH = +(agg.ferieMin / 60).toFixed(2);
    const permH  = +(agg.permMin  / 60).toFixed(2);
    const mutuaH = +(agg.mutuaMin / 60).toFixed(2);
    const oreTeo = workdays.length * 8;
    const oreLav = +(oreTeo - ferieH - permH - mutuaH).toFixed(2);

    // --- riga O (ore lavorate) ---
    const rowObjO = { nome, tipo: 'O', mese: meseTesto, oreLav, ferieOre: ferieH, permOre: permH, mutuaOre: mutuaH };
    // --- riga P (permessi) ---
    const rowObjP = { nome: '', tipo: 'P', mese: '' };

    let hasPermForMonth = false;
    for (let i = 0; i < lastDay; i++) {
      const iso = allISO[i];
      const d = new Date(iso + 'T00:00:00Z');
      const dow = d.getUTCDay();
      // weekend o festività -> vuoto su entrambe
      if (dow === 0 || dow === 6 || holidays.has(iso)) {
        rowObjO[`d${i + 1}`] = '';
        rowObjP[`d${i + 1}`] = '';
        continue;
      }
      const mark = agg.byDay[iso] || {};
      if (mark.ferie) {
        rowObjO[`d${i + 1}`] = 'FE';
        rowObjP[`d${i + 1}`] = '';
        continue;
      }
      if (mark.mutua) {
        rowObjO[`d${i + 1}`] = 'MU';
        rowObjP[`d${i + 1}`] = '';
        continue;
      }
      const permMin = mark.permMin || 0;
      const oreNum = Math.max(0, 8 - permMin / 60);
      rowObjO[`d${i + 1}`] = +oreNum.toFixed(2);
      if (permMin > 0) {
        hasPermForMonth = true;
        rowObjP[`d${i + 1}`] = +(permMin / 60).toFixed(2); // stesso formato decimale (2,50 = due ore e mezza)
      } else {
        rowObjP[`d${i + 1}`] = '';
      }
    }

    const rO = ws.addRow(rowObjO);
    // formati numerici + allineamenti sulla riga O
    for (let i = 4; i <= 3 + lastDay; i++) { // dopo Nome(1), Riga(2), Mese(3)
      const c = rO.getCell(i);
      if (typeof c.value === 'number') c.numFmt = '0.00';
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    rO.getCell(3 + lastDay + 1).numFmt = '0.00'; // oreLav
    rO.getCell(3 + lastDay + 2).numFmt = '0.00'; // ferieOre
    rO.getCell(3 + lastDay + 3).numFmt = '0.00'; // permOre
    rO.getCell(3 + lastDay + 4).numFmt = '0.00'; // mutuaOre

    // Colora FE/MU sulla riga O e bordi
    for (let i = 4; i <= 3 + lastDay; i++) {
      const cell = rO.getCell(i);
      if (cell.value === 'FE') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF59D' } };
      } else if (cell.value === 'MU') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC80' } };
      }
      cell.border = { top: { style: 'hair' }, left: { style: 'hair' }, bottom: { style: 'hair' }, right: { style: 'hair' } };
    }

    // Aggiungi la riga P solo se ci sono permessi nel mese
    if (hasPermForMonth) {
      const rP = ws.addRow(rowObjP);
      // formati e colorazione per i permessi
      for (let i = 4; i <= 3 + lastDay; i++) {
        const c = rP.getCell(i);
        if (typeof c.value === 'number') {
          c.numFmt = '0.00';
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // ambra chiaro
        }
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = { top: { style: 'hair' }, left: { style: 'hair' }, bottom: { style: 'hair' }, right: { style: 'hair' } };
      }
    }
  }

  // Se nessun dato, aggiungi riga vuota segnaposto
  if (perPersona.size === 0) {
    ws.addRow({ nome: '—', mese: meseTesto, oreLav: workdays.length * 8, ferieOre: 0, permOre: 0, mutuaOre: 0 });
  }

  // zebra stripes sulle righe dati
  for (let r = 2; r <= ws.rowCount; r++) {
    if (r % 2 === 0) {
      ws.getRow(r).eachCell((cell) => {
        if (!cell.fill) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; // azzurrino chiaro
        }
      });
    }
  }

  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-${month}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
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
  const statoBase = (tipo === 'Mutua')
    ? 'Grazie per averci inviato la comunicazione.'
    : (diffGiorni < 5
        ? 'Richiesta in fase di accettazione perché non richiesta entro i 5gg di anticipo'
        : 'La tua richiesta è stata inviata correttamente. A breve ti verrà comunicato l\'esito.');

  // 🔒 Anti-duplicato: evita doppio invio identico entro 30 secondi
  try {
    const dupCheck = await pool.query(
      `SELECT id FROM richieste
       WHERE nome = $1 AND tipo = $2 AND giorni = $3
         AND dataRichiesta > NOW() - INTERVAL '30 seconds'
       LIMIT 1`,
      [nome, tipo, JSON.stringify(giorni)]
    );
    if (dupCheck.rowCount > 0) {
      return res.status(200).json({
        message: 'Richiesta già ricevuta di recente.',
        stato: statoBase
      });
    }
  } catch (e) {
    console.error('Errore controllo duplicati:', e);
  }

  await pool.query(
    `INSERT INTO richieste (tipo, nome, email, giorni, ore, oraInizio, oraFine, motivazione, note, stato)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      tipo, nome, email,
      JSON.stringify(giorni),
      ore || '', oraInizio || '', oraFine || '',
      motivazione || '', note || '', statoBase
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
📌 Stato: ${statoBase}
      `
    });
    res.json({ message: 'Richiesta inviata con successo!', stato: statoBase });
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