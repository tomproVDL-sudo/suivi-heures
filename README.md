# Suivi Heures — v2

Application web (PWA) de pointage : temps de travail, planning des absences, soldes de congés, statistiques, exports et sauvegardes.
Hébergée sur GitHub Pages, données dans Supabase. **Aucune compilation** : on dépose les fichiers, c'est en ligne.

## Mise en ligne (remplacement de la v1)

1. Dans le dépôt GitHub, supprimez les anciens fichiers (`index.html`, `sw.js`, `manifest.json`, `icon-*.png`).
2. Déposez tout le contenu de ce dossier à la racine du dépôt (y compris les dossiers `js/`, `css/`, `icons/`, `supabase/`, `scripts/`, `.github/`).
3. Attendez 1 à 2 minutes que GitHub Pages publie, puis ouvrez l'application.
   Les utilisateurs de l'ancienne version reçoivent la nouvelle automatiquement (l'ancien cache est nettoyé).

**Aucune migration de données** : les tables `pointages`, `absences` et `parametres` sont utilisées telles quelles.
Les préférences d'affichage des compteurs et les pointages faits hors-ligne dans la v1 sont repris automatiquement.

### Une seule fois dans Supabase (recommandé)

Supabase → *SQL Editor* → *New query* :

| Fichier | Rôle |
|---|---|
| `supabase/securite_rls.sql` | Vérifie que chacun ne voit que ses données (RLS) et ajoute des index qui accélèrent le chargement. Lancez d'abord les deux `select` du haut pour voir l'état actuel. |
| `supabase/sauvegardes.sql` | Crée la table qui active les **sauvegardes cloud** (onglet Données). |

> ⚠️ La plan gratuit de Supabase ne fait **aucune sauvegarde automatique** de votre base. Les sauvegardes de la v2 comblent ce manque.

### Publier une mise à jour plus tard

Modifiez `VERSION` en haut de `sw.js` (ex. `v2.0.1`) à chaque déploiement : l'application affichera « Une nouvelle version est disponible ».

## Sauvegardes : 4 niveaux

| Niveau | Où | Quand |
|---|---|---|
| Fichier `.json` | Votre ordinateur / téléphone | Bouton *Télécharger une sauvegarde* |
| Instantanés locaux | Navigateur de l'appareil (14 derniers) | Automatique, 1 par jour + avant chaque restauration / import |
| Cloud | Table `sauvegardes` dans Supabase (12 dernières auto) | Automatique chaque semaine + bouton manuel |
| Hors-site chiffrée | Artefacts GitHub Actions (90 jours) | Chaque lundi (optionnel, voir ci-dessous) |

Restauration depuis l'onglet **Données** : mode *Fusionner* (ajoute seulement ce qui manque) ou *Remplacer*.

### Sauvegarde GitHub (optionnelle)

Dans le dépôt : *Settings → Secrets and variables → Actions*, créez `BACKUP_EMAIL`, `BACKUP_PASSWORD` et `BACKUP_PASSPHRASE`.
Le workflow `.github/workflows/sauvegarde.yml` se connecte avec votre compte (les règles RLS s'appliquent), exporte tout et chiffre le fichier.
Pour le déchiffrer :

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in sauvegarde.json.enc -out sauvegarde.json
```

Le fichier obtenu se restaure dans l'application (Données → Restaurer un fichier).
GitHub désactive les tâches planifiées après 60 jours sans activité sur le dépôt : un clic sur *Enable workflow* suffit à la relancer.

## Ce qui a changé

**Rapidité**
- Affichage instantané au démarrage depuis le cache de l'appareil (IndexedDB), synchronisation en arrière-plan.
- Plus de rechargement complet depuis Supabase à chaque pointage ou changement d'onglet : seules les lignes modifiées sont envoyées.
- Plus de Tailwind « play CDN » (compilation dans le navigateur) ni de FullCalendar / Chart.js : CSS et graphiques maison, environ 7 fois moins de code à télécharger au démarrage. Excel et PDF ne sont chargés qu'au moment d'exporter.
- Calculs indexés par jour (plus de parcours de tout l'historique pour chaque case du calendrier).

**Corrections**
- Historique tronqué : Supabase renvoie au maximum 1000 lignes par requête ; tout est désormais paginé.
- Le service worker servait toujours l'ancienne version : mises à jour maintenant détectées et proposées.
- Dates d'export « Ce mois » décalées d'un jour (fuseau UTC).
- Après un import Excel, l'historique n'était pas rechargé (mauvaise clé de cache).
- Congés : décompte en jours ouvrés (week-ends et fériés exclus) au lieu de jours calendaires.
- Reliquat N-1 : les CP pris avant la date limite restent imputés au reliquat même après son expiration.
- Formation en demi-journée : la demi-journée travaillée n'est plus comptée en heures sup.
- Deux absences le même jour (matin + après-midi) sont toutes deux prises en compte et affichées.
- Jours fériés calculés localement (fonctionne hors-ligne, toutes années).
- Modifications et suppressions possibles hors-ligne (file d'attente), avec « Annuler » après suppression.

**Nouveautés**
- Jauge du jour, heure de départ estimée, frise de la journée, alerte double pointage.
- Statistiques : comparaison N-1, solde cumulé, moyenne par jour de semaine, calendrier d'activité, repères réglementaires (10 h/jour, 48 h/semaine, 11 h de repos, pause de 20 min).
- Exports : Excel 6 feuilles avec vrais formats horaires et totaux, rapport PDF d'une page reprenant la mise en page de la v1 (4 indicateurs + 3 graphiques, détail jour par jour en option), rapport imprimable, CSV, agenda `.ics`.
- Graphiques : un clic sur un élément de la légende masque / réaffiche la série.
- Mode sombre, navigation mobile en bas d'écran, vue semaine du planning, historique de base horaire paramétrable.

## Structure

```
index.html            Coquille de l'application
css/app.css           Styles (clair / sombre)
js/config.js          URL et clé Supabase, versions des bibliothèques
js/calc.js            Moteur de calcul (testable : node tests/calc.test.mjs)
js/store.js           Cache local, synchronisation Supabase, file hors-ligne
js/views/*.js         Écrans : pointage, planning, statistiques, données, réglages
js/export.js          Excel, PDF, CSV, ICS
js/backup.js          Sauvegardes et restauration
sw.js                 Fonctionnement hors-ligne
```
