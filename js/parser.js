class BankParser {
    static parseExcel(arrayBuffer, fileName, labeler) {
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

        let headerIdx = -1;
        for (let i = 0; i < rows.length; i++) {
            const rowStr = rows[i].map(c => String(c).toUpperCase()).join(' ');
            if (rowStr.includes('DATA') || rowStr.includes('DATE') || rowStr.includes('IMPORTO')) {
                headerIdx = i;
                break;
            }
        }

        if (headerIdx === -1) return [];

        const headers = rows[headerIdx].map(h => String(h).trim().toUpperCase());
        const records = [];

        const dateColIdx = headers.findIndex(h => h.includes('DATA') || h.includes('DATE'));
        const amtColIdx = headers.findIndex(h => h.includes('IMPORTO') || h.includes('ADDEBITI') || h.includes('ACCREDITI'));
        const descColIdx = headers.findIndex(h => h.includes('CAUSALE') || h.includes('DESCRIZIONE') || h.includes('DETTAGLI') || h.includes('OPERAZIONE'));

        let account = "isp";
        const fn = fileName.toLowerCase();
        if (fn.includes("ing")) account = "ing";
        else if (fn.includes("satispay")) account = "ssp";
        else if (fn.includes("prepagata")) account = "cc2";

        for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row[dateColIdx]) continue;

            const rawDate = row[dateColIdx];
            const dateStr = BankParser.formatISODate(rawDate);
            if (!dateStr) continue;

            let amount = BankParser.parseAmount(row[amtColIdx]);
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
        if (!val) return 0.0;
        if (typeof val === 'number') return val;
        let str = String(val).replace('€', '').trim();
        if (str.includes(',') && str.includes('.')) str = str.replace('.', '').replace(',', '.');
        else if (str.includes(',')) str = str.replace(',', '.');
        return parseFloat(str) || 0.0;
    }

    static formatISODate(val) {
        if (!val) return null;
        const d = new Date(val);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
    }
}
