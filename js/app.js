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
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        
        document.getElementById(tabId).classList.add('active');
        btn.classList.add('active');
    }

    bindEvents() {
        document.getElementById('configFileInput').addEventListener('change', (e) => this.handleConfigFiles(e.target.files));
        document.getElementById('bankFileInput').addEventListener('change', (e) => this.handleBankFiles(e.target.files));
    }

    async handleConfigFiles(files) {
        const statusDiv = document.getElementById('configStatus');
        for (let file of files) {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            const fn = file.name.toLowerCase();

            if (fn.includes('sus')) {
                this.labeler.loadSusFromWorkbook(wb);
                statusDiv.innerHTML += `<div>✅ Regole <strong>sus.xlsx</strong> caricate!</div>`;
            } else if (fn.includes('sources')) {
                this.labeler.loadSourcesFromWorkbook(wb);
                statusDiv.innerHTML += `<div>✅ Mappatura <strong>sources.xlsx</strong> caricata!</div>`;
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
        document.getElementById('importStatus').innerHTML = `<div>🎉 Elaborazione completata: <strong>${totalInserted}</strong> nuove transazioni aggiunte nel DB!</div>`;
        this.renderTransactions();
        this.renderAuditLog();
    }

    // Popola dinamicamente il selettore degli account
    populateAccountSelect(accounts) {
        const select = document.getElementById('accountFilter');
        const currentVal = select.value;
        select.innerHTML = '<option value="">Tutti i Conti</option>';
        accounts.forEach(acc => {
            const opt = document.createElement('option');
            opt.value = acc;
            opt.textContent = acc.toUpperCase();
            if (acc === currentVal) opt.selected = true;
            select.appendChild(opt);
        });
    }

    renderTransactions() {
        const tbody = document.getElementById('transactionsTableBody');
        const search = document.getElementById('searchInput').value.toLowerCase();
        const accFilter = document.getElementById('accountFilter').value;
        const startDate = document.getElementById('startDateFilter').value;
        const endDate = document.getElementById('endDateFilter').value;

        tbody.innerHTML = '';
        const txs = this.dbMgr.getActiveTransactions();

        // Estrazione di tutti gli account presenti per popolare la tendina del filtro
        const uniqueAccounts = [...new Set(txs.map(t => t.account))];
        this.populateAccountSelect(uniqueAccounts);

        let inc = 0, exp = 0, count = 0;

        txs.filter(t => {
            const matchSearch = t.note.toLowerCase().includes(search) || 
                                t.title.toLowerCase().includes(search) || 
                                t.category.toLowerCase().includes(search);
            const matchAcc = !accFilter || t.account === accFilter;
            const matchStart = !startDate || t.date_str >= startDate;
            const matchEnd = !endDate || t.date_str <= endDate;

            return matchSearch && matchAcc && matchStart && matchEnd;
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
                <td><strong style="color:var(--primary);">${t.account.toUpperCase()}</strong></td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-edit-sm" title="Modifica" onclick="app.editTx(${t.id})">✏️</button>
                    <button class="btn btn-danger-sm" title="Elimina" onclick="app.deleteTx(${t.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('totalTxCount').textContent = count;
        document.getElementById('totalIncome').textContent = `€ ${inc.toFixed(2)}`;
        document.getElementById('totalExpense').textContent = `€ ${exp.toFixed(2)}`;
    }

    editTx(id) {
        const txs = this.dbMgr.getActiveTransactions();
        const tx = txs.find(t => t.id === id);
        if (!tx) return;

        const newCat = prompt("Categoria:", tx.category);
        if (newCat === null) return;

        const newTitle = prompt("Titolo:", tx.title);
        if (newTitle === null) return;

        const newNote = prompt("Nota:", tx.note);
        if (newNote === null) return;

        const newAmtStr = prompt("Importo:", tx.amount);
        if (newAmtStr === null) return;
        const newAmt = parseFloat(newAmtStr) || tx.amount;

        const newAcc = prompt("Account (es. isp, ing, ssp):", tx.account);
        if (newAcc === null) return;

        this.dbMgr.updateTransaction(id, {
            category: newCat.trim(),
            title: newTitle.trim(),
            note: newNote.trim(),
            amount: newAmt,
            account: newAcc.trim().toLowerCase()
        });

        this.renderTransactions();
        this.renderAuditLog();
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
            try {
                const buffer = await file.arrayBuffer();
                this.dbMgr.loadBinary(buffer);
                this.renderTransactions();
                this.renderAuditLog();
                alert("Database money.db caricato con successo!");
            } catch (err) {
                alert("Errore durante il caricamento del DB: " + err.message);
            }
        }
    }
}

const app = new App();
window.onload = () => app.init();
