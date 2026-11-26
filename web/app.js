"use strict";
const $ = (id) => document.getElementById(id);
const IDLE_MS = 10 * 60 * 1000;
const UNSORTED = "Unsorted";
const CATEGORIES = ["Identity", "Tax", "Income", "Bank", "Housing", "Medical", "Insurance", "Legal", "Immigration", "Education", "Utilities", "Vehicle", "Other"];
const NEW_CATEGORY = "__new_category__";
const PALETTE = { green: "#37803a", teal: "#1f8a7a", blue: "#2e6fb7", purple: "#7a4fb5", pink: "#c2407a", red: "#c0392b", orange: "#d9771e", brown: "#8a6239", slate: "#5b6b7a" };
// ICONS are 24x24 outline drawings (stroke only), rendered in the avatar's foreground color.
const ICONS = {
  person: "M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  family: "M5.5 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M2.5 20v-.5A5.5 5.5 0 0 1 8 14h2a5.5 5.5 0 0 1 5.5 5.5v.5M14.5 9a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M17 14.5a4.5 4.5 0 0 1 4.5 4.5v1",
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  briefcase: "M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18",
  building: "M5 3h14v18H5zM9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3",
  education: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6",
  health: "M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z",
  medical: "M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z",
  legal: "M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z",
  globe: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  car: "M5 16l1.5-5a2 2 0 0 1 1.9-1.4h7.2a2 2 0 0 1 1.9 1.4L19 16M3 16h18v3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM7 18h.01M17 18h.01",
  star: "M12 3l2.8 5.9 6.2.7-4.6 4.2 1.2 6.2L12 16.9 6.4 20l1.2-6.2L3 9.6l6.2-.7z",
  leaf: "M5 19c0-8 6-14 15-14 0 9-6 15-14 15M5 19l7-7",
};

function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

const S = {
  people: [], person: null, tab: "docs",
  docs: [], creds: [], tasks: [],
  f: { cat: "All", year: "All", q: "", sort: "date-desc" },
  selected: new Set(), openDoc: null, editCred: null,
};
let setupMode = false, lastInput = Date.now(), lastPing = 0, pairTimer = null;

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (k === "checked") e.checked = !!v;
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

async function api(method, path, body, poll) {
  const opts = { method, headers: {} };
  if (poll) opts.headers["X-Porta-Poll"] = "1";
  if (body instanceof Blob) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/unlock") { showGate(); throw new Error("locked"); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// toast shows a short message. Messages with the same key replace each other, and at most three stay on screen.
function toast(msg, error, key) {
  let t = key && document.querySelector('.toast[data-key="' + key + '"]');
  if (!t) {
    t = el("div", { class: "toast", "data-key": key || null });
    $("toasts").append(t);
    while ($("toasts").children.length > 3) $("toasts").firstChild.remove();
  }
  t.className = "toast" + (error ? " error" : "");
  t.textContent = msg;
  clearTimeout(t.timer);
  t.timer = setTimeout(() => t.remove(), 3200);
}

const fmtSize = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";
const fmtAdded = (s) => new Date(s * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const yearOf = (d) => (/^\d{4}/.exec(d.date || "") || ["Undated"])[0];
const catOf = (d) => d.category || UNSORTED;
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || "").join("").toUpperCase();
}

