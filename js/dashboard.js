/* ==========================================================
   STATS: regole di calcolo + utilità date (tutto su stringhe YYYY-MM-DD, UTC-safe)
   ========================================================== */
const Stats = {
    /* Regole:
       - amount>0, tipo T  → escluso dalle entrate
       - amount>0, tipo R  → rimborso: NON è entrata, sottrae dalle uscite
       - amount<0, tipo T  → escluso dalle uscite
       - resto: amount>0 entrata, amount<0 uscita */
    flow(t) {
        const ty = String(t.title || '').trim().toUpperCase();
        const a = Number(t.amount) || 0;
        if (a > 0) {
            if (ty === 'T') return { inc: 0, exp: 0 };
            if (ty === 'R') return { inc: 0, exp: -a };
            return { inc: a, exp: 0 };
        }
        if (a < 0) {
            if (ty === 'T') return { inc: 0, exp: 0 };
            return { inc: 0, exp: -a };
        }
        return { inc: 0, exp: 0 };
    },

    toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
    fmt(d) { return d.toISOString().slice(0, 10); },
    addDays(s, n) { const d = this.toDate(s); d.setUTCDate(d.getUTCDate() + n); return this.fmt(d); },
    diffDays(a, b) { return Math.round((this.toDate(b) - this.toDate(a)) / 864e5); },
    addMonths(s, n) { const d = this.toDate(s); return this.fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); },
    monthEnd(s) { const d = this.toDate(s); return this.fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); },
    today() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },
    min(a, b) { return a < b ? a : b; },

    fullPeriod(gran, anchor) {
        if (gran === 'week') {
            const wd = (this.toDate(anchor).getUTCDay() + 6) % 7; // lun=0
            const start = this.addDays(anchor, -wd);
            return { start, end: this.addDays(start, 6) };
        }
        if (gran === 'year') return { start: anchor.slice(0, 4) + '-01-01', end: anchor.slice(0, 4) + '-12-31' };
        const start = anchor.slice(0, 8) + '01';
        return { start, end: this.monthEnd(start) };
    },
    fullEnd(gran, start) {
        if (gran === 'week') return this.addDays(start, 6);
        if (gran === 'year') return start.slice(0, 4) + '-12-31';
        return this.monthEnd(start);
    },
    shiftStart(gran, start, kind) {
        if (gran === 'week') return this.addDays(start, kind === 'prev' ? -7 : -364); // 52 sett. = stesso giorno sett.
        if (gran === 'year') return this.addMonths(start, -12);
        return this.addMonths(start, kind === 'prev' ? -1 : -12);
    },

    /* Periodo corrente (dall'inizio del periodo fino ad anchor) e periodo di confronto.
       lfl = a parità di giorni trascorsi; altrimenti confronto col periodo intero. */
    ranges(gran, anchor, kind, lfl) {
        const cur = this.fullPeriod(gran, anchor);
        const elapsed = this.diffDays(cur.start, anchor) + 1;
        const cs = this.shiftStart(gran, cur.start, kind);
        const cfull = this.fullEnd(gran, cs);
        const ce = lfl ? this.min(cfull, this.addDays(cs, elapsed - 1)) : cfull;
        return {
            cur: { start: cur.start, end: anchor, days: elapsed },
            cmp: { start: cs, end: ce, days: this.diffDays(cs, ce) + 1 }
        };
    },

    sum(txs, r) {
        let inc = 0, exp = 0;
        for (const t of txs) {
            if (t.date_str < r.start || t.date_str > r.end) continue;
            const f = this.flow(t); inc += f.inc; exp += f.exp;
        }
        return { inc, exp, net: inc - exp, burn: exp / Math.max(1, r.days) };
    },

    monthsList(anchor, n, txs) {
        const end = anchor.slice(0, 7);
        let startM;
        if (n === 'all') {
            const first = txs.reduce((m, t) => (t.date_str < m ? t.date_str : m), anchor);
            startM = first.slice(0, 7);
        } else {
            startM = this.addMonths(end + '-01', -(parseInt(n) - 1)).slice(0, 7);
        }
        const out = [];
        let cur = startM + '-01';
        while (cur.slice(0, 7) <= end) { out.push(cur.slice(0, 7)); cur = this.addMonths(cur, 1); }
        return out;
    }
};

