# Salle Intelligente Connectée — Guide d'utilisation (Simulation IoT)

## 1) Objectif du projet
Ce projet est une **simulation web d'un système IoT de Smart Room**.
Il reproduit le comportement d'un déploiement réel (capteurs + règles + journalisation cloud) sans matériel physique.

L'application:
- simule les mesures capteurs (température, humidité, présence, luminosité),
- enregistre les données dans **Firebase Realtime Database**,
- applique un moteur de règles événementielles (R1 à R5),
- affiche en temps réel les états, historiques et événements.

## 2) Fichiers du dossier
- `web/index.html` : structure de l'interface
- `web/styles.css` : styles et animations
- `web/app.js` : simulation, logique règles et Firebase
- `docs/Cahier Des Charges.docx` : document de spécification
- `docs/Connected Smart Room.pptx` : support de présentation
- `docs/Connected Smart Room.pdf` : version PDF du support de présentation

## 3) Prérequis
- Navigateur moderne (Chrome recommandé)
- Connexion Internet (chargement des CDN Firebase/Chart.js)
- Projet Firebase actif (déjà configuré dans ce projet)

## 4) Lancement de la simulation
### Option A — Exécution locale rapide
1. Ouvrir `web/index.html` dans le navigateur.
2. Attendre quelques secondes (écran de boot).
3. Vérifier que l'état affiche `Firebase: CONNECTÉ`.

### Option B — Hébergement Firebase (recommandé pour la démo)
1. Déployer avec `firebase deploy` depuis le dossier du projet.
2. Si vous utilisez Firebase Hosting, vérifiez que `public` pointe vers `web`.
3. Ouvrir l'URL Hosting fournie par Firebase.

## 5) Comment lire l'interface
### En-tête
- Statut système
- Statut de connexion Firebase
- Dernière mise à jour

### Capteurs (temps réel)
- Température
- Humidité
- Présence
- Luminosité
- Indicateur de tendance (↑ / ↓ / →)

### Graphiques
- Courbe Température/Humidité (20 dernières mesures)
- Barres Luminosité (20 dernières mesures)

### Moteur de règles
Règles surveillées:
- **R1**: Absence détectée pendant 10 ticks consécutifs
- **R2**: Température > 30°C
- **R3**: Présence = true et luminosité < 200 lux
- **R4**: Température < 16°C
- **R5**: Humidité > 85%

Chaque carte règle montre:
- priorité (HAUTE / CRITIQUE / NORMALE),
- proximité du déclenchement,
- état `VEILLE` ou `ACTIVE`.

### Journal d'événements
- Affiche les 10 derniers événements déclenchés
- Les événements critiques sont visuellement accentués

## 6) Ce que le projet fait / ne fait pas
### Ce que le projet fait
- Simulation complète côté front-end
- Écriture et lecture cloud en temps réel
- Journalisation capteurs + événements
- Pruning des logs (limitation des entrées)

### Ce que le projet ne fait pas (volontairement)
- Pas de capteurs physiques réels (ESP32 non connecté)
- Pas d'authentification utilisateur
- Pas de backend serveur personnalisé
- Pas de contrôle d'actionneurs physiques réels (LED/Buzzer simulés via événements)

## 7) Notes de démonstration:
- Le rythme de simulation est optimisé pour une démo pédagogique (événements visibles rapidement).
- Les déclenchements R1 à R5 apparaissent selon des scénarios simulés (normal, chaud, froid, humide, sombre).

## 8) Sécurité (contexte académique)
Pour la démo, les règles Firebase peuvent être ouvertes (`read/write`) afin de simplifier les tests.
En production, ces règles doivent être sécurisées.

## 9) Dépannage rapide
- **Firebase déconnecté**: vérifier Internet + configuration Firebase.
- **Aucun événement visible**: attendre quelques cycles de simulation.
- **Pas de mise à jour**: recharger la page (Ctrl+F5).