// avatar shows the person's chosen icon, or their initials, on their color (or one derived from the name).
function avatar(p, size) {
  const keys = Object.keys(PALETTE);
  let h = 0;
  for (const ch of p.name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const color = PALETTE[p.color] || PALETTE[keys[h % keys.length]];
  const hasIcon = Object.hasOwn(ICONS, p.icon || "");
  return el("span", { class: "avatar" + (size ? " avatar-" + size : "") + (hasIcon ? " has-icon" : ""), style: "background:" + color, "aria-hidden": "true" },
    hasIcon ? icon(p.icon) : initials(p.name));
}

function typeOf(d) {
  const m = d.mime || "", ext = (d.name.split(".").pop() || "").toLowerCase();
  if (m === "application/pdf") return ["PDF", "pdf"];
  if (m.startsWith("image/") || ["heic", "tif", "tiff"].includes(ext)) return [ext === "jpeg" ? "JPG" : ext.toUpperCase().slice(0, 4), "img"];
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return ["DOC", "doc"];
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return [ext === "csv" ? "CSV" : "XLS", "xls"];
  if (["txt", "md"].includes(ext)) return ["TXT", "txt"];
  return [(ext || "FILE").toUpperCase().slice(0, 4), ""];
}

/* ---------------- Background ---------------- */
// startMeadow plays the grass video behind the app; with reduced motion it shows its first frame as a still.
function startMeadow() {
  const v = $("meadowVideo");
  v.addEventListener("error", () => { v.hidden = true; });
  v.poster = "/media/grass.jpg";
  v.hidden = false;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  v.src = v.canPlayType('video/webm; codecs="vp9"') ? "/media/grass.webm" : "/media/grass.mp4";
  v.play().catch(() => {});
}

/* ---------------- Lock screen ---------------- */
async function boot() {
  startMeadow();
  const s = await api("GET", "/api/state", undefined, true);
  if (s.unlocked) showMain(); else showGate(s.initialized);
}

async function showGate(initialized) {
  if (initialized === undefined) initialized = (await (await fetch("/api/state")).json()).initialized;
  clearInterval(pairTimer);
  document.querySelector(".overlay")?.remove();
  Object.assign(S, { people: [], person: null, docs: [], creds: [], tasks: [], openDoc: null });
  S.selected.clear();
  $("workspace").replaceChildren(); $("people").replaceChildren(); $("q").value = ""; $("hits").hidden = true;
  setupMode = !initialized;
  $("gateTitle").textContent = setupMode ? "Create a master password. It cannot be recovered if lost." : "Enter the master password to unlock.";
  $("gateBtn").textContent = setupMode ? "Create vault" : "Unlock";
  $("pw2").hidden = !setupMode; $("pw2").required = setupMode;
  $("pw").value = $("pw2").value = ""; $("gateMsg").textContent = "";
  $("main").hidden = true; $("gate").hidden = false;
  $("pw").focus();
}

$("gateForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("gateMsg").textContent = "";
  if (setupMode && $("pw").value !== $("pw2").value) { $("gateMsg").textContent = "Passwords do not match."; return; }
  $("gateBtn").disabled = true;
  try {
    await api("POST", setupMode ? "/api/setup" : "/api/unlock", { password: $("pw").value });
    $("pw").value = $("pw2").value = "";
    showMain();
  } catch (e) { $("gateMsg").textContent = e.message; $("pw").select(); }
  $("gateBtn").disabled = false;
});

async function showMain() {
  $("gate").hidden = true; $("main").hidden = false;
  lastInput = Date.now();
  await loadPeople();
  renderWorkspace();
}

$("lockBtn").addEventListener("click", async () => { await api("POST", "/api/lock").catch(() => {}); showGate(true); });

for (const ev of ["mousemove", "mousedown", "keydown", "scroll", "touchstart"]) {
  document.addEventListener(ev, () => {
    lastInput = Date.now();
    if (!$("main").hidden && Date.now() - lastPing > 30000) { lastPing = Date.now(); api("POST", "/api/ping").catch(() => {}); }
  }, { passive: true, capture: true });
}
setInterval(async () => {
  if ($("main").hidden) return;
  if (Date.now() - lastInput > IDLE_MS) { await api("POST", "/api/lock").catch(() => {}); showGate(true); return; }
  const s = await api("GET", "/api/state", undefined, true).catch(() => null);
  if (s && !s.unlocked) showGate(true);
}, 15000);

/* ---------------- People ---------------- */
async function loadPeople() {
  S.people = await api("GET", "/api/people");
  S.people.sort((a, b) => a.name.localeCompare(b.name));
  renderPeople();
}

function renderPeople() {
  const f = $("peopleFilter").value.trim().toLowerCase();
  $("peopleCount").textContent = S.people.length ? "(" + S.people.length + ")" : "";
  const shown = S.people.filter((p) => p.name.toLowerCase().includes(f));
  $("people").replaceChildren(...shown.map((p) => el("li", {},
    el("button", { class: S.person === p.id ? "selected" : null, onclick: () => selectPerson(p.id) },
      avatar(p),
      el("span", { class: "who" },
        el("span", { class: "name" }, p.name),
        el("span", { class: "meta" }, plural(p.docs, "doc"), p.unsorted ? [" · ", el("b", {}, p.unsorted + " unsorted")] : null,
          p.openTasks ? " · " + plural(p.openTasks, "open task") : null))))));
  if (!shown.length) $("people").append(el("li", { class: "count" }, S.people.length ? "No match." : "No people yet."));
}

$("peopleFilter").addEventListener("input", renderPeople);
$("newPersonBtn").addEventListener("click", () => { $("addPerson").hidden = !$("addPerson").hidden; if (!$("addPerson").hidden) $("newName").focus(); });
$("addPerson").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const r = await api("POST", "/api/people", { name: $("newName").value.trim(), notes: "" });
  $("newName").value = ""; $("addPerson").hidden = true;
  await loadPeople();
  selectPerson(r.id);
});

const current = () => S.people.find((p) => p.id === S.person);

