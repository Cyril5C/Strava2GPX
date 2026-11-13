# Strava → GPX

Petite app web : on colle une URL Strava et on télécharge le GPX.

- `strava.com/routes/<id>` : export GPX officiel (itinéraires publics ou les tiens)
- `strava.com/activities/<id>` : GPX reconstruit à partir des streams (latlng, altitude, temps). **Uniquement tes propres activités** (limite de l'API Strava)
- Liens courts de l'app (`strava.app.link/...`) : acceptés

## 1. Créer l'application Strava API

1. https://www.strava.com/settings/api
2. **Authorization Callback Domain** : le domaine Railway, par ex. `strava2gpx-production.up.railway.app` (sans `https://`). Pour tester en local : `localhost`.
3. Récupérer le **Client ID** et le **Client Secret**.

## 2. Déployer sur Railway

Via GitHub (pousser ce dossier sur un repo, puis *New Project → Deploy from GitHub repo*) ou via la CLI :

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

Ensuite, dans *Variables* :

| Variable | Valeur |
|---|---|
| `STRAVA_CLIENT_ID` | Client ID Strava |
| `STRAVA_CLIENT_SECRET` | Client Secret Strava |
| `SESSION_SECRET` | une longue chaîne aléatoire (`openssl rand -hex 32`) |

Puis *Settings → Networking → Generate Domain*, et reporter ce domaine dans le champ Callback Domain de Strava.

Railway détecte Node automatiquement et lance `npm start`. Le port est fourni par `PORT`.

## Local

```bash
npm install
STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... SESSION_SECRET=dev npm start
# http://localhost:3000
```
