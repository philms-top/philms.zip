// Proxies The Movie Database (TMDB) API so the API key never reaches the browser.
// Requires an environment variable TMDB_API_KEY set in Netlify (Site settings →
// Environment variables). Use a v3 API key (not the v4 read access token).

const TMDB_BASE = "https://api.themoviedb.org/3";

exports.handler = async (event) => {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "TMDB_API_KEY is not set on the server." }) };
  }

  const params = event.queryStringParameters || {};
  const { type, query, id } = params;

  try {
    if (type === "search") {
      if (!query) return { statusCode: 400, body: JSON.stringify({ error: "Missing query." }) };
      const url = `${TMDB_BASE}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}&include_adult=false`;
      const res = await fetch(url);
      const data = await res.json();
      const results = (data.results || []).slice(0, 8).map((m) => ({
        id: m.id,
        title: m.title,
        year: m.release_date ? m.release_date.slice(0, 4) : null,
        poster_path: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
      }));
      return { statusCode: 200, body: JSON.stringify({ results }) };
    }

    if (type === "details") {
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing id." }) };
      const url = `${TMDB_BASE}/movie/${id}?api_key=${apiKey}&append_to_response=credits`;
      const res = await fetch(url);
      const m = await res.json();
      const director = (m.credits && m.credits.crew || []).find((c) => c.job === "Director");
      const details = {
        id: m.id,
        title: m.title,
        year: m.release_date ? m.release_date.slice(0, 4) : null,
        release_date: m.release_date || null,
        poster_path: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
        runtime: m.runtime || null,
        genres: (m.genres || []).map((g) => g.name),
        director: director ? director.name : null,
        overview: m.overview || "",
      };
      return { statusCode: 200, body: JSON.stringify({ details }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid type param (search|details)." }) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "TMDB request failed.", detail: String(err) }) };
  }
};
