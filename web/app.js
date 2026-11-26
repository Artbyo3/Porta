"use strict";
const $ = (id) => document.getElementById(id);
const IDLE_MS = 10 * 60 * 1000;
const SUGGESTED_FOLDERS = ["Identity", "Tax", "Income", "Bank", "Housing", "Medical", "Insurance", "Legal", "Immigration", "Education", "Utilities", "Vehicle"];
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
// UI_ICONS are drawn like ICONS but are not offered as avatars.
const UI_ICONS = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
};

function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name] || UI_ICONS[name]);
  svg.append(path);
  return svg;
}

// folder is the open folder's id, 0 for the person's top level. lastFolder remembers it per person for this session.
const S = {
  people: [], person: null, tab: "docs",
  docs: [], folders: [], creds: [], tasks: [],
  folder: 0, lastFolder: {}, newFolder: false, editFolder: null, draft: null,
  f: { year: "All", q: "", sort: "date-desc" },
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
  // The video starts after the page has loaded, so it never delays it; until then the still frame shows.
  const play = () => {
    v.src = v.canPlayType('video/webm; codecs="vp9"') ? "/media/grass.webm" : "/media/grass.mp4";
    v.play().catch(() => {});
  };
  if (document.readyState === "complete") play(); else addEventListener("load", play, { once: true });
}

/* ---------------- Lock screen ---------------- */
/* ---------------- Connection to the Porta program ---------------- */
const portaUp = () => fetch("/api/state", { headers: { "X-Porta-Poll": "1" } }).then((r) => r.ok, () => false);

// watchAlive keeps a stream open to Porta. Closing the Porta window drops it at once.
function watchAlive() {
  const es = new EventSource("/api/alive");
  es.onerror = async () => {
    es.close();
    if (await portaUp()) setTimeout(watchAlive, 1000);
    else showStopped();
  };
}

// showStopped hides everything the page showed (the vault is locked once Porta is gone), says what happened,
// and reloads by itself when Porta runs again.
function showStopped() {
  clearInterval(pairTimer);
  document.querySelectorAll(".overlay").forEach((o) => o.remove());
  Object.assign(S, { people: [], person: null, docs: [], folders: [], creds: [], tasks: [], openDoc: null });
  S.selected.clear();
  $("workspace").replaceChildren(); $("people").replaceChildren();
  $("main").hidden = true; $("gate").hidden = true;
  const status = el("p", { class: "status" }, "Waiting for Porta to start again…");
  document.body.append(el("div", { class: "overlay stopped", role: "alertdialog", "aria-labelledby": "stoppedTitle" },
    el("div", { class: "dialog" },
      el("div", { class: "brand brand-lg" }, "Porta"),
      el("h2", { id: "stoppedTitle" }, "Porta has stopped"),
      el("p", {}, "The Porta window on this computer was closed, so this page can no longer reach your documents. Your data is safe and stays encrypted on the drive."),
      el("p", {}, "To keep working, start Porta again: double-click ", el("b", {}, "porta.exe"), ". This page reconnects by itself."),
      status)));
  const timer = setInterval(async () => {
    if (!(await portaUp())) return;
    clearInterval(timer);
    status.textContent = "Porta is back. Reloading…";
    location.reload();
  }, 2000);
}

async function boot() {
  startMeadow();
  watchAlive();
  const s = await api("GET", "/api/state", undefined, true);
  if (s.unlocked) showMain(); else showGate(s.initialized);
}

async function showGate(initialized) {
  if (initialized === undefined) initialized = (await (await fetch("/api/state")).json()).initialized;
  clearInterval(pairTimer);
  document.querySelector(".overlay")?.remove();
  Object.assign(S, { people: [], person: null, docs: [], folders: [], creds: [], tasks: [], openDoc: null, folder: 0, lastFolder: {}, newFolder: false, editFolder: null });
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
        el("span", { class: "meta" }, [plural(p.docs, "doc"), p.folders ? plural(p.folders, "folder") : null,
          p.openTasks ? plural(p.openTasks, "open task") : null].filter(Boolean).join(" · ")))))));
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
    if (S.person != null) S.lastFolder[S.person] = S.folder;
    S.f = { year: "All", q: "", sort: S.f.sort };
    Object.assign(S, { folder: S.lastFolder[id] || 0, openDoc: null, editCred: null, newFolder: false, editFolder: null, docs: [], folders: [] });
    S.selected.clear();
  }
  S.person = id;
  if (tab) S.tab = tab;
  renderPeople();
  await loadChildren();
  renderWorkspace();
}

