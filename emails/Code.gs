// Pharma Remplaçant : e-mails automatiques (nouvelle demande, acceptation, refus, annulation).
// Tourne dans Google Apps Script, sous le compte Gmail de la plateforme, et vérifie Firestore chaque minute.
// Installation : coller ce fichier dans Code.gs, le manifeste dans appsscript.json, puis exécuter « installer ».

const PROJET = "pharma-remplacant";
const APPLI = "https://pharma-remplacant.github.io/";
const BASE = "https://firestore.googleapis.com/v1/projects/" + PROJET + "/databases/(default)/documents";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

// À lancer une fois : crée la vérification automatique chaque minute.
function installer() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("verifier").timeBased().everyMinutes(1).create();
  verifier();
  console.log("Installé : les e-mails partent automatiquement.");
}

// Envoie un e-mail d'essai à ce compte.
function testEmail() {
  envoyer(Session.getEffectiveUser().getEmail(), "Test Pharma Remplaçant", "Bonjour,", ["Les e-mails automatiques fonctionnent."], "Ouvrir l'appli");
}

function verifier() {
  const props = PropertiesService.getScriptProperties();
  const maintenant = new Date().toISOString();
  const last = props.getProperty("last");
  if (!last) { props.setProperty("last", maintenant); props.setProperty("envoyes", "[]"); return; }
  // Marge de 10 minutes : rattrape les téléphones dont l'horloge retarde un peu.
  const depuis = new Date(new Date(last).getTime() - 10 * 60000).toISOString();
  const envoyes = JSON.parse(props.getProperty("envoyes") || "[]");
  const res = appel("post", BASE + ":runQuery", { structuredQuery: {
    from: [{ collectionId: "demandes" }],
    where: { fieldFilter: { field: { fieldPath: "maj" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: depuis } } },
    orderBy: [{ field: { fieldPath: "maj" } }], limit: 200 } });
  let max = last;
  for (const r of res || []) {
    if (!r.document) continue;
    const id = r.document.name.split("/").pop(), d = lire(r.document.fields);
    if (d.maj > max) max = d.maj;
    const cle = id + ":" + d.statut;
    if (envoyes.includes(cle)) continue;
    try { traiter(d); envoyes.push(cle); }
    catch (e) { console.error("Demande " + id + " : " + e); } // réessayé à la minute suivante
  }
  props.setProperty("last", max > maintenant ? maintenant : max);
  props.setProperty("envoyes", JSON.stringify(envoyes.slice(-500)));
}

function traiter(d) {
  const quand = jour(d.date) + " de " + d.debut + " à " + d.fin;
  if (d.statut === "attente") {
    const a = email("remplacants", d.rid); if (!a) return;
    envoyer(a, "Nouvelle demande de remplacement : " + jour(d.date), "Bonjour " + prenom(d.rnom) + ",",
      [d.pnom + " (" + d.pcommune + ") te propose un remplacement le " + quand + ", à " + tarif(d.tarif) + ".",
       d.message ? "Message : « " + d.message + " »" : "",
       "Ouvre l'appli pour accepter ou refuser."], "Répondre à la demande");
  } else if (d.statut === "acceptee") {
    const a = email("pharmacies", d.pid); if (!a) return;
    envoyer(a, "Remplacement confirmé : " + jour(d.date), "Bonjour,",
      [d.rnom + " a accepté ta demande de remplacement du " + quand + ".",
       "Ses coordonnées sont maintenant visibles dans l'appli, onglet « Mes demandes »."], "Voir la mission");
  } else if (d.statut === "refusee") {
    const a = email("pharmacies", d.pid); if (!a) return;
    envoyer(a, "Demande refusée : " + jour(d.date), "Bonjour,",
      [d.rnom + " n'est pas disponible le " + quand + ".",
       "D'autres remplaçants le sont peut-être : relance une recherche dans l'appli."], "Trouver un remplaçant");
  } else if (d.statut === "annulee") {
    const a = email("remplacants", d.rid); if (!a) return;
    envoyer(a, "Remplacement annulé : " + jour(d.date), "Bonjour " + prenom(d.rnom) + ",",
      [d.pnom + " a annulé sa demande du " + quand + ".",
       "Ce jour n'est plus réservé pour cette officine."], "Ouvrir l'appli");
  }
}

// E-mail de contact du profil (remplacants/… ou pharmacies/…, document prive/contact).
function email(coll, id) {
  const c = appel("get", BASE + "/" + coll + "/" + encodeURIComponent(id) + "/prive/contact");
  const e = c && c.fields ? lire(c.fields).email : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "") ? e : null;
}

function envoyer(a, sujet, salut, lignes, bouton) {
  const l = lignes.filter(Boolean);
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d2340;max-width:520px">'
    + "<p>" + esc(salut) + "</p>" + l.map(x => "<p>" + esc(x) + "</p>").join("")
    + '<p style="margin:24px 0"><a href="' + APPLI + '" style="background:#bf4420;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px;display:inline-block">' + esc(bouton) + "</a></p>"
    + '<p style="color:#5c6178;font-size:13px">Pharma Remplaçant · remplacements en officine en Wallonie.<br>Message automatique, merci de ne pas y répondre.</p></div>';
  MailApp.sendEmail({ to: a, subject: sujet, name: "Pharma Remplaçant", htmlBody: html,
    body: [salut].concat(l, [bouton + " : " + APPLI, "", "Pharma Remplaçant · message automatique, merci de ne pas y répondre."]).join("\n\n") });
}

function appel(methode, url, corps) {
  const r = UrlFetchApp.fetch(url, { method: methode, contentType: "application/json", muteHttpExceptions: true,
    payload: corps ? JSON.stringify(corps) : undefined,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "x-goog-user-project": PROJET } });
  const code = r.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error("Firestore " + code + " : " + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText());
}

function lire(f) {
  const o = {};
  for (const k in f || {}) { const v = f[k]; o[k] = "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue : null; }
  return o;
}
function jour(s) { const p = String(s).split("-").map(Number), d = new Date(p[0], p[1] - 1, p[2]); return JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()]; }
function prenom(n) { return String(n || "").trim().split(/\s+/)[0]; }
function tarif(t) { return String(t).replace(".", ",") + " €/h HTVA"; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
