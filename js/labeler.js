class AutoLabeler {
    constructor() {
        this.notWords = new Set();
        this.expenseRules = [];
        this.incomeRules = [];
        this.accountMappings = []; // Regole da sources.xlsx
    }

    loadSusFromWorkbook(wb) {
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        this.expenseRules = [];
        this.incomeRules = [];
        this.notWords.clear();

        rows.slice(1).forEach(r => {
            if (r[0]) this.notWords.add(String(r[0]).trim().toLowerCase());

            if (r[1]) {
                this.expenseRules.push({
                    kw: String(r[1]).trim().toLowerCase(),
                    category: r[2] ? String(r[2]).trim() : "nc",
                    title: r[3] ? String(r[3]).trim() : "nc"
                });
            }
            if (r[4]) {
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
        // Fallback intelligenti se sources.xlsx non è ancora caricato
        if (fn.includes("ing")) return "ing";
        if (fn.includes("satispay") || fn.includes("ssp")) return "ssp";
        if (fn.includes("prepagata") || fn.includes("cc2")) return "cc2";
        return "isp"; // default
    }

    cleanText(text) {
        if (!text) return "";
        const words = String(text).toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/);
        return words.filter(w => w && !this.notWords.has(w)).join(' ');
    }

    predict(note, amount) {
        if (!note) return { category: "nc", title: "nc" };
        const cleaned = this.cleanText(note);
        const rules = amount > 0 ? this.incomeRules : this.expenseRules;

        for (let rule of rules) {
            if (cleaned.includes(rule.kw)) {
                return { category: rule.category, title: rule.title };
            }
        }
        return { category: "nc", title: "nc" };
    }
}
