
class DatabaseManager {
    constructor() {
        this.db = null;
        this.SQL = null;
    }

    async init() {
        this.SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        this.db = new this.SQL.Database();
        this.createTables();
        this.detectSchema();
    }

    getNowLocal() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    createTables() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date_str TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT DEFAULT 'nc',
                title TEXT DEFAULT 'nc',
                note TEXT,
                account TEXT NOT NULL,
                status TEXT DEFAULT 'AUTO',
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(date_str, amount, title, account)
            );
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id INTEGER,
                action TEXT NOT NULL,
                field_changed TEXT,
                old_value TEXT,
                new_value TEXT,
                timestamp TEXT
            );
        `);
    }

    loadBinary(arrayBuffer) {
        this.db = new this.SQL.Database(new Uint8Array(arrayBuffer));
        this.detectSchema();
    }

    /* Rileva colonne opzionali (es. dedup_key) nei DB creati altrove (Python) */
    detectSchema() {
        const res = this.db.exec("PRAGMA table_info(transactions)");
        this.txCols = new Set(res.length ? res[0].values.map(r => r[1]) : []);
        this.hasDedup = this.txCols.has('dedup_key');
    }

    /* SHA-1 sincrono (hex) */
    sha1(str) {
        const msg = unescape(encodeURIComponent(str));
        const rotl = (n, s) => (n << s) | (n >>> (32 - s));
        const bytes = [];
        for (let i = 0; i < msg.length; i++) bytes.push(msg.charCodeAt(i));
        const l = bytes.length;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        const hi = Math.floor(l * 8 / 0x100000000), lo = (l * 8) >>> 0;
        [hi, lo].forEach(v => { for (let s = 24; s >= 0; s -= 8) bytes.push((v >>> s) & 255); });
        let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
        for (let i = 0; i < bytes.length; i += 64) {
            const w = [];
            for (let j = 0; j < 16; j++) w[j] = (bytes[i + 4 * j] << 24) | (bytes[i + 4 * j + 1] << 16) | (bytes[i + 4 * j + 2] << 8) | bytes[i + 4 * j + 3];
            for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
            let a = h0, b = h1, c = h2, dd = h3, e = h4;
            for (let j = 0; j < 80; j++) {
                let f, k;
                if (j < 20) { f = (b & c) | (~b & dd); k = 0x5A827999; }
                else if (j < 40) { f = b ^ c ^ dd; k = 0x6ED9EBA1; }
                else if (j < 60) { f = (b & c) | (b & dd) | (c & dd); k = 0x8F1BBCDC; }
                else { f = b ^ c ^ dd; k = 0xCA62C1D6; }
                const t = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
                e = dd; dd = c; c = rotl(b, 30); b = a; a = t;
            }
            h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + dd) >>> 0; h4 = (h4 + e) >>> 0;
        }
        return [h0, h1, h2, h3, h4].map(x => x.toString(16).padStart(8, '0')).join('');
    }

    /* dedup_key = sha1(conto|data|importo|descrizione|n° occorrenza) */
    makeKey(rec, occ) {
        return this.sha1(`${rec.account}|${rec.date_str}|${Number(rec.amount).toFixed(2)}|${rec.note || ''}|${occ}`);
    }

    insertSingleTransaction(rec) {
        const now = this.getNowLocal();
        if (this.hasDedup) {
            // nonce temporale: i movimenti manuali non devono mai collidere
            const key = this.makeKey(rec, 'manual-' + Date.now() + '-' + Math.random());
            this.db.run(`
                INSERT INTO transactions (date_str, amount, category, title, note, account, status, created_at, updated_at, dedup_key)
                VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?)
            `, [rec.date_str, rec.amount, rec.category, rec.title, rec.note, rec.account, now, now, key]);
        } else {
            this.db.run(`
                INSERT INTO transactions (date_str, amount, category, title, note, account, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?)
            `, [rec.date_str, rec.amount, rec.category, rec.title, rec.note, rec.account, now, now]);
        }

        const lastId = this.db.exec("SELECT last_insert_rowid()")[0].values[0][0];
        const val = `${rec.title} (€${rec.amount})`;
        try {
            this.db.run(`INSERT INTO audit_log (transaction_id, action, new_value, timestamp) VALUES (?, 'INSERT_MANUAL', ?, ?)`, [lastId, val, now]);
        } catch (e) { // schema con CHECK sulle azioni ammesse
            this.db.run(`INSERT INTO audit_log (transaction_id, action, new_value, timestamp) VALUES (?, 'INSERT_AUTO', ?, ?)`, [lastId, val, now]);
        }
        return lastId;
    }

    insertTransactions(records) {
        let insertedCount = 0;
        const now = this.getNowLocal();

        const cols = 'date_str, amount, category, title, note, account, status, created_at, updated_at' + (this.hasDedup ? ', dedup_key' : '');
        const marks = "?, ?, ?, ?, ?, ?, 'AUTO', ?, ?" + (this.hasDedup ? ', ?' : '');
        const stmt = this.db.prepare(`INSERT OR IGNORE INTO transactions (${cols}) VALUES (${marks})`);
        const occ = {}; // n° occorrenza di righe identiche nello stesso import

        records.forEach(rec => {
            const params = [rec.date_str, rec.amount, rec.category, rec.title, rec.note, rec.account, now, now];
            if (this.hasDedup) {
                const base = `${rec.account}|${rec.date_str}|${Number(rec.amount).toFixed(2)}|${rec.note || ''}`;
                occ[base] = (occ[base] || 0) + 1;
                params.push(this.makeKey(rec, occ[base]));
            }
            stmt.run(params);
            if (this.db.getRowsModified() > 0) {
                insertedCount++;
                const lastId = this.db.exec("SELECT last_insert_rowid()")[0].values[0][0];
                this.db.run(`INSERT INTO audit_log (transaction_id, action, new_value, timestamp) VALUES (?, 'INSERT_AUTO', ?, ?)`, 
                    [lastId, `${rec.title} (€${rec.amount})`, now]);
            }
        });

        stmt.free();
        return insertedCount;
    }

    updateTransaction(id, updatedFields) {
        const currentRes = this.db.exec(`SELECT category, title, note, amount, account FROM transactions WHERE id = ?`, [id]);
        if (!currentRes.length || !currentRes[0].values.length) return;

        const [oldCat, oldTitle, oldNote, oldAmt, oldAcc] = currentRes[0].values[0];
        const now = this.getNowLocal();

        this.db.run(`
            UPDATE transactions 
            SET category = ?, title = ?, note = ?, amount = ?, account = ?, status = 'MODIFIED', updated_at = ?
            WHERE id = ?
        `, [updatedFields.category, updatedFields.title, updatedFields.note, updatedFields.amount, updatedFields.account, now, id]);

        if (oldCat !== updatedFields.category) this.logAudit(id, 'UPDATE', 'category', oldCat, updatedFields.category);
        if (oldTitle !== updatedFields.title) this.logAudit(id, 'UPDATE', 'title', oldTitle, updatedFields.title);
        if (oldNote !== updatedFields.note) this.logAudit(id, 'UPDATE', 'note', oldNote, updatedFields.note);
        if (oldAmt !== updatedFields.amount) this.logAudit(id, 'UPDATE', 'amount', oldAmt, updatedFields.amount);
        if (oldAcc !== updatedFields.account) this.logAudit(id, 'UPDATE', 'account', oldAcc, updatedFields.account);
    }

    logAudit(txId, action, field, oldVal, newVal) {
        const now = this.getNowLocal();
        this.db.run(`
            INSERT INTO audit_log (transaction_id, action, field_changed, old_value, new_value, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [txId, action, field, String(oldVal || ''), String(newVal || ''), now]);
    }

    getActiveTransactions() {
        const res = this.db.exec(`SELECT id, date_str, amount, category, title, note, account, status FROM transactions WHERE status != 'DELETED' ORDER BY date_str DESC, id DESC`);
        if (!res.length) return [];
        return res[0].values.map(row => ({
            id: row[0], date_str: row[1], amount: row[2], category: row[3],
            title: row[4], note: row[5], account: row[6], status: row[7]
        }));
    }

    getAuditLog() {
        const res = this.db.exec(`SELECT id, transaction_id, action, field_changed, old_value, new_value, timestamp FROM audit_log ORDER BY id DESC`);
        if (!res.length) return [];
        return res[0].values.map(row => ({
            id: row[0], transaction_id: row[1], action: row[2],
            field_changed: row[3], old_value: row[4], new_value: row[5], timestamp: row[6]
        }));
    }

    softDeleteTransaction(id) {
        this.db.run(`UPDATE transactions SET status = 'DELETED' WHERE id = ?`, [id]);
        this.logAudit(id, 'SOFT_DELETE', 'status', 'ACTIVE', 'DELETED');
    }

    exportBinary() { return this.db.export(); }
}