async function loadChildren() {
  const id = S.person;
  const [docs, folders, creds, tasks] = await Promise.all(["docs", "folders", "creds", "tasks"].map((k) => api("GET", "/api/people/" + id + "/" + k)));
  if (S.person !== id) return;
  Object.assign(S, { docs, folders, creds, tasks });
  if (!folderOf(S.folder)) S.folder = 0;
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
      el("p", {}, S.people.length ? "Pick someone on the left to see their documents, credentials and tasks." : "Add your first person. Each person keeps their own folders, documents, credentials and tasks."),
      el("button", { class: "btn btn-primary", onclick: () => $("newPersonBtn").click() }, "+ Add a person")));
    return;
  }
  const open = S.tasks.filter((t) => !t.done).length;
  const tab = (key, label, n) => el("button", { class: S.tab === key ? "active" : null, onclick: () => { S.tab = key; renderWorkspace(); } },
    label, n != null ? el("span", { class: "badge" }, String(n)) : null);
  const body = el("section", { class: "panel tab-body", id: "tabBody" });
  $("workspace").replaceChildren(
    el("section", { class: "panel person-head" },
      el("div", { class: "person-title" },
        avatar(p, "lg"),
        el("div", { class: "grow" },
          el("h1", {}, p.name),
          el("p", { class: "person-sub" }, [plural(S.docs.length, "document"), plural(S.folders.length, "folder"), plural(S.creds.length, "credential"), plural(open, "open task")].join(" · "))),
        el("button", { class: "btn btn-sm", id: "editPersonBtn", onclick: () => { S.tab = "profile"; renderWorkspace(); document.querySelector("#profileName")?.focus(); } }, "Edit person")),
      el("nav", { class: "tabs" }, tab("docs", "Documents", S.docs.length), tab("creds", "Credentials", S.creds.length), tab("tasks", "Tasks", open), tab("profile", "Profile"))),
    body);
  ({ docs: renderDocs, creds: renderCreds, tasks: renderTasks, profile: renderProfile })[S.tab](body);
}

/* ---------------- Folders ---------------- */
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const folderOf = (id) => S.folders.find((f) => f.id === id);
const subfolders = (id) => S.folders.filter((f) => f.parent === id).sort(byName);

// trail lists the folders from the top level down to id.
function trail(id) {
  const out = [];
  for (let f = folderOf(id); f; f = folderOf(f.parent)) out.unshift(f);
  return out;
}

const folderName = (id) => id ? folderOf(id)?.name || "" : "the top level";
const placeName = (id) => [current()?.name, ...trail(id).map((f) => f.name)].join(" / ");

// deepCount counts the documents and folders inside a folder, at every depth.
function deepCount(id) {
  let docs = S.docs.filter((d) => d.folder === id).length, folders = 0;
  for (const f of subfolders(id)) {
    const c = deepCount(f.id);
    docs += c.docs; folders += 1 + c.folders;
  }
  return { docs, folders };
}

const countText = ({ docs, folders }) => [folders ? plural(folders, "folder") : null, docs ? plural(docs, "document") : null].filter(Boolean).join(" · ") || "Empty";

// folderOptions lists every place a document or folder can go, in tree order. skip leaves out a folder and everything inside it.
function folderOptions(selected, skip) {
  const out = [el("option", { value: 0, selected: selected === 0 }, "Top level of " + current().name)];
  const walk = (parent, depth) => {
    for (const f of subfolders(parent)) {
      if (f.id === skip) continue;
      out.push(el("option", { value: f.id, selected: selected === f.id }, "   ".repeat(depth) + f.name));
      walk(f.id, depth + 1);
    }
  };
  walk(0, 1);
  return out;
}

function openFolder(id) {
  Object.assign(S, { folder: folderOf(id) ? id : 0, openDoc: null, editFolder: null, newFolder: false, draft: null });
  S.f.year = "All";
  S.f.q = "";
  S.selected.clear();
  renderWorkspace();
}

