
class AutoLabeler {
    constructor() {
        this.notWords = new Set();
        this.expenseRules = [];
        this.incomeRules = [];
        this.accountMappings = [];
        this.STORAGE_KEY = 'finance_app_labeler_v1';
        this.loadFromStorage();
    }

    saveToStorage() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                notWords: [...this.notWords],
                expenseRules: this.expenseRules,
                incomeRules: this.incomeRules,
                accountMappings: this.accountMappings
            }));
        } catch (e) {
            console.error('Impossibile salvare le regole labeler:', e);
        }
    }

    loadFromStorage() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            this.notWords = new Set(data.notWords || []);
            this.expenseRules = data.expenseRules || [];
            this.incomeRules = data.incomeRules || [];
            this.accountMappings = data.accountMappings || [];
        } catch (e) {
            console.error('Impossibile ripristinare le regole labeler:', e);
        }
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

            // Colonne 1, 2, 3: Uscite (kw, category, tipo)
            if (r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== '') {
                this.expenseRules.push({
                    kw: String(r[1]).trim().toLowerCase(),
                    category: r[2] ? String(r[2]).trim() : "nc",
                    tipo: r[3] ? String(r[3]).trim() : "nc"
                });
            }

            // Colonne 4, 5, 6: Entrate (kw, category, tipo)
            if (r[4] !== undefined && r[4] !== null && String(r[4]).trim() !== '') {
                this.incomeRules.push({
                    kw: String(r[4]).trim().toLowerCase(),
                    category: r[5] ? String(r[5]).trim() : "nc",
                    tipo: r[6] ? String(r[6]).trim() : "nc"
                });
            }
        });

        this.saveToStorage();
    }

    /* Regole di riconoscimento conto: colonna A = keyword, colonna B = codice conto.
       La keyword può comparire nel NOME FILE oppure nel CONTENUTO del foglio (intestazione,
       intestatario, IBAN, causale...) — questo risolve il caso in cui più banche condividano
       le stesse intestazioni di colonna e non siano distinguibili dal nome file. */
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

        this.saveToStorage();
    }

    /* Ritorna il codice conto o null se nessuna regola combacia (mai più un default "isp" implicito).
       sheetText: testo raw di tutte le celle del foglio (prime N righe), usato come fallback
       quando il nome file non è distintivo. */
    detectAccount(fileName, sheetText = '') {
        const fn = (fileName || '').toLowerCase();
        const content = (sheetText || '').toLowerCase();

        // 1. Match su nome file (più affidabile se distintivo)
        for (let map of this.accountMappings) {
            if (map.keyword && fn.includes(map.keyword)) {
                return map.accountCode;
            }
        }
        // 2. Match sul contenuto del foglio (intestazioni, intestatario, IBAN, ecc.)
        for (let map of this.accountMappings) {
            if (map.keyword && content.includes(map.keyword)) {
                return map.accountCode;
            }
        }
        return null; // nessun match certo: l'utente deve confermare manualmente
    }

    // Pulisce il testo rimuovendo le `notWords` in modo sicuro con Regex Escape
    cleanText(text) {
        if (!text) return "";
        let cleaned = String(text).toLowerCase();
        
        this.notWords.forEach(word => {
            if (word) {
                const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escaped, 'gi');
                cleaned = cleaned.replace(regex, ' ');
            }
        });

        return cleaned.replace(/\s+/g, ' ').trim();
    }

    predict(note, amount) {
        if (!note) return { category: "nc", tipo: "nc" };
        
        const cleanedNote = this.cleanText(note);
        const rules = amount > 0 ? this.incomeRules : this.expenseRules;

        for (let rule of rules) {
            if (rule.kw && cleanedNote.includes(rule.kw)) {
                return { category: rule.category, tipo: rule.tipo };
            }
        }
        return { category: "nc", tipo: "nc" };
    }
}
