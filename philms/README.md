# philms — setup guide

A private, cross-device film log. Search a title → autofill from TMDB → mark
watched / not-watched, loved / disliked → filter and browse as a contact sheet.

You need three free accounts and about 20 minutes. Do these in order.

## 1. Supabase (database + login)

1. Go to supabase.com → New project. Pick any name/region, set a database password (save it somewhere, you won't need it again for this).
2. Once it's ready: **SQL Editor → New query** → paste in everything from `supabase-schema.sql` in this folder → **Run**. This creates the `films` table and locks it down so only you can read or write your rows.
3. **Authentication → Providers**: make sure "Email" is enabled.
4. **Authentication → Providers → Email**: turn **off** "Allow new users to sign up." This is a personal site — you don't want a public signup form sitting on your domain.
5. **Authentication → Users → Add user** → create yourself with an email and password. This is what you'll log in with.
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
7. Open `js/supabase-config.js` in this folder and paste those two values in.

## 2. TMDB (movie data)

1. Go to themoviedb.org → create a free account.
2. **Settings → API** → request an API key (choose "Developer," the personal-use option). Approval is instant.
3. Copy the **API Key (v3 auth)** — a short string, not the long "Read Access Token."
4. You'll paste this into Netlify in the next step, not into any file — it stays server-side.

## 3. Netlify (hosting)

1. Push this folder to a GitHub repo (or drag-and-drop the whole folder into Netlify's deploy UI at app.netlify.com/drop for a quick first pass — but connect it to GitHub eventually so you can update it later).
2. In Netlify: **Add new site → Import an existing project**, point it at the repo. Build settings can stay blank — there's no build step, it's static.
3. **Site configuration → Environment variables** → add:
   - `TMDB_API_KEY` = the key from step 2.
4. Deploy. Visit the `*.netlify.app` URL Netlify gives you and confirm you can log in and search for a film before moving on.

## 4. Connect philms.top

1. In Netlify: **Domain management → Add a domain** → enter `philms.top`.
2. Netlify will show you DNS records to add. Go to wherever you registered the domain, open its DNS settings, and add those records (typically an A record for the root domain and a CNAME for `www`).
3. DNS can take anywhere from a few minutes to a few hours to propagate. Netlify will show the domain as verified once it's live, and will auto-provision HTTPS.

## Using it day to day

- Type a title into the search bar at the top and hit **Search** — pick the right match from the poster grid (useful when a title has been remade or has a common name).
- Set watched/not-watched and loved/disliked before saving, or leave both as defaults and update later from the card itself.
- Tags are yours to define — e.g. `study reference`, `criterion`, `director: Akerman`. They're searchable through the tag filter, same as genres.
- The number on each card (`No. 014`) is just the order you logged it in, like frame numbers on a strip — not a ranking.

## If something needs changing later

- **Add a second account** (e.g. shared with someone): repeat step 1.5 in Supabase for a new user. Each user only ever sees their own films because of the row-level security policy in `supabase-schema.sql`.
- **Change the design**: everything visual lives in `css/style.css` — it's one file, organized top to bottom by section.
- **Change how search/autofill works**: `netlify/functions/search-movie.js` is the only place that talks to TMDB.
