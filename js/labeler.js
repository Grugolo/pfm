
/**
 * AutoLabeler
 * ------------------------------------------------------------------
 * Sistema di etichettatura automatica basato su keyword.
 *
 * Formato file sus.xlsx (colonne, riga 1 = header, ignorata):
 *   A: notWords            -> parole/rumore da ripulire dalla nota prima del match
 *   B: kw uscite            C: categoria uscite     D: titolo uscite
 *   E: kw entrate            F: categoria entrate    G: titolo entrate
 *
 * Sintassi avanzata supportata in ogni cella "kw":
 *   - Più varianti alternative separate da "|"        es:  conad|esselunga|carrefour
 *   - Più termini che devono comparire TUTTI (AND) separati da "&"  es: amazon&prime
 *   - Prefisso "re:" per regex esplicita               es:  re:^bonif.*stipendio
 *   - Il match è sempre case-insensitive e per default su "parola intera"
 *     (bordi di parola), non su semplice substring: evita che "ikea" nella
 *     nota "chimica" o "bar" dentro "barbiere" scattino per errore.
 *
 * Priorità: a parità di più regole che matchano, vince quella più
 * "specifica" (keyword più lunga / con più termini AND), non la prima
 * trovata nel file. Questo rende l'ordine delle righe nel file irrilevante
 * e riduce drasticamente i mismatch dovuti a keyword generiche piazzate
 * per prime.
 */

class AutoLabeler {
    constructor() {
        this.notWords = new Set();
        this.expenseRules = [];
        this.incomeRules = [];
        this.accountMappings = [];
    }

    /* ============================= CARICAMENTO REGOLE ============================= */

    loadSusFromWorkbook(wb) {
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

        this.expenseRules = [];
        this.incomeRules = [];
        this.notWords.clear();

        rows.slice(1).forEach(r => {
            if (!r) return;

            // Colonna 0: notWords
            if (r[0] !== undefined && r[0] !== null && String(r[0]).trim() !== '') {
                this.notWords.add(String(r[0]).trim().toLowerCase());
            }

            // Colonne 1,2,3: regole di spesa (uscite)
            const expRule = this._buildRule(r[1], r[2], r[3]);
            if (expRule) this.expenseRules.push(expRule);

            // Colonne 4,5,6: regole di entrata
            const incRule = this._buildRule(r[4], r[5], r[6]);
            if (incRule) this.incomeRules.push(incRule);
        });

        // Ordina per specificità decrescente: le regole più "forti" vengono
        // valutate per prime, ma il predict() comunque sceglie sempre il
        // miglior match assoluto, quindi l'ordine qui serve solo come
        // ottimizzazione/leggibilità in fase di debug.
        this.expenseRules.sort((a, b) => b.specificity - a.specificity);
        this.incomeRules.sort((a, b) => b.specificity - a.specificity);
    }

    _buildRule(kwRaw, categoryRaw, titleRaw) {
        if (kwRaw === undefined || kwRaw === null || String(kwRaw).trim() === '') return null;

        const kwStr = String(kwRaw).trim();
        const category = categoryRaw ? String(categoryRaw).trim() : "nc";
        const title = titleRaw ? String(titleRaw).trim() : "nc";

        // Regex esplicita: "re:pattern"
        if (/^re:/i.test(kwStr)) {
            const pattern = kwStr.replace(/^re:/i, '');
            let regex;
            try {
                regex = new RegExp(pattern, 'i');
            } catch (e) {
                console.warn(`Regola regex non valida ignorata: "${kwStr}"`, e);
                return null;
            }
            return {
                raw: kwStr,
                type: 'regex',
                regex,
                category,
                title,
                specificity: pattern.length + 1000 // le regex esplicite vincono quasi sempre
            };
        }

        // Gruppi AND separati da "&", ognuno può avere alternative "|"
        const andGroups = kwStr.split('&')
            .map(g => g.trim().toLowerCase())
            .filter(g => g.length > 0);

        if (andGroups.length === 0) return null;

        const groups = andGroups.map(g => g.split('|').map(t => t.trim()).filter(t => t.length > 0));
        if (groups.some(g => g.length === 0)) return null;

        // Specificità: somma delle lunghezze dei termini minimi di ogni
        // gruppo AND (worst case) + bonus per numero di gruppi (AND multipli
        // sono intrinsecamente più specifici di un singolo termine).
        const minLenPerGroup = groups.map(g => Math.min(...g.map(t => t.length)));
        const specificity = minLenPerGroup.reduce((a, b) => a + b, 0) + (groups.length - 1) * 5;

        return {
            raw: kwStr,
            type: 'keyword',
            groups, // array di array di alternative; tutte le entry devono matchare (AND tra gruppi, OR dentro il gruppo)
            category,
            title,
            specificity
        };
    }

