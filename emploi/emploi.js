// Page publique « Emploi » : lit les offres et annonces publiques, sans compte.
import { initializeApp } from "../vendor/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "../vendor/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";
import { LOC } from "../localites.js";

const GEO=new Map(LOC.map(l=>[l[0],l]));
const POSTES={pharmacien:"Pharmacien·ne",assistant:"Assistant·e pharmaceutico-technique",etudiant:"Étudiant·e",autre:"Autre poste en officine"};
const CONTRATS=["CDI","CDD","Flexi-job","Job étudiant","Intérim"];
const MOIS=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dateFr=s=>{if(!s)return"";const[a,m,j]=s.slice(0,10).split("-").map(Number);return `${j} ${MOIS[m-1]} ${a}`};
const locLabel=n=>{const l=GEO.get(n);return l?`${n} (${l[1]})`:n};
function km(a,b){const A=GEO.get(a),B=GEO.get(b);if(!A||!B)return 999;const R=6371,t=x=>x*Math.PI/180;const dLat=t(B[2]-A[2]),dLon=t(B[3]-A[3]);const h=Math.sin(dLat/2)**2+Math.cos(t(A[2]))*Math.cos(t(B[2]))*Math.sin(dLon/2)**2;return Math.round(2*R*Math.asin(Math.sqrt(h))*1.25)}
const limite=(()=>{const d=new Date();d.setDate(d.getDate()-60);return d.toISOString().slice(0,10)})();
const recent=x=>(x.maj||x.cree||"")>=limite;

document.getElementById("localites").innerHTML=LOC.map(l=>`<option value="${esc(l[0])}">${l[1]}</option>`).join("");
document.getElementById("f-poste").innerHTML=`<option value="">Tous</option>`+Object.entries(POSTES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
document.getElementById("f-contrat").innerHTML=`<option value="">Tous</option>`+CONTRATS.map(c=>`<option>${c}</option>`).join("");

const db=getFirestore(initializeApp(firebaseConfig));
let OFF=[],CAND=[],vue=location.hash==="#candidats"?"candidats":"offres";
const f={poste:"",contrat:"",loc:"",km:999};
const ok=(x,commune)=>!f.loc||!GEO.has(f.loc)||f.km===999||km(f.loc,commune)<=f.km;

function render(){
  document.querySelectorAll("[data-vue]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.vue===vue));
  const el=document.getElementById("liste");
  if(vue==="offres"){
    const l=OFF.filter(o=>recent(o)&&(!f.poste||o.poste===f.poste)&&(!f.contrat||o.contrat===f.contrat)&&ok(o,o.commune)).sort((a,b)=>a.cree<b.cree?1:-1);
    el.innerHTML=`<h2>${l.length} offre${l.length>1?"s":""} d'emploi</h2>`+(l.length?`<div class="cards">${l.map(o=>`<article class="card">
      <div class="top"><h3>${esc(o.titre)}</h3><span class="pill">${esc(o.contrat)}</span></div>
      <p class="muted">${esc(o.officine)} · ${esc(locLabel(o.commune))}${f.loc&&GEO.has(f.loc)?` · ${km(f.loc,o.commune)} km`:""}</p>
      <div class="chips"><span class="chip">${esc(POSTES[o.poste]||"")}</span>${o.horaire?`<span class="chip">${esc(o.horaire)}</span>`:""}${o.debut?`<span class="chip">Dès le ${esc(dateFr(o.debut))}</span>`:""}</div>
      <p class="desc">${esc(o.description)}</p>
      <p class="muted small">Publiée le ${esc(dateFr(o.cree))}</p>
      <a class="btn primary" href="../#emploi">Postuler</a>
    </article>`).join("")}</div>`:`<p class="empty">Aucune offre pour ces critères pour l'instant.</p>`);
  }else{
    const l=CAND.filter(c=>recent(c)&&(!f.poste||c.poste===f.poste)&&(!f.contrat||(c.contrats||[]).includes(f.contrat))&&ok(c,c.commune)).sort((a,b)=>a.maj<b.maj?1:-1);
    el.innerHTML=`<h2>${l.length} candidat${l.length>1?"s":""}</h2>`+(l.length?`<div class="cards">${l.map(c=>`<article class="card">
      <div class="top"><h3>${esc(c.pseudo)}</h3></div>
      <p class="muted">${esc(POSTES[c.poste]||"")} · ${esc(locLabel(c.commune))}</p>
      <div class="chips">${(c.contrats||[]).map(x=>`<span class="chip">${esc(x)}</span>`).join("")}${c.disponible?`<span class="chip">Disponible dès le ${esc(dateFr(c.disponible))}</span>`:""}</div>
      <p class="desc">${esc(c.presentation)}</p>
      <a class="btn primary" href="../#emploi">Contacter (officines)</a>
    </article>`).join("")}</div>`:`<p class="empty">Aucun candidat pour ces critères pour l'instant.</p>`);
  }
}
document.querySelectorAll("[data-vue]").forEach(b=>b.onclick=()=>{vue=b.dataset.vue;history.replaceState(null,"",vue==="candidats"?"#candidats":"#offres");render()});
["f-poste","f-contrat","f-loc","f-km"].forEach(id=>document.getElementById(id).onchange=()=>{f.poste=document.getElementById("f-poste").value;f.contrat=document.getElementById("f-contrat").value;f.loc=document.getElementById("f-loc").value.trim();f.km=+document.getElementById("f-km").value;render()});
Promise.all([getDocs(query(collection(db,"offres"),where("statut","==","ouverte"))),getDocs(query(collection(db,"candidats"),where("statut","==","visible")))])
  .then(([o,c])=>{OFF=o.docs.map(x=>({id:x.id,...x.data()}));CAND=c.docs.map(x=>({id:x.id,...x.data()}));render()})
  .catch(()=>{document.getElementById("liste").innerHTML=`<p class="empty">Impossible de charger les offres pour l'instant. Réessaie dans un moment.</p>`});
