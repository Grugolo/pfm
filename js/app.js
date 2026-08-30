class App {
    constructor() {
        this.dbMgr = new DatabaseManager();
        this.labeler = new AutoLabeler();
        
        // Stato dell'ordinamento
        this.sortState = {
            tx: { col: 'date_str', dir: 'desc' },
            audit: { col: 'id', dir: 'desc' }
        };
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

    /* 📂 CARICAMENTO FILE (CORRETTA SEQUENZIALITÀ) */
    openLoadModal() { document.getElementById('loadModal').classList.add('active'); }
    closeLoadModal() { document.getElementById('loadModal').classList.remove('active'); }

    async handleUnifiedLoad(e) {
        const files = Array.from(e.target.files);
        const statusDiv = document.getElementById('loadStatus');
        statusDiv.innerHTML = "<em>Elaborazione file...</em><br>";

        // 1. Ordina i file per elaborare prima le regole (sus/sources) o il DB, poi i report bancari
        files.sort((a, b) => {
            const fnA = a.name.toLowerCase();
            const fnB = b.name.toLowerCase();
            if (fnA.endsWith('.db') || fnA.includes('sus') || fnA.includes('sources')) return -1;
            if (fnB.endsWith('.db') || fnB.includes('sus') || fnB.includes('sources')) return 1;
            return 0;
        });

        for (let file of files) {
            const fn = file.name.toLowerCase();
            const buffer = await file.arrayBuffer();

            if (fn.endsWith('.db') || fn.endsWith('.sqlite')) {
                this.dbMgr.loadBinary(buffer);
                statusDiv.innerHTML += `<div>✅ DB: <strong>${file.name}</strong> caricato.</div>`;
            } else if (fn.includes('sus')) {
                const wb = XLSX.read(buffer, { type: 'array' });
                this.labeler.loadSusFromWorkbook(wb);
                statusDiv.innerHTML += `<div>✅ Regole SUS caricate da <strong>${file.name}</strong>.</div>`;
            } else if (fn.includes('sources')) {
                const wb = XLSX.read(buffer, { type: 'array' });
                this.labeler.loadSourcesFromWorkbook(wb);
                statusDiv.innerHTML += `<div>✅ Sorgenti caricate da <strong>${file.name}</strong>.</div>`;
            } else if (fn.endsWith('.xlsx')) {
                // Parse report bancario con labeler aggiornato
                const records = BankParser.parseExcel(buffer, file.name, this.labeler);
                if (records.length > 0) {
                    const count = this.dbMgr.insertTransactions(records);
                    statusDiv.innerHTML += `<div>✅ Bank Excel <strong>${file.name}</strong>: ${count} nuove transazioni!</div>`;
                } else {
                    statusDiv.innerHTML += `<div>⚠️ Nessuna transazione trovata in <strong>${file.name}</strong>.</div>`;
                }
            }
        }
        this.renderTransactions();
        this.renderAuditLog();
    }

    /* 💾 ESPORTAZIONE CON DOWNLOAD MULTIPLI ABILITATI */
    openSaveModal() { document.getElementById('saveModal').classList.add('active'); }
    closeSaveModal() { document.getElementById('saveModal').classList.remove('active'); }

    executeSave() {
        const txs = this.dbMgr.getActiveTransactions();
        const audit = this.dbMgr.getAuditLog();
        const downloads = [];

        if (document.getElementById('chkDb').checked) {
            downloads.push(() => {
                const blob = new Blob([this.dbMgr.exportBinary()], { type: 'application/x-sqlite3' });
                Exporter.downloadBlob(blob, 'money.db');
            });
        }
        if (document.getElementById('chkXlsx').checked) {
            downloads.push(() => Exporter.exportXLSX(txs));
        }
        if (document.getElementById('chkCsv').checked) {
            downloads.push(() => Exporter.exportCSV(txs));
        }
        if (document.getElementById('chkAudit').checked) {
            downloads.push(() => {
                const csvHeader = "Log ID,Tx ID,Azione,Campo,Vecchio Valore,Nuovo Valore,Timestamp\n";
                const csvRows = audit.map(a => `${a.id},${a.transaction_id},${a.action},"${a.field_changed||''}","${a.old_value||''}","${a.new_value||''}",${a.timestamp}`).join("\n");
                const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
                Exporter.downloadBlob(blob, 'audit_log.csv');
            });
        }

        // Esegue i download sequenzialmente con breve ritardo per prevenire blocchi browser
        downloads.forEach((dlFn, index) => {
            setTimeout(dlFn, index * 350);
        });

        this.closeSaveModal();
    }

    /* 📊 ORDINAMENTO TABELLE */
    sortTable(targetTable, colName) {
        const state = this.sortState[targetTable];
        if (state.col === colName) {
            state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
            state.col = colName;
            state.dir = 'asc';
        }

        this.updateSortIcons(targetTable);
        if (targetTable === 'tx') this.renderTransactions();
        if (targetTable === 'audit') this.renderAuditLog();
    }

    updateSortIcons(targetTable) {
        document.querySelectorAll(`[id^="sort_${targetTable}_"]`).forEach(el => el.textContent = '');
        const current = this.sortState[targetTable];
        const iconEl = document.getElementById(`sort_${targetTable}_${current.col}`);
        if (iconEl) iconEl.textContent = current.dir === 'asc' ? ' ▲' : ' ▼';
    }

    /* 📝 TRANSAZIONI: RENDERING E FILTRI INTESTAZIONE */
    renderTransactions() {
        const tbody = document.getElementById('transactionsTableBody');
        tbody.innerHTML = '';
        let txs = this.dbMgr.getActiveTransactions();

        // Aggiorna opzioni Account nel filtro intestazione
        const accounts = [...new Set(txs.map(t => t.account))];
        const accSelect = document.getElementById('txF_account');
        const currentAcc = accSelect.value;
        accSelect.innerHTML = '<option value="">Tutti</option>';
        accounts.forEach(a => {
            accSelect.innerHTML += `<option value="${a}" ${a === currentAcc ? 'selected' : ''}>${a.toUpperCase()}</option>`;
        });

        // Leggi filtri da intestazione
        const fId = document.getElementById('txF_id').value;
        const fDate = document.getElementById('txF_date').value;
        const fAmount = document.getElementById('txF_amount').value;
        const fCat = document.getElementById('txF_category').value.toLowerCase();
        const fTitle = document.getElementById('txF_title').value.toLowerCase();
        const fNote = document.getElementById('txF_note').value.toLowerCase();
        const fAcc = document.getElementById('txF_account').value;

        // Applicazione Filtri
        txs = txs.filter(t => {
            if (fId && t.id != fId) return false;
            if (fDate && t.date_str !== fDate) return false;
            if (fAmount && Math.abs(t.amount) < parseFloat(fAmount)) return false;
            if (fCat && !t.category.toLowerCase().includes(fCat)) return false;
            if (fTitle && !t.title.toLowerCase().includes(fTitle)) return false;
            if (fNote && !t.note.toLowerCase().includes(fNote)) return false;
            if (fAcc && t.account !== fAcc) return false;
            return true;
        });

        // Applicazione Ordinamento (Sorting)
        const { col, dir } = this.sortState.tx;
        txs.sort((a, b) => {
            let valA = a[col], valB = b[col];
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            
            if (valA < valB) return dir === 'asc' ? -1 : 1;
            if (valA > valB) return dir === 'asc' ? 1 : -1;
            return 0;
        });

        // Calcolo Totali ed Emissione HTML
        let inc = 0, exp = 0;
        txs.forEach(t => {
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
                    <button class="btn btn-edit-sm" onclick="app.openTransactionModal(${t.id})">✏️</button>
                    <button class="btn btn-danger-sm" onclick="app.deleteTx(${t.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('totalTxCount').textContent = txs.length;
        document.getElementById('totalIncome').textContent = `€ ${inc.toFixed(2)}`;
        document.getElementById('totalExpense').textContent = `€ ${exp.toFixed(2)}`;
    }

    /* 📋 AUDIT LOG: RENDERING E FILTRI INTESTAZIONE */
    renderAuditLog() {
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = '';
        let logs = this.dbMgr.getAuditLog();

        const fId = document.getElementById('logF_id').value;
        const fTxId = document.getElementById('logF_txId').value;
        const fAction = document.getElementById('logF_action').value.toLowerCase();
        const fField = document.getElementById('logF_field').value.toLowerCase();
        const fDate = document.getElementById('logF_date').value;

        logs = logs.filter(l => {
            if (fId && l.id != fId) return false;
            if (fTxId && l.transaction_id != fTxId) return false;
            if (fAction && !l.action.toLowerCase().includes(fAction)) return false;
            if (fField && !(l.field_changed || '').toLowerCase().includes(fField)) return false;
            if (fDate && !l.timestamp.startsWith(fDate)) return false;
            return true;
        });

        const { col, dir } = this.sortState.audit;
        logs.sort((a, b) => {
            let valA = a[col], valB = b[col];
            if (valA < valB) return dir === 'asc' ? -1 : 1;
            if (valA > valB) return dir === 'asc' ? 1 : -1;
            return 0;
        });

        logs.forEach(log => {
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

    /* ✏️ MODALE DI AGGIUNTA / MODIFICA TRANSAZIONI CON INPUT NATIVI */
    openTransactionModal(txId = null) {
        const modal = document.getElementById('txFormModal');
        const titleEl = document.getElementById('txModalTitle');

        if (txId) {
            const txs = this.dbMgr.getActiveTransactions();
            const tx = txs.find(t => t.id === txId);
            if (!tx) return;

            titleEl.textContent = `Modifica Transazione #${tx.id}`;
            document.getElementById('txForm_id').value = tx.id;
            document.getElementById('txForm_date').value = tx.date_str;
            document.getElementById('txForm_amount').value = tx.amount;
            document.getElementById('txForm_note').value = tx.note;
            document.getElementById('txForm_category').value = tx.category;
            document.getElementById('txForm_title').value = tx.title;
            document.getElementById('txForm_account').value = tx.account;
        } else {
            titleEl.textContent = "Nuova Transazione Manuale";
            document.getElementById('txForm_id').value = "";
            document.getElementById('txForm_date').value = new Date().toISOString().split('T')[0];
            document.getElementById('txForm_amount').value = "";
            document.getElementById('txForm_note').value = "";
            document.getElementById('txForm_category').value = "nc";
            document.getElementById('txForm_title').value = "nc";
            document.getElementById('txForm_account').value = "isp";
        }

        modal.classList.add('active');
    }

    closeTransactionModal() { document.getElementById('txFormModal').classList.remove('active'); }

    onNoteInputAutoPredict() {
        const isNew = !document.getElementById('txForm_id').value;
        if (!isNew) return; // Autosuggestion solo su nuovi inserimenti

        const note = document.getElementById('txForm_note').value;
        const amt = parseFloat(document.getElementById('txForm_amount').value) || 0;
        
        if (note.length > 2) {
            const pred = this.labeler.predict(note, amt);
            if (pred.category !== 'nc') document.getElementById('txForm_category').value = pred.category;
            if (pred.title !== 'nc') document.getElementById('txForm_title').value = pred.title;
        }
    }

    saveTransactionFromModal() {
        const id = document.getElementById('txForm_id').value;
        const date_str = document.getElementById('txForm_date').value;
        const amount = parseFloat(document.getElementById('txForm_amount').value) || 0;
        const note = document.getElementById('txForm_note').value.trim();
        const category = document.getElementById('txForm_category').value.trim() || 'nc';
        const title = document.getElementById('txForm_title').value.trim() || 'nc';
        const account = document.getElementById('txForm_account').value.trim().toLowerCase() || 'isp';

        if (!date_str) { alert("Seleziona una data valida."); return; }

        if (id) {
            this.dbMgr.updateTransaction(parseInt(id), { category, title, note, amount, account });
        } else {
            this.dbMgr.insertSingleTransaction({ date_str, amount, category, title, note, account });
        }

        this.closeTransactionModal();
        this.renderTransactions();
        this.renderAuditLog();
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
