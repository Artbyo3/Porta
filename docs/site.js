(function () {
  "use strict";

  const REPO = "Artbyo3/Porta";
  const RELEASE_API = "https://api.github.com/repos/" + REPO + "/releases/latest";

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs || {})) {
      if (key.startsWith("on")) {
        node.addEventListener(key.slice(2), val);
      } else if (key === "checked") {
        node.checked = !!val;
      } else if (val === true) {
        node.setAttribute(key, "");
      } else if (val !== false && val != null) {
        node.setAttribute(key, val);
      }
    }
    for (const child of children.flat()) {
      if (child != null && child !== false) node.append(child);
    }
    return node;
  }

  function showToast(msg) {
    const wrap = document.getElementById("siteToasts");
    if (!wrap) return;
    const t = el("div", { class: "toast" }, msg);
    wrap.append(t);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    setTimeout(() => t.remove(), 2600);
  }

  function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // Sync download links and version text with the latest GitHub Release; fall back quietly to v1.0.0 defaults.
  async function syncLatestRelease() {
    try {
      const res = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return;
      const rel = await res.json();
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const zip = assets.find((a) => /^Porta-.*\.zip$/i.test(a.name)) || assets.find((a) => /\.zip$/i.test(a.name));

      if (rel.tag_name) {
        document.querySelectorAll("[data-release-version]").forEach((n) => {
          n.textContent = rel.tag_name;
        });
      }
      if (rel.html_url) {
        document.querySelectorAll("[data-release-notes]").forEach((a) => {
          a.href = rel.html_url;
        });
      }
      if (zip && zip.browser_download_url) {
        document.querySelectorAll("[data-download-link]").forEach((a) => {
          a.href = zip.browser_download_url;
        });
        if (typeof zip.size === "number" && zip.size > 0) {
          document.querySelectorAll("[data-download-size]").forEach((n) => {
            n.textContent = formatMB(zip.size);
          });
        }
      }
    } catch (_) {
      // Offline or rate-limited: HTML already carries valid v1.0.0 release links.
    }
  }

  // Interactive demo data (fictional sample records matching Porta's layout)
  const DEMO_PEOPLE = [
    {
      id: "elena",
      name: "Elena Morales",
      initials: "EM",
      color: "#37803a",
      folders: [
        { id: "identity", name: "Identity", items: 2 },
        { id: "tax", name: "Tax", items: 1 },
        { id: "medical", name: "Medical", items: 1 },
      ],
      docs: [
        {
          id: "passport",
          folder: "identity",
          name: "Passport_Renewal_2026.pdf",
          badge: "PDF",
          badgeClass: "pdf",
          date: "2026-04-12",
          size: "1.4 MB",
          preview: "2-page scanned PDF\nPassport Agency\nExpires: Apr 2036",
        },
        {
          id: "license",
          folder: "identity",
          name: "Driver_License_Front.jpg",
          badge: "JPG",
          badgeClass: "img",
          date: "2026-02-03",
          size: "640 KB",
          preview: "Photo saved privately on your drive\nOpen full screen inside Porta to zoom in.",
        },
        {
          id: "w2",
          folder: "tax",
          name: "Annual_Return_Summary.pdf",
          badge: "PDF",
          badgeClass: "pdf",
          date: "2026-03-19",
          size: "820 KB",
          preview: "2025 Tax Filing Summary\nConfirmation #482-910-33\nSaved privately on your drive.",
        },
        {
          id: "rx",
          folder: "medical",
          name: "Prescription_Notes.txt",
          badge: "TXT",
          badgeClass: "txt",
          date: "2026-08-05",
          size: "2 KB",
          preview: "Clinic: Valley Family Health\nFollow-up checkup: November\nAllergies: None reported",
        },
      ],
      creds: [
        { title: "Bank Portal", site: "bank.example.org", user: "elena.m", pass: "pine-meadow-74!" },
        { title: "Health Insurance", site: "care.example.net", user: "emorales92", pass: "clover-vault-19#" },
      ],
      tasks: [
        { id: "t1", label: "Scan updated vehicle registration from phone", done: false },
        { id: "t2", label: "Back up Porta folder to spare USB drive", done: true },
        { id: "t3", label: "Organize 2026 medical receipts", done: false },
      ],
    },
    {
      id: "household",
      name: "Household",
      initials: "HH",
      color: "#1f8a7a",
      folders: [
        { id: "housing", name: "Housing", items: 2 },
      ],
      docs: [
        {
          id: "lease",
          folder: "housing",
          name: "Apartment_Lease_Signed.pdf",
          badge: "PDF",
          badgeClass: "pdf",
          date: "2025-09-01",
          size: "2.1 MB",
          preview: "12-page PDF · Scanned with Phone Scan\nTerm: Sep 2025 – Aug 2027\nSecurity deposit receipt on page 11.",
        },
        {
          id: "meter",
          folder: "housing",
          name: "Utility_Meter_Setup.txt",
          badge: "TXT",
          badgeClass: "txt",
          date: "2025-09-04",
          size: "1 KB",
          preview: "Electric account: #8841-209\nMonthly billing cycle\nMaintenance contact: 555-0148",
        },
      ],
      creds: [
        { title: "Home Wi-Fi", site: "Home router", user: "admin", pass: "cedar-forest-88*" },
      ],
      tasks: [
        { id: "h1", label: "Renew renters policy before September", done: false },
        { id: "h2", label: "Save electric bill PDF to Housing", done: true },
      ],
    },
  ];

  const state = {
    personId: "elena",
    tab: "docs",
    folderId: null,
    openDocId: "passport",
    search: "",
    revealed: new Set(),
    scanMode: "Color",
  };

  function currentPerson() {
    return DEMO_PEOPLE.find((p) => p.id === state.personId) || DEMO_PEOPLE[0];
  }

  function folderSvg() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z");
    svg.append(path);
    return svg;
  }

  function qrSvg() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 84 84");
    svg.setAttribute("width", "112");
    svg.setAttribute("height", "112");
    svg.setAttribute("aria-hidden", "true");
    const rects = [
      [4, 4, 24, 24], [56, 4, 24, 24], [4, 56, 24, 24],
      [10, 10, 12, 12], [62, 10, 12, 12], [10, 62, 12, 12],
      [34, 8, 6, 6], [44, 14, 6, 12], [34, 34, 16, 16],
      [56, 36, 8, 8], [70, 36, 10, 10], [36, 58, 12, 8],
      [56, 56, 12, 12], [72, 64, 8, 16], [8, 36, 14, 8],
    ];
    for (const [x, y, w, h] of rects) {
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", x);
      r.setAttribute("y", y);
      r.setAttribute("width", w);
      r.setAttribute("height", h);
      r.setAttribute("rx", "1.5");
      r.setAttribute("fill", w === 12 && (x === 10 || x === 62) ? "#f0f7ec" : "#14361a");
      svg.append(r);
    }
    return svg;
  }

  function renderPeople() {
    const list = document.getElementById("demoPeopleList");
    if (!list) return;
    list.replaceChildren();
    for (const p of DEMO_PEOPLE) {
      const openTasks = p.tasks.filter((t) => !t.done).length;
      const btn = el(
        "button",
        {
          type: "button",
          class: p.id === state.personId ? "selected" : "",
          "aria-pressed": p.id === state.personId ? "true" : "false",
          onclick: () => {
            state.personId = p.id;
            state.folderId = null;
            state.openDocId = p.docs[0] ? p.docs[0].id : null;
            renderDemo();
          },
        },
        el("span", { class: "avatar", style: "background:" + p.color, "aria-hidden": "true" }, p.initials),
        el(
          "span",
          { class: "who" },
          el("span", { class: "name" }, p.name),
          el("span", { class: "meta" }, p.docs.length + " docs · " + openTasks + " open")
        )
      );
      list.append(el("li", {}, btn));
    }
  }

  function renderHeader(person) {
    const titleSlot = document.getElementById("demoPersonTitle");
    const tabsSlot = document.getElementById("demoTabs");
    if (!titleSlot || !tabsSlot) return;

    titleSlot.replaceChildren(
      el("span", { class: "avatar avatar-lg", style: "background:" + person.color, "aria-hidden": "true" }, person.initials),
      el(
        "div",
        {},
        el("h3", {}, person.name),
        el(
          "div",
          { class: "demo-person-sub" },
          person.docs.length + " documents · " + person.creds.length + " logins · " + person.tasks.filter((t) => !t.done).length + " open tasks"
        )
      )
    );

    const tabs = [
      { id: "docs", label: "Documents", count: person.docs.length },
      { id: "creds", label: "Logins", count: person.creds.length },
      { id: "tasks", label: "Tasks", count: person.tasks.filter((t) => !t.done).length },
      { id: "scan", label: "Phone Scan", count: null },
    ];
    tabsSlot.replaceChildren(
      ...tabs.map((t) =>
        el(
          "button",
          {
            type: "button",
            role: "tab",
            class: state.tab === t.id ? "active" : "",
            "aria-selected": state.tab === t.id ? "true" : "false",
            onclick: () => {
              state.tab = t.id;
              renderDemo();
            },
          },
          t.label,
          t.count !== null ? el("span", { class: "badge" }, String(t.count)) : null
        )
      )
    );
  }

  function renderDocsTab(person, body) {
    const q = state.search.trim().toLowerCase();
    const activeFolder = person.folders.find((f) => f.id === state.folderId) || null;
    const visibleFolders = activeFolder || q ? [] : person.folders;
    const visibleDocs = person.docs.filter((d) => {
      if (q) return d.name.toLowerCase().includes(q) || d.preview.toLowerCase().includes(q);
      return activeFolder ? d.folder === activeFolder.id : true;
    });

    if (!visibleDocs.some((d) => d.id === state.openDocId)) {
      state.openDocId = visibleDocs[0] ? visibleDocs[0].id : null;
    }
    const openDoc = visibleDocs.find((d) => d.id === state.openDocId) || null;

    const crumbs = el(
      "div",
      { class: "crumbs" },
      el(
        "button",
        {
          type: "button",
          class: "crumb" + (activeFolder ? "" : " here"),
          onclick: () => {
            state.folderId = null;
            renderDemo();
          },
        },
        person.name
      ),
      activeFolder ? el("span", { "aria-hidden": "true" }, "/") : null,
      activeFolder ? el("span", { class: "crumb here" }, activeFolder.name) : null
    );

    const listEl = el("div", { class: "docs-items" });
    for (const f of visibleFolders) {
      listEl.append(
        el(
          "button",
          {
            type: "button",
            class: "folder-row",
            onclick: () => {
              state.folderId = f.id;
              renderDemo();
            },
          },
          el("span", { class: "folder-ico" }, folderSvg()),
          el("span", { class: "row-title" }, f.name),
          el("span", { class: "row-sub" }, f.items + (f.items === 1 ? " item" : " items"))
        )
      );
    }

    for (const d of visibleDocs) {
      listEl.append(
        el(
          "button",
          {
            type: "button",
            class: "doc-row" + (openDoc && openDoc.id === d.id ? " open" : ""),
            onclick: () => {
              state.openDocId = d.id;
              renderDemo();
            },
          },
          el("span", { class: "type " + d.badgeClass }, d.badge),
          el(
            "span",
            { style: "min-width:0" },
            el("div", { class: "row-title" }, d.name),
            el("div", { class: "row-sub" }, d.date)
          ),
          el("span", { class: "row-sub" }, d.size)
        )
      );
    }

    if (visibleFolders.length === 0 && visibleDocs.length === 0) {
      listEl.append(el("p", { class: "row-sub" }, "No matching documents in this view."));
    }

    const detailEl = openDoc
      ? el(
          "div",
          { class: "detail-card" },
          el(
            "div",
            { class: "detail-head" },
            el("strong", {}, openDoc.name),
            el("span", { class: "type " + openDoc.badgeClass }, openDoc.badge)
          ),
          el("div", { class: "detail-preview" }, el("pre", {}, openDoc.preview)),
          el(
            "div",
            { class: "detail-meta" },
            el("span", {}, "Added: " + openDoc.date + " · Size: " + openDoc.size),
            el("span", {}, "Locked with your master password")
          )
        )
      : el(
          "div",
          { class: "detail-card" },
          el("div", { class: "detail-preview" }, "Select a document to preview its contents.")
        );

    body.replaceChildren(crumbs, el("div", { class: "docs-split" }, listEl, detailEl));
  }

  function renderCredsTab(person, body) {
    const q = state.search.trim().toLowerCase();
    const creds = person.creds.filter(
      (c) => !q || c.title.toLowerCase().includes(q) || c.site.toLowerCase().includes(q) || c.user.toLowerCase().includes(q)
    );
    if (creds.length === 0) {
      body.replaceChildren(el("p", { class: "row-sub" }, "No matching logins."));
      return;
    }
    const grid = el(
      "div",
      { class: "cards" },
      ...creds.map((c) => {
        const key = person.id + ":" + c.title;
        const shown = state.revealed.has(key);
        return el(
          "div",
          { class: "card" },
          el("h4", {}, c.title),
          el("div", { class: "site" }, c.site),
          el(
            "div",
            { class: "kv" },
            el("span", {}, "User"),
            el("code", {}, c.user),
            el(
              "button",
              {
                type: "button",
                class: "btn btn-sm",
                onclick: () => showToast("Copied demo username for " + c.title),
              },
              "Copy"
            )
          ),
          el(
            "div",
            { class: "kv" },
            el("span", {}, "Pass"),
            el("code", {}, shown ? c.pass : "••••••••••••"),
            el(
              "div",
              { class: "kv-actions" },
              el(
                "button",
                {
                  type: "button",
                  class: "btn btn-sm",
                  onclick: () => {
                    if (shown) state.revealed.delete(key);
                    else state.revealed.add(key);
                    renderDemo();
                  },
                },
                shown ? "Hide" : "Show"
              ),
              el(
                "button",
                {
                  type: "button",
                  class: "btn btn-sm",
                  onclick: () => showToast("Copied demo password for " + c.title),
                },
                "Copy"
              )
            )
          )
        );
      })
    );
    body.replaceChildren(grid);
  }

  function renderTasksTab(person, body) {
    const list = el(
      "ul",
      { class: "tasks" },
      ...person.tasks.map((t) =>
        el(
          "li",
          { class: t.done ? "done" : "" },
          el("input", {
            type: "checkbox",
            id: "demo-" + t.id,
            checked: t.done,
            onchange: () => {
              t.done = !t.done;
              renderDemo();
            },
          }),
          el("label", { for: "demo-" + t.id }, t.label)
        )
      )
    );
    body.replaceChildren(list);
  }

  function renderScanTab(person, body) {
    const modeNotes = {
      Color: "Color mode keeps stamps, signatures, and highlights crisp.",
      Gray: "Gray mode softens shadows while keeping text easy to read.",
      "B&W": "B&W mode gives clean black-and-white pages for receipts and forms.",
    };
    const modes = ["Color", "Gray", "B&W"];
    body.replaceChildren(
      el(
        "div",
        { class: "scan-demo" },
        el(
          "div",
          { class: "qr-box" },
          qrSvg(),
          el("small", {}, "Connects over your Wi-Fi"),
          el("small", {}, "Saves to " + person.name)
        ),
        el(
          "div",
          { class: "scan-info" },
          el("h4", {}, "Scan paper pages straight from your phone"),
          el(
            "p",
            {},
            "Point your phone camera at the QR code while on the same Wi-Fi. Crop the corners, press and hold to reorder pages, pick a look, and save everything as one locked PDF."
          ),
          el(
            "div",
            { class: "mode-pills" },
            ...modes.map((m) =>
              el(
                "button",
                {
                  type: "button",
                  class: "mode-pill" + (state.scanMode === m ? " active" : ""),
                  "aria-pressed": state.scanMode === m ? "true" : "false",
                  onclick: () => {
                    state.scanMode = m;
                    renderDemo();
                  },
                },
                m
              )
            )
          ),
          el("p", { class: "scan-note" }, modeNotes[state.scanMode])
        )
      )
    );
  }

  function renderDemo() {
    const person = currentPerson();
    renderPeople();
    renderHeader(person);
    const body = document.getElementById("demoBody");
    if (!body) return;
    if (state.tab === "docs") renderDocsTab(person, body);
    else if (state.tab === "creds") renderCredsTab(person, body);
    else if (state.tab === "tasks") renderTasksTab(person, body);
    else renderScanTab(person, body);
  }

  function wireSearch() {
    const input = document.getElementById("demoSearch");
    if (!input) return;
    input.addEventListener("input", () => {
      state.search = input.value;
      renderDemo();
    });
  }

  renderDemo();
  wireSearch();
  syncLatestRelease();
})();