async function createFolder(name, parent, open) {
  try {
    const r = await api("POST", "/api/people/" + S.person + "/folders", { name, parent });
    toast("Created " + name);
    await refresh();
    if (open) openFolder(r.id);
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

// moveItems puts documents and folders into the target folder, then reports what moved.
async function moveItems({ docs = [], folders = [] }, target) {
  let moved = 0, failed = 0;
  for (const id of docs) {
    if (S.docs.find((d) => d.id === id)?.folder === target) continue;
    try { await api("PUT", "/api/docs/" + id, { folder: target }); moved++; } catch (e) { failed++; toast(e.message, true); }
  }
  for (const id of folders) {
    if (id === target || folderOf(id)?.parent === target) continue;
    try { await api("PUT", "/api/folders/" + id, { parent: target }); moved++; } catch (e) { failed++; toast(e.message, true); }
  }
  if (moved) toast("Moved " + plural(moved, "item") + " to " + folderName(target));
  else if (!failed) toast("Already in " + folderName(target) + ". Pick another folder to move to.");
  S.selected.clear();
  await refresh();
}

async function deleteFolder(f) {
  const c = deepCount(f.id);
  if ((c.docs || c.folders) && !confirm("Delete the folder " + f.name + " and everything in it (" + countText(c) + ")? This cannot be undone.")) return;
  await api("DELETE", "/api/folders/" + f.id);
  if (trail(S.folder).some((t) => t.id === f.id)) S.folder = f.parent;
  toast("Deleted " + f.name);
  refresh();
}

/* ---------------- Drag and drop ---------------- */
const DRAG = "application/x-porta-items";

function dragItems(e, items) {
  e.stopPropagation();
  e.dataTransfer.setData(DRAG, JSON.stringify(items));
  e.dataTransfer.effectAllowed = "move";
}

// dropInto makes an element accept documents and folders dragged inside Porta, and files dropped from the computer.
function dropInto(target) {
  const accepts = (e) => [...e.dataTransfer.types].some((t) => t === DRAG || t === "Files");
  return {
    ondragover: (e) => { if (!accepts(e)) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add("drop-on"); },
    ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove("drop-on"); },
    ondrop: (e) => {
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.classList.remove("drop-on");
      document.querySelector(".dropping")?.classList.remove("dropping");
      const items = e.dataTransfer.getData(DRAG);
      if (items) moveItems(JSON.parse(items), target);
      else if (fromPorta(e.dataTransfer)) toast("That item is already in Porta", true);
      else uploadFiles(e.dataTransfer.files, target);
    },
  };
}

/* ---------------- Documents ---------------- */
// filteredDocs returns the documents of the open folder, or, while searching, matching documents from every folder.
function filteredDocs() {
  const q = S.f.q.trim().toLowerCase();
  const list = S.docs.filter((d) =>
    (q ? [d.title, d.name, d.notes, d.date].some((v) => (v || "").toLowerCase().includes(q)) : d.folder === S.folder) &&
    (S.f.year === "All" || yearOf(d) === S.f.year));
  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "") || b.created - a.created;
  const sorts = {
    "date-desc": (a, b) => (!a.date - !b.date) || byDate(a, b),
    "date-asc": (a, b) => (!a.date - !b.date) || -byDate(a, b),
    "added-desc": (a, b) => b.created - a.created,
    "title": (a, b) => (a.title || "").localeCompare(b.title || ""),
  };
  return list.sort(sorts[S.f.sort]);
}

async function uploadFiles(files, folder = S.folder) {
  files = [...files];
  if (!files.length) return;
  const id = S.person, where = folderName(folder);
  let ok = 0;
  for (const [i, f] of files.entries()) {
    toast("Adding " + (i + 1) + " of " + files.length + ": " + f.name, false, "upload");
    try {
      await api("POST", "/api/people/" + id + "/docs?name=" + encodeURIComponent(f.name) + "&folder=" + folder, f);
      ok++;
    } catch (e) { toast(f.name + ": " + e.message, true); }
  }
  if (ok) toast(plural(ok, "document") + " added to " + where, false, "upload");
  if (S.person === id) refresh();
}

