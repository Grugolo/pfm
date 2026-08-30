class BankParser {
    static parseExcel(arrayBuffer, fileName, labeler) {
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        
        // Convertiamo il foglio in matrice di celle grezze per la ricerca flessibile dell'header
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

        if (!rows || rows.length === 0) return [];

        let headerIdx = -1;
        let dateColIdx = -1, amtColIdx = -1, descColIdx = -1, incColIdx = -1, expColIdx = -1;

        // Scansione per trovare la riga d'intestazione corretta
        for (let i = 0; i < Math.min(rows.length, 25); i++) {
            const row = rows[i];
            if (!row || !Array.isArray(row)) continue;

            const rowStr = row.map(c => String(c).toUpperCase()).join(' ');

            if (rowStr.includes('DATA') || rowStr.includes('DATE')) {
                headerIdx = i;
                row.forEach((cell, colIdx) => {
                    const h = String(cell).toUpperCase().trim();
                    if (h.includes('DATA') || h.includes('DATE')) dateColIdx = colIdx;
                    else if (h.includes('IMPORTO') || h.includes('AMOUNT')) amtColIdx = colIdx;
                    else if (h.includes('ENTRATE') || h.includes('ACCREDITI')) incColIdx = colIdx;
                    else if (h.includes('USCITE') || h.includes('ADDEBITI')) expColIdx = colIdx;
                    else if (h.includes('CAUSALE') || h.includes('DESCRIZIONE') || h.includes('DETTAGLI') || h.includes('OPERAZIONE') || h.includes('MOTIVO')) {
                        if (descColIdx === -1) descColIdx = colIdx;
                    }
                });
                if (dateColIdx !== -1) break;
            }
        }

        if (headerIdx === -1 || dateColIdx === -1) return [];

        const account = labeler.detectAccount(fileName);
        const records = [];

        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row[dateColIdx]) continue;

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

            let note = descColIdx !== -1 && row[descColIdx] ? String(row[descColIdx]).trim() : "";
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
        if (typeof val === 'number') return val;

        let str = String(val).replace(/[^0-9\,\.\-]/g, '').trim();
        if (!str) return 0.0;

        if (str.includes(',') && str.includes('.')) {
            str = str.replace(/\./g, '').replace(',', '.');
        } else if (str.includes(',')) {
            str = str.replace(',', '.');
        }

        return parseFloat(str) || 0.0;
    }

    static formatISODate(val) {
        if (!val) return null;
        if (val instanceof Date) {
            return val.toISOString().split('T')[0];
        }
        const str = String(val).trim();
        // Gestione dd/mm/yyyy o dd-mm-yyyy
        const parts = str.split(/[\/\-\.]/);
        if (parts.length === 3) {
            if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    }
}
