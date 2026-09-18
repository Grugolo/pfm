
# pfm
Personal Finance Manager

## Code Structure

```
main

├── index.html
├── css/
│   └── style.css
└── js/
    ├── app.js
    ├── db.js
    ├── parser.js
    ├── labeler.js
    └── exporter.js
```


## How it works

Reach out the website at www.grugolo.github.io/pfm and import your financial files (excel reports or complete sql database) tapping on 📂. 

### Import data
Imported files must contains data fields according to a file "sus.xlsx" to be imported via the settings tab (⚙️). In cells A2:E999 of "sus.xlsx", you should have inserted how each one of the following fields (cells A1:E1):
- • Account Name
- • Account ID
- • Amount Column
- • Date Column
- • Description Columns

is named in your financial files. 

Expenses and incomes will be auto-labeled according to a "sus. xlsx" file to be submitted via the same settings tab. In "sus.xlsx" you should write: 
- • a list of words to be excluded from parsing (A2:A999) 
- • a list of keyword, category, expense type (B2:B999, C2:C999, D2:D999)
- • a list of keyword, category, income type (E2:E999, F2:F999, G2:G999)

### View data
Besides settings, import, and export tabs, you'll have two main pages: 
- • Transazioni
- • Audit Log

In the former you are able to view and filter all the data, while in the other one a log of anything happened about the database is shown.
You can tap to the + putton at the bottom-right of the screen to manually insert a new record of data.

### Export data
You can tap on 💾 to export data as. xlsx, .csv, or .db



## Aggiornamenti al sistema di labeling (2026)

**Formato regole `sus.xlsx`** (colonna kw uscite/entrate) ora supporta:
- `conad|esselunga|carrefour` → OR, matcha una qualsiasi alternativa
- `amazon&prime` → AND, devono comparire entrambi i termini
- `re:^netflix` → regex esplicita
- Match sempre su **parola intera** (word-boundary), non più substring grezzo:
  evita falsi positivi tipo "bar" dentro "barbiere".
- A parità di match multipli vince la regola più **specifica** (keyword più
  lunga / più termini AND), indipendentemente dall'ordine delle righe nel file.

**Import bancario**: ora supporta anche **.csv/.txt** oltre a .xlsx/.xls, con
autodetect del delimitatore (`; , tab |`) e dell'encoding. L'header viene
cercato nelle prime 40 righe scegliendo quella con il punteggio migliore
(più colonne riconosciute), non più la prima che matcha genericamente.

Nel modale ⚙️ Impostazioni è disponibile "🔄 Rietichetta transazioni esistenti"
per riapplicare le regole aggiornate senza dover ricaricare i file bancari.