function renderDocs(body) {
  const p = current();
  const picker = el("input", { type: "file", multiple: true, class: "hidden-input", id: "filePicker", onchange: () => uploadFiles(picker.files) });
  const years = [...new Set(S.docs.map(yearOf))].sort().reverse();
  const search = el("input", { type: "search", placeholder: "Search all of " + p.name + "'s documents", value: S.f.q,
    oninput: () => { S.f.q = search.value; S.selected.clear(); renderList(); } });

  const crumb = (id, label) => id === S.folder
    ? el("span", { class: "crumb here", "aria-current": "location", ...dropInto(id) }, label)
    : el("button", { class: "crumb", onclick: () => openFolder(id), ...dropInto(id) }, label);
  const crumbs = el("nav", { class: "crumbs", "aria-label": "Folder path" },
    S.folder ? el("button", { class: "btn btn-sm up", title: "Up one folder (Backspace)", onclick: () => openFolder(folderOf(S.folder).parent) }, "← Up") : null,
    crumb(0, p.name), trail(S.folder).flatMap((f) => [el("span", { class: "sep", "aria-hidden": "true" }, "/"), crumb(f.id, f.name)]));

  const toolbar = el("div", { class: "toolbar" },
    el("button", { class: "btn", onclick: () => { S.newFolder = true; S.f.q = ""; renderWorkspace(); } }, "+ New folder"),
    el("button", { class: "btn btn-primary", onclick: () => picker.click() }, "+ Add files"), picker,
    el("button", { class: "btn", onclick: startPair }, "Scan with phone"),
    el("span", { class: "grow" }),
    search,
    el("select", { "aria-label": "Year", onchange: (e) => { S.f.year = e.target.value; S.selected.clear(); renderWorkspace(); } },
      el("option", { value: "All" }, "All years"), years.map((y) => el("option", { value: y, selected: S.f.year === y }, y))),
    el("select", { "aria-label": "Sort", onchange: (e) => { S.f.sort = e.target.value; renderWorkspace(); } },
      [["date-desc", "Newest document date"], ["date-asc", "Oldest document date"], ["added-desc", "Recently added"], ["title", "Title A–Z"]]
        .map(([v, l]) => el("option", { value: v, selected: S.f.sort === v }, l))));

  const listBox = el("div", { class: "docs-list" });
  const detailBox = el("div", { class: "detail-slot" });
  const bulk = el("div");

  function renderBulk() {
    if (!S.selected.size) { bulk.replaceChildren(); return; }
    const to = el("select", { "aria-label": "Move to folder" }, folderOptions(S.folder));
    bulk.replaceChildren(el("div", { class: "bulkbar" },
      el("b", {}, S.selected.size + " selected"),
      el("button", { class: "btn btn-sm", onclick: () => { for (const d of filteredDocs()) S.selected.add(d.id); renderList(); } }, "Select all"),
      el("span", { class: "grow" }),
      to,
      el("button", { class: "btn btn-sm btn-primary", onclick: () => moveItems({ docs: [...S.selected] }, Number(to.value)) }, "Move"),
      el("button", { class: "btn btn-sm btn-danger", onclick: async () => {
        if (!confirm("Delete " + plural(S.selected.size, "document") + "? This cannot be undone.")) return;
        for (const id of S.selected) await api("DELETE", "/api/docs/" + id);
        toast(plural(S.selected.size, "document") + " deleted");
        if (S.selected.has(S.openDoc)) S.openDoc = null;
        S.selected.clear(); refresh();
      } }, "Delete"),
      el("button", { class: "btn btn-sm", onclick: () => { S.selected.clear(); renderList(); } }, "Clear")));
  }

  // folderForm keeps the typed name in S.draft, so a refresh while typing (an upload or a phone scan finishing) does not lose it.
  function folderForm(key, label, value, submit) {
    const kept = S.draft?.key === key;
    const input = el("input", { value: kept ? S.draft.value : value, placeholder: "Folder name", required: true, "aria-label": "Folder name", autofocus: true, "data-select": !kept,
      oninput: () => { S.draft = { key, value: input.value }; } });
    const cancel = () => { S.newFolder = false; S.editFolder = null; S.draft = null; renderWorkspace(); };
    const form = el("form", { class: "folder-form", onsubmit: async (e) => { e.preventDefault(); if (await submit(input.value.trim())) cancel(); } },
      el("span", { class: "folder-ico" }, icon("folder")), input,
      el("button", { class: "btn btn-sm btn-primary" }, label),
      el("button", { type: "button", class: "btn btn-sm", onclick: cancel }, "Cancel"));
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } });
    return form;
  }

  function folderRow(f, showPath) {
    const ed = S.editFolder;
    if (ed?.id === f.id && ed.mode === "rename") {
      return folderForm("rename" + f.id, "Rename", f.name, async (name) => {
        try { await api("PUT", "/api/folders/" + f.id, { name }); toast("Renamed to " + name); await refresh(); return true; } catch (e) { toast(e.message, true); return false; }
      });
    }
    if (ed?.id === f.id && ed.mode === "move") {
      const to = el("select", { "aria-label": "Move " + f.name + " to" }, folderOptions(f.parent, f.id));
      return el("form", { class: "folder-form", onsubmit: (e) => { e.preventDefault(); S.editFolder = null; moveItems({ folders: [f.id] }, Number(to.value)); } },
        el("span", { class: "folder-ico" }, icon("folder")), el("b", {}, "Move " + f.name + " to"), to,
        el("button", { class: "btn btn-sm btn-primary" }, "Move"),
        el("button", { type: "button", class: "btn btn-sm", onclick: () => { S.editFolder = null; renderList(); } }, "Cancel"));
    }
    const tool = (label, fn, cls) => el("button", { class: "btn btn-sm" + (cls ? " " + cls : ""), onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    return el("div", { class: "folder-row", draggable: "true", tabindex: 0, role: "button", "aria-label": "Open folder " + f.name,
      onclick: () => openFolder(f.id), onkeydown: (e) => { if (e.key === "Enter" && e.target === e.currentTarget) openFolder(f.id); },
      ondragstart: (e) => dragItems(e, { folders: [f.id] }), ...dropInto(f.id) },
      el("span", { class: "folder-ico" }, icon("folder")),
      el("div", { style: "min-width:0" },
        el("div", { class: "doc-title" }, f.name),
        el("div", { class: "doc-sub" }, showPath ? "In " + placeName(f.parent) : countText(deepCount(f.id)))),
      el("span", { class: "row-tools" },
        tool("Rename", () => { S.editFolder = { id: f.id, mode: "rename" }; renderList(); }),
        tool("Move", () => { S.editFolder = { id: f.id, mode: "move" }; renderList(); }),
        tool("Delete", () => deleteFolder(f), "btn-danger")));
  }

  function docRow(d, showPath) {
    const [label, cls] = typeOf(d);
    return el("div", { class: "doc-row" + (S.openDoc === d.id ? " open" : ""), "data-id": d.id, draggable: "true",
      ondragstart: (e) => dragItems(e, { docs: S.selected.has(d.id) ? [...S.selected] : [d.id] }),
      onclick: () => { S.openDoc = d.id; renderList(); } },
      el("input", { type: "checkbox", checked: S.selected.has(d.id), "aria-label": "Select", onclick: (e) => e.stopPropagation(),
        onchange: (e) => { e.target.checked ? S.selected.add(d.id) : S.selected.delete(d.id); renderBulk(); } }),
      el("span", { class: "type " + cls }, label),
      el("div", { style: "min-width:0" }, el("div", { class: "doc-title" }, d.title || d.name),
        el("div", { class: "doc-sub" }, showPath ? "In " + placeName(d.folder) : d.name + (d.notes ? " · " + d.notes : ""))),
      el("span", { class: "doc-date" }, d.date || "—"),
      el("span", { class: "doc-size" }, fmtSize(d.size)));
  }

  function docSection(docs, showPath) {
    if (!S.f.sort.startsWith("date")) return docs.map((d) => docRow(d, showPath));
    const groups = new Map();
    for (const d of docs) { const y = yearOf(d); if (!groups.has(y)) groups.set(y, []); groups.get(y).push(d); }
    return [...groups].flatMap(([y, ds]) => [el("h3", { class: "year" }, y, el("span", {}, plural(ds.length, "document"))), ...ds.map((d) => docRow(d, showPath))]);
  }

  function quickStart() {
    const box = el("div", { class: "quick" }, el("p", { class: "count" }, "Start with some common folders, or make your own with + New folder:"));
    box.append(el("div", { class: "chips" }, SUGGESTED_FOLDERS.map((name) => el("button", { class: "chip", onclick: async (e) => { e.target.disabled = true; if (!await createFolder(name, 0, false)) e.target.disabled = false; } }, "+ " + name))));
    return box;
  }

  function renderList() {
    renderBulk();
    const docs = filteredDocs();
    const q = S.f.q.trim().toLowerCase();
    if (q) {
      const folders = S.folders.filter((f) => f.name.toLowerCase().includes(q)).sort(byName);
      listBox.replaceChildren(...(folders.length || docs.length
        ? [folders.length ? el("h3", { class: "year" }, "Folders", el("span", {}, String(folders.length))) : null, ...folders.map((f) => folderRow(f, true)),
          ...(docs.length ? [el("h3", { class: "year" }, "Documents", el("span", {}, docs.length + (docs.length === 1 ? " match" : " matches"))), ...docs.map((d) => docRow(d, true))] : [])]
        : [el("p", { class: "count" }, "Nothing in " + p.name + "'s folders matches “" + S.f.q.trim() + "”.")]).filter(Boolean));
    } else {
      const folders = subfolders(S.folder);
      const here = S.docs.filter((d) => d.folder === S.folder);
      const where = S.folder ? folderOf(S.folder).name : p.name + "'s top level";
      listBox.replaceChildren(...[
        S.newFolder ? folderForm("new" + S.folder, "Create", "", (name) => createFolder(name, S.folder, true)) : null,
        ...folders.map((f) => folderRow(f, false)),
        folders.length && here.length ? el("div", { class: "divider" }) : null,
        ...(here.length && !docs.length ? [el("p", { class: "count" }, "No documents here match this year.")] : docSection(docs, false)),
        !folders.length && !here.length && !S.newFolder ? el("div", { class: "drop-hint" }, "Nothing in " + where + " yet. Drop files here, use + Add files, or scan with the phone.") : null,
        !S.folders.length && !S.folder ? quickStart() : null,
      ].filter(Boolean));
    }
    const d = S.docs.find((x) => x.id === S.openDoc);
    detailBox.replaceChildren(d ? renderDetail(d) : "");
    const input = listBox.querySelector("input[autofocus]");
    if (input) { input.focus(); if (input.dataset.select != null) input.select(); }
  }

  body.replaceChildren(crumbs, toolbar, bulk, el("div", { class: "docs-split" }, listBox, detailBox));
  renderList();

  body.classList.add("docs-drop");
  body.dataset.dropLabel = "Drop files to add them to " + (S.folder ? folderOf(S.folder).name : p.name);
  body.ondragover = (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); body.classList.add("dropping"); } };
  body.ondragleave = (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove("dropping"); };
  body.ondrop = (e) => {
    e.preventDefault();
    body.classList.remove("dropping");
    if (e.dataTransfer.types.includes(DRAG)) return;
    if (fromPorta(e.dataTransfer)) { toast("That item is already in Porta", true); return; }
    uploadFiles(e.dataTransfer.files);
  };
}

