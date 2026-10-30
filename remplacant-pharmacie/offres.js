// Offres d'emploi ouvertes de la province affichée (toutes si la page n'en précise pas).
import { initializeApp } from "../vendor/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "../vendor/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";
import { LOC } from "../localites.js";

const GEO=new Map(LOC.map(l=>[l[0],l]));
const POSTES={pharmacien:"Pharmacien·ne",assistant:"Assistant·e pharmaceutico-technique",etudiant:"Étudiant·e",autre:"Autre poste en officine"};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// Province d'après le code postal
const province=commune=>{const z=+(GEO.get(commune)?.[1]||0);
  return z>=1300&&z<=1499?"brabant-wallon":z>=4000&&z<=4999?"liege":z>=5000&&z<=5999?"namur":z>=6600&&z<=6999?"luxembourg":(z>=6000&&z<=6599)||(z>=7000&&z<=7999)?"hainaut":""};
const el=document.getElementById("offres"), cible=el.dataset.province, racine=cible?"../../":"../";
const limite=(()=>{const d=new Date();d.setDate(d.getDate()-60);return d.toISOString().slice(0,10)})();

getDocs(query(collection(getFirestore(initializeApp(firebaseConfig)),"offres"),where("statut","==","ouverte"))).then(q=>{
  const l=q.docs.map(d=>d.data()).filter(o=>(o.maj||o.cree||"")>=limite&&(!cible||province(o.commune)===cible)).sort((a,b)=>a.cree<b.cree?1:-1).slice(0,6);
  el.innerHTML=l.length?`<div class="cards">${l.map(o=>`<article class="card"><span class="pill">${esc(o.contrat)}</span><h3>${esc(o.titre)}</h3><p class="muted small">${esc(o.officine)} · ${esc(o.commune)}</p><p class="small">${esc(POSTES[o.poste]||"")}${o.horaire?" · "+esc(o.horaire):""}</p><a href="${racine}emploi/">Voir l'offre</a></article>`).join("")}</div>`
    :`<p class="empty">Pas encore d'offre ici. Officines, publiez la vôtre gratuitement depuis l'onglet Emploi de l'appli.</p>`;
}).catch(()=>{el.innerHTML=`<p class="empty">Les offres ne peuvent pas être chargées pour l'instant.</p>`});
