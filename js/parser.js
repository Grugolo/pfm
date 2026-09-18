
/**
 * BankParser
 * ------------------------------------------------------------------
 * Parsing dei tracciati bancari (.xlsx, .xls, .csv) con intestazione
 * in posizione variabile (le banche spesso mettono intestatario/IBAN/
 * periodo nelle prime righe prima della vera riga di header).
 *
 * Strategia:
 *  1. Normalizza il file in una matrice di righe (array di array) usando
 *     SheetJS sia per Excel che per CSV (delimitatore auto-rilevato).
 *  2. Scansiona le prime N righe cercando quella che più assomiglia a un
 *     header di estratto conto (contiene colonna data + colonna importo,
 *     o colonna data + colonne accrediti/addebiti separate).
 *  3. Da quel punto in poi legge i record, unendo tutte le colonne
 *     descrittive individuate in un unico campo nota.
 */

class BankParser {

    /* ============================= ENTRY POINT ============================= */

    static parseFile(arrayBuffer, fileName, labeler) {
        const fn = fileName.toLowerCase();
        if (fn.endsWith('.csv') || fn.endsWith('.txt')) {
            return BankParser._parseWorkbookBuffer(arrayBuffer, fileName, labeler, true);
        }
        return BankParser._parseWorkbookBuffer(arrayBuffer, fileName, labeler, false);
    }

    // Mantiene compatibilità con chiamate esistenti (xlsx)
    static parseExcel(arrayBuffer, fileName, labeler) {
        return BankParser._parseWorkbookBuffer(arrayBuffer, fileName, labeler, false);
    }