// fromPorta reports whether a drop carries something dragged out of Porta itself, such as a previewed page.
function fromPorta(dt) {
  const urls = [dt.getData("text/uri-list"), dt.getData("text/html")].join(" ");
  return urls.includes(location.origin + "/") || /src="\/api\/|href="\/api\//.test(urls);
}

// Only document and folder rows may be dragged; stopping everything else keeps previews and links from being dropped back in as new files.
document.addEventListener("dragstart", (e) => { if (!e.target.closest?.('[draggable="true"]')) e.preventDefault(); });
// A file dropped outside the drop area would make the browser open it and leave Porta.
document.addEventListener("dragover", (e) => { if (!e.target.closest?.(".docs-drop")) { e.preventDefault(); e.dataTransfer.dropEffect = "none"; } });
document.addEventListener("drop", (e) => { if (!e.target.closest?.(".docs-drop")) e.preventDefault(); });

const fileURL = (d) => "/api/docs/" + d.id + "/file";

// docPreview shows a document inside Porta: in the side panel, or full size in the viewer (big). Images zoom on click in the viewer.
function docPreview(d, big) {
  const url = fileURL(d);
  const box = el("div", { class: big ? "viewer-body" : "preview", onclick: big ? null : (e) => { if (!e.target.closest("a, button")) openViewer(d.id); } });
  if (d.mime === "application/pdf") box.append(el("iframe", { src: url, title: "Preview of " + (d.title || d.name) }));
  else if (/^image\/(jpeg|png|gif|webp)$/.test(d.mime)) {
    const img = el("img", { src: url, alt: d.title || d.name, title: big ? "Click to zoom" : "Click for full screen" });
    if (big) img.addEventListener("click", () => img.classList.toggle("zoomed"));
    box.append(img);
  } else if ((d.mime || "").startsWith("text/plain")) fetch(url).then((r) => r.text()).then((t) => box.replaceChildren(el("pre", {}, t.slice(0, 200000))));
  else box.append(el("div", { class: "no-preview" }, el("p", {}, "No preview for this file type."), el("a", { class: "btn btn-sm", href: url + "?dl=1" }, "Download " + d.name)));
  return box;
}

