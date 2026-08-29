class Exporter {
    static exportCSV(transactions) {
        let csvContent = "Date\tAmount\tCategory\tTitle\tNote\tAccount\n";
        transactions.forEach(t => {
            csvContent += `${t.date_str}\t${t.amount}\t${t.category}\t${t.title}\t${t.note}\t${t.account}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        Exporter.downloadBlob(blob, 'merged_transactions.csv');
    }

    static exportXLSX(transactions) {
        const wsData = [["Date", "Amount", "Category", "Title", "Note", "Account"]];
        transactions.forEach(t => wsData.push([t.date_str, t.amount, t.category, t.title, t.note, t.account]));

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Transactions");

        XLSX.writeFile(wb, "merged_transactions.xlsx");
    }

    static downloadBlob(blob, fileName) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
    }
}