async function selectPerson(id, tab) {
  if (S.person !== id) {
    S.f = { cat: "All", year: "All", q: "", sort: S.f.sort };
    S.selected.clear(); S.openDoc = null; S.editCred = null;
  }
  S.person = id;
  if (tab) S.tab = tab;
  renderPeople();
  await loadChildren();
  renderWorkspace();
}

async function loadChildren() {
  const id = S.person;
  const [docs, creds, tasks] = await Promise.all(["docs", "creds", "tasks"].map((k) => api("GET", "/api/people/" + id + "/" + k)));
  if (S.person !== id) return;
  Object.assign(S, { docs, creds, tasks });
}

async function refresh() {
  await Promise.all([loadPeople(), loadChildren()]);
  renderWorkspace();
}

/* ---------------- Workspace ---------------- */
function renderWorkspace() {
  const p = current();
  if (!p) {
    $("workspace").replaceChildren(el("div", { class: "panel empty-state" },
      el("h2", {}, S.people.length ? "Choose a person" : "Welcome to Porta"),
      el("p", {}, S.people.length ? "Pick someone on the left to see their documents, credentials and tasks." : "Add the first person you are helping. Each person keeps their own documents, credentials and tasks."),
      el("button", { class: "btn btn-primary", onclick: () => $("newPersonBtn").click() }, "+ Add a person")));
    return;
  }
  const open = S.tasks.filter((t) => !t.done).length;
  const unsortedN = S.docs.filter((d) => catOf(d) === UNSORTED).length;
  const tab = (key, label, n, warn) => el("button", { class: S.tab === key ? "active" : null, onclick: () => { S.tab = key; renderWorkspace(); } },
    label, n != null ? el("span", { class: "badge" + (warn ? " warn" : "") }, String(n)) : null);
  const body = el("section", { class: "panel tab-body", id: "tabBody" });
  $("workspace").replaceChildren(
    el("section", { class: "panel person-head" },
      el("div", { class: "person-title" },
        avatar(p, "lg"),
        el("div", { class: "grow" },
          el("h1", {}, p.name),
          el("p", { class: "person-sub" }, [plural(S.docs.length, "document"), unsortedN ? unsortedN + " unsorted" : null, plural(S.creds.length, "credential"), plural(open, "open task")].filter(Boolean).join(" · "))),
        el("button", { class: "btn btn-sm", id: "editPersonBtn", onclick: () => { S.tab = "profile"; renderWorkspace(); document.querySelector("#profileName")?.focus(); } }, "Edit person")),
      el("nav", { class: "tabs" }, tab("docs", "Documents", S.docs.length, false), tab("creds", "Credentials", S.creds.length), tab("tasks", "Tasks", open, false), tab("profile", "Profile"))),
    body);
  ({ docs: renderDocs, creds: renderCreds, tasks: renderTasks, profile: renderProfile })[S.tab](body);
}

/* ---------------- Documents ---------------- */
function filteredDocs() {
  const q = S.f.q.toLowerCase();
  const list = S.docs.filter((d) =>
    (S.f.cat === "All" || catOf(d) === S.f.cat) &&
    (S.f.year === "All" || yearOf(d) === S.f.year) &&
    (!q || [d.title, d.name, d.notes, d.category, d.date].some((v) => (v || "").toLowerCase().includes(q))));
  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "") || b.created - a.created;
  const sorts = {
    "date-desc": (a, b) => (!a.date - !b.date) || byDate(a, b),
    "date-asc": (a, b) => (!a.date - !b.date) || -byDate(a, b),
    "added-desc": (a, b) => b.created - a.created,
    "title": (a, b) => (a.title || "").localeCompare(b.title || ""),
  };
  return list.sort(sorts[S.f.sort]);
}

function allCategories() {
  return [...new Set([...CATEGORIES, ...S.docs.map(catOf)].filter((c) => c !== UNSORTED))].sort();
}

function categoryList() {
  return el("datalist", { id: "catlist" }, [UNSORTED, ...allCategories()].map((c) => el("option", { value: c })));
}

async function uploadFiles(files) {
  files = [...files];
  if (!files.length) return;
  const id = S.person;
  const cat = S.f.cat !== "All" ? S.f.cat : "";
  let ok = 0;
  for (const [i, f] of files.entries()) {
    toast("Adding " + (i + 1) + " of " + files.length + ": " + f.name, false, "upload");
    try {
      await api("POST", "/api/people/" + id + "/docs?name=" + encodeURIComponent(f.name) + (cat ? "&category=" + encodeURIComponent(cat) : ""), f);
      ok++;
    } catch (e) { toast(f.name + ": " + e.message, true); }
  }
  if (ok) toast(plural(ok, "document") + " added" + (cat ? " to " + cat : " to Unsorted"), false, "upload");
  if (S.person === id) refresh();
}