// openViewer shows a document full screen, with the documents of the current list one arrow key away.
function openViewer(id) {
  document.querySelector(".viewer")?.remove();
  const list = filteredDocs().map((d) => d.id);
  if (!list.includes(id)) list.unshift(id);
  let i = list.indexOf(id);
  const head = el("div", { class: "viewer-head" });
  const stage = el("div", { class: "viewer-stage" });
  const ov = el("div", { class: "overlay viewer", "data-start": id, role: "dialog", "aria-modal": "true", "aria-label": "Document viewer" }, head, stage);
  const show = () => {
    const d = S.docs.find((x) => x.id === list[i]);
    if (!d) return closeViewer();
    S.openDoc = d.id;
    const many = list.length > 1;
    head.replaceChildren(
      el("div", { class: "viewer-title" }, el("b", {}, d.title || d.name),
        el("small", {}, [placeName(d.folder), d.name, fmtSize(d.size), many ? (i + 1) + " of " + list.length : null].filter(Boolean).join(" · "))),
      many ? el("button", { class: "btn btn-sm", title: "Previous (←)", onclick: () => ov.step(-1) }, "‹ Prev") : null,
      many ? el("button", { class: "btn btn-sm", title: "Next (→)", onclick: () => ov.step(1) }, "Next ›") : null,
      el("a", { class: "btn btn-sm", href: fileURL(d) + "?dl=1" }, "Download"),
      el("button", { class: "btn btn-sm btn-primary", "data-close": true, title: "Close (Esc)", onclick: closeViewer }, "Close"));
    stage.replaceChildren(docPreview(d, true));
  };
  ov.step = (n) => { i = (i + n + list.length) % list.length; show(); };
  document.body.append(ov);
  show();
}

