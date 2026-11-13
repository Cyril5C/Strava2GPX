const express = require("express");
const cookieSession = require("cookie-session");
const crypto = require("crypto");
const path = require("path");

const {
  STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET,
  SESSION_SECRET = crypto.randomBytes(32).toString("hex"),
  PORT = 3000,
} = process.env;

if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
  console.warn("⚠️  STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET manquants : l'authentification ne fonctionnera pas.");
}

const app = express();
app.set("trust proxy", 1); // Railway est derrière un proxy HTTPS

app.use(
  cookieSession({
    name: "s2g",
    keys: [SESSION_SECRET],
    maxAge: 30 * 24 * 3600 * 1000,
    sameSite: "lax",
    httpOnly: true,
  })
);

app.use(express.static(path.join(__dirname, "public")));

const baseUrl = (req) => `${req.protocol}://${req.get("host")}`;

// ---------- Auth Strava ----------

app.get("/api/me", (req, res) => {
  const s = req.session;
  res.json({ connected: !!s.refresh_token, athlete: s.athlete || null });
});

app.get("/auth", (req, res) => {
  const next = typeof req.query.next === "string" ? req.query.next : "";
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauth_state = state;
  req.session.next = next.startsWith("/") ? next : "/";
  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    redirect_uri: `${baseUrl(req)}/auth/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,read_all,activity:read_all",
    state,
  });
  res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || state !== req.session.oauth_state) {
    return res.redirect("/?error=auth");
  }
  try {
    const tok = await tokenRequest({ grant_type: "authorization_code", code });
    saveTokens(req, tok);
    req.session.athlete = tok.athlete
      ? { firstname: tok.athlete.firstname, lastname: tok.athlete.lastname }
      : null;
    const next = req.session.next || "/";
    req.session.oauth_state = null;
    req.session.next = null;
    res.redirect(next);
  } catch (e) {
    console.error(e);
    res.redirect("/?error=auth");
  }
});

app.get("/logout", (req, res) => {
  req.session = null;
  res.redirect("/");
});

async function tokenRequest(body) {
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, ...body }),
  });
  if (!r.ok) throw new Error(`Token Strava: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

function saveTokens(req, tok) {
  req.session.access_token = tok.access_token;
  req.session.refresh_token = tok.refresh_token;
  req.session.expires_at = tok.expires_at;
}

async function getAccessToken(req) {
  const s = req.session;
  if (!s.refresh_token) return null;
  if (s.access_token && s.expires_at && s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh_token });
  saveTokens(req, tok);
  return tok.access_token;
}

// ---------- Parsing d'URL ----------

const SHORTLINK_HOSTS = new Set(["strava.app.link", "strava.app", "www.strava.app"]);

async function parseStravaUrl(input) {
  let u;
  try {
    u = new URL(input.trim().match(/^https?:\/\//) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }

  // Liens courts de l'app mobile → on suit la redirection (hôtes autorisés uniquement)
  if (SHORTLINK_HOSTS.has(u.hostname)) {
    try {
      const r = await fetch(u, { redirect: "follow" });
      const finalUrl = new URL(r.url);
      if (!finalUrl.hostname.endsWith("strava.com")) {
        // Certains liens renvoient une page HTML contenant l'URL finale
        const html = await r.text();
        const m = html.match(/https:\/\/www\.strava\.com\/(activities|routes)\/\d+/);
        if (!m) return null;
        return parseStravaUrl(m[0]);
      }
      u = finalUrl;
    } catch {
      return null;
    }
  }

  if (!/(^|\.)strava\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(activities|routes)\/(\d+)/);
  if (!m) return null;
  return { type: m[1] === "activities" ? "activity" : "route", id: m[2] };
}

// ---------- Téléchargement GPX ----------

async function stravaGet(token, pathname, raw = false) {
  const r = await fetch(`https://www.strava.com/api/v3${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const err = new Error(`Strava API ${pathname}: HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return raw ? r.text() : r.json();
}

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

const safeFilename = (s) => (s || "strava").replace(/[^\p{L}\p{N} _.-]+/gu, "").trim().slice(0, 80) || "strava";

async function activityGpx(token, id) {
  const act = await stravaGet(token, `/activities/${id}`);
  const streams = await stravaGet(token, `/activities/${id}/streams?keys=latlng,altitude,time&key_by_type=true`);
  const latlng = streams.latlng?.data;
  if (!latlng?.length) {
    const err = new Error("Cette activité n'a pas de trace GPS.");
    err.status = 422;
    throw err;
  }
  const alt = streams.altitude?.data;
  const time = streams.time?.data;
  const start = new Date(act.start_date).getTime();

  const pts = latlng
    .map(([lat, lon], i) => {
      let inner = "";
      if (alt) inner += `<ele>${alt[i]}</ele>`;
      if (time) inner += `<time>${new Date(start + time[i] * 1000).toISOString()}</time>`;
      return `      <trkpt lat="${lat}" lon="${lon}">${inner}</trkpt>`;
    })
    .join("\n");

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Strava2GPX" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xmlEscape(act.name)}</name>
    <time>${act.start_date}</time>
  </metadata>
  <trk>
    <name>${xmlEscape(act.name)}</name>
    <type>${xmlEscape(act.sport_type || act.type || "")}</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
  return { gpx, name: act.name };
}

async function routeGpx(token, id) {
  const [route, gpx] = await Promise.all([
    stravaGet(token, `/routes/${id}`).catch(() => null),
    stravaGet(token, `/routes/${id}/export_gpx`, true),
  ]);
  return { gpx, name: route?.name };
}

app.get("/download", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  const target = await parseStravaUrl(url);
  if (!target) return res.redirect(`/?error=url&url=${encodeURIComponent(url)}`);

  let token;
  try {
    token = await getAccessToken(req);
  } catch {
    token = null;
  }
  if (!token) return res.redirect(`/auth?next=${encodeURIComponent(req.originalUrl)}`);

  try {
    const { gpx, name } =
      target.type === "activity" ? await activityGpx(token, target.id) : await routeGpx(token, target.id);
    const filename = `${safeFilename(name)}-${target.id}.gpx`;
    res.setHeader("Content-Type", "application/gpx+xml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${target.id}.gpx"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(gpx);
  } catch (e) {
    console.error(e.message);
    const code =
      e.status === 404 || e.status === 403 ? "notfound" : e.status === 422 ? "nogps" : e.status === 401 ? "auth" : "api";
    if (e.status === 401) req.session = null;
    res.redirect(`/?error=${code}&url=${encodeURIComponent(url)}`);
  }
});

app.listen(PORT, () => console.log(`Strava2GPX sur le port ${PORT}`));