/* ==========================================================
   DASHBOARD UI
   ========================================================== */
class Dashboard {
    constructor(dbMgr) {
        this.dbMgr = dbMgr;
        this.KEY = 'finance_app_dash_v1';
        this.state = {
            gran: 'month', anchor: '', account: '', lfl: true, hmMonths: '12',
            show: { kpi: true, compare: true, cmpPrev: true, cmpYear: true, hmWeekday: true, hmCat: true, trend: true, topcat: true }
        };
        this.WIDGETS = [
            ['kpi', 'KPI'], ['compare', 'Confronti'], ['cmpPrev', ' ↳ vs periodo prec.'], ['cmpYear', ' ↳ vs anno prima'],
            ['hmWeekday', 'Heatmap giorni sett.'], ['hmCat', 'Heatmap categorie'],
            ['trend', 'Andamento mensile'], ['topcat', 'Top categorie']
        ];
        this.WD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    }

    isActive() { const el = document.getElementById('dashboardTab'); return el && el.classList.contains('active'); }
    refreshIfActive() { if (this.isActive()) this.render(); }

    mount() {
        try {
            const s = JSON.parse(localStorage.getItem(this.KEY) || 'null');
            if (s) { this.state = { ...this.state, ...s, show: { ...this.state.show, ...(s.show || {}) } }; }
        } catch (e) { /* ignora */ }
        const root = document.getElementById('dashboardRoot');
        if (!root) return;
        const st = this.state;
        root.innerHTML = `
            <div class="card dash-controls">
                <div class="dash-row">
                    <label>Periodo
                        <select id="dash_gran" class="table-filter-input" onchange="app.dash.onChange()">
                            <option value="week">Settimana</option>
                            <option value="month">Mese</option>
                            <option value="year">Anno</option>
                        </select>
                    </label>
                    <label>Riferimento
                        <input type="date" id="dash_anchor" class="table-filter-input" onchange="app.dash.onChange()">
                    </label>
                    <label>Account
                        <select id="dash_account" class="table-filter-input" onchange="app.dash.onChange()"><option value="">Tutti</option></select>
                    </label>
                    <label>Heatmap
                        <select id="dash_hm" class="table-filter-input" onchange="app.dash.onChange()">
                            <option value="6">6 mesi</option><option value="12">12 mesi</option>
                            <option value="24">24 mesi</option><option value="all">Tutto</option>
                        </select>
                    </label>
                </div>
                <label class="checkbox-label dash-lfl"><input type="checkbox" id="dash_lfl" onchange="app.dash.onChange()"> Confronta a parità di giorni trascorsi</label>
                <details class="dash-widgets">
                    <summary>🧩 Widget visibili</summary>
                    <div class="dash-widget-grid">
                        ${this.WIDGETS.map(([k, l]) => `<label class="checkbox-label"><input type="checkbox" id="dash_w_${k}" onchange="app.dash.onChange()"> ${l}</label>`).join('')}
                    </div>
                </details>
            </div>
            <div id="dashWidgets"></div>`;
        document.getElementById('dash_gran').value = st.gran;
        document.getElementById('dash_anchor').value = st.anchor || Stats.today();
        document.getElementById('dash_hm').value = st.hmMonths;
        document.getElementById('dash_lfl').checked = st.lfl;
        this.WIDGETS.forEach(([k]) => { document.getElementById('dash_w_' + k).checked = !!st.show[k]; });
    }

