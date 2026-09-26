
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
                tipo TEXT DEFAULT 'nc',
                note TEXT,
                conto TEXT NOT NULL,
                emotional_value INTEGER DEFAULT NULL,
                status TEXT DEFAULT 'AUTO',
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(date_str, amount, tipo, conto, note)
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

    /* 🔄 Migra un DB .db vecchio (schema title/account) allo schema attuale (tipo/conto/emotional_value) */
    migrateLegacySchema() {
        const cols = this.db.exec(`PRAGMA table_info(transactions)`);
        if (!cols.length) return;
        const colNames = cols[0].values.map(r => r[1]);

        const hasLegacyTitle = colNames.includes('title') && !colNames.includes('tipo');
        const hasLegacyAccount = colNames.includes('account') && !colNames.includes('conto');
        const hasEmotional = colNames.includes('emotional_value');

        if (!hasLegacyTitle && !hasLegacyAccount && hasEmotional) return; // già aggiornato

        if (hasLegacyTitle) {
            this.db.run(`ALTER TABLE transactions RENAME COLUMN title TO tipo`);
        }
        if (hasLegacyAccount) {
            this.db.run(`ALTER TABLE transactions RENAME COLUMN account TO conto`);
        }
        if (!hasEmotional) {
            this.db.run(`ALTER TABLE transactions ADD COLUMN emotional_value INTEGER DEFAULT NULL`);
        }
    }

    loadBinary(arrayBuffer) {
        this.db = new this.SQL.Database(new Uint8Array(arrayBuffer));
        this.migrateLegacySchema();
    }

    insertSingleTransaction(rec) {
        const now = this.getNowLocal();
        this.db.run(`
            INSERT INTO transactions (date_str, amount, category, tipo, note, conto, emotional_value, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?)
        `, [rec.date_str, rec.amount, rec.category, rec.tipo, rec.note, rec.conto, rec.emotional_value ?? null, now, now]);

        const lastId = this.db.exec("SELECT last_insert_rowid()")[0].values[0][0];
        this.db.run(`INSERT INTO audit_log (transaction_id, action, new_value, timestamp) VALUES (?, 'INSERT_MANUAL', ?, ?)`, 
            [lastId, `${rec.tipo} (€${rec.amount})`, now]);
        return lastId;
    }

    insertTransactions(records) {
        let insertedCount = 0;
        const now = this.getNowLocal();

        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO transactions (date_str, amount, category, tipo, note, conto, emotional_value, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'AUTO', ?, ?)
        `);

        records.forEach(rec => {
            stmt.run([rec.date_str, rec.amount, rec.category, rec.tipo, rec.note, rec.conto, rec.emotional_value ?? null, now, now]);
            if (this.db.getRowsModified() > 0) {
                insertedCount++;
                const lastId = this.db.exec("SELECT last_insert_rowid()")[0].values[0][0];
                this.db.run(`INSERT INTO audit_log (transaction_id, action, new_value, timestamp) VALUES (?, 'INSERT_AUTO', ?, ?)`, 
                    [lastId, `${rec.tipo} (€${rec.amount})`, now]);
            }
        });

        stmt.free();
        return insertedCount;
    }

    updateTransaction(id, updatedFields) {
        const currentRes = this.db.exec(`SELECT category, tipo, note, amount, conto, emotional_value FROM transactions WHERE id = ?`, [id]);
        if (!currentRes.length || !currentRes[0].values.length) return;

        const [oldCat, oldTipo, oldNote, oldAmt, oldConto, oldEmo] = currentRes[0].values[0];
        const now = this.getNowLocal();

        this.db.run(`
            UPDATE transactions 
            SET category = ?, tipo = ?, note = ?, amount = ?, conto = ?, emotional_value = ?, status = 'MODIFIED', updated_at = ?
            WHERE id = ?
        `, [updatedFields.category, updatedFields.tipo, updatedFields.note, updatedFields.amount, updatedFields.conto, updatedFields.emotional_value ?? null, now, id]);

        if (oldCat !== updatedFields.category) this.logAudit(id, 'UPDATE', 'category', oldCat, updatedFields.category);
        if (oldTipo !== updatedFields.tipo) this.logAudit(id, 'UPDATE', 'tipo', oldTipo, updatedFields.tipo);
        if (oldNote !== updatedFields.note) this.logAudit(id, 'UPDATE', 'note', oldNote, updatedFields.note);
        if (oldAmt !== updatedFields.amount) this.logAudit(id, 'UPDATE', 'amount', oldAmt, updatedFields.amount);
        if (oldConto !== updatedFields.conto) this.logAudit(id, 'UPDATE', 'conto', oldConto, updatedFields.conto);
        if ((oldEmo ?? null) !== (updatedFields.emotional_value ?? null)) this.logAudit(id, 'UPDATE', 'emotional_value', oldEmo, updatedFields.emotional_value);
    }

    logAudit(txId, action, field, oldVal, newVal) {
        const now = this.getNowLocal();
        this.db.run(`
            INSERT INTO audit_log (transaction_id, action, field_changed, old_value, new_value, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [txId, action, field, String(oldVal ?? ''), String(newVal ?? ''), now]);
    }

    getActiveTransactions() {
        const res = this.db.exec(`SELECT id, date_str, amount, category, tipo, note, conto, emotional_value, status FROM transactions WHERE status != 'DELETED' ORDER BY date_str DESC, id DESC`);
        if (!res.length) return [];
        return res[0].values.map(row => ({
            id: row[0], date_str: row[1], amount: row[2], category: row[3],
            tipo: row[4], note: row[5], conto: row[6], emotional_value: row[7], status: row[8]
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
