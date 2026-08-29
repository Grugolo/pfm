class DatabaseManager {
    constructor() {
        this.db = null;
    }

    async init() {
        const SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        this.db = new SQL.Database();
        this.createTables();
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }

    insertTransactions(records) {
        let insertedCount = 0;
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO transactions (date_str, amount, category, title, note, account, status)
            VALUES (?, ?, ?, ?, ?, ?, 'AUTO')
        `);

        const auditStmt = this.db.prepare(`
            INSERT INTO audit_log (transaction_id, action, new_value)
            VALUES (?, 'INSERT_AUTO', ?)
        `);

        records.forEach(rec => {
            stmt.run([rec.date_str, rec.amount, rec.category, rec.title, rec.note, rec.account]);
            if (this.db.getRowsModified() > 0) {
                insertedCount++;
                const lastId = this.db.exec("SELECT last_insert_rowid()")[0].values[0][0];
                auditStmt.run([lastId, `Importato: ${rec.title} (€${rec.amount})`]);
            }
        });

        stmt.free();
        auditStmt.free();
        return insertedCount;
    }

    getActiveTransactions() {
        const res = this.db.exec(`
            SELECT id, date_str, amount, category, title, note, account, status 
            FROM transactions 
            WHERE status != 'DELETED' 
            ORDER BY date_str DESC, id DESC
        `);
        if (!res.length) return [];
        return res[0].values.map(row => ({
            id: row[0], date_str: row[1], amount: row[2], category: row[3],
            title: row[4], note: row[5], account: row[6], status: row[7]
        }));
    }

    getAuditLog() {
        const res = this.db.exec(`SELECT * FROM audit_log ORDER BY id DESC`);
        if (!res.length) return [];
        return res[0].values.map(row => ({
            id: row[0], transaction_id: row[1], action: row[2],
            field_changed: row[3], old_value: row[4], new_value: row[5], timestamp: row[6]
        }));
    }

    softDeleteTransaction(id) {
        this.db.run(`UPDATE transactions SET status = 'DELETED' WHERE id = ?`, [id]);
        this.db.run(`INSERT INTO audit_log (transaction_id, action) VALUES (?, 'SOFT_DELETE')`, [id]);
    }

    exportBinary() {
        return this.db.export();
    }

    loadBinary(arrayBuffer) {
        this.db = new SQL.Database(new Uint8Array(arrayBuffer));
    }
}