function renderDocs(body) {
  const docs = filteredDocs();
  const picker = el("input", { type: "file", multiple: true, class: "hidden-input", id: "filePicker", onchange: () => uploadFiles(picker.files) });
  const years = [...new Set(S.docs.map(yearOf))].sort().reverse();
  const counts = {};
  for (const d of S.docs) counts[catOf(d)] = (counts[catOf(d)] || 0) + 1;
  const chip = (c, n, warn) => el("button", { class: "chip" + (warn ? " warn" : "") + (S.f.cat === c ? " active" : ""), onclick: () => { S.f.cat = c; S.selected.clear(); renderWorkspace(); } }, c, el("span", {}, String(n)));
  const search = el("input", { type: "search", placeholder: "Filter these documents", value: S.f.q, oninput: () => { S.f.q = search.value; renderList(); } });

  const toolbar = el("div", { class: "toolbar" },
    el("button", { class: "btn btn-primary", onclick: () => picker.click() }, "+ Add files"), picker,
    el("button", { class: "btn", onclick: startPair }, "Scan with phone"),
    el("span", { class: "grow" }),
    search,
    el("select", { "aria-label": "Year", onchange: (e) => { S.f.year = e.target.value; renderWorkspace(); } },
      el("option", { value: "All" }, "All years"), years.map((y) => el("option", { value: y, selected: S.f.year === y }, y))),
    el("select", { "aria-label": "Sort", onchange: (e) => { S.f.sort = e.target.value; renderWorkspace(); } },
      [["date-desc", "Newest document date"], ["date-asc", "Oldest document date"], ["added-desc", "Recently added"], ["title", "Title A–Z"]]
        .map(([v, l]) => el("option", { value: v, selected: S.f.sort === v }, l))));

  const chips = el("div", { class: "chips" }, chip("All", S.docs.length),
    counts[UNSORTED] ? chip(UNSORTED, counts[UNSORTED], true) : null,
    Object.keys(counts).filter((c) => c !== UNSORTED).sort().map((c) => chip(c, counts[c])));

  const listBox = el("div", { class: "docs-list" });
  const detailBox = el("div");
  const bulk = el("div");

  function renderBulk() {
    if (!S.selected.size) { bulk.replaceChildren(); return; }
    const cat = el("input", { list: "catlist", placeholder: "Category" });
    bulk.replaceChildren(el("div", { class: "bulkbar" },
      el("b", {}, S.selected.size + " selected"), cat,
      el("button", { class: "btn btn-sm btn-primary", onclick: async () => {
        if (!cat.value.trim()) return cat.focus();
        for (const id of S.selected) await api("PUT", "/api/docs/" + id, { category: cat.value.trim() });
        toast(plural(S.selected.size, "document") + " moved to " + cat.value.trim());
        S.selected.clear(); refresh();
      } }, "Set category"),
      el("button", { class: "btn btn-sm btn-danger", onclick: async () => {
        if (!confirm("Delete " + plural(S.selected.size, "document") + "? This cannot be undone.")) return;
        for (const id of S.selected) await api("DELETE", "/api/docs/" + id);
        toast(plural(S.selected.size, "document") + " deleted");
        if (S.selected.has(S.openDoc)) S.openDoc = null;
        S.selected.clear(); refresh();
      } }, "Delete"),
      el("button", { class: "btn btn-sm", onclick: () => { S.selected.clear(); renderList(); } }, "Clear")));
  }

  function row(d) {
    const [label, cls] = typeOf(d);
    return el("div", { class: "doc-row" + (S.openDoc === d.id ? " open" : ""), "data-id": d.id, onclick: () => { S.openDoc = d.id; renderList(); } },
      el("input", { type: "checkbox", checked: S.selected.has(d.id), "aria-label": "Select", onclick: (e) => e.stopPropagation(),
        onchange: (e) => { e.target.checked ? S.selected.add(d.id) : S.selected.delete(d.id); renderBulk(); } }),
      el("span", { class: "type " + cls }, label),
      el("div", { style: "min-width:0" }, el("div", { class: "doc-title" }, d.title || d.name), el("div", { class: "doc-sub" }, d.name + (d.notes ? " · " + d.notes : ""))),
      categorySelect(d),
      el("span", { class: "doc-date" }, d.date || "—"),
      el("span", { class: "doc-size" }, fmtSize(d.size)));
  }

  function renderList() {
    const docs = filteredDocs();
    renderBulk();
    if (!S.docs.length) {
      listBox.replaceChildren(el("div", { class: "drop-hint" }, "No documents yet. Drop files anywhere here, use + Add files, or scan with the phone."));
    } else if (!docs.length) {
      listBox.replaceChildren(el("p", { class: "count" }, "No documents match these filters."));
    } else if (S.f.sort.startsWith("date")) {
      const groups = new Map();
      for (const d of docs) { const y = yearOf(d); if (!groups.has(y)) groups.set(y, []); groups.get(y).push(d); }
      listBox.replaceChildren(...[...groups].flatMap(([y, ds]) => [el("h3", { class: "year" }, y, el("span", {}, plural(ds.length, "document"))), ...ds.map(row)]));
    } else {
      listBox.replaceChildren(...docs.map(row));
    }
    const d = S.docs.find((x) => x.id === S.openDoc);
    detailBox.replaceChildren(d ? renderDetail(d) : "");
  }

  body.replaceChildren(categoryList(), toolbar, chips, bulk, el("div", { class: "docs-split" }, listBox, detailBox));
  renderList();

  body.classList.add("docs-drop");
  body.ondragover = (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); body.classList.add("dropping"); } };
  body.ondragleave = (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove("dropping"); };
  body.ondrop = (e) => {
    e.preventDefault();
    body.classList.remove("dropping");
    if (fromPorta(e.dataTransfer)) { toast("That item is already in Porta", true); return; }
    uploadFiles(e.dataTransfer.files);
  };
}

