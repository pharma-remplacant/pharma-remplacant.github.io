# Mettre Pharma Remplaçant en ligne depuis ton téléphone

Compte environ 1 heure, gratuit, sans carte bancaire. Tout se fait dans le navigateur Chrome ou Samsung Internet. Si un écran est trop petit, ouvre le menu du navigateur et coche **Version pour ordinateur**.

À la fin, tu auras un lien du type `https://ton-nom.github.io/pharma-remplacant/` à envoyer aux pharmacies et aux remplaçants.

---

## Étape 1 : préparer les fichiers (2 min)

1. Télécharge le fichier `pharma-remplacant.zip` que je t'ai envoyé.
2. Ouvre l'appli **Mes fichiers** > **Téléchargements**, appuie longuement sur le zip et choisis **Extraire**.
3. Tu obtiens un dossier `pharma-remplacant` avec 13 fichiers. Tu en auras besoin à l'étape 5.

## Étape 2 : créer le projet Firebase (5 min)

1. Va sur https://console.firebase.google.com et connecte-toi avec ton compte Gmail.
2. Touche **Créer un projet**, nomme-le `pharma-remplacant`, désactive Google Analytics, puis **Créer le projet**.

## Étape 3 : activer les comptes et créer la base (10 min)

1. Menu (☰) > **Créer** > **Authentication** > **Commencer**.
2. **Mode de connexion** > **Adresse e-mail/Mot de passe** : active le premier interrupteur, puis **Enregistrer**.
3. Onglet **Modèles** > crayon à côté de « Langue du modèle » > **Français**. Les e-mails partiront en français.
4. Menu > **Créer** > **Firestore Database** > **Créer une base de données**.
5. Emplacement : **europe-west1 (Belgique)**, puis **mode production**, puis **Créer**.
6. Onglet **Règles** : efface tout, colle le texte du bloc ci-dessous (appui long > Tout sélectionner > Copier), puis **Publier**.

