# Strava → GPX

Page web statique : on colle une URL Strava et on télécharge le GPX.

**En ligne :** https://cyril5c.github.io/Strava2GPX/

## Fonctionnement

La page extrait l'identifiant de l'URL et redirige vers le lien d'export officiel de Strava :

- `strava.com/activities/<id>` → `https://www.strava.com/activities/<id>/export_gpx`
- `strava.com/routes/<id>` → `https://www.strava.com/routes/<id>/export_gpx`

Le téléchargement utilise ta session Strava dans le navigateur : il faut donc être connecté à strava.com. Pas d'API, pas de serveur, pas d'abonnement nécessaire.

Astuce : `https://cyril5c.github.io/Strava2GPX/?url=<lien strava>` lance le téléchargement directement (utile pour un favori ou un raccourci iOS).

