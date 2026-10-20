const ROW_NUMBER_WIDTH = 46;

function colWidth(cols, index) {
    const c = cols[index];
    if (!c) return "200px";
    if (c.key === "index") return "250px";
    if (c.key === "school") return "220px";
    if (c.key === "name") return "200px";
    if (c.key === "email") return "250px";
    if (c.key === "phone") return "150px";
    if (c.key === "registered") return "150px";
    if (c.sub === "Participant") return "200px";
    if (c.sub === "Email") return "250px";
    if (c.sub === "Phone") return "150px";
    return c.width || "200px";
}

class AdminRegsPage {
    constructor() {
        this.data = null;
        this.eventId = "";
        this.schoolKey = "";
        this.query = "";
        this.sel = null;
        this.anchor = null;
        this.dragging = false;
        this.gridRows = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupSelection();
        this.load();
    }

    setupEventListeners() {
        const refresh = document.getElementById("tb-refresh");
        if (refresh) refresh.addEventListener("click", () => this.load(true));

        const search = document.getElementById("tb-search");
        const searchClear = document.getElementById("tb-search-clear");
        if (search) {
            search.addEventListener("input", Utils.debounce((e) => {
                this.query = String(e.target.value || "").trim().toLowerCase();
                if (searchClear) searchClear.hidden = !this.query;
                this.render();
            }, 200));
        }
        if (searchClear) {
            searchClear.addEventListener("click", () => {
                if (search) search.value = "";
                this.query = "";
                searchClear.hidden = true;
                this.render();
            });
        }

        const school = document.getElementById("tb-school");
        if (school) {
            school.addEventListener("click", (e) => {
                e.stopPropagation();
                const menu = document.getElementById("tb-school-menu");
                if (!menu) return;
                const wasOpen = !menu.hidden;
                this.closeMenus();
                if (!wasOpen) menu.hidden = false;
            });
        }

        const schoolMenu = document.getElementById("tb-school-menu");
        if (schoolMenu) {
            schoolMenu.addEventListener("click", (e) => {
                const item = e.target.closest("[data-school]");
                if (!item) return;
                this.schoolKey = item.dataset.school || "";
                this.closeMenus();
                this.renderSchoolFilter();
                this.render();
            });
        }

        const prev = document.getElementById("tabs-prev");
        const next = document.getElementById("tabs-next");
        if (prev) prev.addEventListener("click", () => this.scrollTabs(-240));
        if (next) next.addEventListener("click", () => this.scrollTabs(240));

        this.setupMenu("tb-export", "tb-export-menu", (action, el) => {
            if (action === "csv") this.exportCsv();
            if (action === "tsv") this.copyTsv();
        });
        this.setupMenu("tb-more", "tb-more-menu", (action) => {
            if (action === "print") window.print();
            if (action === "copy") this.copyTsv();
            if (action === "sel") this.copySelection();
            if (action === "reset") this.resetFilters();
        });

        document.addEventListener("click", (e) => {
            if (!e.target.closest(".sheet-menu-wrap")) this.closeMenus();
        });
    }

    setupSelection() {
        const wrap = document.getElementById("sheet-grid-wrap");
        if (!wrap) return;
        this.gridWrap = wrap;
        this.selOverlay = document.createElement("div");
        this.selOverlay.className = "sheet-selection";
        this.selOverlay.hidden = true;
        wrap.appendChild(this.selOverlay);

        wrap.addEventListener("mousedown", (e) => this.onSelectStart(e));
        wrap.addEventListener("scroll", () => this.updateSelectionOverlay());
        document.addEventListener("mousemove", (e) => this.onSelectMove(e));
        document.addEventListener("mouseup", () => this.onSelectEnd());
        document.addEventListener("keydown", (e) => this.onGridKey(e));
    }

    onSelectStart(e) {
        if (e.button !== 0) return;
        const td = e.target.closest("td");
        if (!td || !td.closest(".sheet-row")) return;
        const coords = this.coordsOf(td);
        if (!coords) return;
        e.preventDefault();
        this.closeMenus();
        if (e.shiftKey && this.anchor) {
            this.setSelection(this.anchor, coords);
        } else {
            this.anchor = coords;
            this.setSelection(coords, coords);
        }
        this.dragging = true;
    }

    onSelectMove(e) {
        if (!this.dragging) return;
        const td = e.target.closest ? e.target.closest("td") : null;
        if (!td) return;
        const coords = this.coordsOf(td);
        if (!coords) return;
        this.setSelection(this.anchor, coords);
    }

