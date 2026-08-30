class App {
    constructor() {
        this.dbMgr = new DatabaseManager();
        this.labeler = new AutoLabeler();
    }

    async init() {
        await this.dbMgr.init();
        this.renderTransactions();
        this.renderAuditLog();
    }

    switchTab(tabId, btn) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        
        document.getElementById(tabId).classList.add('active');
        btn.classList.add('active');
    }

    /* 🌟 GESTIONE MODALE CARICA UNIFICATO */
    openLoadModal() { document.getElementById('loadModal').classList.add('active'); }
    closeLoadModal() { document.getElementById('loadModal').classList.remove('active'); }

    async handleUnifiedLoad(e) {
        const files = e.target.files;
        const statusDiv = document.getElementById('loadStatus');
        statusDiv.innerHTML = "";

        for (let file of files) {
            const fn = file.name.toLowerCase();
            const buffer = await file.arrayBuffer();

            if (fn.endsWith('.db') || fn.endsWith('.sqlite')) {
                this.dbMgr.loadBinary(buffer);
                statusDiv.innerHTML += `<div>✅ DB <strong>${file.name}</strong> caricato!</div>`;
            } else if (fn.includes('sus')) {
                const wb = XLSX.read(buffer, { type: 'array' });
                this.labeler.loadSusFromWorkbook(wb);
                statusDiv.innerHTML += `<div>✅ Regole <strong>sus.xlsx</strong> caricate!</div>`;
            } else if (fn.includes('sources')) {
                const wb = XLSX.read(buffer, { type: 'array' });
                this.labeler.loadSourcesFromWorkbook(wb);
                statusDiv.innerHTML += `<div>✅ Sorgenti <strong>sources.xlsx</strong> caricate!</div>`;
            } else if (fn.endsWith('.xlsx')) {
                const records = BankParser.parseExcel(buffer, file.name, this.labeler);
                const count = this.dbMgr.insertTransactions(records);
                statusDiv.innerHTML += `<div>✅ <strong>${file.name}</strong>: ${count} nuove transazioni!</div>`;
            }
        }
        this.renderTransactions();
        this.renderAuditLog();
    }

    /* 🌟 GESTIONE MODALE SALVA UNIFICATO MULTI-SELECT */
    openSaveModal() { document.getElementById('saveModal').classList.add('active'); }
    closeSaveModal() { document.getElementById('saveModal').classList.remove('active'); }

    executeSave() {
        const txs = this.dbMgr.getActiveTransactions();
        const audit = this.dbMgr.getAuditLog();

        if (document.getElementById('chkDb').checked) {
            const blob = new Blob([this.dbMgr.exportBinary()], { type: 'application/x-sqlite3' });
            Exporter.downloadBlob(blob, 'money.db');
        }
        if (document.getElementById('chkXlsx').checked) {
            Exporter.exportXLSX(txs);
        }
        if (document.getElementById('chkCsv').checked) {
            Exporter.exportCSV(txs);
        }
        if (document.getElementById('chkAudit').checked) {
            const csvContent = "data:text/csv;charset=utf-8," + 
                ["Log ID,Tx ID,Action,Field,Old,New,Timestamp"].concat(audit.map(a => `${a.id},${a.transaction_id},${a.action},${a.field_changed},${a.old_value},${a.new_value},${a.timestamp}`)).join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "audit_log.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        this.closeSaveModal();
    }

    /* 🌟 INSERIMENTO MANUALE CON FAB '+' */
    addManualTransaction() {
        const today = new Date().toISOString().split('T')[0];
        const dateStr = prompt("Data (YYYY-MM-DD):", today);
        if (!dateStr) return;

        const amtStr = prompt("Importo (es. -15.50 o 50):", "0.00");
        if (!amtStr) return;
        const amount = parseFloat(amtStr) || 0;

        const note = prompt("Nota / Descrizione:", "");
        if (note === null) return;

        const predicted = this.labeler.predict(note, amount);

        const category = prompt("Categoria:", predicted.category) || "nc";
        const title = prompt("Titolo:", predicted.title) || "nc";
        const account = prompt("Account (es. isp, ing, ssp):", "isp") || "isp";

        this.dbMgr.insertSingleTransaction({
            date_str: dateStr.trim(),
            amount: amount,
            category: category.trim(),
            title: title.trim(),
            note: note.trim(),
            account: account.trim().toLowerCase()
        });

        this.renderTransactions();
        this.renderAuditLog();
    }

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
                <td><span class="badge badge-status ${log.action}">${log.action}</span></td>
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
}

const app = new App();
window.onload = () => app.init();
