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

    // Ritorna la data/ora locale formattata YYYY-MM-DD HH:mm:ss
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
    }

    insertTransactions(records) {
        let insertedCount = 0;
        const now = this.getNowLocal();

        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO transactions (date_str, amount, category, title, note, account, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'AUTO', ?, ?)
        `);

        records.forEach(rec => {
            stmt.run([rec.date_str, rec.amount, rec.category, rec.title, rec.note, rec.account, now, now]);
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