// categorySelect changes a document's category in place, straight from its row.
function categorySelect(d) {
  const cur = catOf(d);
  const s = el("select", { class: "cat-select" + (cur === UNSORTED ? " warn" : ""), "aria-label": "Category of " + (d.title || d.name),
    onclick: (e) => e.stopPropagation(),
    onchange: async () => {
      let cat = s.value;
      if (cat === NEW_CATEGORY) {
        cat = (prompt("Name of the new category") || "").trim();
        if (!cat) { s.value = cur; return; }
      }
      await api("PUT", "/api/docs/" + d.id, { category: cat });
      toast("Moved to " + cat);
      refresh();
    } },
    [UNSORTED, ...new Set([...allCategories(), cur])].filter((c, i, a) => a.indexOf(c) === i).map((c) => el("option", { value: c, selected: c === cur }, c)),
    el("option", { value: NEW_CATEGORY }, "+ New category…"));
  return s;
}

// fromPorta reports whether a drop carries something dragged out of Porta itself, such as a previewed page.
function fromPorta(dt) {
  const urls = [dt.getData("text/uri-list"), dt.getData("text/html")].join(" ");
  return urls.includes(location.origin + "/") || /src="\/api\/|href="\/api\//.test(urls);
}

// Nothing in Porta is meant to be dragged; stopping it here keeps previews and links from being dropped back in as new files.
document.addEventListener("dragstart", (e) => e.preventDefault());
// A file dropped outside the drop area would make the browser open it and leave Porta.
document.addEventListener("dragover", (e) => { if (!e.target.closest?.(".docs-drop")) { e.preventDefault(); e.dataTransfer.dropEffect = "none"; } });
document.addEventListener("drop", (e) => { if (!e.target.closest?.(".docs-drop")) e.preventDefault(); });

function renderDetail(d) {
  const url = "/api/docs/" + d.id + "/file";
  const preview = el("div", { class: "preview" });
  if (d.mime === "application/pdf") preview.append(el("iframe", { src: url, title: "Preview" }));
  else if (/^image\/(jpeg|png|gif|webp)$/.test(d.mime)) preview.append(el("img", { src: url, alt: d.title }));
  else if ((d.mime || "").startsWith("text/plain")) fetch(url).then((r) => r.text()).then((t) => preview.replaceChildren(el("pre", {}, t.slice(0, 200000))));
  else preview.append(el("p", {}, "No preview for this file type. Use Download to open it."));
  const title = el("input", { value: d.title || d.name, required: true });
  const cat = el("input", { value: catOf(d), list: "catlist" });
  const date = el("input", { value: d.date || "", placeholder: "e.g. 2019 or 2019-04-12", pattern: "\\d{4}(-\\d{2}(-\\d{2})?)?" });
  const notes = el("textarea", { rows: 3, placeholder: "What is it, what is it for?" }, d.notes || "");
  return el("aside", { class: "detail" },
    el("div", { class: "detail-head" }, el("h3", {}, d.title || d.name), el("button", { class: "btn btn-sm", onclick: () => { S.openDoc = null; renderWorkspace(); } }, "Close")),
    preview,
    el("form", { onsubmit: async (e) => {
      e.preventDefault();
      await api("PUT", "/api/docs/" + d.id, { title: title.value.trim(), category: cat.value.trim() || UNSORTED, date: date.value.trim(), notes: notes.value });
      toast("Saved"); refresh();
    } },
      el("p", { class: "facts" }, d.name + " · " + fmtSize(d.size) + " · added " + fmtAdded(d.created)),
      el("label", { class: "field" }, el("span", {}, "Title"), title),
      el("div", { class: "grid2" },
        el("label", { class: "field" }, el("span", {}, "Category"), cat),
        el("label", { class: "field" }, el("span", {}, "Document date"), date)),
      el("label", { class: "field" }, el("span", {}, "Notes"), notes),
      el("div", { class: "row-actions" },
        el("button", { class: "btn btn-primary" }, "Save"),
        el("a", { class: "btn", href: url, target: "_blank" }, "Open"),
        el("a", { class: "btn", href: url + "?dl=1" }, "Download"),
        el("button", { type: "button", class: "btn btn-danger", onclick: async () => {
          if (!confirm("Delete " + (d.title || d.name) + "?")) return;
          await api("DELETE", "/api/docs/" + d.id); S.openDoc = null; toast("Deleted"); refresh();
        } }, "Delete"))));
}