```
rules_version = '2';

// Règles de sécurité de Pharma Remplaçant.
// À coller dans Firebase > Firestore Database > Règles, puis « Publier ».
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function me() { return request.auth.uid; }
    function isAdmin() { return signedIn() && exists(/databases/$(database)/documents/admins/$(me())); }
    function chemin(p) { return path('/databases/' + database + '/documents/' + p); }
    // Lien créé quand un remplaçant accepte une mission : ouvre l'accès aux coordonnées des deux côtés.
    function linked(rid, pid) { return exists(/databases/$(database)/documents/liens/$(rid + '_' + pid)); }

    match /admins/{uid} {
      allow read: if signedIn() && me() == uid;
    }

    // Profil public d'un remplaçant. Il devient visible (valide) automatiquement dès que
    // son n° d'entreprise (BCE) est valide et son diplôme renseigné. Seul l'administrateur
    // peut le suspendre (bloque) ou le réactiver.
    function bceOk(b) {
      return b is string && b.matches('^[01][0-9]{9}$')
        && 97 - int(b[0:8]) % 97 == int(b[8:10]);
    }
    function profilComplet(rid) {
      let v = getAfter(chemin('remplacants/' + rid + '/prive/verif')).data;
      return bceOk(v.bce) && v.diplome is string && v.diplome.size() >= 3;
    }
    match /remplacants/{rid} {
      allow read: if signedIn() && (resource.data.valide == true || me() == rid || isAdmin());
      allow create: if signedIn() && me() == rid
        && request.resource.data.bloque == false
        && (request.resource.data.valide == false || profilComplet(rid));
      allow update: if isAdmin() || (signedIn() && me() == rid
        && request.resource.data.bloque == resource.data.bloque
        && (request.resource.data.valide == false || (resource.data.bloque == false && profilComplet(rid))));
      allow delete: if signedIn() && (me() == rid || isAdmin());

      // contact : téléphone et e-mail, visibles après une mission confirmée.
      // verif : n° BCE et diplôme, visibles seulement par l'administrateur.
      match /prive/{docId} {
        allow read: if signedIn() && (me() == rid || isAdmin() || (docId == 'contact' && linked(rid, me())));
        allow write: if signedIn() && me() == rid;
      }
    }

    match /pharmacies/{pid} {
      allow read: if signedIn();
      allow create, update: if signedIn() && me() == pid;
      allow delete: if signedIn() && (me() == pid || isAdmin());

      match /prive/{docId} {
        allow read: if signedIn() && (me() == pid || isAdmin() || (docId == 'contact' && linked(me(), pid)));
        allow write: if signedIn() && me() == pid;
      }
    }

    match /demandes/{id} {
      allow read: if signedIn() && (resource.data.rid == me() || resource.data.pid == me() || isAdmin());
      allow create: if signedIn()
        && request.resource.data.pid == me()
        && request.resource.data.statut == 'attente'
        && exists(chemin('pharmacies/' + me()))
        && get(chemin('remplacants/' + request.resource.data.rid)).data.valide == true;
      allow update: if signedIn()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['statut', 'maj'])
        && (
          (resource.data.rid == me() && resource.data.statut == 'attente' && request.resource.data.statut in ['acceptee', 'refusee'])
          || (resource.data.pid == me() && resource.data.statut in ['attente', 'acceptee'] && request.resource.data.statut == 'annulee')
          || isAdmin()
        );
      allow delete: if isAdmin();
    }

    match /liens/{lid} {
      allow read: if signedIn() && (resource.data.rid == me() || resource.data.pid == me() || isAdmin());
      allow create, update: if signedIn()
        && request.resource.data.rid == me()
        && lid == me() + '_' + request.resource.data.pid
        && getAfter(chemin('demandes/' + request.resource.data.demandeId)).data.rid == me()
        && getAfter(chemin('demandes/' + request.resource.data.demandeId)).data.pid == request.resource.data.pid
        && getAfter(chemin('demandes/' + request.resource.data.demandeId)).data.statut == 'acceptee';
    }

    function avisValide(a) {
      let d = get(chemin('demandes/' + a.demandeId)).data;
      return d.statut == 'acceptee'
        && ((a.sens == 'r' && d.rid == me() && a.pour == d.pid) || (a.sens == 'p' && d.pid == me() && a.pour == d.rid));
    }

    match /avis/{aid} {
      allow read: if signedIn();
      allow create: if signedIn()
        && request.resource.data.de == me()
        && aid == request.resource.data.demandeId + '_' + request.resource.data.sens
        && request.resource.data.note is int
        && request.resource.data.note >= 1 && request.resource.data.note <= 5
        && avisValide(request.resource.data);
      allow delete: if isAdmin();
    }
  }
}
```

## Étape 4 : récupérer ta configuration (2 min)

1. Roue dentée (en haut) > **Paramètres du projet**.
2. En bas, sous « Vos applications », touche l'icône **</>**. Nomme l'appli `Pharma Remplaçant` et ne coche rien. Touche **Enregistrer l'application**.
3. Firebase affiche un bloc `const firebaseConfig = { … };`. Copie-le et colle-le dans notre conversation : je te renvoie `firebase-config.js` déjà rempli. Ces valeurs ne sont pas secrètes.

Tu peux aussi le faire toi-même à l'étape 6.

## Étape 5 : mettre le site en ligne avec GitHub Pages (15 min)

1. Va sur https://github.com/signup et crée un compte gratuit. Ton nom d'utilisateur fera partie de ton adresse (par exemple `pharmaremplacant` donne `pharmaremplacant.github.io`).
2. Touche **+** en haut > **New repository**.
   - Repository name : `pharma-remplacant`
   - Laisse **Public**
   - Coche **Add a README file**
   - **Create repository**
3. Dans le dépôt : **Add file** > **Upload files** > **choose your files**. Dans **Mes fichiers**, ouvre le dossier `pharma-remplacant`, appuie longuement sur un fichier, coche **Tout**, puis **Terminé**.
4. Attends que les 13 fichiers apparaissent dans la liste, puis touche **Commit changes**.
5. Dans le dépôt : **Settings** > **Pages** (menu de gauche).
   - Source : **Deploy from a branch**
   - Branch : **main**, dossier **/ (root)**, puis **Save**