    onSelectEnd() {
        this.dragging = false;
    }

    onGridKey(e) {
        const tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        const meta = e.ctrlKey || e.metaKey;
        if (meta && e.key.toLowerCase() === "c") {
            e.preventDefault();
            this.copySelection();
            return;
        }
        if (meta && e.key.toLowerCase() === "a") {
            e.preventDefault();
            this.selectAll();
            return;
        }
        if (e.key === "Escape") {
            this.clearSelection();
            return;
        }
        const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (!moves[e.key]) return;
        if (!this.anchor) return;
        e.preventDefault();
        const [dr, dc] = moves[e.key];
        const base = e.shiftKey && this.sel
            ? { r: this.sel.r2, c: this.sel.c2 }
            : { r: this.anchor.r, c: this.anchor.c };
        const end = {
            r: Math.max(0, Math.min(this.gridRows.length - 1, base.r + dr)),
            c: Math.max(0, Math.min(this.maxCol(), base.c + dc))
        };
        if (e.shiftKey) {
            this.setSelection(this.anchor, end);
        } else {
            this.anchor = end;
            this.setSelection(end, end);
            this.scrollCellIntoView(end);
        }
    }

    maxCol() {
        if (!this.gridRows.length) return 0;
        return this.gridRows[0].tds.length - 2;
    }

    selectAll() {
        if (!this.gridRows.length) return;
        const last = this.gridRows[this.gridRows.length - 1];
        const c = last.tds.length - 2;
        this.anchor = { r: 0, c: 0 };
        this.setSelection({ r: 0, c: 0 }, { r: this.gridRows.length - 1, c });
    }

    coordsOf(td) {
        for (let r = 0; r < this.gridRows.length; r++) {
            const idx = this.gridRows[r].tds.indexOf(td);
            if (idx >= 0) return { r, c: idx - 1 };
        }
        return null;
    }

    cellAt(r, c) {
        const row = this.gridRows[r];
        if (!row) return null;
        return row.tds[c + 1] || null;
    }

    setSelection(a, b) {
        this.sel = {
            r1: Math.min(a.r, b.r),
            c1: Math.min(a.c, b.c),
            r2: Math.max(a.r, b.r),
            c2: Math.max(a.c, b.c)
        };
        this.updateSelectionOverlay();
    }

    clearSelection() {
        this.sel = null;
        this.anchor = null;
        if (this.selOverlay) this.selOverlay.hidden = true;
    }

    updateSelectionOverlay() {
        if (!this.sel || !this.selOverlay) return;
        const first = this.cellAt(this.sel.r1, this.sel.c1);
        const last = this.cellAt(this.sel.r2, this.sel.c2);
        if (!first || !last) {
            this.selOverlay.hidden = true;
            return;
        }
        const wrapRect = this.gridWrap.getBoundingClientRect();
        const a = first.getBoundingClientRect();
        const b = last.getBoundingClientRect();
        const left = a.left - wrapRect.left + this.gridWrap.scrollLeft;
        const top = a.top - wrapRect.top + this.gridWrap.scrollTop;
        const width = b.right - a.left;
        const height = b.bottom - a.top;
        this.selOverlay.style.left = `${left}px`;
        this.selOverlay.style.top = `${top}px`;
        this.selOverlay.style.width = `${width}px`;
        this.selOverlay.style.height = `${height}px`;
        this.selOverlay.hidden = false;
    }

    scrollCellIntoView(coords) {
        const td = this.cellAt(coords.r, coords.c);
        if (!td) return;
        const wrap = this.gridWrap;
        const wrapRect = wrap.getBoundingClientRect();
        const rect = td.getBoundingClientRect();
        if (rect.left < wrapRect.left + 60) {
            wrap.scrollLeft -= (wrapRect.left + 60 - rect.left);
        } else if (rect.right > wrapRect.right) {
            wrap.scrollLeft += (rect.right - wrapRect.right);
        }
        if (rect.top < wrapRect.top + 40) {
            wrap.scrollTop -= (wrapRect.top + 40 - rect.top);
        } else if (rect.bottom > wrapRect.bottom) {
            wrap.scrollTop += (rect.bottom - wrapRect.bottom);
        }
    }

    cellText(td) {
        if (!td) return "";
        const text = typeof td.innerText === "string" ? td.innerText : td.textContent || "";
        return text.replace(/ /g, " ").trim();
    }

