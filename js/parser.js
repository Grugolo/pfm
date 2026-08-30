class BankParser {
    static parseExcel(arrayBuffer, fileName, labeler) {
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

        if (!rows || rows.length === 0) return [];

        let headerIdx = -1;
        let dateColIdx = -1, amtColIdx = -1, incColIdx = -1, expColIdx = -1;
        let descColIndices = [];

        // Scansione flessibile su 30 righe per trovare l'intestazione
        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            const row = rows[i];
            if (!row || !Array.isArray(row)) continue;

            let tempDescCols = [];
            let foundDate = -1, foundAmt = -1, foundInc = -1, foundExp = -1;

            row.forEach((cell, colIdx) => {
                if (cell === null || cell === undefined) return;
                const h = String(cell).toUpperCase().trim();
                if (!h) return;
                
                // Date recognition
                if (foundDate === -1 && (h.includes('DATA') || h.includes('DATE') || h.includes('TIME') || h.includes('TIMESTAMP'))) {
                    foundDate = colIdx;
                }
                // Amount recognition
                if (h === 'IMPORTO' || h === 'AMOUNT' || h.includes('IMPORTO (') || h === 'VALORE') {
                    foundAmt = colIdx;
                }
                if (h.includes('ACCREDITI') || h.includes('ENTRATE') || h.includes('CREDIT')) foundInc = colIdx;
                if (h.includes('ADDEBITI') || h.includes('USCITE') || h.includes('DEBIT')) foundExp = colIdx;

                // Description recognition (Accorpa più colonne descrittive se presenti)
                if (h.includes('CAUSALE') || h.includes('DESCRIZIONE') || h.includes('COUNTERPARTY') || 
                    h.includes('NAME') || h.includes('NOME') || h.includes('EXTRA') || h.includes('SUBJECT') || h.includes('NOTE')) {
                    tempDescCols.push(colIdx);
                }
            });

            if (foundDate !== -1 && (foundAmt !== -1 || (foundInc !== -1 || foundExp !== -1))) {
                headerIdx = i;
                dateColIdx = foundDate;
                amtColIdx = foundAmt;
                incColIdx = foundInc;
                expColIdx = foundExp;
                descColIndices = tempDescCols;
                break;
            }
        }

        if (headerIdx === -1 || dateColIdx === -1) return [];

        const account = labeler.detectAccount(fileName);
        const records = [];

        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row[dateColIdx] === undefined || row[dateColIdx] === null) continue;

            const dateStr = BankParser.formatISODate(row[dateColIdx]);
            if (!dateStr) continue;

            let amount = 0;
            if (amtColIdx !== -1 && row[amtColIdx] !== undefined) {
                amount = BankParser.parseAmount(row[amtColIdx]);
            } else {
                const inc = incColIdx !== -1 ? BankParser.parseAmount(row[incColIdx]) : 0;
                const exp = expColIdx !== -1 ? BankParser.parseAmount(row[expColIdx]) : 0;
                amount = inc !== 0 ? Math.abs(inc) : -Math.abs(exp);
            }

            if (amount === 0) continue;

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

    static parseAmount(val) {
        if (val === undefined || val === null || val === '') return 0.0;
        if (typeof val === 'number') return isNaN(val) ? 0.0 : val;

        let str = String(val).replace(/[^0-9\,\.\-]/g, '').trim();
        if (!str) return 0.0;

        if (str.includes(',') && str.includes('.')) {
            // Es: "1.234,56" -> "1234.56"
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                str = str.replace(/\./g, '').replace(',', '.');
            } else { // Es: "1,234.56" -> "1234.56"
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
            const yyyy = val.getFullYear();
            const mm = String(val.getMonth() + 1).padStart(2, '0');
            const dd = String(val.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        const str = String(val).trim();
        // Gestione formati GG/MM/AAAA o AAAA-MM-GG
        const parts = str.split(/[\/\-\.\s]/);
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
                year = '20' + parts[2];
            }

            if (year && month && day) {
                return `${year}-${month}-${day}`;
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
