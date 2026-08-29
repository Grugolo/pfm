class App {
    constructor() {
        this.dbMgr = new DatabaseManager();
        this.labeler = new AutoLabeler();
    }

    async init() {
        await this.dbMgr.init();
        this.bindEvents();
        this.renderTransactions();
        this.renderAuditLog();
    }

    switchTab(tabId, btn) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        btn.classList.add('active');
    }

    bindEvents() {
        // Dropzone Config
        const configInput = document.getElementById('configFileInput');
        configInput.addEventListener('change', (e) => this.handleConfigFiles(e.target.files));

        // Dropzone Bank
        const bankInput = document.getElementById('bankFileInput');
        bankInput.addEventListener('change', (e) => this.handleBankFiles(e.target.files));
    }

    async handleConfigFiles(files) {
        for (let file of files) {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            if (file.name.toLowerCase().includes('sus')) {
                this.labeler.loadSusFromWorkbook(wb);
                document.getElementById('configStatus').innerHTML += `<div>✅ Regole sus.xlsx caricate!</div>`;
            }
        }
    }

    async handleBankFiles(files) {
        let totalInserted = 0;
        for (let file of files) {
            const buffer = await file.arrayBuffer();
            const records = BankParser.parseExcel(buffer, file.name, this.labeler);
            totalInserted += this.dbMgr.insertTransactions(records);
        }
        document.getElementById('importStatus').innerHTML = `<div>🎉 Inserite ${totalInserted} nuove transazioni!</div>`;
        this.renderTransactions();
        this.renderAuditLog();
    }

    renderTransactions() {
        const tbody = document.getElementById('transactionsTableBody');
        const search = document.getElementById('searchInput').value.toLowerCase();
        const accFilter = document.getElementById('accountFilter').value;

        tbody.innerHTML = '';
        const txs = this.dbMgr.getActiveTransactions();

        let inc = 0, exp = 0, count = 0;

        txs.filter(t => {
            const matchSearch = t.note.toLowerCase().includes(search) || t.title.toLowerCase().includes(search);
            const matchAcc = !accFilter || t.account === accFilter;
            return matchSearch && matchAcc;
        }).forEach(t => {
            count++;
            if (t.amount > 0) inc += t.amount;
            else exp += Math.abs(t.amount);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${t.id}</td>
                <td>${t.date_str}</td>
                <td class="${t.amount >= 0 ? 'amount-income' : 'amount-expense'}">€ ${t.amount.toFixed(2)}</td>
                <td><span class="badge">${t.category}</span></td>
                <td>${t.title}</td>
                <td>${t.note}</td>
                <td><strong>${t.account.toUpperCase()}</strong></td>
                <td><span class="badge badge-status ${t.status}">${t.status}</span></td>
                <td><button class="btn btn-danger-sm" onclick="app.deleteTx(${t.id})">Cancella</button></td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('totalTxCount').textContent = count;
        document.getElementById('totalIncome').textContent = `€ ${inc.toFixed(2)}`;
        document.getElementById('totalExpense').textContent = `€ ${exp.toFixed(2)}`;
    }

    renderAuditLog() {
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = '';
        this.dbMgr.getAuditLog().forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${log.id}</td>
                <td>${log.transaction_id}</td>
                <td><span class="badge badge-status">${log.action}</span></td>
                <td>${log.field_changed || '-'}</td>
                <td>${log.old_value || '-'}</td>
                <td>${log.new_value || '-'}</td>
                <td>${log.timestamp}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    deleteTx(id) {
        if (confirm("Vuoi cancellare questa transazione dall'output?")) {
            this.dbMgr.softDeleteTransaction(id);
            this.renderTransactions();
            this.renderAuditLog();
        }
    }

    exportCSV() { Exporter.exportCSV(this.dbMgr.getActiveTransactions()); }
    exportXLSX() { Exporter.exportXLSX(this.dbMgr.getActiveTransactions()); }

    downloadDatabase() {
        const arrayBuffer = this.dbMgr.exportBinary();
        const blob = new Blob([arrayBuffer], { type: 'application/x-sqlite3' });
        Exporter.downloadBlob(blob, 'money.db');
    }

    async uploadDatabase(e) {
        const file = e.target.files[0];
        if (file) {
            const buffer = await file.arrayBuffer();
            this.dbMgr.loadBinary(buffer);
            this.renderTransactions();
            this.renderAuditLog();
        }
    }
}

const app = new App();
window.onload = () => app.init();
