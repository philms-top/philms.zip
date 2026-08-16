const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let films = [];
let currentDraft = null;     // new entry being built from a TMDB result
let currentEdit = null;      // existing entry open in the modal { ...row, _dirty }
let activeStatusFilter = "all";
let activeLoggedByFilter = "all";
let activeTagFilter = "";
let activeDirectorFilter = "";
let yearFrom = null;
let yearTo = null;
let activeSort = "added_desc";

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showMain();
  } else {
    showLogin();
  }
}

function showLogin() {
  el("login-screen").hidden = false;
  el("main-screen").hidden = true;
}

async function showMain() {
  el("login-screen").hidden = true;
  el("main-screen").hidden = false;
  await loadFilms();
}

el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = el("login-email").value.trim();
  const password = el("login-password").value;
  const errEl = el("login-error");
  errEl.hidden = true;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = error.message;
    errEl.hidden = false;
    return;
  }
  showMain();
});

el("logout-btn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  showLogin();
});

// ---------------------------------------------------------------------------
// TMDB search → new entry draft
// ---------------------------------------------------------------------------
el("search-btn").addEventListener("click", runSearch);
el("search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runSearch(); }
});

async function runSearch() {
  const query = el("search-input").value.trim();
  if (!query) return;

  const resultsEl = el("search-results");
  resultsEl.hidden = false;
  resultsEl.innerHTML = `<p class="no-results">Searching…</p>`;
  hideDraft();

  try {
    const res = await fetch(`/api/search-movie?type=search&query=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      resultsEl.innerHTML = `<p class="no-results">No matches. Try a different spelling, or the original-language title.</p>`;
      return;
    }

    resultsEl.innerHTML = "";
    data.results.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "result-card-btn";
      btn.innerHTML = `
        <div class="result-card">
          <img src="${m.poster_path || placeholderPoster()}" alt="">
          <div class="rc-label">
            <div class="rc-title">${escapeHtml(m.title)}</div>
            <div class="rc-year">${m.year || "—"}</div>
          </div>
        </div>`;
      btn.addEventListener("click", () => selectResult(m.id));
      resultsEl.appendChild(btn);
    });
  } catch (err) {
    resultsEl.innerHTML = `<p class="no-results">Search failed. Check your connection and try again.</p>`;
  }
}

async function selectResult(tmdbId) {
  const res = await fetch(`/api/search-movie?type=details&id=${tmdbId}`);
  const data = await res.json();
  if (!data.details) return;

  currentDraft = {
    ...data.details,
    status: "not_watched",
    rating: "",
    logged_by: "",
  };
  renderDraft();
}

function renderDraft() {
  el("search-results").hidden = true;
  const panel = el("draft-panel");
  panel.hidden = false;

  el("draft-poster-img").src = currentDraft.poster_path || placeholderPoster();
  el("draft-title").textContent = currentDraft.title;
  const metaBits = [currentDraft.year, currentDraft.runtime ? `${currentDraft.runtime} min` : null, (currentDraft.genres || []).join(", ")].filter(Boolean);
  el("draft-meta").textContent = metaBits.join("  ·  ");
  el("draft-director").value = currentDraft.director || "";
  el("draft-tags").value = "";
  el("draft-notes").value = "";

  syncToggleGroup("status", "field", currentDraft.status);
  syncToggleGroup("rating", "field", currentDraft.rating);
  syncToggleGroup("logged_by", "field", currentDraft.logged_by);
}

function hideDraft() {
  el("draft-panel").hidden = true;
  currentDraft = null;
}

document.querySelectorAll(".toggle-btn[data-field]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const field = btn.dataset.field;
    const value = btn.dataset.value;
    if (!currentDraft) return;
    currentDraft[field] = value;
    syncToggleGroup(field, "field", value);
  });
});

document.querySelectorAll(".toggle-btn[data-mfield]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const field = btn.dataset.mfield;
    const value = btn.dataset.value;
    if (!currentEdit) return;
    currentEdit[field] = value;
    syncToggleGroup(field, "mfield", value);
  });
});

function syncToggleGroup(field, attr, value) {
  document.querySelectorAll(`.toggle-btn[data-${attr}="${field}"]`).forEach((b) => {
    b.classList.toggle("is-selected", b.dataset.value === value);
  });
}

el("draft-cancel").addEventListener("click", () => {
  hideDraft();
  el("search-results").hidden = true;
  el("search-input").value = "";
});

el("draft-save").addEventListener("click", async () => {
  if (!currentDraft) return;
  const { data: { user } } = await supabaseClient.auth.getUser();

  const tags = el("draft-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  const notes = el("draft-notes").value.trim();
  const director = el("draft-director").value.trim();

  const record = {
    user_id: user.id,
    title: currentDraft.title,
    tmdb_id: currentDraft.id,
    release_year: currentDraft.year ? parseInt(currentDraft.year, 10) : null,
    director,
    genres: currentDraft.genres || [],
    poster_path: currentDraft.poster_path,
    runtime: currentDraft.runtime,
    status: currentDraft.status,
    rating: currentDraft.rating || null,
    logged_by: currentDraft.logged_by || null,
    tags,
    notes,
    watched_at: currentDraft.status === "watched" ? new Date().toISOString() : null,
  };

  const { error } = await supabaseClient.from("films").insert(record);
  if (error) {
    alert("Couldn't save: " + error.message);
    return;
  }

  hideDraft();
  el("search-results").hidden = true;
  el("search-input").value = "";
  await loadFilms();
});

// ---------------------------------------------------------------------------
// Edit modal (existing entries)
// ---------------------------------------------------------------------------
function openEditModal(f, indexInFullList) {
  currentEdit = { ...f };

  el("modal-index").textContent = `No. ${String(indexInFullList).padStart(3, "0")}`;
  el("modal-poster-img").src = f.poster_path || placeholderPoster();
  el("modal-title").textContent = f.title;
  const metaBits = [f.release_year, f.runtime ? `${f.runtime} min` : null, (f.genres || []).join(", ")].filter(Boolean);
  el("modal-meta").textContent = metaBits.join("  ·  ");
  el("modal-director").value = f.director || "";
  el("modal-tags").value = (f.tags || []).join(", ");
  el("modal-notes").value = f.notes || "";

  syncToggleGroup("status", "mfield", f.status);
  syncToggleGroup("rating", "mfield", f.rating);
  syncToggleGroup("logged_by", "mfield", f.logged_by);

  el("edit-modal").hidden = false;
}

function closeEditModal() {
  el("edit-modal").hidden = true;
  currentEdit = null;
}

el("modal-close").addEventListener("click", closeEditModal);
el("edit-modal").addEventListener("click", (e) => {
  if (e.target.id === "edit-modal") closeEditModal();
});

el("modal-save").addEventListener("click", async () => {
  if (!currentEdit) return;

  const tags = el("modal-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  const notes = el("modal-notes").value.trim();
  const director = el("modal-director").value.trim();

  const updates = {
    status: currentEdit.status,
    rating: currentEdit.rating || null,
    logged_by: currentEdit.logged_by || null,
    director,
    tags,
    notes,
    watched_at: currentEdit.status === "watched" ? (currentEdit.watched_at || new Date().toISOString()) : null,
  };

  const { error } = await supabaseClient.from("films").update(updates).eq("id", currentEdit.id);
  if (error) {
    alert("Couldn't save: " + error.message);
    return;
  }
  closeEditModal();
  await loadFilms();
});

el("modal-delete").addEventListener("click", async () => {
  if (!currentEdit) return;
  if (!confirm(`Remove "${currentEdit.title}" from your log?`)) return;
  const { error } = await supabaseClient.from("films").delete().eq("id", currentEdit.id);
  if (!error) {
    closeEditModal();
    await loadFilms();
  }
});

// ---------------------------------------------------------------------------
// Load + render the log
// ---------------------------------------------------------------------------
async function loadFilms() {
  const { data, error } = await supabaseClient.from("films").select("*").order("added_at", { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  films = data || [];
  render();
}

document.querySelectorAll("#filter-status .filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#filter-status .filter-chip").forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    activeStatusFilter = chip.dataset.filter;
    render();
  });
});

document.querySelectorAll("#filter-logged-by .filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#filter-logged-by .filter-chip").forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    activeLoggedByFilter = chip.dataset.loggedby;
    render();
  });
});

el("tag-filter").addEventListener("input", (e) => {
  activeTagFilter = e.target.value.trim().toLowerCase();
  render();
});

el("director-filter").addEventListener("input", (e) => {
  activeDirectorFilter = e.target.value.trim().toLowerCase();
  render();
});

el("year-from").addEventListener("input", (e) => {
  yearFrom = e.target.value ? parseInt(e.target.value, 10) : null;
  render();
});
el("year-to").addEventListener("input", (e) => {
  yearTo = e.target.value ? parseInt(e.target.value, 10) : null;
  render();
});

el("sort-select").addEventListener("change", (e) => {
  activeSort = e.target.value;
  render();
});

function getFiltered() {
  let list = films.slice();

  if (activeStatusFilter === "watched") list = list.filter((f) => f.status === "watched");
  else if (activeStatusFilter === "not_watched") list = list.filter((f) => f.status === "not_watched");
  else if (activeStatusFilter === "loved") list = list.filter((f) => f.rating === "loved");
  else if (activeStatusFilter === "disliked") list = list.filter((f) => f.rating === "disliked");

  if (activeLoggedByFilter === "D" || activeLoggedByFilter === "M") {
    list = list.filter((f) => f.logged_by === activeLoggedByFilter);
  }

  if (activeTagFilter) {
    list = list.filter((f) => {
      const hay = [...(f.tags || []), ...(f.genres || [])].join(" ").toLowerCase();
      return hay.includes(activeTagFilter);
    });
  }

  if (activeDirectorFilter) {
    list = list.filter((f) => (f.director || "").toLowerCase().includes(activeDirectorFilter));
  }

  if (yearFrom !== null) list = list.filter((f) => (f.release_year || 0) >= yearFrom);
  if (yearTo !== null) list = list.filter((f) => (f.release_year || 0) <= yearTo);

  switch (activeSort) {
    case "added_asc": list.sort((a, b) => new Date(a.added_at) - new Date(b.added_at)); break;
    case "added_desc": list.sort((a, b) => new Date(b.added_at) - new Date(a.added_at)); break;
    case "year_desc": list.sort((a, b) => (b.release_year || 0) - (a.release_year || 0)); break;
    case "year_asc": list.sort((a, b) => (a.release_year || 0) - (b.release_year || 0)); break;
    case "title_asc": list.sort((a, b) => a.title.localeCompare(b.title)); break;
  }

  return list;
}

function render() {
  el("entry-count").textContent = `No. ${String(films.length).padStart(3, "0")}`;

  const list = getFiltered();
  const sheet = el("sheet");
  sheet.innerHTML = "";

  el("empty-state").hidden = films.length !== 0;

  list.forEach((f) => {
    const indexInFullList = films.findIndex((x) => x.id === f.id) + 1;
    const frame = document.createElement("article");
    frame.className = "frame";

    const stamp = f.rating === "loved"
      ? `<span class="frame-stamp loved">Loved</span>`
      : f.rating === "disliked"
        ? `<span class="frame-stamp disliked">Disliked</span>`
        : "";

    const loggedByBadge = f.logged_by ? `<span class="loggedby-badge" title="Logged by ${f.logged_by}">${f.logged_by}</span>` : "";

    frame.innerHTML = `
      <div class="frame-index mono">
        <span>No. ${String(indexInFullList).padStart(3, "0")}</span>
        ${loggedByBadge}
      </div>
      <div class="frame-poster frame-clickable">
        <img src="${f.poster_path || placeholderPoster()}" alt="">
        ${stamp}
      </div>
      <h3 class="frame-title frame-clickable">${escapeHtml(f.title)}</h3>
      <div class="frame-meta">${f.release_year || "—"}${f.director ? " · " + escapeHtml(f.director) : ""}</div>
      ${(f.tags && f.tags.length) ? `<div class="frame-tags">${f.tags.map(escapeHtml).join(", ")}</div>` : ""}
      <div class="frame-quick">
        <button class="qbtn watched ${f.status === "watched" ? "is-on" : ""}" data-action="toggle-watched">${f.status === "watched" ? "Watched" : "Mark seen"}</button>
        <button class="qbtn loved ${f.rating === "loved" ? "is-on" : ""}" data-action="toggle-loved">♥</button>
        <button class="qbtn disliked ${f.rating === "disliked" ? "is-on" : ""}" data-action="toggle-disliked">✕</button>
        <button class="qbtn remove" data-action="delete">Remove</button>
      </div>
    `;

    frame.querySelectorAll(".frame-clickable").forEach((node) => {
      node.addEventListener("click", () => openEditModal(f, indexInFullList));
    });
    frame.querySelector('[data-action="toggle-watched"]').addEventListener("click", () => toggleStatus(f));
    frame.querySelector('[data-action="toggle-loved"]').addEventListener("click", () => toggleRating(f, "loved"));
    frame.querySelector('[data-action="toggle-disliked"]').addEventListener("click", () => toggleRating(f, "disliked"));
    frame.querySelector('[data-action="delete"]').addEventListener("click", () => deleteFilm(f));

    sheet.appendChild(frame);
  });
}

async function toggleStatus(f) {
  const newStatus = f.status === "watched" ? "not_watched" : "watched";
  const { error } = await supabaseClient.from("films").update({
    status: newStatus,
    watched_at: newStatus === "watched" ? new Date().toISOString() : null,
  }).eq("id", f.id);
  if (!error) await loadFilms();
}

async function toggleRating(f, value) {
  const newRating = f.rating === value ? null : value;
  const { error } = await supabaseClient.from("films").update({ rating: newRating }).eq("id", f.id);
  if (!error) await loadFilms();
}

async function deleteFilm(f) {
  if (!confirm(`Remove "${f.title}" from your log?`)) return;
  const { error } = await supabaseClient.from("films").delete().eq("id", f.id);
  if (!error) await loadFilms();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function placeholderPoster() {
  return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="%23ded3ba"/></svg>';
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