/* ---------------- Phone pairing ---------------- */
async function startPair() {
  const id = S.person;
  const r = await api("POST", "/api/pair", { person: id });
  clearInterval(pairTimer);
  document.querySelector(".overlay")?.remove();
  const status = el("p", { class: "status" }, "Waiting for the phone…");
  const close = () => { clearInterval(pairTimer); ov.remove(); };
  const ov = el("div", { class: "overlay", onclick: (e) => { if (e.target === ov) close(); } },
    el("div", { class: "dialog", role: "dialog" },
      el("h2", {}, "Scan with your phone"),
      el("p", {}, "Point the phone camera at this code. The phone must be on the same Wi-Fi. The link works once and expires in 5 minutes."),
      el("img", { src: "/api/pair/qr?" + Date.now(), alt: "QR code" }),
      el("code", {}, r.url), status,
      el("button", { class: "btn", onclick: close }, "Close")));
  document.body.append(ov);
  pairTimer = setInterval(async () => {
    const s = await api("GET", "/api/pair", undefined, true).catch(() => null);
    if (!s) return;
    if (s.done) {
      clearInterval(pairTimer);
      const parts = [s.pages ? "1 scanned PDF (" + plural(s.pages, "page") + ")" : null, s.files ? plural(s.files, "file") : null].filter(Boolean);
      status.textContent = "Received " + parts.join(" and ") + ".";
      toast("Received " + parts.join(" and "));
      if (S.person === id) { S.tab = "docs"; refresh(); }
    } else if (!s.active) {
      clearInterval(pairTimer);
      status.textContent = "This code expired. Close and start again.";
    } else {
      const left = Math.max(0, s.expires - Math.floor(Date.now() / 1000));
      status.textContent = "Waiting for the phone… " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    }
  }, 1000);
}

/* ---------------- Credentials ---------------- */
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what + " copied"); } catch (e) { toast("Copy failed: " + e.message, true); }
}

