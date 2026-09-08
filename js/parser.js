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

        // 1) Cerca le intestazioni scorrendo le prime righe del file (potrebbe non essere la prima riga)
        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            const row = rows[i];
            if (!row || !Array.isArray(row)) continue;

            let foundDate = false;
            row.forEach((cell, colIdx) => {
                if (cell === null || cell === undefined) return;
                const h = String(cell).toUpperCase().trim();
                
                if (targetDateCols.some(dc => h === dc || h.includes(dc))) {
                    if (!dateColIndices.includes(colIdx)) dateColIndices.push(colIdx);
                    foundDate = true;
                }
                if (targetAmtCols.some(ac => h === ac || h.includes(ac))) {
                    if (!amtColIndices.includes(colIdx)) amtColIndices.push(colIdx);
                }
                if (targetDescCols.some(dc => h === dc || h.includes(dc))) {
                    if (!descColIndices.includes(colIdx)) descColIndices.push(colIdx);
                }
            });

            if (foundDate) {
                headerIdx = i;
                break;
            }
        }

        if (headerIdx === -1) headerIdx = 0; // Fallback alla riga 0

        const records = [];
        // 2) Prende i dati a partire dalla riga sotto l'intestazione individuata
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;

            // Se sono presenti più campi per la data, calcola e prende la minore (più antecedente)
            let validDates = [];
            const colsToSearchDate = dateColIndices.length > 0 ? dateColIndices : [0];
            colsToSearchDate.forEach(cIdx => {
                const parsedIso = BankParser.formatISODate(row[cIdx]);
                if (parsedIso) validDates.push(parsedIso);
            });

            if (validDates.length === 0) continue;
            validDates.sort(); // Ordinamento alfabetico/cronologico crescente: la prima è la minore
            const dateStr = validDates[0];

            let amount = 0;
            const colsToSearchAmt = amtColIndices.length > 0 ? amtColIndices : row.map((_, idx) => idx);
            for (let cIdx of colsToSearchAmt) {
                const val = BankParser.parseAmount(row[cIdx]);
                if (val !== 0) { amount = val; break; }
            }

            if (amount === 0) continue;

            // Concatenazione dei campi descrizione unendoli con uno spazio
            let descParts = [];
            const colsToSearchDesc = descColIndices.length > 0 ? descColIndices : row.map((_, idx) => idx);
            colsToSearchDesc.forEach(colIdx => {
                if (row[colIdx] !== undefined && row[colIdx] !== null) {
                    const val = String(row[colIdx]).trim();
                    if (val && !descParts.includes(val) && isNaN(val)) {
                        descParts.push(val);
                    }
                }
            });
            let note = descParts.join(' '); // Uniti con uno spazio

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