    loadSourcesFromWorkbook(wb) {
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

        this.accountMappings = [];
        rows.slice(1).forEach(r => {
            if (r && r[0] && r[1]) {
                this.accountMappings.push({
                    keyword: String(r[0]).trim().toLowerCase(),
                    accountCode: String(r[1]).trim().toLowerCase()
                });
            }
        });
        // Anche qui: keyword più lunghe/specifiche valutate per prime
        this.accountMappings.sort((a, b) => b.keyword.length - a.keyword.length);
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

    /* ============================= PULIZIA TESTO ============================= */

    // Escape per uso sicuro in regex
    static _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Rimuove le notWords come parole intere (non substring), per evitare di
    // "mangiare" pezzi di altre parole (es. la notWord "sdd" non deve
    // spezzare "carte credito sdd amazon" in modo da rovinare "amazon").
    cleanText(text) {
        if (!text) return "";
        let cleaned = String(text).toLowerCase();

        if (this.notWords.size > 0) {
            const escaped = Array.from(this.notWords)
                .filter(w => w)
                .sort((a, b) => b.length - a.length) // le più lunghe prima
                .map(AutoLabeler._escapeRegex);
            if (escaped.length > 0) {
                const regex = new RegExp('\\b(?:' + escaped.join('|') + ')\\b', 'gi');
                cleaned = cleaned.replace(regex, ' ');
            }
        }

        return cleaned.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    }

    /* ============================= MATCHING ============================= */

    // Verifica se "term" compare come parola intera (o sequenza di parole
    // intere, per termini multi-parola come "carta credito") dentro "text".
    static _wordMatch(text, term) {
        if (!term) return false;
        const escaped = AutoLabeler._escapeRegex(term.trim());
        if (!escaped) return false;
        // \b funziona bene anche per termini multi-parola con spazi interni
        const regex = new RegExp('\\b' + escaped.replace(/\s+/g, '\\s+') + '\\b', 'i');
        return regex.test(text);
    }

    // Ritorna true se la regola matcha il testo pulito
    static _ruleMatches(rule, cleanedNote) {
        if (rule.type === 'regex') {
            return rule.regex.test(cleanedNote);
        }
        // Tutti i gruppi AND devono avere almeno un'alternativa OR presente
        return rule.groups.every(group =>
            group.some(term => AutoLabeler._wordMatch(cleanedNote, term))
        );
    }

    /**
     * Predice categoria/titolo per una transazione.
     * @param {string} note   - descrizione/causale grezza
     * @param {number} amount - importo (>0 entrata, <0 uscita)
     * @returns {{category:string, title:string, matchedRule?:string}}
     */
    predict(note, amount) {
        if (!note) return { category: "nc", title: "nc" };

        const cleanedNote = this.cleanText(note);
        if (!cleanedNote) return { category: "nc", title: "nc" };

        const rules = amount > 0 ? this.incomeRules : this.expenseRules;

        let best = null;
        for (let rule of rules) {
            if (AutoLabeler._ruleMatches(rule, cleanedNote)) {
                if (!best || rule.specificity > best.specificity) {
                    best = rule;
                }
            }
        }

        if (best) {
            return { category: best.category, title: best.title, matchedRule: best.raw };
        }
        return { category: "nc", title: "nc" };
    }
}
