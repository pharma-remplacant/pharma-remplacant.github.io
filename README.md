# Pharma Remplaçant

Plateforme de remplacements en officine en Wallonie : les pharmaciens et assistants indépendants ouvrent leurs jours libres, les officines trouvent et réservent un remplaçant en quelques minutes.

- Appli : https://pharma-remplacant.github.io/
- Inscription remplaçant : https://pharma-remplacant.github.io/#inscription-remplacant
- Inscription officine : https://pharma-remplacant.github.io/#inscription-pharmacie

Appli web installable (écran d'accueil sur téléphone, « Installer » sur PC), hébergée par GitHub Pages, données et comptes sur Firebase (Firestore, région europe-west1). Les règles de sécurité sont dans `firestore.rules`.

## E-mails automatiques

Le dossier `emails/` contient un script Google Apps Script qui vérifie Firestore chaque minute et envoie un e-mail à chaque nouvelle demande (au remplaçant), acceptation ou refus (à l'officine) et annulation (au remplaçant). Il tourne sous le compte Gmail de la plateforme, membre « Éditeur » du projet Firebase.