    onChange() {
        const st = this.state;
        st.gran = document.getElementById('dash_gran').value;
        st.anchor = document.getElementById('dash_anchor').value || Stats.today();
        st.account = document.getElementById('dash_account').value;
        st.hmMonths = document.getElementById('dash_hm').value;
        st.lfl = document.getElementById('dash_lfl').checked;
        this.WIDGETS.forEach(([k]) => { st.show[k] = document.getElementById('dash_w_' + k).checked; });
        try { localStorage.setItem(this.KEY, JSON.stringify(st)); } catch (e) { /* ignora */ }
        this.render();
    }

    /* ---------- helper formattazione ---------- */
    eur(n, dec = 2) { return '€ ' + n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
    esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    delta(cur, prev, upIsGood) {
        if (!prev) return '<span class="text-muted">–</span>';
        const pct = (cur - prev) / Math.abs(prev) * 100;
        const good = upIsGood ? pct >= 0 : pct <= 0;
        const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '=';
        return `<span class="${good ? 'amount-income' : 'amount-expense'}">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
    }

    /* ---------- render principale ---------- */
    render() {
        const out = document.getElementById('dashWidgets');
        if (!out) return;
        const st = this.state;
        const all = this.dbMgr.getActiveTransactions();

        // popola select account
        const accSel = document.getElementById('dash_account');
        const accs = [...new Set(all.map(t => t.account))].sort();
        accSel.innerHTML = '<option value="">Tutti</option>' + accs.map(a => `<option value="${this.esc(a)}">${this.esc(a.toUpperCase())}</option>`).join('');
        accSel.value = accs.includes(st.account) ? st.account : '';
        st.account = accSel.value;

        const txs = st.account ? all.filter(t => t.account === st.account) : all;
        if (!txs.length) { out.innerHTML = '<div class="card text-muted">Nessun dato. Carica un database o degli estratti conto (📂).</div>'; return; }

        const anchor = st.anchor || Stats.today();
        const s = st.show;
        let html = '';
        if (s.kpi) html += this.kpiHtml(txs, anchor);
        if (s.compare) html += this.compareHtml(txs, anchor);
        if (s.hmWeekday) html += this.heatWeekdayHtml(txs, anchor);
        if (s.hmCat) html += this.heatCategoryHtml(txs, anchor);
        if (s.trend) html += this.trendHtml(txs, anchor);
        if (s.topcat) html += this.topCatHtml(txs, anchor);
        out.innerHTML = html || '<div class="card text-muted">Tutti i widget sono disattivati.</div>';
    }

    periodLabel() { return { week: 'questa settimana', month: 'questo mese', year: 'quest\'anno' }[this.state.gran]; }

    /* ---------- KPI ---------- */
    kpiHtml(txs, anchor) {
        const { cur } = Stats.ranges(this.state.gran, anchor, 'prev', true);
        const r = Stats.sum(txs, cur);
        const balance = txs.reduce((a, t) => a + (Number(t.amount) || 0), 0);
        const card = (t, v, cls = '') => `<div class="stat-card card"><span class="stat-title">${t}</span><span class="stat-value ${cls}">${v}</span></div>`;
        return `
            <div class="dash-title">📌 ${this.periodLabel()} <small>(${cur.start} → ${cur.end}, ${cur.days} gg)</small></div>
            <div class="dash-kpis">
                ${card('Saldo (Σ mov.)', this.eur(balance), balance >= 0 ? 'amount-income' : 'amount-expense')}
                ${card('Entrate', this.eur(r.inc), 'amount-income')}
                ${card('Uscite nette', this.eur(r.exp), 'amount-expense')}
                ${card('Netto', this.eur(r.net), r.net >= 0 ? 'amount-income' : 'amount-expense')}
                ${card('Burn / giorno', this.eur(r.burn))}
                ${card('Burn / mese (proiez.)', this.eur(r.burn * 30.44, 0))}
            </div>`;
    }

    /* ---------- Confronti ---------- */
    compareHtml(txs, anchor) {
        const st = this.state, s = st.show;
        const cols = [];
        if (s.cmpPrev) cols.push({ kind: 'prev', label: { week: 'Sett. prec.', month: 'Mese prec.', year: 'Anno prec.' }[st.gran] });
        if (s.cmpYear && st.gran !== 'year') cols.push({ kind: 'year', label: { week: 'Sett. anno fa', month: 'Mese anno fa' }[st.gran] });
        if (!cols.length) return '';

        const base = Stats.ranges(st.gran, anchor, 'prev', st.lfl);
        const cur = Stats.sum(txs, base.cur);
        const res = cols.map(c => {
            const rg = Stats.ranges(st.gran, anchor, c.kind, st.lfl);
            return { ...c, rg: rg.cmp, v: Stats.sum(txs, rg.cmp) };
        });
        const rows = [
            ['Uscite nette', 'exp', false, v => this.eur(v)],
            ['Burn / giorno', 'burn', false, v => this.eur(v)],
            ['Entrate', 'inc', true, v => this.eur(v)],
            ['Netto', 'net', true, v => this.eur(v)]
        ];
        const head = `<tr><th>Metrica</th><th>Ora</th>${res.map(c => `<th>${c.label}<br><small>${c.rg.start.slice(2)}→${c.rg.end.slice(2)}</small></th><th>Δ</th>`).join('')}</tr>`;
        const body = rows.map(([lbl, k, upGood, f]) =>
            `<tr><td>${lbl}</td><td><strong>${f(cur[k])}</strong></td>${res.map(c => `<td>${f(c.v[k])}</td><td>${this.delta(cur[k], c.v[k], upGood)}</td>`).join('')}</tr>`
        ).join('');
        return `
            <div class="dash-title">⚖️ Confronti <small>${st.lfl ? '(a parità di giorni)' : '(vs periodo intero)'}</small></div>
            <div class="card dash-scroll"><table class="dash-table">${head}${body}</table></div>`;
    }

    /* ---------- Heatmap helper ---------- */
    heatCell(v, max) {
        const val = Math.max(0, v);
        const a = max > 0 ? 0.07 + 0.85 * (val / max) : 0;
        const txt = a > 0.55 ? '#fff' : 'var(--text-main)';
        return `<td class="hm-cell" style="background:rgba(220,38,38,${a.toFixed(2)});color:${txt}">${v ? Math.round(v) : ''}</td>`;
    }
    monthShort(m) { const [y, mm] = m.split('-'); return ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][+mm - 1] + `<br><small>${y.slice(2)}</small>`; }

    heatWeekdayHtml(txs, anchor) {
        const months = Stats.monthsList(anchor, this.state.hmMonths, txs);
        const idx = Object.fromEntries(months.map((m, i) => [m, i]));
        const grid = Array.from({ length: 7 }, () => Array(months.length).fill(0));
        for (const t of txs) {
            const i = idx[t.date_str.slice(0, 7)];
            if (i === undefined) continue;
            const wd = (Stats.toDate(t.date_str).getUTCDay() + 6) % 7;
            grid[wd][i] += Stats.flow(t).exp;
        }
        const max = Math.max(0, ...grid.flat());
        const rows = grid.map((r, d) => `<tr><th class="hm-row">${this.WD[d]}</th>${r.map(v => this.heatCell(v, max)).join('')}<td class="hm-tot">${Math.round(r.reduce((a, b) => a + b, 0))}</td></tr>`).join('');
        return `
            <div class="dash-title">🗓️ Spese per giorno della settimana <small>(€ per mese)</small></div>
            <div class="card dash-scroll"><table class="dash-table hm">
                <tr><th></th>${months.map(m => `<th>${this.monthShort(m)}</th>`).join('')}<th>Tot</th></tr>${rows}</table></div>`;
    }

    heatCategoryHtml(txs, anchor) {
        const months = Stats.monthsList(anchor, this.state.hmMonths, txs);
        const idx = Object.fromEntries(months.map((m, i) => [m, i]));
        const map = {};
        for (const t of txs) {
            const i = idx[t.date_str.slice(0, 7)];
            if (i === undefined) continue;
            const e = Stats.flow(t).exp;
            if (!e) continue;
            const c = t.category || 'nc';
            (map[c] = map[c] || Array(months.length).fill(0))[i] += e;
        }
        const cats = Object.entries(map).map(([c, a]) => [c, a, a.reduce((x, y) => x + y, 0)])
            .filter(x => x[2] > 0).sort((a, b) => b[2] - a[2]).slice(0, 15);
        if (!cats.length) return '';
        const max = Math.max(0, ...cats.flatMap(c => c[1]));
        const rows = cats.map(([c, a, tot]) => `<tr><th class="hm-row">${this.esc(c)}</th>${a.map(v => this.heatCell(v, max)).join('')}<td class="hm-tot">${Math.round(tot)}</td></tr>`).join('');
        return `
            <div class="dash-title">🔥 Spese per categoria <small>(top 15, € netti da rimborsi)</small></div>
            <div class="card dash-scroll"><table class="dash-table hm">
                <tr><th></th>${months.map(m => `<th>${this.monthShort(m)}</th>`).join('')}<th>Tot</th></tr>${rows}</table></div>`;
    }

    /* ---------- Andamento mensile ---------- */
    trendHtml(txs, anchor) {
        const months = Stats.monthsList(anchor, this.state.hmMonths, txs);
        const idx = Object.fromEntries(months.map((m, i) => [m, i]));
        const inc = Array(months.length).fill(0), exp = Array(months.length).fill(0);
        for (const t of txs) {
            const i = idx[t.date_str.slice(0, 7)];
            if (i === undefined) continue;
            const f = Stats.flow(t); inc[i] += f.inc; exp[i] += f.exp;
        }
        const max = Math.max(1, ...inc, ...exp);
        const rows = months.map((m, i) => `
            <div class="trend-row">
                <span class="trend-lbl">${m}</span>
                <div class="trend-bars">
                    <div class="bar bar-inc" style="width:${Math.max(0, inc[i]) / max * 100}%"><span>${Math.round(inc[i])}</span></div>
                    <div class="bar bar-exp" style="width:${Math.max(0, exp[i]) / max * 100}%"><span>${Math.round(exp[i])}</span></div>
                </div>
            </div>`).join('');
        return `<div class="dash-title">📈 Andamento mensile <small>(<span class="amount-income">entrate</span> / <span class="amount-expense">uscite</span>)</small></div><div class="card">${rows}</div>`;
    }

    /* ---------- Top categorie nel periodo ---------- */
    topCatHtml(txs, anchor) {
        const { cur } = Stats.ranges(this.state.gran, anchor, 'prev', true);
        const map = {};
        for (const t of txs) {
            if (t.date_str < cur.start || t.date_str > cur.end) continue;
            const e = Stats.flow(t).exp;
            if (e) map[t.category || 'nc'] = (map[t.category || 'nc'] || 0) + e;
        }
        const list = Object.entries(map).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
        if (!list.length) return '';
        const tot = list.reduce((a, x) => a + x[1], 0), max = list[0][1];
        const rows = list.map(([c, v]) => `
            <div class="trend-row">
                <span class="trend-lbl">${this.esc(c)}</span>
                <div class="trend-bars"><div class="bar bar-exp" style="width:${v / max * 100}%"><span>${Math.round(v)} · ${(v / tot * 100).toFixed(0)}%</span></div></div>
            </div>`).join('');
        return `<div class="dash-title">🏷️ Top categorie ${this.periodLabel()}</div><div class="card">${rows}</div>`;
    }
}
