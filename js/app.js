class App {
    constructor() {
        this.dbMgr = new DatabaseManager();
        this.labeler = new AutoLabeler();
        
        this.sortState = {
            tx: { col: 'date_str', dir: 'desc' },
            audit: { col: 'id', dir: 'desc' }
        };

        this.STORAGE_KEY_FILTERS = 'finance_app_filters_v1';
        this.activeRuleType = 'sources';
        this.charts = { category: null, account: null };
    }

    async init() {
        await this.dbMgr.init();
        this.loadFiltersFromStorage();
        this.renderTransactions();
        this.renderAuditLog();
    }

    switchTab(tabId, btn) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        
        document.getElementById(tabId).classList.add('active');
        btn.classList.add('active');

        if (tabId === 'insightsTab') {
            this.renderCharts();
        }
    }

    /* ⚙️ GESTIONE MODALE IMPOSTAZIONI & EDITOR REGOLE */
    openSettingsModal() { 
        document.getElementById('settingsModal').classList.add('active'); 
        this.switchRuleTab('sources');
    }
    closeSettingsModal() { 
        document.getElementById('settingsModal').classList.remove('active');
        this.renderTransactions();
    }

    switchRuleTab(type) {
        this.activeRuleType = type;
        const btnSources = document.getElementById('btnEditSources');
        const btnSus = document.getElementById('btnEditSus');

        if (type === 'sources') {
            btnSources.className = 'btn btn-primary';
            btnSus.className = 'btn btn-outline';
        } else {
            btnSources.className = 'btn btn-outline';
            btnSus.className = 'btn btn-primary';
        }
        this.renderRuleEditorTable();
    }

    renderRuleEditorTable() {
        const headerRow = document.getElementById('ruleHeaderRow');
        const bodyRow = document.getElementById('ruleBodyRow');
        headerRow.innerHTML = '';
        bodyRow.innerHTML = '';

        const data = this.activeRuleType === 'sources' ? this.labeler.sourcesRawData : this.labeler.susRawData;
        if (!data || data.length === 0) return;

        // Headers
        data[0].forEach((h, colIndex) => {
            const th = document.createElement('th');
            th.innerHTML = `<input type="text" value="${h || ''}" onchange="app.updateRuleCell(0, ${colIndex}, this.value)" style="font-weight:bold; width:100%; border:none; background:transparent;">`;
            headerRow.appendChild(th);
        });
        const thAction = document.createElement('th');
        thAction.textContent = 'Azioni';
        headerRow.appendChild(thAction);

        // Rows
        for (let r = 1; r < data.length; r++) {
            const tr = document.createElement('tr');
            data[r].forEach((val, colIndex) => {
                const td = document.createElement('td');
                td.innerHTML = `<input type="text" value="${val !== undefined && val !== null ? val : ''}" onchange="app.updateRuleCell(${r}, ${colIndex}, this.value)" class="table-filter-input">`;
                tr.appendChild(td);
            });
            const tdAction = document.createElement('td');
            tdAction.innerHTML = `<button class="btn btn-danger-sm" onclick="app.deleteRuleRow(${r})">🗑️</button>`;
            tr.appendChild(tdAction);
            bodyRow.appendChild(tr);
        }
    }

    updateRuleCell(rowIdx, colIdx, val) {
        const data = this.activeRuleType === 'sources' ? this.labeler.sourcesRawData : this.labeler.susRawData;
        if (!data[rowIdx]) data[rowIdx] = [];
        data[rowIdx][colIdx] = val;

        localStorage.setItem(this.activeRuleType === 'sources' ? 'pfm_sources_json' : 'pfm_sus_json', JSON.stringify(data));
        this.labeler.parseRulesFromMemory();
    }

    addRuleRow() {
        const data = this.activeRuleType === 'sources' ? this.labeler.sourcesRawData : this.labeler.susRawData;
        const colsCount = data[0] ? data[0].length : 5;
        data.push(new Array(colsCount).fill(''));
        localStorage.setItem(this.activeRuleType === 'sources' ? 'pfm_sources_json' : 'pfm_sus_json', JSON.stringify(data));
        this.renderRuleEditorTable();
    }

    deleteRuleRow(rowIdx) {
        const data = this.activeRuleType === 'sources' ? this.labeler.sourcesRawData : this.labeler.susRawData;
        data.splice(rowIdx, 1);
        localStorage.setItem(this.activeRuleType === 'sources' ? 'pfm_sources_json' : 'pfm_sus_json', JSON.stringify(data));
        this.renderRuleEditorTable();
    }

    async handleConfigLoad(e) {
        const files = Array.from(e.target.files);
        const statusDiv = document.getElementById('configStatus');
        statusDiv.innerHTML = "";

        for (let file of files) {
            const success = await this.labeler.loadRuleFile(file);
            if (success) {
                statusDiv.innerHTML += `<div>✅ Regole <strong>${file.name}</strong> caricate e convertite a JSON!</div>`;
            } else {
                statusDiv.innerHTML += `<div>⚠️ Errore nel caricamento di ${file.name}</div>`;
            }
        }
        this.renderRuleEditorTable();
    }

    /* 📂 CARICAMENTO DATI BANCARI / DB */
    openLoadModal() { document.getElementById('loadModal').classList.add('active'); }
    closeLoadModal() { document.getElementById('loadModal').classList.remove('active'); }

    async handleUnifiedLoad(e) {
        const files = Array.from(e.target.files);
        const statusDiv = document.getElementById('loadStatus');
        statusDiv.innerHTML = "<em>Elaborazione file...</em><br>";

        files.sort((a, b) => (a.name.toLowerCase().endsWith('.db') ? -1 : 1));

        for (let file of files) {
            const fn = file.name.toLowerCase();
            const buffer = await file.arrayBuffer();

            if (fn.endsWith('.db') || fn.endsWith('.sqlite')) {
                this.dbMgr.loadBinary(buffer);
                statusDiv.innerHTML += `<div>✅ DB: <strong>${file.name}</strong> caricato.</div>`;
            } else if (fn.endsWith('.xlsx')) {
                const records = BankParser.parseExcel(buffer, file.name, this.labeler);
                if (records.length > 0) {
                    const count = this.dbMgr.insertTransactions(records);
                    statusDiv.innerHTML += `<div>✅ Bank Excel <strong>${file.name}</strong>: ${count} nuove transazioni!</div>`;
                } else {
                    statusDiv.innerHTML += `<div>⚠️ Nessuna transazione valida in <strong>${file.name}</strong>.</div>`;
                }
            }
        }
        this.renderTransactions();
        this.renderAuditLog();
    }

    /* 💾 ESPORTAZIONE MULTIPLA */
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
        if (document.getElementById('chkXlsx').checked) downloads.push(() => Exporter.exportXLSX(txs));
        if (document.getElementById('chkCsv').checked) downloads.push(() => Exporter.exportCSV(txs));
        if (document.getElementById('chkAudit').checked) {
            downloads.push(() => {
                const csvHeader = "Log ID,Tx ID,Azione,Campo,Vecchio Valore,Nuovo Valore,Timestamp\n";
                const csvRows = audit.map(a => `${a.id},${a.transaction_id},${a.action},"${a.field_changed||''}","${a.old_value||''}","${a.new_value||''}",${a.timestamp}`).join("\n");
                const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
                Exporter.downloadBlob(blob, 'audit_log.csv');
            });
        }

        downloads.forEach((dlFn, index) => setTimeout(dlFn, index * 350));
        this.closeSaveModal();
    }

    /* 📊 GRAFICI & INSIGHTS */
    renderCharts() {
        const txs = this.dbMgr.getActiveTransactions();
        
        // Category Totals for Expenses
        const catTotals = {};
        const accTotals = {};

        txs.forEach(t => {
            if (t.amount < 0) {
                const cat = t.category || 'nc';
                catTotals[cat] = (catTotals[cat] || 0) + Math.abs(t.amount);
            }
            const acc = t.account || 'isp';
            accTotals[acc] = (accTotals[acc] || 0) + t.amount;
        });

        // 1. Category Chart
        const ctxCat = document.getElementById('categoryChart').getContext('2d');
        if (this.charts.category) this.charts.category.destroy();
        this.charts.category = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catTotals),
                datasets: [{
                    data: Object.values(catTotals),
                    backgroundColor: ['#2563eb', '#16a34a', '#dc2626', '#eab308', '#9333ea', '#06b6d4', '#f97316']
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        // 2. Account Chart
        const ctxAcc = document.getElementById('accountChart').getContext('2d');
        if (this.charts.account) this.charts.account.destroy();
        this.charts.account = new Chart(ctxAcc, {
            type: 'bar',
            data: {
                labels: Object.keys(accTotals).map(a => a.toUpperCase()),
                datasets: [{
                    label: 'Flusso Netto (€)',
                    data: Object.values(accTotals),
                    backgroundColor: Object.values(accTotals).map(v => v >= 0 ? '#16a34a' : '#dc2626')
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    /* 💾 PERSISTENZA FILTRI */
    saveFiltersToStorage() {
        const filterIds = [
            'txF_id_min', 'txF_id_max', 'txF_date_start', 'txF_date_end', 
            'txF_amt_min', 'txF_amt_max', 'txF_category_inc', 'txF_category_exc',
            'txF_title_inc', 'txF_title_exc', 'txF_note_inc', 'txF_note_exc', 'txF_account',
            'logF_id_min', 'logF_id_max', 'logF_txId_min', 'logF_txId_max',
            'logF_action_inc', 'logF_action_exc', 'logF_field_inc', 'logF_field_exc',
            'logF_date_start', 'logF_date_end'
        ];
        const filterData = {};
        filterIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) filterData[id] = el.value;
        });
        localStorage.setItem(this.STORAGE_KEY_FILTERS, JSON.stringify(filterData));
    }

    loadFiltersFromStorage() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY_FILTERS);
            if (!saved) return;
            const filterData = JSON.parse(saved);
            Object.keys(filterData).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = filterData[id];
            });
        } catch (e) {
            console.error(e);
        }
    }

    matchTextFilterIncludeExclude(value, incTerm, excTerm) {
        const valStr = String(value || '').toLowerCase();
        if (incTerm && incTerm.trim()) {
            for (let t of incTerm.trim().toLowerCase().split(/\s+/)) {
                if (!valStr.includes(t)) return false;
            }
        }
        if (excTerm && excTerm.trim()) {
            for (let t of excTerm.trim().toLowerCase().split(/\s+/)) {
                if (valStr.includes(t)) return false;
            }
        }
        return true;
    }

    sortTable(targetTable, colName) {
        const state = this.sortState[targetTable];
        if (state.col === colName) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.col = colName; state.dir = 'asc'; }
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

    renderTransactions() {
        this.saveFiltersToStorage();
        const tbody = document.getElementById('transactionsTableBody');
        tbody.innerHTML = '';
        let txs = this.dbMgr.getActiveTransactions();

        const accounts = [...new Set(txs.map(t => t.account))];
        const accSelect = document.getElementById('txF_account');
        const currentAcc = accSelect.value;
        accSelect.innerHTML = '<option value="">Tutti</option>';
        accounts.forEach(a => {
            accSelect.innerHTML += `<option value="${a}" ${a === currentAcc ? 'selected' : ''}>${a.toUpperCase()}</option>`;
        });

        const idMin = document.getElementById('txF_id_min').value;
        const idMax = document.getElementById('txF_id_max').value;
        const dateStart = document.getElementById('txF_date_start').value;
        const dateEnd = document.getElementById('txF_date_end').value;
        const amtMin = document.getElementById('txF_amt_min').value;
        const amtMax = document.getElementById('txF_amt_max').value;
        const fCatInc = document.getElementById('txF_category_inc').value;
        const fCatExc = document.getElementById('txF_category_exc').value;
        const fTitleInc = document.getElementById('txF_title_inc').value;
        const fTitleExc = document.getElementById('txF_title_exc').value;
        const fNoteInc = document.getElementById('txF_note_inc').value;
        const fNoteExc = document.getElementById('txF_note_exc').value;
        const fAcc = document.getElementById('txF_account').value;

        txs = txs.filter(t => {
            if (idMin && t.id < parseInt(idMin)) return false;
            if (idMax && t.id > parseInt(idMax)) return false;
            if (dateStart && t.date_str < dateStart) return false;
            if (dateEnd && t.date_str > dateEnd) return false;
            if (amtMin && t.amount < parseFloat(amtMin)) return false;
            if (amtMax && t.amount > parseFloat(amtMax)) return false;
            if (!this.matchTextFilterIncludeExclude(t.category, fCatInc, fCatExc)) return false;
            if (!this.matchTextFilterIncludeExclude(t.title, fTitleInc, fTitleExc)) return false;
            if (!this.matchTextFilterIncludeExclude(t.note, fNoteInc, fNoteExc)) return false;
            if (fAcc && t.account !== fAcc) return false;
            return true;
        });

        const { col, dir } = this.sortState.tx;
        txs.sort((a, b) => {
            let valA = a[col], valB = b[col];
            if (typeof valA === 'string') { valA = valA.toLowerCase(); valB = valB.toLowerCase(); }
            if (valA < valB) return dir === 'asc' ? -1 : 1;
            if (valA > valB) return dir === 'asc' ? 1 : -1;
            return 0;
        });

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

    renderAuditLog() {
        this.saveFiltersToStorage();
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = '';
        let logs = this.dbMgr.getAuditLog();

        const idMin = document.getElementById('logF_id_min').value;
        const idMax = document.getElementById('logF_id_max').value;
        const txIdMin = document.getElementById('logF_txId_min').value;
        const txIdMax = document.getElementById('logF_txId_max').value;
        const fActionInc = document.getElementById('logF_action_inc').value;
        const fActionExc = document.getElementById('logF_action_exc').value;
        const fFieldInc = document.getElementById('logF_field_inc').value;
        const fFieldExc = document.getElementById('logF_field_exc').value;
        const dateStart = document.getElementById('logF_date_start').value;
        const dateEnd = document.getElementById('logF_date_end').value;

        logs = logs.filter(l => {
            if (idMin && l.id < parseInt(idMin)) return false;
            if (idMax && l.id > parseInt(idMax)) return false;
            if (txIdMin && l.transaction_id < parseInt(txIdMin)) return false;
            if (txIdMax && l.transaction_id > parseInt(txIdMax)) return false;
            if (!this.matchTextFilterIncludeExclude(l.action, fActionInc, fActionExc)) return false;
            if (!this.matchTextFilterIncludeExclude(l.field_changed, fFieldInc, fFieldExc)) return false;
            if (dateStart && l.timestamp.split(' ')[0] < dateStart) return false;
            if (dateEnd && l.timestamp.split(' ')[0] > dateEnd) return false;
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
        if (!isNew) return;

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
