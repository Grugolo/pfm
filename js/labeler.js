class AutoLabeler {
    constructor() {
        this.notWords = new Set();
        this.expenseRules = [];
        this.incomeRules = [];
        this.accountMappings = [];
        
        // Mantenuto formato originale: Name (0), ID (1), Amount (2), Date (3), Desc (4)
        this.sourcesRawData = JSON.parse(localStorage.getItem('pfm_sources_json')) || [
            ["Account Name", "Account ID", "Amount Column", "Date Column", "Description Columns"],
            ["ing", "ing", "IMPORTO IN EURO", "DATA VALUTA, DATA CONTABILE", "CAUSALE, DESCRIZIONE OPERAZIONE"],
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

    _buildRegexPattern(kw) {
        // Traduzione esatta del python: escape dei caratteri speciali, gestione del * e word boundaries
        if (kw.includes('*')) {
            const escaped = kw.split('*').map(s => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('\\w*');
            return new RegExp(escaped, 'i');
        } else {
            const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            return new RegExp('\\b' + escaped + '\\b', 'i');
        }
    }

    parseRulesFromMemory() {
        this.accountMappings = [];
        if (this.sourcesRawData.length > 1) {
            for (let i = 1; i < this.sourcesRawData.length; i++) {
                const r = this.sourcesRawData[i];
                if (r[0]) {
                    this.accountMappings.push({
                        keyword: String(r[0]).trim().toLowerCase(),
                        accountCode: r[1] ? String(r[1]).trim() : "1", // Account ID mantenuto
                        amountCol: r[2] ? String(r[2]).trim() : '',
                        dateCol: r[3] ? String(r[3]).trim() : '',
                        descCols: r[4] ? String(r[4]).trim() : ''
                    });
                }
            }
        }

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
                    const kw = String(r[1]).trim().toLowerCase();
                    this.expenseRules.push({
                        pattern: this._buildRegexPattern(kw),
                        category: r[2] ? String(r[2]).trim() : "nc",
                        title: r[3] ? String(r[3]).trim() : "nc"
                    });
                }
                if (r[4] !== undefined && r[4] !== null && String(r[4]).trim() !== '') {
                    const kw = String(r[4]).trim().toLowerCase();
                    this.incomeRules.push({
                        pattern: this._buildRegexPattern(kw),
                        category: r[5] ? String(r[5]).trim() : "nc",
                        title: r[6] ? String(r[6]).trim() : "nc"
                    });
                }
            }
        }
    }

    cleanText(text) {
        if (!text) return "";
        // Sostituisce la punteggiatura con spazio e divide in parole (come re.sub(r"[^\w\s]", " ", text.lower()))
        let cleaned = String(text).toLowerCase().replace(/[^\w\s]/g, ' ');
        let words = cleaned.split(/\s+/).filter(w => w.length > 0);
        
        // Filtra le not_words
        let filteredWords = words.filter(w => !this.notWords.has(w));
        return filteredWords.join(' ');
    }

    predict(descrizione, amount) {
        if (!descrizione) return { category: "nc", title: "nc" };
        const cleanedText = this.cleanText(descrizione);
        if (!cleanedText) return { category: "nc", title: "nc" };

        const rules = amount > 0 ? this.incomeRules : this.expenseRules;
        let matchedPairs = [];

        // Trova TUTTE le corrispondenze regex
        for (let rule of rules) {
            if (rule.pattern.test(cleanedText)) {
                matchedPairs.push({ category: rule.category || "nc", title: rule.title || "nc" });
            }
        }

        if (matchedPairs.length === 0) {
            return { category: "nc", title: "nc" };
        }

        // Replica di Counter(matched_pairs).most_common(1)[0]
        let counts = {};
        let maxCount = 0;
        let bestMatch = matchedPairs[0];

        for (let match of matchedPairs) {
            let key = match.category + "|||" + match.title;
            counts[key] = (counts[key] || 0) + 1;
            if (counts[key] > maxCount) {
                maxCount = counts[key];
                bestMatch = match;
            }
        }

        return bestMatch;
    }

    // (Il resto delle funzioni come getSourceConfig, loadRuleFile rimangono identiche a quelle che usavi)
    getSourceConfig(fileName) {
        const fn = fileName.toLowerCase();
        for (let map of this.accountMappings) {
            if (fn.includes(map.keyword)) return map;
        }
        return { accountCode: 'isp', amountCol: 'Importo', dateCol: 'Data', descCols: 'Operazione, Dettagli' };
    }
}