// closeViewer re-renders only when the viewer moved to another document, so unsaved edits in the side panel survive.
function closeViewer() {
  const v = document.querySelector(".viewer");
  if (!v) return;
  v.remove();
  if (Number(v.dataset.start) !== S.openDoc && S.tab === "docs") renderWorkspace();
}

function renderDetail(d) {
  const url = fileURL(d);
  const preview = docPreview(d, false);
  const title = el("input", { value: d.title || d.name, required: true });
  const folder = el("select", {}, folderOptions(d.folder));
  const date = el("input", { value: d.date || "", placeholder: "e.g. 2019 or 2019-04-12", pattern: "\\d{4}(-\\d{2}(-\\d{2})?)?" });
  const notes = el("textarea", { rows: 3, placeholder: "What is it, what is it for?" }, d.notes || "");
  return el("aside", { class: "detail" },
    el("div", { class: "detail-head" }, el("h3", {}, d.title || d.name),
      el("button", { class: "btn btn-sm btn-primary", title: "Full screen", onclick: () => openViewer(d.id) }, "⤢ Full screen"),
      el("button", { class: "btn btn-sm", onclick: () => { S.openDoc = null; renderWorkspace(); } }, "Close")),
    preview,
    el("form", { onsubmit: async (e) => {
      e.preventDefault();
      const to = Number(folder.value);
      await api("PUT", "/api/docs/" + d.id, { title: title.value.trim(), folder: to, date: date.value.trim(), notes: notes.value });
      toast(to === d.folder ? "Saved" : "Saved and moved to " + folderName(to)); refresh();
    } },
      el("p", { class: "facts" }, d.name + " · " + fmtSize(d.size) + " · added " + fmtAdded(d.created)),
      el("label", { class: "field" }, el("span", {}, "Title"), title),
      el("div", { class: "grid2" },
        el("label", { class: "field" }, el("span", {}, "Folder"), folder),
        el("label", { class: "field" }, el("span", {}, "Document date"), date)),
      el("label", { class: "field" }, el("span", {}, "Notes"), notes),
      el("div", { class: "row-actions" },
        el("button", { class: "btn btn-primary" }, "Save"),
        el("a", { class: "btn", href: url + "?dl=1" }, "Download"),
        el("button", { type: "button", class: "btn btn-danger", onclick: async () => {
          if (!confirm("Delete " + (d.title || d.name) + "?")) return;
          await api("DELETE", "/api/docs/" + d.id); S.openDoc = null; toast("Deleted"); refresh();
        } }, "Delete"))));
}

