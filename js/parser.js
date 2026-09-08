class BankParser {
    static parseExcel(arrayBuffer, fileName, labeler) {
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

        if (!rows || rows.length === 0) return [];

        const sourceConfig = labeler.getSourceConfig(fileName);
        const account = sourceConfig.accountCode;

        let headerIdx = -1;
        let dateColIndices = [];
        let amtColIndices = [];
        let descColIndices = [];

        const targetDateCols = (sourceConfig.dateCol || 'Data').toUpperCase().split(',').map(s => s.trim());
        const targetAmtCols = (sourceConfig.amountCol || 'Importo').toUpperCase().split(',').map(s => s.trim());
        const targetDescCols = (sourceConfig.descCols || 'Descrizione').toUpperCase().split(',').map(s => s.trim());

        // 1) Cerca dinamicamente le intestazioni (come find_header_row in python)
        const commonHeaders = ["DATA", "DATA CONTABILE", "DATA VALUTA", "DATE", "IMPORTO IN EURO", "IMPORTO", "AMOUNT"];
        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            const row = rows[i];
            if (!row || !Array.isArray(row)) continue;

            const rowUpper = row.map(c => c ? String(c).toUpperCase().trim() : "");
            
            // Verifica se la riga contiene parole chiave tipiche di un header o quelle mappate
            let isHeader = rowUpper.some(c => commonHeaders.includes(c) || targetDateCols.includes(c) || targetAmtCols.includes(c));

            if (isHeader) {
                headerIdx = i;
                rowUpper.forEach((h, colIdx) => {
                    if (!h) return;
                    if (targetDateCols.some(dc => h === dc || h.includes(dc))) dateColIndices.push(colIdx);
                    if (targetAmtCols.some(ac => h === ac || h.includes(ac))) amtColIndices.push(colIdx);
                    if (targetDescCols.some(dc => h === dc || h.includes(dc))) descColIndices.push(colIdx);
                });
                break;
            }
        }

        if (headerIdx === -1) headerIdx = 0; // Fallback se non lo trova

        const records = [];
        
        // 2) Partiamo a ciclare ESATTAMENTE dalla riga sotto l'intestazione
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;

            // 3) Prendi la DATA MINORE (più vecchia) se ci sono più colonne (come min(valid_dates) in Python)
            let validDates = [];
            const colsToSearchDate = dateColIndices.length > 0 ? dateColIndices : [0];
            colsToSearchDate.forEach(cIdx => {
                const parsedIso = BankParser.formatISODate(row[cIdx]);
                if (parsedIso) validDates.push(parsedIso);
            });

            if (validDates.length === 0) continue;
            validDates.sort(); // Stringhe "YYYY-MM-DD" ordinate alfabeticamente portano la minore all'indice 0
            const dateStr = validDates[0];

            let amount = 0;
            const colsToSearchAmt = amtColIndices.length > 0 ? amtColIndices : row.map((_, idx) => idx);
            for (let cIdx of colsToSearchAmt) {
                const val = BankParser.parseAmount(row[cIdx]);
                if (val !== 0) { amount = val; break; }
            }
            if (amount === 0) continue;

            // 4) Concatenazione Descrizione con spazio (" ".join(desc_parts) in Python)
            let descParts = [];
            const colsToSearchDesc = descColIndices.length > 0 ? descColIndices : row.map((_, idx) => idx);
            colsToSearchDesc.forEach(colIdx => {
                if (row[colIdx] !== undefined && row[colIdx] !== null) {
                    const val = String(row[colIdx]).trim();
                    if (val && val !== "NaN") descParts.push(val);
                }
            });
            let descrizione = descParts.join(' '); 

            // Predizione passata dal labeler
            const predicted = labeler.predict(descrizione, amount);

            records.push({
                date_str: dateStr,
                amount: amount,
                category: predicted.category,
                title: predicted.title,
                descrizione: descrizione, // Rinominato da note a descrizione
                account: account
            });
        }
        return records;
    }

    static parseAmount(val) {
        if (val === undefined || val === null || val === '') return 0.0;
        if (typeof val === 'number') return isNaN(val) ? 0.0 : val;
        let str = String(val).replace(/[^0-9\,\.\-]/g, '').trim();
        if (!str) return 0.0;

        if (str.includes(',') && str.includes('.')) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                str = str.replace(/\,/g, '');
            }
        } else if (str.includes(',')) {
            str = str.replace(',', '.');
        }
        return parseFloat(str) || 0.0;
    }

    static formatISODate(val) {
        if (!val) return null;
        if (val instanceof Date) {
            if (isNaN(val.getTime())) return null;
            return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
        }
        const str = String(val).trim();
        const parts = str.split(/[\/\-\.\s]/);
        if (parts.length >= 3) {
            let year, month, day;
            if (parts[0].length === 4) { year = parts[0]; month = parts[1]; day = parts[2]; }
            else if (parts[2].length === 4) { day = parts[0]; month = parts[1]; year = parts[2]; }
            else if (parts[2].length === 2) { day = parts[0]; month = parts[1]; year = '20' + parts[2]; }
            if (year && month && day) {
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
        }
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        return null;
    }
}