    static _parseWorkbookBuffer(arrayBuffer, fileName, labeler, isCsv) {
        let rows;

        if (isCsv) {
            // Parsing CSV manuale: evita che SheetJS reinterpreti come
            // numeri/date i campi testuali (es. "-10,00" -> -1000, oppure
            // "01/01/2026" -> numero seriale), cosa che accade quando si usa
            // XLSX.read con type:'string' perché raw:false viene ignorato
            // in quella modalità.
            const text = BankParser._decodeText(arrayBuffer);
            const delimiter = BankParser._detectDelimiter(text);
            rows = BankParser._parseCsvText(text, delimiter);
        } else {
            const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: null });
        }

        if (!rows || rows.length === 0) return [];

        const headerInfo = BankParser._detectHeader(rows);
        if (!headerInfo) return [];

        const { headerIdx, dateColIdx, amtColIdx, incColIdx, expColIdx, descColIndices, signColIdx } = headerInfo;

        const account = labeler.detectAccount(fileName);
        const records = [];
        const seen = new Set(); // dedup interno al file (stesso file caricato con righe duplicate)

        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !Array.isArray(row)) continue;
            if (row[dateColIdx] === undefined || row[dateColIdx] === null || String(row[dateColIdx]).trim() === '') continue;

            const dateStr = BankParser.formatISODate(row[dateColIdx]);
            if (!dateStr) continue;

            let amount = 0;
            if (amtColIdx !== -1 && row[amtColIdx] !== undefined && row[amtColIdx] !== null && String(row[amtColIdx]).trim() !== '') {
                amount = BankParser.parseAmount(row[amtColIdx]);
                // Alcune banche esportano sempre importi positivi con una
                // colonna separata "Dare/Avere" o "Tipo" che indica il segno
                if (signColIdx !== -1 && row[signColIdx]) {
                    const signVal = String(row[signColIdx]).toUpperCase().trim();
                    const isDebit = /^(D|DARE|USCITA|ADDEBIT|DEBIT)/.test(signVal);
                    const isCredit = /^(A|AVERE|ENTRATA|ACCREDIT|CREDIT)/.test(signVal);
                    if (isDebit) amount = -Math.abs(amount);
                    else if (isCredit) amount = Math.abs(amount);
                }
            } else {
                const inc = incColIdx !== -1 ? BankParser.parseAmount(row[incColIdx]) : 0;
                const exp = expColIdx !== -1 ? BankParser.parseAmount(row[expColIdx]) : 0;
                if (inc === 0 && exp === 0) continue;
                amount = inc !== 0 ? Math.abs(inc) : -Math.abs(exp);
            }

            if (amount === 0 || isNaN(amount)) continue;

            // Unisci il contenuto di tutte le colonne descrittive trovate
            let noteParts = [];
            descColIndices.forEach(colIdx => {
                if (row[colIdx] !== undefined && row[colIdx] !== null) {
                    const val = String(row[colIdx]).trim();
                    if (val && !noteParts.includes(val)) noteParts.push(val);
                }
            });
            let note = noteParts.join(' - ');

            const predicted = labeler.predict(note, amount);

            const dedupKey = `${dateStr}|${amount}|${note}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            records.push({
                date_str: dateStr,
                amount: amount,
                category: predicted.category,
                title: predicted.title,
                note: note,
                account: account
            });
        }
        return records;
    }

    /* ============================= HEADER DETECTION ============================= */

    static _detectHeader(rows) {
        const DATE_HINTS = ['DATA CONTABILE', 'DATA VALUTA', 'DATA OPERAZIONE', 'DATA REGISTRAZIONE', 'DATA', 'DATE', 'TIMESTAMP', 'TIME'];
        const AMOUNT_EXACT = ['IMPORTO', 'AMOUNT', 'VALORE', 'IMPORTO EUR', 'IMPORTO (EUR)', 'IMPORTO €'];
        const INCOME_HINTS = ['ACCREDITI', 'ACCREDITO', 'ENTRATE', 'ENTRATA', 'AVERE', 'CREDIT', 'CREDITO'];
        const EXPENSE_HINTS = ['ADDEBITI', 'ADDEBITO', 'USCITE', 'USCITA', 'DARE', 'DEBIT', 'DEBITO'];
        const DESC_HINTS = ['CAUSALE', 'DESCRIZIONE', 'DESCRIZIONE OPERAZIONE', 'DETTAGLIO', 'COUNTERPARTY', 'NAME', 'NOME', 'BENEFICIARIO', 'ORDINANTE', 'EXTRA', 'SUBJECT', 'NOTE', 'MEMO', 'TIPO OPERAZIONE'];
        const SIGN_HINTS = ['DARE/AVERE', 'DARE AVERE', 'TIPO', 'SEGNO', 'D/A'];

        const maxScan = Math.min(rows.length, 40);
        let best = null;

        for (let i = 0; i < maxScan; i++) {
            const row = rows[i];
            if (!row || !Array.isArray(row)) continue;

            let foundDate = -1, foundAmt = -1, foundInc = -1, foundExp = -1, foundSign = -1;
            let tempDescCols = [];
            let nonEmptyCells = 0;

            row.forEach((cell, colIdx) => {
                if (cell === null || cell === undefined) return;
                const raw = String(cell).trim();
                if (!raw) return;
                nonEmptyCells++;
                const h = raw.toUpperCase();

                if (foundDate === -1 && DATE_HINTS.some(k => h.includes(k))) foundDate = colIdx;
                if (foundAmt === -1 && AMOUNT_EXACT.some(k => h === k || h.includes(k))) foundAmt = colIdx;
                if (foundInc === -1 && INCOME_HINTS.some(k => h.includes(k))) foundInc = colIdx;
                if (foundExp === -1 && EXPENSE_HINTS.some(k => h.includes(k))) foundExp = colIdx;
                if (foundSign === -1 && SIGN_HINTS.some(k => h.includes(k))) foundSign = colIdx;
                if (DESC_HINTS.some(k => h.includes(k))) tempDescCols.push(colIdx);
            });

            // Una riga è considerata "header" solo se ha almeno data + (importo
            // oppure sia accrediti che addebiti) E un minimo di celle non
            // vuote (evita di scambiare una riga isolata tipo "Saldo: 100"
            // per header).
            const hasAmountInfo = foundAmt !== -1 || (foundInc !== -1 && foundExp !== -1) || foundInc !== -1 || foundExp !== -1;
            if (foundDate !== -1 && hasAmountInfo && nonEmptyCells >= 2) {
                // Punteggio: preferiamo header con più colonne riconosciute
                // e con colonne descrittive individuate
                const score = (foundAmt !== -1 ? 2 : 0) + (foundInc !== -1 ? 1 : 0) + (foundExp !== -1 ? 1 : 0) + tempDescCols.length;

                if (!best || score > best.score) {
                    best = {
                        headerIdx: i,
                        dateColIdx: foundDate,
                        amtColIdx: foundAmt,
                        incColIdx: foundInc,
                        expColIdx: foundExp,
                        signColIdx: foundSign,
                        descColIndices: tempDescCols,
                        score
                    };
                }

                // Se troviamo un header "forte" (importo unico + descrizione),
                // ci fermiamo subito: è quasi certamente quello giusto e le
                // righe successive potrebbero generare falsi positivi sui dati.
                if (foundAmt !== -1 && tempDescCols.length > 0) break;
            }
        }

        if (!best || best.dateColIdx === -1) return null;
        // Se non abbiamo trovato colonne descrittive esplicite, prova a
        // recuperare qualunque colonna testuale rimasta libera come nota.
        if (best.descColIndices.length === 0) {
            const headerRow = rows[best.headerIdx] || [];
            const used = new Set([best.dateColIdx, best.amtColIdx, best.incColIdx, best.expColIdx, best.signColIdx]);
            headerRow.forEach((cell, colIdx) => {
                if (used.has(colIdx)) return;
                if (cell !== null && cell !== undefined && String(cell).trim() !== '') {
                    best.descColIndices.push(colIdx);
                }
            });
        }

        return best;
    }

    /* ============================= CSV HELPERS ============================= */

    // Parser CSV manuale (gestisce campi quotati "...") che mantiene tutti i
    // valori come stringhe grezze, così il resto della pipeline (parseAmount,
    // formatISODate) li interpreta esattamente come farebbe con l'xlsx.
    static _parseCsvText(text, delimiter) {
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        const rows = [];

        lines.forEach(line => {
            const row = [];
            let field = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (inQuotes) {
                    if (c === '"') {
                        if (line[i + 1] === '"') { field += '"'; i++; }
                        else inQuotes = false;
                    } else {
                        field += c;
                    }
                } else {
                    if (c === '"') {
                        inQuotes = true;
                    } else if (c === delimiter) {
                        row.push(field.trim());
                        field = '';
                    } else {
                        field += c;
                    }
                }
            }
            row.push(field.trim());
            rows.push(row);
        });

        return rows;
    }

    static _decodeText(arrayBuffer) {
        // Prova UTF-8, poi fallback latin1 (comune negli export bancari IT)
        try {
            const decoder = new TextDecoder('utf-8', { fatal: true });
            return decoder.decode(arrayBuffer);
        } catch (e) {
            const decoder = new TextDecoder('iso-8859-1');
            return decoder.decode(arrayBuffer);
        }
    }

    static _detectDelimiter(text) {
        const sampleLines = text.split(/\r?\n/).slice(0, 10).filter(l => l.trim() !== '');
        const candidates = [';', ',', '\t', '|'];
        let bestDelim = ';';
        let bestScore = -1;

        candidates.forEach(delim => {
            const counts = sampleLines.map(l => l.split(delim).length);
            if (counts.length === 0) return;
            const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
            // Preferisce delimitatori che danno un numero consistente e > 1
            // di colonne su tutte le righe campione
            const consistent = counts.every(c => c === counts[0]) && counts[0] > 1;
            const score = (consistent ? 1000 : 0) + avg;
            if (score > bestScore) {
                bestScore = score;
                bestDelim = delim;
            }
        });

        return bestDelim;
    }

    /* ============================= PARSING VALORI ============================= */

    static parseAmount(val) {
        if (val === undefined || val === null || val === '') return 0.0;
        if (typeof val === 'number') return isNaN(val) ? 0.0 : val;

        let str = String(val).trim();
        if (!str) return 0.0;

        // Rileva segno negativo espresso come "(123,45)" (contabile)
        let negativeParens = false;
        if (/^\(.*\)$/.test(str)) {
            negativeParens = true;
            str = str.slice(1, -1);
        }

        str = str.replace(/[^0-9,.\-]/g, '').trim();
        if (!str) return 0.0;

        if (str.includes(',') && str.includes('.')) {
            // Es: "1.234,56" -> "1234.56"  oppure "1,234.56" -> "1234.56"
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                str = str.replace(/,/g, '');
            }
        } else if (str.includes(',')) {
            // Se la virgola è seguita da esattamente 3 cifre e non ce ne
            // sono altre, è quasi certamente un separatore delle migliaia
            // in stile anglosassone (es. "1,234"); altrimenti è decimale.
            const parts = str.split(',');
            if (parts.length === 2 && parts[1].length === 3 && !str.includes('.')) {
                str = str.replace(',', '');
            } else {
                str = str.replace(',', '.');
            }
        }

        let n = parseFloat(str);
        if (isNaN(n)) return 0.0;
        if (negativeParens) n = -Math.abs(n);
        return n;
    }

    static formatISODate(val) {
        if (!val) return null;
        if (val instanceof Date) {
            if (isNaN(val.getTime())) return null;
            const yyyy = val.getFullYear();
            const mm = String(val.getMonth() + 1).padStart(2, '0');
            const dd = String(val.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        const str = String(val).trim();

        // Formato numerico seriale Excel (es. 45123)
        if (/^\d+(\.\d+)?$/.test(str) && Number(str) > 20000 && Number(str) < 80000) {
            const d = XLSX.SSF ? XLSX.SSF.parse_date_code(Number(str)) : null;
            if (d && d.y) {
                const yyyy = d.y;
                const mm = String(d.m).padStart(2, '0');
                const dd = String(d.d).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }
        }

        // Gestione formati GG/MM/AAAA, AAAA-MM-GG, GG.MM.AAAA, con eventuale
        // orario a seguire (che viene ignorato ai fini della sola data)
        const datePart = str.split(/[ T]/)[0];
        const parts = datePart.split(/[\/\-.]/);
        if (parts.length >= 3) {
            let year, month, day;
            if (parts[0].length === 4) { // YYYY-MM-DD
                year = parts[0];
                month = parts[1].padStart(2, '0');
                day = parts[2].padStart(2, '0');
            } else if (parts[2].length === 4) { // DD-MM-YYYY
                day = parts[0].padStart(2, '0');
                month = parts[1].padStart(2, '0');
                year = parts[2];
            } else if (parts[2].length === 2) { // DD-MM-YY
                day = parts[0].padStart(2, '0');
                month = parts[1].padStart(2, '0');
                const yy = parseInt(parts[2], 10);
                year = String(yy < 70 ? 2000 + yy : 1900 + yy);
            }

            if (year && month && day) {
                const y = parseInt(year, 10), m = parseInt(month, 10), d = parseInt(day, 10);
                if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                    return `${year}-${month}-${day}`;
                }
            }
        }

        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        return null;
    }
}
