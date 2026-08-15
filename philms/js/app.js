const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let films = [];
let currentDraft = null; // { tmdb details..., status, rating }
let activeStatusFilter = "all";
let activeTagFilter = "";
let activeSort = "added_desc";

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
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

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = error.message;
    errEl.hidden = false;
    return;
  }
  showMain();
});

el("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

// ---------------------------------------------------------------------------
// TMDB search
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
  };
  renderDraft();
}

function renderDraft() {
  el("search-results").hidden = true;
  const panel = el("draft-panel");
  panel.hidden = false;

  el("draft-poster-img").src = currentDraft.poster_path || placeholderPoster();
  el("draft-title").textContent = currentDraft.title;
  const metaBits = [currentDraft.year, currentDraft.director, currentDraft.runtime ? `${currentDraft.runtime} min` : null, (currentDraft.genres || []).join(", ")].filter(Boolean);
  el("draft-meta").textContent = metaBits.join("  ·  ");
  el("draft-tags").value = "";
  el("draft-notes").value = "";

  syncToggleGroup("status", currentDraft.status);
  syncToggleGroup("rating", currentDraft.rating);
}

function hideDraft() {
  el("draft-panel").hidden = true;
  currentDraft = null;
}

document.querySelectorAll(".toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const field = btn.dataset.field;
    const value = btn.dataset.value;
    if (!currentDraft) return;
    currentDraft[field] = value;
    syncToggleGroup(field, value);
  });
});

function syncToggleGroup(field, value) {
  document.querySelectorAll(`.toggle-btn[data-field="${field}"]`).forEach((b) => {
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
  const { data: { user } } = await supabase.auth.getUser();

  const tags = el("draft-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  const notes = el("draft-notes").value.trim();

  const record = {
    user_id: user.id,
    title: currentDraft.title,
    tmdb_id: currentDraft.id,
    release_year: currentDraft.year ? parseInt(currentDraft.year, 10) : null,
    director: currentDraft.director,
    genres: currentDraft.genres || [],
    poster_path: currentDraft.poster_path,
    runtime: currentDraft.runtime,
    status: currentDraft.status,
    rating: currentDraft.rating || null,
    tags,
    notes,
    watched_at: currentDraft.status === "watched" ? new Date().toISOString() : null,
  };

  const { error } = await supabase.from("films").insert(record);
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
// Load + render the log
// ---------------------------------------------------------------------------
async function loadFilms() {
  const { data, error } = await supabase.from("films").select("*").order("added_at", { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  films = data || [];
  render();
}

document.querySelectorAll(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    activeStatusFilter = chip.dataset.filter;
    render();
  });
});

el("tag-filter").addEventListener("input", (e) => {
  activeTagFilter = e.target.value.trim().toLowerCase();
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

  if (activeTagFilter) {
    list = list.filter((f) => {
      const hay = [...(f.tags || []), ...(f.genres || [])].join(" ").toLowerCase();
      return hay.includes(activeTagFilter);
    });
  }

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

    frame.innerHTML = `
      <div class="frame-index mono">No. ${String(indexInFullList).padStart(3, "0")}</div>
      <div class="frame-poster">
        <img src="${f.poster_path || placeholderPoster()}" alt="">
        ${stamp}
      </div>
      <h3 class="frame-title">${escapeHtml(f.title)}</h3>
      <div class="frame-meta">${f.release_year || "—"}${f.director ? " · " + escapeHtml(f.director) : ""}</div>
      ${(f.tags && f.tags.length) ? `<div class="frame-tags">${f.tags.map(escapeHtml).join(", ")}</div>` : ""}
      <div class="frame-quick">
        <button class="qbtn watched ${f.status === "watched" ? "is-on" : ""}" data-action="toggle-watched">${f.status === "watched" ? "Watched" : "Mark seen"}</button>
        <button class="qbtn loved ${f.rating === "loved" ? "is-on" : ""}" data-action="toggle-loved">♥</button>
        <button class="qbtn disliked ${f.rating === "disliked" ? "is-on" : ""}" data-action="toggle-disliked">✕</button>
        <button class="qbtn remove" data-action="delete">Remove</button>
      </div>
    `;

    frame.querySelector('[data-action="toggle-watched"]').addEventListener("click", () => toggleStatus(f));
    frame.querySelector('[data-action="toggle-loved"]').addEventListener("click", () => toggleRating(f, "loved"));
    frame.querySelector('[data-action="toggle-disliked"]').addEventListener("click", () => toggleRating(f, "disliked"));
    frame.querySelector('[data-action="delete"]').addEventListener("click", () => deleteFilm(f));

    sheet.appendChild(frame);
  });
}

async function toggleStatus(f) {
  const newStatus = f.status === "watched" ? "not_watched" : "watched";
  const { error } = await supabase.from("films").update({
    status: newStatus,
    watched_at: newStatus === "watched" ? new Date().toISOString() : null,
  }).eq("id", f.id);
  if (!error) await loadFilms();
}

async function toggleRating(f, value) {
  const newRating = f.rating === value ? null : value;
  const { error } = await supabase.from("films").update({ rating: newRating }).eq("id", f.id);
  if (!error) await loadFilms();
}

async function deleteFilm(f) {
  if (!confirm(`Remove "${f.title}" from your log?`)) return;
  const { error } = await supabase.from("films").delete().eq("id", f.id);
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
