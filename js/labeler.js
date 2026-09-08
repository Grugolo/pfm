class AutoLabeler {
    constructor() {
        this.notWords = new Set();
        this.expenseRules = [];
        this.incomeRules = [];
        this.accountMappings = [];
        
        // Raw matrix arrays for the live rule editors
        this.sourcesRawData = JSON.parse(localStorage.getItem('pfm_sources_json')) || [
            ["Account Name", "Account ID", "Amount Column", "Date Column", "Description Columns"],
            ["ing", "ing", "IMPORTO IN EURO", "DATA VALUTA", "CAUSALE, DESCRIZIONE OPERAZIONE"],
            ["conto corrente", "isp", "Importo", "Data", "Operazione, Dettagli"],
            ["prepagata", "cc2", "Accrediti, Addebiti", "Data valuta", "Descrizione"],
            ["satispay", "ssp", "Amount", "Date", "Type, Name, Description, ID"],
            ["paypal", "ppl", "Lordo", "Data", "Nome, Nota"]
        ];

        this.susRawData = JSON.parse(localStorage.getItem('pfm_sus_json')) || [
            ["NOT", "A", "B", "C", "A", "B", "C"],
            ["effettuato", "Bonifico", "movimenti", "T", "rimborso", "rimborsi", "(E)"],
            ["mediante", "INT Progresso", "caffe", "SV", "storno", "rimborsi", "(E)"]
        ];

        this.parseRulesFromMemory();
    }

    parseRulesFromMemory() {
        // Parse Sources
        this.accountMappings = [];
        if (this.sourcesRawData.length > 1) {
            for (let i = 1; i < this.sourcesRawData.length; i++) {
                const r = this.sourcesRawData[i];
                if (r[0] && r[1]) {
                    this.accountMappings.push({
                        keyword: String(r[0]).trim().toLowerCase(),
                        accountCode: String(r[1]).trim().toLowerCase(),
                        amountCol: r[2] ? String(r[2]).trim() : '',
                        dateCol: r[3] ? String(r[3]).trim() : '',
                        descCols: r[4] ? String(r[4]).trim() : ''
                    });
                }
            }
        }

        // Parse Sus
        this.expenseRules = [];
        this.incomeRules = [];
        this.notWords.clear();

        if (this.susRawData.length > 1) {
            for (let i = 1; i < this.susRawData.length; i++) {
                const r = this.susRawData[i];
                if (!r) continue;

                if (r[0] !== undefined && r[0] !== null && String(r[0]).trim() !== '') {
                    this.notWords.add(String(r[0]).trim().toLowerCase());
                }
                if (r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== '') {
                    this.expenseRules.push({
                        kw: String(r[1]).trim().toLowerCase(),
                        category: r[2] ? String(r[2]).trim() : "nc",
                        title: r[3] ? String(r[3]).trim() : "nc"
                    });
                }
                if (r[4] !== undefined && r[4] !== null && String(r[4]).trim() !== '') {
                    this.incomeRules.push({
                        kw: String(r[4]).trim().toLowerCase(),
                        category: r[5] ? String(r[5]).trim() : "nc",
                        title: r[6] ? String(r[6]).trim() : "nc"
                    });
                }
            }
        }
    }

    async loadRuleFile(file) {
        const fn = file.name.toLowerCase();
        const ext = fn.split('.').pop();
        let rows = [];

        if (ext === 'xlsx' || ext === 'csv') {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        } else if (ext === 'txt') {
            const text = await file.text();
            rows = text.split('\n').map(line => line.split(/[\t,]/).map(cell => cell.trim()));
        }

        if (rows.length === 0) return false;

        if (fn.includes('sus')) {
            this.susRawData = rows;
            localStorage.setItem('pfm_sus_json', JSON.stringify(this.susRawData));
        } else if (fn.includes('sources')) {
            this.sourcesRawData = rows;
            localStorage.setItem('pfm_sources_json', JSON.stringify(this.sourcesRawData));
        } else {
            // Default check based on columns width or headers
            if (rows[0] && String(rows[0][0]).toLowerCase().includes('account')) {
                this.sourcesRawData = rows;
                localStorage.setItem('pfm_sources_json', JSON.stringify(this.sourcesRawData));
            } else {
                this.susRawData = rows;
                localStorage.setItem('pfm_sus_json', JSON.stringify(this.susRawData));
            }
        }

        this.parseRulesFromMemory();
        return true;
    }

    getSourceConfig(fileName) {
        const fn = fileName.toLowerCase();
        for (let map of this.accountMappings) {
            if (fn.includes(map.keyword)) return map;
        }
        // Fallback default structure
        return { accountCode: 'isp', amountCol: 'Importo', dateCol: 'Data', descCols: 'Operazione, Dettagli' };
    }

    detectAccount(fileName) {
        const config = this.getSourceConfig(fileName);
        return config.accountCode || 'isp';
    }

    cleanText(text) {
        if (!text) return "";
        let cleaned = String(text).toLowerCase();
        this.notWords.forEach(word => {
            if (word) {
                const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cleaned = cleaned.replace(new RegExp(escaped, 'gi'), ' ');
            }
        });
        return cleaned.replace(/\s+/g, ' ').trim();
    }

    predict(note, amount) {
        if (!note) return { category: "nc", title: "nc" };
        const cleanedNote = this.cleanText(note);
        const rules = amount > 0 ? this.incomeRules : this.expenseRules;

        for (let rule of rules) {
            if (rule.kw && cleanedNote.includes(rule.kw)) {
                return { category: rule.category, title: rule.title };
            }
        }
        return { category: "nc", title: "nc" };
    }
}
