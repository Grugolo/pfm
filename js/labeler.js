class AutoLabeler {
    constructor() {
        this.notWords = new Set();
        this.expenseRules = [];
        this.incomeRules = [];
        this.accountMappings = [];
    }

    loadSusFromWorkbook(wb) {
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        this.expenseRules = [];
        this.incomeRules = [];
        this.notWords.clear();

        rows.slice(1).forEach(r => {
            // Colonna 0: notWords
            if (r[0] !== undefined && r[0] !== null && String(r[0]).trim() !== '') {
                this.notWords.add(String(r[0]).trim().toLowerCase());
            }

            // Colonne 1, 2, 3: Uscite (kw, category, title)
            if (r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== '') {
                this.expenseRules.push({
                    kw: String(r[1]).trim().toLowerCase(),
                    category: r[2] ? String(r[2]).trim() : "nc",
                    title: r[3] ? String(r[3]).trim() : "nc"
                });
            }

            // Colonne 4, 5, 6: Entrate (kw, category, title)
            if (r[4] !== undefined && r[4] !== null && String(r[4]).trim() !== '') {
                this.incomeRules.push({
                    kw: String(r[4]).trim().toLowerCase(),
                    category: r[5] ? String(r[5]).trim() : "nc",
                    title: r[6] ? String(r[6]).trim() : "nc"
                });
            }
        });
    }

    loadSourcesFromWorkbook(wb) {
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        this.accountMappings = [];
        rows.slice(1).forEach(r => {
            if (r[0] && r[1]) {
                this.accountMappings.push({
                    keyword: String(r[0]).trim().toLowerCase(),
                    accountCode: String(r[1]).trim().toLowerCase()
                });
            }
        });
    }

    detectAccount(fileName) {
        const fn = fileName.toLowerCase();
        for (let map of this.accountMappings) {
            if (fn.includes(map.keyword)) {
                return map.accountCode;
            }
        }
        if (fn.includes("ing")) return "ing";
        if (fn.includes("satispay") || fn.includes("ssp")) return "ssp";
        if (fn.includes("prepagata") || fn.includes("cc2")) return "cc2";
        return "isp";
    }

    // Pulisce il testo rimuovendo le `notWords`, mantenendo la struttura esattamente come il codice Python
    cleanText(text) {
        if (!text) return "";
        let cleaned = String(text).toLowerCase();
        
        // Sostituisce ogni stringa presente in notWords con uno spazio vuoto
        this.notWords.forEach(word => {
            if (word) {
                // Regex per sostituire le parole esatte ignorando maiuscole
                const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                cleaned = cleaned.replace(regex, ' ');
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
