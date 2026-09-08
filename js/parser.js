class BankParser {
    static parseExcel(arrayBuffer, fileName, labeler) {
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

        if (!rows || rows.length === 0) return [];

        const sourceConfig = labeler.getSourceConfig(fileName);
        const account = sourceConfig.accountCode;

        let headerIdx = -1;
        let dateColIdx = -1, amtColIdx = -1;
        let descColIndices = [];

        const targetDateCol = (sourceConfig.dateCol || 'Data').toUpperCase();
        const targetAmtCols = (sourceConfig.amountCol || 'Importo').toUpperCase().split(',').map(s => s.trim());
        const targetDescCols = (sourceConfig.descCols || 'Descrizione').toUpperCase().split(',').map(s => s.trim());

        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            const row = rows[i];
            if (!row || !Array.isArray(row)) continue;

            row.forEach((cell, colIdx) => {
                if (cell === null || cell === undefined) return;
                const h = String(cell).toUpperCase().trim();
                
                if (h === targetDateCol || h.includes(targetDateCol)) dateColIdx = colIdx;
                if (targetAmtCols.includes(h) || targetAmtCols.some(ac => h.includes(ac))) amtColIdx = colIdx;
                if (targetDescCols.some(dc => h.includes(dc))) {
                    if (!descColIndices.includes(colIdx)) descColIndices.push(colIdx);
                }
            });

            if (dateColIdx !== -1) {
                headerIdx = i;
                break;
            }
        }

        if (headerIdx === -1) headerIdx = 0; // Fallback to first row if headers unconfigured

        const records = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;

            const dateVal = dateColIdx !== -1 ? row[dateColIdx] : row[0];
            const dateStr = BankParser.formatISODate(dateVal);
            if (!dateStr) continue;

            let amount = 0;
            if (amtColIdx !== -1 && row[amtColIdx] !== undefined) {
                amount = BankParser.parseAmount(row[amtColIdx]);
            } else {
                // Look for first available numeric amount column fallback
                for (let c = 0; c < row.length; c++) {
                    const val = BankParser.parseAmount(row[c]);
                    if (val !== 0) { amount = val; break; }
                }
            }

            if (amount === 0) continue;

            let noteParts = [];
            const colsToScan = descColIndices.length > 0 ? descColIndices : row.map((_, idx) => idx);
            colsToScan.forEach(colIdx => {
                if (row[colIdx] !== undefined && row[colIdx] !== null) {
                    const val = String(row[colIdx]).trim();
                    if (val && !noteParts.includes(val) && isNaN(val)) noteParts.push(val);
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