function renderCreds(body) {
  const editing = S.editCred && S.creds.find((c) => c.id === S.editCred);
  const f = {};
  for (const k of ["label", "url", "username", "password"]) f[k] = el("input", { type: k === "password" ? "password" : "text", autocomplete: "off", value: editing ? (editing[k] || "") : "", placeholder: k === "url" ? "https://…" : "" });
  f.notes = el("textarea", { rows: 2 }, editing ? editing.notes || "" : "");
  f.label.required = true;
  if (editing) api("GET", "/api/creds/" + editing.id).then((c) => { f.password.value = c.password || ""; });
  const form = el("form", { class: "formcard", hidden: !editing && S.creds.length > 0 && !S.addingCred, onsubmit: async (e) => {
    e.preventDefault();
    const rec = {}; for (const k in f) rec[k] = f[k].value;
    if (editing) await api("PUT", "/api/creds/" + editing.id, rec); else await api("POST", "/api/people/" + S.person + "/creds", rec);
    toast(editing ? "Credential updated" : "Credential added");
    S.editCred = null; S.addingCred = false; refresh();
  } },
    el("h3", { style: "margin-bottom:10px" }, editing ? "Edit credential" : "New credential"),
    el("div", { class: "grid2" },
      el("label", { class: "field" }, el("span", {}, "Label"), f.label),
      el("label", { class: "field" }, el("span", {}, "Site / URL"), f.url),
      el("label", { class: "field" }, el("span", {}, "Username"), f.username),
      el("label", { class: "field" }, el("span", {}, "Password"), f.password)),
    el("label", { class: "field" }, el("span", {}, "Notes"), f.notes),
    el("div", { class: "row-actions" }, el("button", { class: "btn btn-primary" }, editing ? "Save changes" : "Add credential"),
      el("button", { type: "button", class: "btn", onclick: () => { S.editCred = null; S.addingCred = false; renderWorkspace(); } }, "Cancel")));

  const cards = S.creds.map((c) => {
    const pw = el("code", {}, "••••••••");
    let shown = false;
    return el("div", { class: "card" },
      el("h3", {}, c.label || "(no label)"),
      c.url ? el("a", { class: "site", href: /^https?:\/\//.test(c.url) ? c.url : null, target: "_blank", rel: "noreferrer" }, c.url) : el("span", { class: "site count" }, "No site"),
      el("div", { class: "kv" }, el("span", {}, "Username"), el("code", {}, c.username || "—"),
        el("button", { class: "btn btn-sm", onclick: () => copy(c.username || "", "Username") }, "Copy")),
      el("div", { class: "kv" }, el("span", {}, "Password"), pw,
        el("span", {},
          el("button", { class: "btn btn-sm", onclick: async (e) => {
            shown = !shown;
            pw.textContent = shown ? (await api("GET", "/api/creds/" + c.id)).password : "••••••••";
            e.target.textContent = shown ? "Hide" : "Reveal";
          } }, "Reveal"), " ",
          el("button", { class: "btn btn-sm", onclick: async () => copy((await api("GET", "/api/creds/" + c.id)).password, "Password") }, "Copy"))),
      c.notes ? el("p", { class: "notes" }, c.notes) : null,
      el("div", { class: "row-actions" },
        el("button", { class: "btn btn-sm", onclick: () => { S.editCred = c.id; renderWorkspace(); } }, "Edit"),
        el("button", { class: "btn btn-sm btn-danger", onclick: async () => {
          if (!confirm("Delete " + c.label + "?")) return;
          await api("DELETE", "/api/creds/" + c.id); toast("Credential deleted"); refresh();
        } }, "Delete")));
  });
  body.replaceChildren(
    el("div", { class: "toolbar" }, el("button", { class: "btn btn-primary", onclick: () => { S.editCred = null; S.addingCred = true; renderWorkspace(); } }, "+ Add credential")),
    form,
    S.creds.length ? el("div", { class: "cards" }, cards) : el("p", { class: "count" }, "No credentials saved for this person."));
}

/* ---------------- Tasks ---------------- */
function renderTasks(body) {
  const text = el("input", { placeholder: "What needs doing? e.g. File 2025 tax return", required: true });
  const item = (t) => {
    const li = el("li", { class: t.done ? "done" : null });
    const view = () => li.replaceChildren(
      el("input", { type: "checkbox", id: "t" + t.id, checked: !!t.done, onchange: async (e) => { await api("PUT", "/api/tasks/" + t.id, { done: e.target.checked }); refresh(); } }),
      el("label", { for: "t" + t.id }, t.text),
      el("button", { class: "btn btn-sm", onclick: edit }, "Edit"),
      el("button", { class: "btn btn-sm btn-danger", onclick: async () => { await api("DELETE", "/api/tasks/" + t.id); refresh(); } }, "Delete"));
    const edit = () => {
      const input = el("input", { value: t.text, required: true });
      li.replaceChildren(el("form", { class: "task-edit", onsubmit: async (e) => {
        e.preventDefault();
        await api("PUT", "/api/tasks/" + t.id, { text: input.value.trim() });
        toast("Task updated"); refresh();
      } }, input, el("button", { class: "btn btn-sm btn-primary" }, "Save"), el("button", { type: "button", class: "btn btn-sm", onclick: view }, "Cancel")));
      input.focus();
    };
    view();
    return li;
  };
  const open = S.tasks.filter((t) => !t.done), done = S.tasks.filter((t) => t.done);
  body.replaceChildren(
    el("form", { class: "task-add", onsubmit: async (e) => {
      e.preventDefault();
      await api("POST", "/api/people/" + S.person + "/tasks", { text: text.value.trim(), done: false });
      await refresh(); document.querySelector(".task-add input")?.focus();
    } }, text, el("button", { class: "btn btn-primary" }, "Add task")),
    open.length ? el("ul", { class: "tasks" }, open.map(item)) : el("p", { class: "count" }, "Nothing open."),
    done.length ? el("details", {}, el("summary", {}, "Done (" + done.length + ")"), el("ul", { class: "tasks" }, done.map(item))) : null);
}

/* ---------------- Profile ---------------- */
function renderProfile(body) {
  const p = current();
  const draft = { icon: Object.hasOwn(ICONS, p.icon || "") ? p.icon : "", color: PALETTE[p.color] ? p.color : "" };
  const name = el("input", { id: "profileName", value: p.name, required: true });
  const notes = el("textarea", { rows: 10, placeholder: "Contact details, situation, deadlines, anything worth remembering…" }, p.notes || "");
  const preview = el("span");
  const iconRow = el("div", { class: "picker" });
  const colorRow = el("div", { class: "picker" });
  function paint() {
    preview.replaceChildren(avatar({ name: name.value, icon: draft.icon, color: draft.color }, "lg"));
    iconRow.replaceChildren(
      el("button", { type: "button", class: "pick initials" + (!draft.icon ? " on" : ""), title: "Initials", "aria-label": "Initials", onclick: () => { draft.icon = ""; paint(); } }, initials(name.value)),
      ...Object.keys(ICONS).map((k) => el("button", { type: "button", class: "pick" + (draft.icon === k ? " on" : ""), title: k, "aria-label": k, onclick: () => { draft.icon = k; paint(); } }, icon(k))));
    colorRow.replaceChildren(
      el("button", { type: "button", class: "swatch auto" + (!draft.color ? " on" : ""), title: "Automatic", onclick: () => { draft.color = ""; paint(); } }, "Auto"),
      ...Object.entries(PALETTE).map(([k, hex]) => el("button", { type: "button", class: "swatch" + (draft.color === k ? " on" : ""), title: k, "aria-label": k, style: "background:" + hex, onclick: () => { draft.color = k; paint(); } })));
  }
  name.addEventListener("input", paint);
  paint();
  body.replaceChildren(
    el("form", { class: "profile", onsubmit: async (e) => {
      e.preventDefault();
      await api("PUT", "/api/people/" + p.id, { name: name.value.trim(), notes: notes.value, icon: draft.icon, color: draft.color });
      toast("Saved"); refresh();
    } },
      el("div", { class: "profile-top" }, preview,
        el("label", { class: "field grow" }, el("span", {}, "Name"), name)),
      el("div", { class: "field" }, el("span", { class: "field-label" }, "Icon"), iconRow),
      el("div", { class: "field" }, el("span", { class: "field-label" }, "Color"), colorRow),
      el("label", { class: "field" }, el("span", {}, "Notes"), notes),
      el("button", { class: "btn btn-primary" }, "Save changes")),
    el("div", { class: "danger-zone" },
      el("p", {}, "Deleting " + p.name + " also deletes all of their documents, credentials and tasks."),
      el("button", { class: "btn btn-danger", onclick: async () => {
        if (!confirm("Delete " + p.name + " and everything stored for them?")) return;
        await api("DELETE", "/api/people/" + p.id);
        S.person = null; toast(p.name + " deleted"); await loadPeople(); renderWorkspace();
      } }, "Delete person")));
}

/* ---------------- Global search ---------------- */
let searchSeq = 0;
$("q").addEventListener("input", async () => {
  const q = $("q").value.trim(), seq = ++searchSeq;
  if (!q) { $("hits").hidden = true; return; }
  const hits = await api("GET", "/api/search?q=" + encodeURIComponent(q));
  if (seq !== searchSeq) return;
  const owner = (id) => (S.people.find((p) => p.id === id) || {}).name || "";
  const group = (kind, title, fn) => {
    const hs = hits.filter((h) => h.kind === kind);
    return hs.length ? [el("h4", {}, title), ...hs.slice(0, 30).map((h) => el("button", { onclick: () => { $("hits").hidden = true; $("q").value = ""; fn(h); } },
      el("span", {}, h.text), el("small", {}, [kind === "people" ? "" : owner(h.person), h.detail].filter(Boolean).join(" · "))))] : [];
  };
  const items = [
    ...group("people", "People", (h) => selectPerson(h.person, "docs")),
    ...group("docs", "Documents", (h) => { S.openDoc = h.id; S.f.cat = "All"; S.f.year = "All"; S.f.q = ""; selectPerson(h.person, "docs").then(() => { S.openDoc = h.id; renderWorkspace(); }); }),
    ...group("creds", "Credentials", (h) => selectPerson(h.person, "creds")),
  ];
  $("hits").replaceChildren(...(items.length ? items : [el("p", { class: "count", style: "padding:8px 10px;margin:0" }, "No matches.")]));
  $("hits").hidden = false;
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) $("hits").hidden = true; });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !$("main").hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
  if (e.key === "Escape") { $("hits").hidden = true; document.querySelector(".overlay .btn")?.click(); }
});

boot();