    tsvCell(value) {
        const s = String(value == null ? "" : value);
        if (/[\t\n"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }

    async copySelection() {
        if (!this.sel) {
            Utils.showToast("Select cells first", "error");
            return;
        }
        const lines = [];
        for (let r = this.sel.r1; r <= this.sel.r2; r++) {
            const vals = [];
            for (let c = this.sel.c1; c <= this.sel.c2; c++) {
                vals.push(this.tsvCell(this.cellText(this.cellAt(r, c))));
            }
            lines.push(vals.join("\t"));
        }
        const text = lines.join("\n");
        try {
            await navigator.clipboard.writeText(text);
            const rows = this.sel.r2 - this.sel.r1 + 1;
            const cols = this.sel.c2 - this.sel.c1 + 1;
            Utils.showToast(`Copied ${rows}×${cols} cells`, "success");
        } catch (err) {
            Utils.showToast("Could not copy to clipboard", "error");
        }
    }

    setupMenu(buttonId, menuId, handler) {
        const button = document.getElementById(buttonId);
        const menu = document.getElementById(menuId);
        if (!button || !menu) return;
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            const wasOpen = !menu.hidden;
            this.closeMenus();
            if (!wasOpen) menu.hidden = false;
        });
        menu.querySelectorAll("[data-export],[data-more]").forEach((item) => {
            item.addEventListener("click", () => {
                const action = item.dataset.export || item.dataset.more;
                this.closeMenus();
                handler(action, item);
            });
        });
    }

    closeMenus() {
        document.querySelectorAll(".sheet-menu").forEach((m) => {
            m.hidden = true;
        });
    }

    resetFilters() {
        this.query = "";
        this.schoolKey = "";
        const search = document.getElementById("tb-search");
        const clear = document.getElementById("tb-search-clear");
        if (search) search.value = "";
        if (clear) clear.hidden = true;
        this.renderSchoolFilter();
        this.render();
    }

    async load(manual) {
        try {
            const resp = await window.ExunServices.api.apiRequest("/api/admin/regs", { method: "GET" });
            this.data = (resp && resp.data) || null;
            if (!this.data) throw new Error("No data returned");
            this.renderSchoolFilter();
            this.render();
        } catch (err) {
            console.error("Failed to load registrations:", err);
            Utils.showToast((err && err.message) || "Failed to load registrations", "error");
        }
    }

    renderSchoolFilter() {
        const button = document.getElementById("tb-school");
        const menu = document.getElementById("tb-school-menu");
        if (!button || !menu || !this.data) return;
        const current = this.schoolKey;
        const schools = this.data.schools.map((s) => {
            const key = String(s.code || "").trim().toLowerCase() || String(s.name || "").trim().toLowerCase() || "unknown";
            return { key, name: s.name, count: s.registrationCount };
        });
        const active = schools.find((s) => s.key === current);
        button.textContent = active ? `${active.name} (${active.count}) ▾` : "All schools ▾";
        button.classList.toggle("sheet-btn--active", !!active);
        menu.innerHTML = [
            `<button type="button" data-school="" class="sheet-menu__item${current ? "" : " sheet-menu__item--active"}">All schools</button>`
        ].concat(
            schools.map((s) => `<button type="button" data-school="${Utils.escapeHtml(s.key)}" class="sheet-menu__item${s.key === current ? " sheet-menu__item--active" : ""}">${Utils.escapeHtml(s.name)}<span class="sheet-menu__count">${Utils.escapeHtml(String(s.count))}</span></button>`)
        ).join("");
    }

    scrollTabs(delta) {
        const tabs = document.getElementById("sheet-tabs");
        if (!tabs) return;
        tabs.scrollBy({ left: delta, behavior: "smooth" });
    }

    columns() {
        if (!this.eventId) {
            const cols = [{ key: "index", label: "School / Individual", width: "250px" }];
            for (const ev of this.allEvents()) {
                cols.push({ key: `${ev.id}:name`, label: ev.name, sub: "Participant", width: "200px", event: ev });
                cols.push({ key: `${ev.id}:email`, label: ev.name, sub: "Email", width: "250px", event: ev });
                cols.push({ key: `${ev.id}:phone`, label: ev.name, sub: "Phone", width: "150px", event: ev });
            }
            return cols;
        }
        return [
            { key: "school", label: "School", width: "220px" },
            { key: "name", label: "Participant", width: "200px" },
            { key: "email", label: "Email", width: "250px" },
            { key: "phone", label: "Phone", width: "150px" },
            { key: "registered", label: "Registered", width: "150px" }
        ];
    }

    allEvents() {
        if (!this.data) return [];
        if (this.schoolKey) {
            return this.data.events.filter((ev) => this.filteredRows().some((r) => r.eventId === ev.id));
        }
        return this.data.events;
    }

    transposedGroups() {
        const groups = [];
        const byKey = new Map();
        for (const r of this.filteredRows()) {
            const key = r.kind === "individual" ? `i:${r.userId}` : `s:${this.schoolKeyFor(r)}`;
            let g = byKey.get(key);
            if (!g) {
                g = {
                    key,
                    kind: r.kind,
                    title: r.kind === "individual" ? (r.accountName || r.accountEmail || "Individual") : (r.schoolName || "Unnamed school"),
                    code: r.schoolCode || "",
                    accountEmail: r.accountEmail || "",
                    accountPhone: r.accountPhone || "",
                    principalName: r.principalName || "",
                    principalEmail: r.principalEmail || "",
                    address: r.address || "",
                    byEvent: new Map()
                };
                byKey.set(key, g);
                groups.push(g);
            }
            const list = g.byEvent.get(r.eventId) || [];
            list.push(r);
            g.byEvent.set(r.eventId, list);
        }
        for (const g of groups) {
            g.participantCount = 0;
            for (const list of g.byEvent.values()) {
                for (const r of list) g.participantCount += r.participants.length;
            }
            g.eventCount = g.byEvent.size;
        }
        groups.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "school" ? -1 : 1;
            if (a.kind === "school") return b.participantCount - a.participantCount || a.title.localeCompare(b.title);
            return a.title.localeCompare(b.title);
        });
        return groups;
    }

    filteredRows() {
        if (!this.data) return [];
        let rows = this.data.rows;
        if (this.eventId) rows = rows.filter((r) => r.eventId === this.eventId);
        if (this.schoolKey) rows = rows.filter((r) => this.schoolKeyFor(r) === this.schoolKey);
        if (this.query) {
            const q = this.query;
            rows = rows.filter((r) => {
                const haystack = [
                    r.eventName,
                    r.eventMode,
                    r.schoolName,
                    r.schoolCode,
                    r.teamName,
                    r.accountName,
                    r.accountEmail,
                    r.accountPhone,
                    r.principalName,
                    r.principalEmail,
                    r.address,
                    r.status
                ];
                for (const p of r.participants) haystack.push(p.name, p.email, p.phone);
                return haystack.some((v) => String(v || "").toLowerCase().includes(q));
            });
        }
        return rows;
    }

    schoolKeyFor(row) {
        if (row.kind === "individual") return "";
        const code = String(row.schoolCode || "").trim().toLowerCase();
        if (code) return code;
        const name = String(row.schoolName || "").trim().toLowerCase();
        return name || "unknown";
    }

    render() {
        this.renderHead();
        this.renderBody();
        this.renderTabs();
        this.renderTitle();
    }

    renderTitle() {
        if (!this.data) return;
        let name = "All registrations";
        if (this.eventId) {
            const ev = this.data.events.find((e) => e.id === this.eventId);
            name = ev ? `${ev.name} registrations` : "Registrations";
        }
        document.title = `${name} | Exun 2026`;
    }

    renderHead() {
        const head = document.getElementById("sheet-head");
        if (!head) return;
        const cols = this.columns();
        const letters = cols.map((_, i) => {
            const pinned = !this.eventId && i === 0 ? " sheet-letter--index" : "";
            return `<th class="${pinned.trim()}" style="width:${colWidth(cols, i)}">${Utils.escapeHtml(this.columnLetter(i))}</th>`;
        }).join("");
        const table = document.getElementById("sheet-grid");
        if (table) {
            const total = cols.reduce((n, _, i) => n + parseInt(colWidth(cols, i), 10), ROW_NUMBER_WIDTH);
            table.style.width = `${total}px`;
        }

        if (this.eventId) {
            const heads = cols.map((c) => `<th class="sheet-th">${Utils.escapeHtml(c.label)}</th>`).join("");
            head.innerHTML = `
                <tr class="sheet-letters">
                    <th class="sheet-corner" rowspan="2"></th>
                    ${letters}
                </tr>
                <tr class="sheet-heads">${heads}</tr>`;
            return;
        }

        const groups = [];
        const subs = [];
        for (const ev of this.allEvents()) {
            groups.push(`<th class="sheet-group" colspan="3"><span class="sheet-group__name">${Utils.escapeHtml(ev.name)}</span></th>`);
            subs.push(`<th class="sheet-sub">Participant</th><th class="sheet-sub">Email</th><th class="sheet-sub">Phone</th>`);
        }
        head.innerHTML = `
            <tr class="sheet-letters">
                <th class="sheet-corner" rowspan="3"></th>
                ${letters}
            </tr>
            <tr class="sheet-groups">
                <th class="sheet-group sheet-group--index">School / Individual</th>
                ${groups.join("")}
            </tr>
            <tr class="sheet-subs">
                <th class="sheet-sub sheet-sub--index"></th>
                ${subs.join("")}
            </tr>`;
    }

    columnLetter(index) {
        let n = index + 1;
        let out = "";
        while (n > 0) {
            const rem = (n - 1) % 26;
            out = String.fromCharCode(65 + rem) + out;
            n = Math.floor((n - 1) / 26);
        }
        return out;
    }

    renderBody() {
        const body = document.getElementById("sheet-body");
        if (!body) return;
        const rows = this.filteredRows();
        if (rows.length === 0) {
            body.innerHTML = `<tr class="sheet-empty-row"><td class="sheet-empty" colspan="99">No registrations match this view.</td></tr>`;
            this.gridRows = [];
            this.clearSelection();
            return;
        }
        if (this.eventId) {
            body.innerHTML = rows.map((r, i) => this.renderRow(r, i + 1)).join("");
        } else {
            const groups = this.transposedGroups();
            const events = this.allEvents();
            body.innerHTML = groups.map((g, i) => {
                const cells = events.map((ev) => {
                    if (g.kind === "individual" && !ev.independentRegistration) {
                        return `<td class="sheet-td sheet-td--people sheet-td--na"><span class="sheet-empty-cell">—</span></td>`
                            + `<td class="sheet-td sheet-td--people sheet-td--na"></td>`
                            + `<td class="sheet-td sheet-td--people sheet-td--na"></td>`;
                    }
                    const list = g.byEvent.get(ev.id) || [];
                    const { names, emails, phones } = this.splitParticipants(list);
                    return `<td class="sheet-td sheet-td--people">${this.renderLineColumn(names, "name")}</td>`
                        + `<td class="sheet-td sheet-td--people">${this.renderLineColumn(emails, "meta")}</td>`
                        + `<td class="sheet-td sheet-td--people">${this.renderLineColumn(phones, "meta")}</td>`;
                }).join("");
                return `<tr class="sheet-row"><td class="sheet-rownum">${i + 1}</td><td class="sheet-td sheet-td--index">${Utils.escapeHtml(g.title)}</td>${cells}</tr>`;
            }).join("");
        }
        this.gridRows = [...body.querySelectorAll(".sheet-row")].map((tr) => ({
            tr,
            tds: [...tr.querySelectorAll("td")]
        }));
        this.clearSelection();
    }

    renderRow(r, index) {
        const { names, emails, phones } = this.splitParticipants([r]);
        const nameCell = this.renderLineColumn(names, "name") || `<div class="sheet-line sheet-line--name sheet-empty-cell">—</div>`;
        const emailCell = this.renderLineColumn(emails, "meta") || `<div class="sheet-line sheet-line--meta sheet-empty-cell">—</div>`;
        const phoneCell = this.renderLineColumn(phones, "meta") || `<div class="sheet-line sheet-line--meta sheet-empty-cell">—</div>`;
        return `<tr class="sheet-row">
            <td class="sheet-rownum">${index}</td>
            <td class="sheet-td">${Utils.escapeHtml(r.schoolName || "")}</td>
            <td class="sheet-td sheet-td--people">${nameCell}</td>
            <td class="sheet-td sheet-td--people">${emailCell}</td>
            <td class="sheet-td sheet-td--people">${phoneCell}</td>
            <td class="sheet-td sheet-td--date">${Utils.escapeHtml(r.createdAt || "")}</td>
        </tr>`;
    }

    renderLineColumn(values, kind) {
        return values.map((v) => `<div class="sheet-line sheet-line--${kind}">${Utils.escapeHtml(v || "")}</div>`).join("");
    }

    splitParticipants(list) {
        const names = [];
        const emails = [];
        const phones = [];
        for (const r of list || []) {
            for (const p of r.participants) {
                names.push(p.name || "");
                emails.push(p.email || "");
                phones.push(p.phone || "");
            }
        }
        return { names, emails, phones };
    }
    renderTabs() {
        const box = document.getElementById("sheet-tabs");
        if (!box || !this.data) return;
        const tabs = [{ id: "", name: "All events", count: this.data.totals.registrations }].concat(
            this.data.events.map((ev) => ({ id: ev.id, name: ev.name, count: ev.registrationCount }))
        );
        box.innerHTML = tabs.map((t) => `
            <button class="sheet-tab${t.id === this.eventId ? " sheet-tab--active" : ""}" type="button" data-tab-id="${Utils.escapeHtml(t.id)}">
                <span class="sheet-tab__name">${Utils.escapeHtml(t.name)}</span>
                <span class="sheet-tab__count">${Utils.escapeHtml(String(t.count))}</span>
            </button>`).join("");
        box.querySelectorAll("[data-tab-id]").forEach((btn) => {
            btn.addEventListener("click", () => {
                this.eventId = btn.dataset.tabId;
                this.render();
            });
        });
    }

    renderStatus() {
        const status = document.getElementById("tb-status");
        if (!status) return;
        status.textContent = "";
    }

    tableData() {
        const cols = this.columns();
        const rows = this.filteredRows();
        const header = cols.map((c) => c.label);
        const body = rows.map((r) => {
            const values = [];
            if (!this.eventId) values.push(r.eventName);
            values.push(r.schoolName || "");
            values.push(r.participants.map((p) => [p.name, p.email, p.phone].filter(Boolean).join(" · ")).join(" | "));
            values.push(r.createdAt || "");
            return values;
        });
        return { header, body };
    }

    exportData() {
        if (!this.eventId) {
            const groups = this.transposedGroups();
            const events = this.allEvents();
            const header = ["School / Individual", "Code", "Contact", "Principal", "Address"];
            for (const ev of events) header.push(`${ev.name} - Participant`, `${ev.name} - Email`, `${ev.name} - Phone`);
            const body = groups.map((g) => {
                const meta = [
                    g.title,
                    g.code,
                    g.kind === "individual" ? "" : [g.accountEmail, g.accountPhone].filter(Boolean).join(" · "),
                    g.kind === "individual" ? "" : [g.principalName, g.principalEmail].filter(Boolean).join(" · "),
                    g.address || ""
                ];
                const cells = [];
                for (const ev of events) {
                    const list = g.byEvent.get(ev.id) || [];
                    const names = [];
                    const emails = [];
                    const phones = [];
                    for (const r of list) {
                        for (const p of r.participants) {
                            names.push(p.name || "");
                            emails.push(p.email || "");
                            phones.push(p.phone || "");
                        }
                    }
                    cells.push(names.join(" | "), emails.join(" | "), phones.join(" | "));
                }
                return [...meta, ...cells];
            });
            return { header, body };
        }
        const rows = this.filteredRows();
        const header = ["Event", "School", "Code", "Team", "Participant", "Email", "Phone", "Contact", "Principal", "Address", "Registered"];
        const body = rows.map((r) => [
            r.eventName,
            r.schoolName || "",
            r.schoolCode || "",
            r.teamName || "",
            r.participants.map((p) => p.name || "").join(" | "),
            r.participants.map((p) => p.email || "").join(" | "),
            r.participants.map((p) => p.phone || "").join(" | "),
            r.kind === "individual" ? "" : [r.accountEmail, r.accountPhone].filter(Boolean).join(" · "),
            r.kind === "individual" ? "" : [r.principalName, r.principalEmail].filter(Boolean).join(" · "),
            r.address || "",
            r.createdAt || ""
        ]);
        return { header, body };
    }

    exportCsv() {
        const { header, body } = this.exportData();
        if (body.length === 0) {
            Utils.showToast("Nothing to export", "error");
            return;
        }
        const lines = [header, ...body].map((row) => row.map((v) => this.csvCell(v)).join(","));
        const csv = lines.join("\n");
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `exun-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        Utils.showToast(`Exported ${body.length} rows`, "success");
    }

    async copyTsv() {
        const { header, body } = this.exportData();
        if (body.length === 0) {
            Utils.showToast("Nothing to copy", "error");
            return;
        }
        const tsv = [header, ...body].map((row) => row.map((v) => String(v).replace(/[\t\n]/g, " ")).join("\t")).join("\n");
        try {
            await navigator.clipboard.writeText(tsv);
            Utils.showToast(`Copied ${body.length} rows`, "success");
        } catch (err) {
            Utils.showToast("Could not copy to clipboard", "error");
        }
    }

    csvCell(value) {
        const s = String(value == null ? "" : value);
        if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }
}

window.AdminRegsPage = AdminRegsPage;