6. Attends 1 à 2 minutes et recharge la page : ton adresse s'affiche en haut, par exemple `https://pharmaremplacant.github.io/pharma-remplacant/`.

## Étape 6 : brancher la configuration

- **Si je t'ai renvoyé `firebase-config.js`** : dans le dépôt, **Add file** > **Upload files**, choisis ce fichier, puis **Commit changes**. Il remplace l'ancien.
- **Sinon** : dans le dépôt, touche `firebase-config.js` > crayon (Edit). Remplace les 6 lignes `A_REMPLACER` par celles de Firebase, puis **Commit changes**.

Ensuite, dans Firebase : **Authentication** > **Paramètres** > **Domaines autorisés** > **Ajouter un domaine**, et colle `ton-nom.github.io` (sans le reste de l'adresse).

## Étape 7 : devenir administrateur (5 min)

1. Ouvre ton adresse, touche **Créer un compte** et inscris-toi.
2. Firebase > **Authentication** > **Utilisateurs** : copie l'**UID** de ton compte.
3. **Firestore Database** > **Données** > **Commencer une collection**.
   - ID de la collection : `admins`
   - ID du document : colle ton UID
   - Champ : `role`, type `string`, valeur `admin`
   - **Enregistrer**
4. Recharge l'appli : le bouton **Administration** apparaît.

## Étape 8 : installer et tester

1. Dans l'appli, touche **Installer** sur le bandeau vert. L'icône arrive sur ton écran d'accueil.
2. Crée ton profil de remplaçant et ouvre quelques jours. Il est visible tout de suite si ton n° BCE est valide.
3. Passe en « Je suis une pharmacie », inscris une officine de test et envoie-toi une demande.
4. Repasse en « Je remplace » et accepte : les coordonnées s'affichent des deux côtés.

---

## Tes liens d'inscription

| À envoyer à | Lien (remplace par ton adresse) |
| --- | --- |
| Remplaçants | `https://ton-nom.github.io/pharma-remplacant/#inscription-remplacant` |
| Pharmacies | `https://ton-nom.github.io/pharma-remplacant/#inscription-pharmacie` |
| Tout le monde | `https://ton-nom.github.io/pharma-remplacant/#inscription` |

Ensuite, tout se fait sans toi :

1. La personne crée son compte. L'e-mail de confirmation part immédiatement.
2. Elle remplit son profil. Le n° d'entreprise est contrôlé automatiquement (format et chiffre de contrôle officiels de la BCE).
3. Dès que les champs sont valides, le remplaçant est visible des pharmacies. Une pharmacie peut chercher et réserver tout de suite.

Le contrôle vérifie qu'un n° BCE est valide, pas qu'il appartient à la personne. Regarde de temps en temps l'onglet **Administration** : le n° est cliquable vers le site de la BCE, et tu peux suspendre un profil douteux.

## Mettre à jour l'appli plus tard

Quand je t'envoie une nouvelle version, dépose les fichiers modifiés dans le dépôt (**Add file** > **Upload files** > **Commit changes**). Ils remplacent les anciens. L'adresse et les données ne changent pas, et tout le monde reçoit la mise à jour automatiquement.

## Ce qui reste gratuit

- **Firebase**, offre « Spark » : comptes, base de données et e-mails de connexion. C'est largement suffisant pour quelques centaines d'utilisateurs, et rien n'est facturé sans ton accord.
- **GitHub Pages** : hébergement du site.
- **Facultatif** : un nom de domaine à toi (`pharmaremplacant.be`, environ 10 € par an), à relier plus tard.

## Bon à savoir

- **Notifications** : pas d'e-mail automatique à chaque demande dans la version gratuite. Tout s'affiche en direct dans l'appli.
- **Frais de 2 € TVAC par mission** : le total par remplaçant est dans **Administration** > **Vue d'ensemble**.
- **Suppression de compte** : chacun peut supprimer son compte dans **Mon compte**.