/* ---------------- Phone pairing ---------------- */
async function startPair() {
  const id = S.person, folder = S.folder;
  const r = await api("POST", "/api/pair", { person: id, folder });
  clearInterval(pairTimer);
  document.querySelector(".overlay")?.remove();
  const status = el("p", { class: "status" }, "Waiting for the phone…");
  const help = el("div", { class: "pair-help", hidden: true });
  const started = Date.now();
  const close = () => { clearInterval(pairTimer); ov.remove(); };
  const ov = el("div", { class: "overlay", onclick: (e) => { if (e.target === ov) close(); } },
    el("div", { class: "dialog", role: "dialog" },
      el("h2", {}, "Scan with your phone"),
      el("p", {}, "Point the phone camera at this code. The phone must be on the same Wi-Fi. The link works once and expires in 5 minutes."),
      el("p", {}, "Saves to ", el("b", {}, placeName(folder))),
      el("img", { src: "/api/pair/qr?" + Date.now(), alt: "QR code" }),
      el("code", {}, r.url), status, help,
      el("button", { class: "btn", "data-close": true, onclick: close }, "Close")));
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
      status.textContent = (s.reached ? "Phone connected. Waiting for it to send… " : "Waiting for the phone… ") + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
      if (s.reached) help.hidden = true;
      else if (help.hidden && !help.dataset.shown && Date.now() - started > PHONE_HELP_AFTER) showPhoneHelp(help, s.canAllow);
    }
  }, 1000);
}

const PHONE_HELP_AFTER = 7000;

// showPhoneHelp explains what to do when no phone has reached Porta, and on Windows offers to fix it.
// Windows ties firewall permission to the program's place on the drive, which breaks for a USB stick,
// so Porta asks Windows (with its administrator prompt) to let phones on this network reach its port instead.
function showPhoneHelp(help, canAllow) {
  help.dataset.shown = "1";
  const msg = el("p", { class: "pair-help-msg" });
  const button = canAllow ? el("button", { class: "btn btn-primary btn-sm", onclick: async () => {
    button.disabled = true;
    button.textContent = "Waiting for Windows…";
    msg.textContent = "Choose Yes in the Windows prompt. It may be behind this window.";
    try {
      await api("POST", "/api/allow-phones");
      button.remove();
      msg.textContent = "Done. Phones on this network can reach Porta now. Scan the code again, or reload the page on the phone.";
    } catch (e) {
      button.disabled = false;
      button.textContent = "Try again";
      msg.textContent = e.message;
    }
  } }, "Allow phone access") : null;
  help.replaceChildren(
    el("b", {}, "Phone not loading?"),
    el("p", {}, "If your phone shows a blank or black page, it can't reach this computer. Check that it is on the same Wi-Fi."),
    canAllow
      ? el("p", {}, "On the same Wi-Fi, Windows is blocking it. This happens most when Porta runs from a USB stick. Porta can ask Windows to let phones on this network in; you only do this once on each computer.")
      : el("p", {}, "On the same Wi-Fi, this computer's firewall is blocking it. Allow incoming connections on port 8787."),
    button, msg);
  help.hidden = false;
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
      el("p", {}, "Deleting " + p.name + " also deletes all of their folders, documents, credentials and tasks."),
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
    ...group("folders", "Folders", (h) => goTo(h.person, h.folder)),
    ...group("docs", "Documents", (h) => goTo(h.person, h.folder, h.id)),
    ...group("creds", "Credentials", (h) => selectPerson(h.person, "creds")),
  ];
  $("hits").replaceChildren(...(items.length ? items : [el("p", { class: "count", style: "padding:8px 10px;margin:0" }, "No matches.")]));
  $("hits").hidden = false;
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) $("hits").hidden = true; });

// goTo opens a person's documents at a folder, and optionally a document in it.
async function goTo(person, folder, doc) {
  await selectPerson(person, "docs");
  S.f.q = "";
  openFolder(folder);
  if (doc) { S.openDoc = doc; renderWorkspace(); }
}
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  const viewer = document.querySelector(".viewer");
  if (viewer && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); viewer.step(e.key === "ArrowLeft" ? -1 : 1); return; }
  if (e.key === "/" && !$("main").hidden && !typing && !viewer) { e.preventDefault(); $("q").focus(); }
  if (e.key === "Backspace" && !typing && !$("main").hidden && S.tab === "docs" && S.folder && !document.querySelector(".overlay")) { e.preventDefault(); openFolder(folderOf(S.folder).parent); }
  if (e.key === "Escape") { $("hits").hidden = true; document.querySelector(".overlay [data-close]")?.click(); }
});

boot();
