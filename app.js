import { initializeApp } from "./vendor/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification, sendPasswordResetEmail, deleteUser } from "./vendor/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, addDoc, writeBatch } from "./vendor/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { LOC } from "./localites.js";

const GEO=new Map(LOC.map(l=>[l[0],l]));
const LOGICIELS=["Officinall","Farmad","Greenock","Sabco Ultimate","Pharmony","Next Pharm"];
const MOIS=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const JOURS=["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
const FRAIS=2; // € TVAC par mission acceptée, à charge du remplaçant (après le pilote)

const pad=n=>String(n).padStart(2,"0");
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse=s=>{const[a,b,c]=s.split("-").map(Number);return new Date(a,b-1,c)};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const TODAY=(()=>{const d=new Date();d.setHours(0,0,0,0);return d})();
const TODAY_ISO=iso(TODAY);
const nowIso=()=>new Date().toISOString();
const nice=s=>{const d=parse(s);return JOURS[d.getDay()]+" "+d.getDate()+" "+MOIS[d.getMonth()]};
const niceY=s=>nice(s)+" "+s.slice(0,4);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=n=>String(n||"?").split(/\s+/).filter(Boolean).map(w=>w[0]).join("").slice(0,2).toUpperCase();
const locLabel=n=>{const l=GEO.get(n);return l?`${n} (${l[1]})`:n};
function km(a,b){const A=GEO.get(a),B=GEO.get(b);if(!A||!B)return 999;const R=6371,toR=x=>x*Math.PI/180;
  const dLat=toR(B[2]-A[2]),dLon=toR(B[3]-A[3]);const h=Math.sin(dLat/2)**2+Math.cos(toR(A[2]))*Math.cos(toR(B[2]))*Math.sin(dLon/2)**2;
  return Math.round(2*R*Math.asin(Math.sqrt(h))*1.25);} // ×1.25 : estimation de la distance par la route
function hours(a,b){const[h1,m1]=a.split(":").map(Number),[h2,m2]=b.split(":").map(Number);return Math.max(0,(h2*60+m2-h1*60-m1)/60)}
function nextDow(dow){let d=addDays(TODAY,1);while(d.getDay()!==dow)d=addDays(d,1);return d}
const fmtH=h=>String(Math.round(h*100)/100).replace(".",",");
const fmtNote=n=>n.toFixed(1).replace(".",",");
// N° d'entreprise belge (BCE) : 10 chiffres, les 2 derniers = 97 - (8 premiers modulo 97)
function bceNorm(v){let d=String(v||"").replace(/\D/g,"");if(d.length===9)d="0"+d;return d}
function bceOk(d){return /^[01]\d{9}$/.test(d)&&97-Number(d.slice(0,8))%97===Number(d.slice(8))}
const bceFmt=d=>d.length===10?`${d.slice(0,4)}.${d.slice(4,7)}.${d.slice(7)}`:d;
const telOk=v=>String(v||"").replace(/\D/g,"").length>=9;
const statutLabel=s=>s==="pharmacien"?"Pharmacien·ne":"Assistant·e en pharmacie";
const stLabel={attente:"En attente",acceptee:"Confirmée",refusee:"Refusée",annulee:"Annulée"};
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

const app=document.getElementById("app"), tabsEl=document.getElementById("tabs"), layer=document.getElementById("layer"), rolesEl=document.getElementById("roles");
document.getElementById("localites").innerHTML=LOC.map(l=>`<option value="${esc(l[0])}">${l[1]}</option>`).join("");
function toast(msg){layer.querySelector(".toast")?.remove();const t=document.createElement("div");t.className="toast";t.setAttribute("role","status");t.textContent=msg;layer.appendChild(t);setTimeout(()=>t.remove(),3400)}

/* ---------- installation sur l'écran d'accueil ---------- */
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
let installEvt=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e;renderInstallBar()});
window.addEventListener("appinstalled",()=>{installEvt=null;renderInstallBar();toast("Appli installée sur ton écran d'accueil")});
const standalone=()=>window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
const isMobile=/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
// Bandeau en haut de page qui propose d'installer l'appli (masquable 7 jours)
function renderInstallBar(){
  const bar=document.getElementById("installbar"); if(!bar)return;
  const cache=+(store.get("pr-install-hide")||0);
  if(standalone()||Date.now()-cache<7*864e5){bar.hidden=true;bar.innerHTML="";return}
  const txt=installEvt?"Accès en un geste, en plein écran, comme une vraie appli."
    :isIOS?"Dans Safari, touche le bouton Partager puis « Sur l'écran d'accueil »."
    :isMobile?"Menu ⋮ du navigateur, puis « Ajouter à l'écran d'accueil » ou « Installer l'application »."
    :"Clique sur l'icône « Installer » dans la barre d'adresse du navigateur.";
  bar.innerHTML=`<div class="wrap installbar"><img src="icon-192.png" alt="" width="36" height="36"><span><b>Télécharge l'appli Pharma Remplaçant</b><br><span class="hint">${txt}</span></span><span class="row">${installEvt?`<button class="btn small primary" id="inst-go">Installer</button>`:""}<button class="linkbtn" id="inst-x" aria-label="Masquer le bandeau">Plus tard</button></span></div>`;
  bar.hidden=false;
  document.getElementById("inst-go")?.addEventListener("click",async()=>{installEvt.prompt();await installEvt.userChoice.catch(()=>{});installEvt=null;renderInstallBar()});
  document.getElementById("inst-x").addEventListener("click",()=>{store.set("pr-install-hide",String(Date.now()));renderInstallBar()});
}
function installBanner(){return ""}
function bindInstall(){}
renderInstallBar();

/* ---------- Firebase ---------- */
const configured=firebaseConfig.apiKey&&firebaseConfig.apiKey!=="A_REMPLACER";
let auth=null, db=null;
if(configured){const fb=initializeApp(firebaseConfig);auth=getAuth(fb);auth.languageCode="fr";db=getFirestore(fb)}

/* ---------- état ---------- */
let user=null, uid=null, isAdmin=false, ready=false;
let myR=null, myP=null, RV={}, RA={}, P={}, Dmap={}, D=[], A=[];
let unsubs=[];
let role=store.get("pr-role")||"r", tab=null, calMonth=new Date(TODAY.getFullYear(),TODAY.getMonth(),1);
let search={date:iso(nextDow(5)),statut:"tous",logiciel:"",debut:"08:30",fin:"18:30"};
let localDispo=null, dispoTimer=null, current=null, authMode="login";
{const h=location.hash.replace("#","");
 if(h.startsWith("inscription")){authMode="register";if(h==="inscription-pharmacie")role="p";else if(h==="inscription-remplacant")role="r";store.set("pr-role",role)}}
const contacts=new Map(); // "r:<id>" | "p:<id>" -> objet, "…" pendant le chargement, null si illisible

const rem=id=>(id===uid&&myR)||RA[id]||RV[id]||null;
const myDispo=()=>localDispo||(myR?.dispo||[]);
function noteOf(id){const l=A.filter(a=>a.pour===id);return{n:l.length,avg:l.length?l.reduce((s,a)=>s+a.note,0)/l.length:0,list:l}}
function noteChip(id){const{n,avg}=noteOf(id);return n?`<span class="chip"><span class="stars">★</span> ${fmtNote(avg)} (${n} avis)</span>`:`<span class="chip">Pas encore d'avis</span>`}
function avisList(id){const{list}=noteOf(id);if(!list.length)return"";
  return `<details class="avis"><summary>Lire les ${list.length} avis vérifiés</summary><p class="hint" style="margin:6px 0 0">Avis laissés uniquement après une mission confirmée sur Pharma Remplaçant.</p><ul>${list.slice().sort((a,b)=>a.cree<b.cree?1:-1).map(a=>`<li><span class="stars">${"★".repeat(a.note)}</span><span class="muted">${"★".repeat(5-a.note)}</span>${a.texte?`<br>${esc(a.texte)}`:""}</li>`).join("")}</ul></details>`}

/* ---------- écritures ---------- */
async function write(fn,okMsg){
  try{await fn();if(okMsg)toast(okMsg);return true}
  catch(e){
    console.error(e);
    if(e?.code==="permission-denied")toast("Action refusée. Vérifie que ton profil est complet, puis réessaie.");
    else if(e?.code==="unavailable")toast("Pas de connexion. Réessaie dans un moment.");
    else toast("Enregistrement impossible pour l'instant. Réessaie dans un moment.");
    return false}
}

/* ---------- connexion ---------- */
function vSetup(){
  rolesEl.hidden=true;tabsEl.innerHTML="";
  app.innerHTML=`<div class="stack"><h1>Configuration à terminer</h1><p class="lede">L'appli n'est pas encore reliée à Firebase. Colle la configuration de ton projet dans le fichier <span class="mono">firebase-config.js</span>, comme indiqué dans le guide, puis dépose à nouveau le dossier sur l'hébergeur.</p></div>`;
}
function vAuth(){
  rolesEl.hidden=true;tabsEl.innerHTML="";current=null;
  const reg=authMode==="register", reset=authMode==="reset";
  app.innerHTML=`<div class="stack auth">
    <div><h1>${reset?"Mot de passe oublié":reg?"Créer un compte":"Connexion"}</h1><p class="lede">${reset?"Indique ton e-mail : tu recevras tout de suite un lien pour choisir un nouveau mot de passe.":reg?"Gratuit pour les officines. Pour les remplaçants, inscription gratuite puis 2 € TVAC par mission acceptée, après le pilote.":"Remplaçants indépendants et officines de Wallonie."}</p></div>
    ${reset?"":`<div class="seg" role="group" aria-label="Connexion ou inscription"><button id="m-login" aria-pressed="${!reg}">J'ai un compte</button><button id="m-reg" aria-pressed="${reg}">Créer un compte</button></div>`}
    <form class="panel stack" id="af">
      <label>E-mail<input id="a-email" type="email" required autocomplete="email"></label>
      ${reset?"":`<label>Mot de passe<input id="a-pass" type="password" required minlength="6" autocomplete="${reg?"new-password":"current-password"}">${reg?`<span class="hint">6 caractères minimum.</span>`:""}</label>`}
      <button class="btn primary" type="submit">${reset?"Envoyer le lien":reg?"Créer mon compte":"Me connecter"}</button>
      <div class="auth-links">${reset?`<button type="button" class="linkbtn" id="m-back">Retour à la connexion</button>`:`<button type="button" class="linkbtn" id="m-reset">Mot de passe oublié ?</button>`}<a class="linkbtn" href="decouvrir/">Découvrir Pharma Remplaçant</a></div>
    </form>
    <p class="hint" style="text-align:center;margin:0"><a href="legal/#mentions">Mentions légales</a> · <a href="legal/#conditions">Conditions d'utilisation</a> · <a href="legal/#confidentialite">Confidentialité</a></p>
    ${installBanner()}
  </div>`;
  document.getElementById("m-login")?.addEventListener("click",()=>{authMode="login";vAuth()});
  document.getElementById("m-reg")?.addEventListener("click",()=>{authMode="register";vAuth()});
  document.getElementById("m-reset")?.addEventListener("click",()=>{authMode="reset";vAuth()});
  document.getElementById("m-back")?.addEventListener("click",()=>{authMode="login";vAuth()});
  bindInstall();
  document.getElementById("af").onsubmit=async e=>{e.preventDefault();
    const email=document.getElementById("a-email").value.trim(), pass=document.getElementById("a-pass")?.value||"";
    const btn=e.submitter||document.querySelector("#af button[type=submit]");btn.disabled=true;
    try{
      if(reset){await sendPasswordResetEmail(auth,email);toast("E-mail envoyé. Pense à vérifier les spams.");authMode="login";vAuth();return}
      if(reg){const c=await createUserWithEmailAndPassword(auth,email,pass);sendEmailVerification(c.user).catch(()=>{})}
      else await signInWithEmailAndPassword(auth,email,pass);
    }catch(err){
      const m={"auth/email-already-in-use":"Un compte existe déjà avec cet e-mail. Connecte-toi.","auth/invalid-email":"Cet e-mail n'est pas valide.","auth/weak-password":"Mot de passe trop court : 6 caractères minimum.","auth/invalid-credential":"E-mail ou mot de passe incorrect.","auth/wrong-password":"E-mail ou mot de passe incorrect.","auth/user-not-found":"Aucun compte avec cet e-mail.","auth/too-many-requests":"Trop d'essais. Attends quelques minutes.","auth/network-request-failed":"Pas de connexion internet."};
      toast(m[err.code]||"Connexion impossible pour l'instant.");btn.disabled=false;
    }
  };
}

function stopAll(){unsubs.forEach(u=>u());unsubs=[];contacts.clear()}
function resetState(){factu=factures=abo=null;myR=myP=null;RV={};RA={};P={};Dmap={};D=[];A=[];isAdmin=false;ready=false;localDispo=null}

if(!configured)vSetup();
else onAuthStateChanged(auth,async u=>{
  stopAll();resetState();user=u;uid=u?.uid||null;
  if(!u){vAuth();return}
  app.innerHTML=`<div class="stack"><h1>Chargement…</h1></div>`;
  try{isAdmin=(await getDoc(doc(db,"admins",uid))).exists()}catch(e){isAdmin=false}
  const subs=[
    [doc(db,"remplacants",uid),s=>{myR=s.exists()?s.data():null}],
    [doc(db,"pharmacies",uid),s=>{myP=s.exists()?s.data():null}],
    [query(collection(db,"remplacants"),where("valide","==",true)),s=>{RV={};s.forEach(x=>RV[x.id]=x.data())}],
    [collection(db,"pharmacies"),s=>{P={};s.forEach(x=>P[x.id]=x.data())}],
    [collection(db,"avis"),s=>{A=s.docs.map(x=>({id:x.id,...x.data()}))}],
  ];
  const putD=(tag)=>s=>{for(const k of Object.keys(Dmap))if(Dmap[k].__t===tag)delete Dmap[k];s.forEach(x=>{Dmap[x.id]={id:x.id,...x.data(),__t:tag}});D=Object.values(Dmap)};
  if(isAdmin){
    subs.push([collection(db,"remplacants"),s=>{RA={};s.forEach(x=>RA[x.id]=x.data())}]);
    subs.push([collection(db,"demandes"),putD("all")]);
  }else{
    subs.push([query(collection(db,"demandes"),where("rid","==",uid)),putD("r")]);
    subs.push([query(collection(db,"demandes"),where("pid","==",uid)),putD("p")]);
  }
  let pending=subs.length;
  for(const [ref,fn] of subs){
    let first=true;
    unsubs.push(onSnapshot(ref,s=>{fn(s);if(first){first=false;if(--pending===0){ready=true;mount()}}else rerender()},
      e=>{console.error(e);if(first){first=false;if(--pending===0){ready=true;mount()}}}));
  }
});

/* ---------- navigation ---------- */
let lastTabs="";
function tabsFor(){
  if(role==="a")return[["validation","Remplaçants"],["vue","Vue d'ensemble"]];
  if(role==="r"){
    if(!myR)return[["inscription","Créer mon profil"],["compte","Mon compte"]];
    const pend=D.filter(d=>d.rid===uid&&d.statut==="attente"&&d.date>=TODAY_ISO).length;
    return[["agenda","Mon agenda"],["demandes","Demandes"+(pend?`<span class="count">${pend}</span>`:"")],["facturation","Facturation"],["profil","Mon profil"],["compte","Mon compte"]];
  }
  if(!myP)return[["officine","Inscrire mon officine"],["compte","Mon compte"]];
  return[["trouver","Trouver un remplaçant"],["mesdemandes","Mes demandes"],["officine","Mon officine"],["compte","Mon compte"]];
}
function renderTabs(){
  const list=tabsFor();lastTabs=list.map(t=>t[0]).join();
  if(!list.some(([k])=>k===tab))tab=list[0][0];
  tabsEl.innerHTML=list.map(([k,l])=>`<button role="tab" aria-selected="${tab===k}" data-tab="${k}">${l}</button>`).join("");
  tabsEl.querySelectorAll("button").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;mount()});
  rolesEl.hidden=false;
  rolesEl.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.role===role));
  document.getElementById("role-a").hidden=!isAdmin;
}
rolesEl.querySelectorAll("button").forEach(b=>b.onclick=()=>{role=b.dataset.role;store.set("pr-role",role);tab=null;mount()});

const VIEWS={agenda:vAgenda,demandes:vDemandes,profil:vProfil,inscription:vProfil,trouver:vTrouver,mesdemandes:vMesDemandes,officine:vOfficine,validation:vValidation,vue:vVue,compte:vCompte,facturation:vFacturation};
function mount(){
  if(!user||!ready)return;
  if(role==="a"&&!isAdmin)role="r";
  renderTabs();current=VIEWS[tab]()||{};window.scrollTo({top:0});
}
function rerender(){
  if(!user||!ready){if(!user&&configured&&authMode)vAuthRefresh();return}
  const before=lastTabs;renderTabs();
  if(lastTabs!==before&&!current?.keep){current=VIEWS[tab]()||{};return}
  if(current?.refresh)current.refresh();else current=VIEWS[tab]()||{};
}
function vAuthRefresh(){if(document.getElementById("af")&&!document.querySelector(".install"))vAuth()}
function banner(){
  let h="";
  if(user&&!user.emailVerified&&!store.get("pr-verif-hide-"+uid))h+=`<div class="notice install"><span><b>Confirme ton e-mail</b> avec le lien reçu à ${esc(user.email)} (regarde aussi les spams).</span><span class="row"><button class="btn small" id="vf-send">Renvoyer</button><button class="linkbtn" id="vf-x">Masquer</button></span></div>`;
  return h+installBanner();
}
function bindBanner(){
  bindInstall();
  document.getElementById("vf-send")?.addEventListener("click",()=>sendEmailVerification(user).then(()=>toast("E-mail de confirmation renvoyé")).catch(()=>toast("Réessaie dans quelques minutes.")));
  document.getElementById("vf-x")?.addEventListener("click",()=>{store.set("pr-verif-hide-"+uid,"1");rerender()});
}

/* ---------- coordonnées (lisibles après confirmation) ---------- */
function loadContact(kind,id){
  const k=kind+":"+id;if(contacts.has(k))return contacts.get(k);
  contacts.set(k,"…");
  getDoc(doc(db,kind==="r"?"remplacants":"pharmacies",id,"prive","contact"))
    .then(s=>{contacts.set(k,s.exists()?s.data():null);rerender()})
    .catch(()=>{contacts.set(k,null);rerender()});
  return "…";
}
function contactBlock(kind,id){
  const c=loadContact(kind,id);
  if(c==="…")return `<div class="contact"><b>Coordonnées</b><span class="muted">Chargement…</span></div>`;
  if(!c)return `<div class="contact"><b>Coordonnées</b><span class="muted">Indisponibles pour l'instant.</span></div>`;
  const line=(lab,v)=>v?`<div class="row"><span><span class="muted">${lab}</span> <b class="mono">${esc(v)}</b></span><button type="button" class="btn small" data-copy="${esc(v)}">Copier</button></div>`:"";
  return `<div class="contact"><b>Coordonnées</b>${line("Tél.",c.tel)}${line("E-mail",c.email)}${c.adresse?`<div><span class="muted">Adresse</span> ${esc(c.adresse)}</div>`:""}</div>`;
}
function bindCopy(root){root.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{
  try{await navigator.clipboard.writeText(b.dataset.copy);toast("Copié")}catch(e){toast("Copie impossible : sélectionne le texte à la main")}})}

/* ---------- REMPLAÇANT : AGENDA ---------- */
function bookedMap(rid){return new Map(D.filter(d=>d.rid===rid&&d.statut==="acceptee").map(d=>[d.date,d]))}
function saveDispo(){
  clearTimeout(dispoTimer);
  dispoTimer=setTimeout(async()=>{dispoTimer=null;const list=[...new Set(localDispo)].filter(k=>k>=TODAY_ISO).sort();
    await write(()=>updateDoc(doc(db,"remplacants",uid),{dispo:list,maj:nowIso()}));if(!dispoTimer)localDispo=null},700);
}
function vAgenda(){
  const draw=()=>{
  const r=myR; if(!r)return;
  const dispo=new Set(myDispo()), booked=bookedMap(uid);
  const pendingSet=new Set(D.filter(d=>d.rid===uid&&d.statut==="attente").map(d=>d.date));
  const y=calMonth.getFullYear(),m=calMonth.getMonth();
  const lead=(new Date(y,m,1).getDay()+6)%7, nDays=new Date(y,m+1,0).getDate();
  let cells="";
  for(let i=0;i<lead;i++)cells+=`<span class="day out" aria-hidden="true"></span>`;
  for(let d=1;d<=nDays;d++){
    const k=iso(new Date(y,m,d)), past=k<TODAY_ISO;
    let cls="day",tag="",lab=nice(k);
    if(past)cls+=" past";
    if(booked.has(k)){cls+=" booked";tag="Mission";lab+=", mission confirmée"}
    else if(dispo.has(k)){cls+=" on";tag="Dispo";lab+=", disponible"}
    if(pendingSet.has(k)){cls+=" pending";lab+=", demande en attente"}
    if(k===TODAY_ISO)cls+=" today";
    cells+=`<button class="${cls}" data-d="${k}" aria-label="${lab}" ${past||booked.has(k)?"disabled":""}><span>${d}</span>${tag?`<span class="tag">${tag}</span>`:""}</button>`;
  }
  const upcoming=[...dispo].filter(k=>k>=TODAY_ISO&&!booked.has(k)).length;
  const monthDispo=[...dispo].filter(k=>k.startsWith(y+"-"+pad(m+1))).length;
  const futureMissions=[...booked.values()].filter(d=>d.date>=TODAY_ISO).sort((a,b)=>a.date<b.date?-1:1);
  const nm=futureMissions[0];
  const keepDow=document.getElementById("q-dow")?.value||"5", keepFreq=document.getElementById("q-freq")?.value||"7";
  app.innerHTML=`<div class="stack">
    ${banner()}
    ${r.bloque?`<div class="notice"><b>Profil suspendu.</b> Les pharmacies ne te voient plus. Contacte l'administrateur au 0493 44 50 48.</div>`:r.valide?"":`<div class="notice"><b>Profil incomplet.</b> Complète ton n° d'entreprise et ton diplôme dans « Mon profil » pour être visible des pharmacies.</div>`}
    <div><h1>Bonjour ${esc(r.nom.split(" ")[0])}</h1><p class="lede">Touche un jour pour l'ouvrir ou le fermer. Les pharmacies ne voient que tes jours ouverts, dans ton rayon de ${r.rayon} km autour de ${esc(r.commune)}.</p></div>
    <div class="two">
      <div class="panel">
        <div class="cal-head"><button class="btn small" id="prev" aria-label="Mois précédent">←</button><h2>${MOIS[m]} ${y}</h2><button class="btn small" id="next" aria-label="Mois suivant">→</button></div>
        <div class="cal">${["L","M","M","J","V","S","D"].map(x=>`<div class="dow">${x}</div>`).join("")}${cells}</div>
        <div class="legend"><span><i style="background:var(--accent-soft);border-color:var(--accent)"></i>Disponible</span><span><i style="background:var(--accent);border-color:var(--accent)"></i>Mission confirmée</span><span><i style="box-shadow:inset 0 -3px 0 var(--warn)"></i>Demande en attente</span></div>
      </div>
      <div class="stack">
        <div class="panel stack">
          <div class="stat"><div><b>${upcoming}</b><span>jours ouverts à venir</span></div><div><b>${monthDispo}</b><span>en ${MOIS[m]}</span></div><div><b>${futureMissions.length}</b><span>missions à venir</span></div></div>
          ${nm?`<p style="margin:0">Prochaine mission : <b>${nice(nm.date)}</b> à ${esc(P[nm.pid]?.nom||nm.pnom)} (${esc(P[nm.pid]?.commune||nm.pcommune)}), <span class="mono">${nm.debut}–${nm.fin}</span>.</p>`:`<p class="muted" style="margin:0">Aucune mission confirmée pour l'instant.</p>`}
        </div>
        <div class="panel stack">
          <h2>Remplir vite</h2>
          <p class="muted" style="margin:0;font-size:14px">Ouvre des jours sur les 3 prochains mois.</p>
          <div class="row">
            <select id="q-dow" aria-label="Jour de la semaine" style="width:auto">${[1,2,3,4,5,6].map(i=>`<option value="${i}" ${String(i)===keepDow?"selected":""}>Tous les ${JOURS[i]}s</option>`).join("")}</select>
            <select id="q-freq" aria-label="Fréquence" style="width:auto"><option value="7" ${keepFreq==="7"?"selected":""}>chaque semaine</option><option value="14" ${keepFreq==="14"?"selected":""}>une semaine sur deux</option></select>
          </div>
          <div class="row"><button class="btn primary" id="q-add">Ouvrir ces jours</button><button class="btn danger" id="q-clear">Fermer tout ${MOIS[m]}</button></div>
        </div>
      </div>
    </div>
  </div>`;
  bindBanner();
  app.querySelectorAll(".day[data-d]:not([disabled])").forEach(b=>b.onclick=()=>{
    const k=b.dataset.d;localDispo=[...myDispo()];const i=localDispo.indexOf(k);
    if(i>=0)localDispo.splice(i,1);else localDispo.push(k);saveDispo();draw();
    app.querySelector(`.day[data-d="${k}"]`)?.focus();
  });
  document.getElementById("prev").onclick=()=>{calMonth=new Date(y,m-1,1);draw()};
  document.getElementById("next").onclick=()=>{calMonth=new Date(y,m+1,1);draw()};
  document.getElementById("q-add").onclick=()=>{
    const dow=+document.getElementById("q-dow").value,step=+document.getElementById("q-freq").value;
    localDispo=[...myDispo()];const set=new Set(localDispo);let d=nextDow(dow),n=0;
    while(d<=addDays(TODAY,92)){const k=iso(d);if(!set.has(k)&&!booked.has(k)){localDispo.push(k);n++}d=addDays(d,step)}
    saveDispo();draw();toast(n?`${n} jours ouverts`:"Ces jours étaient déjà ouverts");
  };
  document.getElementById("q-clear").onclick=()=>{
    const pre=y+"-"+pad(m+1),before=myDispo().length;localDispo=myDispo().filter(k=>!k.startsWith(pre)||k<TODAY_ISO);
    saveDispo();draw();toast(`${before-localDispo.length} jours fermés en ${MOIS[m]}`);
  };
  };
  draw();return{refresh:draw};
}

/* ---------- cartes de demande (deux côtés) ---------- */
function reqCard(d,mode){
  const r=rem(d.rid)||{nom:d.rnom||"Remplaçant",statut:"",commune:"",tarif:d.tarif};
  const p=P[d.pid]||{nom:d.pnom,commune:d.pcommune};
  const h=hours(d.debut,d.fin), cost=Math.round(h*(d.tarif??r.tarif));
  const past=d.date<TODAY_ISO;
  const title=mode==="r"?`${esc(p.nom)} · ${esc(p.commune)}`:esc(r.nom||d.rnom);
  const sub=mode==="r"?`${km(myR?.commune,p.commune)} km de chez toi`:`${r.statut?statutLabel(r.statut)+" · ":""}${esc(r.commune||"")}`;
  const otherId=mode==="r"?d.pid:d.rid;
  const myAvis=A.find(a=>a.demandeId===d.id&&a.de===uid);
  let actions="";
  if(mode==="r"&&d.statut==="attente"&&!past)actions=`<div class="row"><button class="btn primary" data-acc="${d.id}">Accepter</button><button class="btn" data-ref="${d.id}">Refuser</button></div>`;
  if(mode==="p"&&d.statut==="attente"&&!past)actions=`<div class="row"><button class="btn small danger" data-cancel="${d.id}">Annuler la demande</button></div>`;
  if(mode==="p"&&d.statut==="acceptee"&&!past)actions=`<div class="row"><button class="btn small danger" data-cancel="${d.id}">Annuler la mission</button></div>`;
  if(d.statut==="acceptee"&&past)actions=myAvis?`<p class="muted" style="margin:0;font-size:13px">Ton avis : <span class="stars">${"★".repeat(myAvis.note)}</span>${"★".repeat(5-myAvis.note)}</p>`:`<div class="row"><button class="btn primary small" data-rate="${d.id}" data-mode="${mode}">Noter ${mode==="r"?"la pharmacie":"le remplaçant"}</button></div>`;
  const contact=d.statut==="acceptee"?contactBlock(mode==="r"?"p":"r",otherId):"";
  const status=d.statut==="attente"&&past?`<span class="status st-annulee">Expirée</span>`:`<span class="status st-${d.statut}">${stLabel[d.statut]}</span>`;
  return `<div class="card req">
    <div class="req-top"><div style="min-width:0"><h3>${title}</h3><p class="muted" style="margin:0;font-size:13px">${sub}</p></div>${status}</div>
    <div class="chips">${noteChip(otherId)}</div>
    <div class="facts"><div><b style="font-family:var(--f-body);text-transform:capitalize">${nice(d.date).split(" ").slice(0,2).join(" ")}</b><span>${MOIS[parse(d.date).getMonth()]}</span></div><div><b>${d.debut}–${d.fin}</b><span>${fmtH(h)} h</span></div><div><b>${cost} €</b><span>estimation</span></div></div>
    ${d.message?`<q>${esc(d.message)}</q>`:""}
    ${d.statut==="attente"?`<p class="muted" style="margin:0;font-size:12px">Les coordonnées s'affichent des deux côtés dès que la mission est confirmée.</p>`:""}
    ${mode==="r"&&d.statut==="annulee"?`<p class="muted" style="margin:0;font-size:12px">Ce jour est à nouveau libre : rouvre-le dans ton agenda si tu veux.</p>`:""}
    ${contact}${actions}</div>`;
}
function bindReqActions(root){
  bindCopy(root);
  root.querySelectorAll("[data-acc]").forEach(b=>b.onclick=()=>{
    const d=D.find(x=>x.id===b.dataset.acc);
    if(bookedMap(uid).has(d.date)){toast("Tu as déjà une mission confirmée ce jour-là.");return}
    b.disabled=true;
    write(async()=>{
      const batch=writeBatch(db), t=nowIso();
      batch.update(doc(db,"demandes",d.id),{statut:"acceptee",maj:t});
      batch.set(doc(db,"liens",uid+"_"+d.pid),{rid:uid,pid:d.pid,demandeId:d.id,maj:t});
      for(const o of D.filter(o=>o.id!==d.id&&o.rid===uid&&o.date===d.date&&o.statut==="attente"))batch.update(doc(db,"demandes",o.id),{statut:"refusee",maj:t});
      batch.update(doc(db,"remplacants",uid),{dispo:(myR.dispo||[]).filter(k=>k!==d.date&&k>=TODAY_ISO),maj:t});
      await batch.commit();
    },"Mission confirmée. Les coordonnées de la pharmacie sont affichées.").then(ok=>{if(!ok)b.disabled=false});
  });
  root.querySelectorAll("[data-ref]").forEach(b=>b.onclick=()=>{b.disabled=true;write(()=>updateDoc(doc(db,"demandes",b.dataset.ref),{statut:"refusee",maj:nowIso()}),"Demande refusée")});
  root.querySelectorAll("[data-cancel]").forEach(b=>b.onclick=()=>confirmSheet("Annuler ?","Le remplaçant verra la demande comme annulée.","Annuler la demande",()=>write(()=>updateDoc(doc(db,"demandes",b.dataset.cancel),{statut:"annulee",maj:nowIso()}),"Demande annulée")));
  root.querySelectorAll("[data-rate]").forEach(b=>b.onclick=()=>rateModal(D.find(x=>x.id===b.dataset.rate),b.dataset.mode));
}
function confirmSheet(title,text,action,fn){
  layer.innerHTML=`<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cf-t"><h2 id="cf-t">${esc(title)}</h2><p style="margin:0">${esc(text)}</p>
  <div class="row" style="justify-content:flex-end"><button class="btn" id="cf-x">Retour</button><button class="btn primary" id="cf-ok">${esc(action)}</button></div></div></div>`;
  const close=()=>layer.innerHTML="";
  document.getElementById("cf-x").onclick=close;document.getElementById("ov").onclick=e=>{if(e.target.id==="ov")close()};
  document.getElementById("cf-ok").onclick=()=>{close();fn()};document.getElementById("cf-ok").focus();
}
function rateModal(d,mode){
  const sens=mode==="r"?"r":"p";
  const target=sens==="r"?(P[d.pid]?.nom||d.pnom):(rem(d.rid)?.nom||d.rnom||"le remplaçant");
  layer.innerHTML=`<div class="overlay" id="ov"><form class="sheet" id="rf" role="dialog" aria-modal="true" aria-labelledby="rf-t">
    <div><h2 id="rf-t">Noter ${esc(target)}</h2><p class="muted" style="margin:4px 0 0;font-size:14px">Mission du ${nice(d.date)}. Ton avis sera visible par les autres utilisateurs, avec la mention « avis vérifié ». Reste factuel et respectueux : les avis injurieux sont retirés.</p></div>
    <fieldset><legend>Note</legend><div class="rate">${[5,4,3,2,1].map(n=>`<input type="radio" name="note" id="n${n}" value="${n}" ${n===5?"checked":""}><label for="n${n}" aria-label="${n} sur 5">★</label>`).join("")}</div></fieldset>
    <label>Commentaire (facultatif)<textarea id="rf-t2" maxlength="500" placeholder="${sens==="r"?"Accueil, organisation, consignes claires…":"Ponctualité, autonomie, contact avec les patients…"}"></textarea></label>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" id="rf-x">Annuler</button><button class="btn primary" type="submit">Publier l'avis</button></div></form></div>`;
  const close=()=>layer.innerHTML="";
  document.getElementById("rf-x").onclick=close;document.getElementById("ov").onclick=e=>{if(e.target.id==="ov")close()};
  document.getElementById("rf").onsubmit=e=>{e.preventDefault();
    const note=+document.querySelector('input[name="note"]:checked').value;
    write(()=>setDoc(doc(db,"avis",d.id+"_"+sens),{demandeId:d.id,sens,de:uid,pour:sens==="r"?d.pid:d.rid,note,texte:document.getElementById("rf-t2").value.trim(),cree:nowIso()}),"Merci, ton avis est publié");close()};
}

/* ---------- REMPLAÇANT : DEMANDES ---------- */
function vDemandes(){
  const draw=()=>{
  const mine=D.filter(d=>d.rid===uid).sort((a,b)=>(a.statut==="attente"?0:1)-(b.statut==="attente"?0:1)||(a.date<b.date?-1:1));
  const toRate=mine.filter(d=>d.statut==="acceptee"&&d.date<TODAY_ISO&&!A.some(a=>a.demandeId===d.id&&a.de===uid)).length;
  app.innerHTML=`<div class="stack">${banner()}<div><h1>Demandes reçues</h1><p class="lede">Une pharmacie a vu un de tes jours ouverts et te demande. Accepter bloque le jour dans ton agenda et affiche ses coordonnées.</p><p class="hint" style="margin:6px 0 0">Gratuit pendant le pilote. Ensuite, ${FRAIS} € TVAC par mission acceptée, rien pour un refus.</p></div>
    ${toRate?`<div class="notice ok"><b>${toRate} mission${toRate>1?"s":""} à noter.</b> Ton avis aide les autres remplaçants à choisir leurs officines.</div>`:""}
    ${mine.length?`<div class="cards">${mine.map(d=>reqCard(d,"r")).join("")}</div>`:`<div class="empty">Aucune demande pour l'instant. Ouvre des jours dans ton agenda pour être visible.</div>`}</div>`;
  bindBanner();bindReqActions(app);};
  draw();return{refresh:draw};
}

/* ---------- REMPLAÇANT : PROFIL / INSCRIPTION ---------- */
function vProfil(){
  const r=myR, isNew=!r;
  const v=r||{nom:"",statut:"assistant",commune:"",rayon:30,tarif:30,exp:0,logiciels:[],bio:""};
  app.innerHTML=`<div class="stack">${banner()}<div><h1>${isNew?"Créer mon profil de remplaçant":"Mon profil"}</h1><p class="lede">${isNew?"Ton profil est visible par les pharmacies dès que tous les champs sont valides. Ton n° d'entreprise est contrôlé automatiquement.":"C'est ce que voient les pharmacies quand elles cherchent un remplaçant. Ton téléphone et ton e-mail ne sont montrés qu'après une mission confirmée ; ton n° BCE et ton diplôme, seulement à l'administrateur."}</p></div>
  <form class="panel stack" id="pf">
    <div class="grid">
      <label>Nom complet<input id="p-nom" value="${esc(v.nom)}" required autocomplete="name"></label>
      <label>Statut<select id="p-statut"><option value="assistant" ${v.statut==="assistant"?"selected":""}>Assistant·e en pharmacie</option><option value="pharmacien" ${v.statut==="pharmacien"?"selected":""}>Pharmacien·ne</option></select></label>
      <label>Localité de départ<input id="p-commune" list="localites" value="${esc(v.commune)}" required placeholder="Ex. : Wépion" autocomplete="off"></label>
      <label>Rayon de déplacement (km)<input id="p-rayon" type="number" min="5" max="150" value="${v.rayon}" required></label>
      <label>Tarif horaire (€ HTVA)<input id="p-tarif" type="number" min="10" max="200" step="0.5" value="${v.tarif}" required></label>
      <label>Années d'expérience<input id="p-exp" type="number" min="0" max="50" value="${v.exp}"></label>
      <label>Téléphone<input id="p-tel" type="tel" required autocomplete="tel" placeholder="04xx xx xx xx"></label>
      <label>E-mail de contact<input id="p-email" type="email" required autocomplete="email" value="${esc(isNew?user.email:"")}"></label>
      <label>N° d'entreprise (BCE)<input id="p-bce" required placeholder="0xxx.xxx.xxx"><span class="hint">Statut d'indépendant obligatoire pour les remplacements.</span></label>
      <label>Diplôme<input id="p-dipl" required placeholder="Ex. : Bachelier APT, HEPN 2018"><span class="hint">Pharmacien·ne : indique aussi ton n° de visa.</span></label>
    </div>
    <fieldset><legend>Logiciels maîtrisés</legend>
      <div class="row">${LOGICIELS.map((l,i)=>`<label class="check" style="align-items:center"><input type="checkbox" id="lg-${i}" ${v.logiciels.includes(l)?"checked":""}>${l}</label>`).join("")}</div></fieldset>
    <label>Présentation<textarea id="p-bio" maxlength="600" placeholder="Ton expérience, tes points forts, tes jours habituels…">${esc(v.bio)}</textarea></label>
    ${isNew?`<label class="check"><input type="checkbox" id="p-ok" required><span>J'accepte les <a href="legal/#conditions" target="_blank" rel="noopener">conditions d'utilisation</a> et la <a href="legal/#confidentialite" target="_blank" rel="noopener">politique de confidentialité</a>. Mon profil et mon agenda sont visibles par les officines inscrites. L'inscription est gratuite ; après le pilote, chaque mission acceptée coûtera ${FRAIS} € TVAC.</span></label>`:""}
    <div class="row" style="justify-content:space-between"><span id="p-chip"></span><button class="btn primary" type="submit">${isNew?"Créer mon profil":"Enregistrer"}</button></div>
  </form></div>`;
  bindBanner();
  if(!isNew){
    getDoc(doc(db,"remplacants",uid,"prive","contact")).then(s=>{const c=s.data()||{};const t=document.getElementById("p-tel"),e=document.getElementById("p-email");if(t&&!t.value)t.value=c.tel||"";if(e&&!e.value)e.value=c.email||""}).catch(()=>{});
    getDoc(doc(db,"remplacants",uid,"prive","verif")).then(s=>{const c=s.data()||{};const b=document.getElementById("p-bce"),d=document.getElementById("p-dipl");if(b&&!b.value)b.value=bceFmt(c.bce||"");if(d&&!d.value)d.value=c.diplome||""}).catch(()=>{});
  }
  const chip=()=>{const c=document.getElementById("p-chip");if(c)c.innerHTML=isNew?"":myR?.bloque?`<span class="chip wait">Profil suspendu</span>`:myR?.valide?`<span class="chip ok">✓ Profil actif</span>`:`<span class="chip wait">Profil incomplet</span>`};chip();
  if(isNew)document.getElementById("p-statut").onchange=e=>{const t=document.getElementById("p-tarif");if(t.value==="30"||t.value==="55")t.value=e.target.value==="pharmacien"?55:30};
  document.getElementById("pf").onsubmit=e=>{e.preventDefault();
    const commune=document.getElementById("p-commune").value.trim();
    if(!GEO.has(commune)){toast("Choisis une localité wallonne dans la liste.");document.getElementById("p-commune").focus();return}
    const bce=bceNorm(document.getElementById("p-bce").value);
    if(!bceOk(bce)){toast("Ce n° d'entreprise n'est pas valide. Il compte 10 chiffres, par exemple 0123.456.749.");document.getElementById("p-bce").focus();return}
    if(!telOk(document.getElementById("p-tel").value)){toast("Indique un numéro de téléphone complet.");document.getElementById("p-tel").focus();return}
    if(document.getElementById("p-dipl").value.trim().length<3){toast("Indique ton diplôme.");document.getElementById("p-dipl").focus();return}
    const t=nowIso();
    const pub={nom:document.getElementById("p-nom").value.trim(),statut:document.getElementById("p-statut").value,commune,
      rayon:+document.getElementById("p-rayon").value||30,tarif:+document.getElementById("p-tarif").value||30,exp:+document.getElementById("p-exp").value||0,
      logiciels:LOGICIELS.filter((l,i)=>document.getElementById("lg-"+i).checked),bio:document.getElementById("p-bio").value.trim(),maj:t};
    const contact={tel:document.getElementById("p-tel").value.trim(),email:document.getElementById("p-email").value.trim(),maj:t};
    const verif={bce,diplome:document.getElementById("p-dipl").value.trim(),maj:t};
    write(async()=>{
      const batch=writeBatch(db);
      if(isNew)batch.set(doc(db,"remplacants",uid),{...pub,dispo:[],valide:true,bloque:false,cree:t,consentement:t});
      else batch.update(doc(db,"remplacants",uid),{...pub,valide:!myR.bloque});
      batch.set(doc(db,"remplacants",uid,"prive","contact"),contact);
      batch.set(doc(db,"remplacants",uid,"prive","verif"),verif);
      await batch.commit();
    },isNew?"Profil créé et visible des pharmacies. Ouvre maintenant tes jours disponibles.":"Profil enregistré").then(ok=>{if(ok&&isNew){tab="agenda";mount()}});
  };
  return{refresh:chip,keep:true};
}

/* ---------- PHARMACIE : OFFICINE ---------- */
function vOfficine(){
  const p=myP, isNew=!p, v=p||{nom:"",commune:"",titulaire:""};
  app.innerHTML=`<div class="stack">${banner()}<div><h1>${isNew?"Inscrire mon officine":"Mon officine"}</h1><p class="lede">La localité sert à calculer la distance avec les remplaçants. Ton téléphone, ton e-mail et ton adresse ne sont montrés au remplaçant qu'après une mission confirmée.</p></div>
  <form class="panel stack" id="of">
    <div class="grid">
      <label>Nom de l'officine<input id="o-nom" value="${esc(v.nom)}" required placeholder="Ex. : Pharmacie du Centre"></label>
      <label>Pharmacien·ne titulaire<input id="o-tit" value="${esc(v.titulaire)}" required></label>
      <label>Localité<input id="o-commune" list="localites" value="${esc(v.commune)}" required placeholder="Ex. : Jambes" autocomplete="off"></label>
      <label>Adresse<input id="o-adr" required placeholder="Rue et numéro"></label>
      <label>Téléphone<input id="o-tel" type="tel" required></label>
      <label>E-mail<input id="o-email" type="email" required value="${esc(isNew?user.email:"")}"></label>
      <label>N° d'entreprise (BCE)<input id="o-bce" required placeholder="0xxx.xxx.xxx"><span class="hint">Pour recevoir les factures des remplaçants par Peppol.</span></label>
      <label>N° APB / AFMPS (facultatif)<input id="o-apb"></label>
    </div>
    ${isNew?`<label class="check"><input type="checkbox" id="o-ok" required><span>J'accepte les <a href="legal/#conditions" target="_blank" rel="noopener">conditions d'utilisation</a> et la <a href="legal/#confidentialite" target="_blank" rel="noopener">politique de confidentialité</a>. L'accès est gratuit pour les officines.</span></label>`:""}
    <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">${isNew?"Inscrire mon officine":"Enregistrer"}</button></div>
  </form></div>`;
  bindBanner();
  if(!isNew)getDoc(doc(db,"pharmacies",uid,"prive","contact")).then(s=>{const c=s.data()||{};for(const[id,k]of[["o-adr","adresse"],["o-tel","tel"],["o-email","email"],["o-apb","apb"],["o-bce","bce"]]){const el=document.getElementById(id);if(el&&!el.value)el.value=k==="bce"?bceFmt(c[k]||""):c[k]||""}}).catch(()=>{});
  document.getElementById("of").onsubmit=e=>{e.preventDefault();
    const commune=document.getElementById("o-commune").value.trim();
    if(!GEO.has(commune)){toast("Choisis une localité wallonne dans la liste.");document.getElementById("o-commune").focus();return}
    const obce=bceNorm(document.getElementById("o-bce").value);
    if(!bceOk(obce)){toast("Ce n° d'entreprise n'est pas valide. Il compte 10 chiffres, par exemple 0123.456.749.");document.getElementById("o-bce").focus();return}
    const t=nowIso();
    const pub={nom:document.getElementById("o-nom").value.trim(),titulaire:document.getElementById("o-tit").value.trim(),commune,maj:t};
    const contact={adresse:document.getElementById("o-adr").value.trim(),tel:document.getElementById("o-tel").value.trim(),email:document.getElementById("o-email").value.trim(),apb:document.getElementById("o-apb").value.trim(),bce:obce,maj:t};
    write(async()=>{
      const batch=writeBatch(db);
      if(isNew)batch.set(doc(db,"pharmacies",uid),{...pub,cree:t,consentement:t});else batch.update(doc(db,"pharmacies",uid),pub);
      batch.set(doc(db,"pharmacies",uid,"prive","contact"),contact);
      await batch.commit();
    },isNew?"Officine inscrite. Cherche ton premier remplaçant.":"Officine enregistrée").then(ok=>{if(ok&&isNew){tab="trouver";mount()}});
  };
  return{refresh:()=>{},keep:true};
}

/* ---------- PHARMACIE : TROUVER ---------- */
function vTrouver(){
  const ph=myP;
  app.innerHTML=`<div class="stack">${banner()}<div><h1>Trouver un remplaçant</h1><p class="lede">Choisis le jour : tu vois les indépendants inscrits, libres ce jour-là, qui acceptent de venir jusqu'à ${esc(ph.commune)}.</p></div>
  <div class="panel"><div class="grid">
      <label>Date<input id="s-date" type="date" min="${TODAY_ISO}" value="${search.date}"></label>
      <label>Profil recherché<select id="s-statut"><option value="tous">Tous</option><option value="pharmacien" ${search.statut==="pharmacien"?"selected":""}>Pharmacien·ne</option><option value="assistant" ${search.statut==="assistant"?"selected":""}>Assistant·e</option></select></label>
      <label>Logiciel<select id="s-log"><option value="">Peu importe</option>${LOGICIELS.map(l=>`<option ${search.logiciel===l?"selected":""}>${l}</option>`).join("")}</select></label>
  </div></div>
  <div id="results"></div></div>`;
  bindBanner();
  const upd=()=>{search.date=document.getElementById("s-date").value||search.date;search.statut=document.getElementById("s-statut").value;search.logiciel=document.getElementById("s-log").value;results()};
  ["s-date","s-statut","s-log"].forEach(id=>document.getElementById(id).onchange=upd);
  results();return{refresh:results,keep:true};
}
function results(){
  const ph=myP, el=document.getElementById("results"); if(!ph||!el)return;
  const list=Object.entries(RV).map(([id,r])=>({id,r,dist:km(r.commune,ph.commune)}))
    .filter(({r,dist})=>(r.dispo||[]).includes(search.date)&&dist<=r.rayon&&(search.statut==="tous"||r.statut===search.statut)&&(!search.logiciel||(r.logiciels||[]).includes(search.logiciel)))
    .sort((a,b)=>a.dist-b.dist);
  const already=new Set(D.filter(d=>d.pid===uid&&d.date===search.date&&(d.statut==="attente"||d.statut==="acceptee")).map(d=>d.rid));
  el.innerHTML=`<div class="stack"><h2>${list.length} disponible${list.length>1?"s":""} le ${nice(search.date)}</h2>
  ${list.length?`<div class="cards">${list.map(({id,r,dist})=>`<div class="card">
    <div class="who"><div class="av">${esc(initials(r.nom))}</div><div style="min-width:0"><h3>${esc(r.nom)}</h3><p>${statutLabel(r.statut)} · ${esc(r.commune)}</p></div></div>
    <div class="chips"><span class="chip ok">✓ N° BCE contrôlé</span>${noteChip(id)}${(r.logiciels||[]).map(l=>`<span class="chip">${esc(l)}</span>`).join("")}</div>
    ${r.bio?`<p style="margin:0;font-size:14px;overflow-wrap:anywhere">${esc(r.bio)}</p>`:""}
    <div class="facts"><div><b>${fmtH(r.tarif)} €</b><span>par heure</span></div><div><b>${r.exp} an${r.exp>1?"s":""}</b><span>d'expérience</span></div><div><b>${dist} km</b><span>de toi</span></div></div>
    ${avisList(id)}
    ${already.has(id)?`<button class="btn" disabled>Demande envoyée</button>`:`<button class="btn primary" data-ask="${esc(id)}">Demander ce jour</button>`}
  </div>`).join("")}</div>`:`<div class="empty">${Object.keys(RV).length?"Personne n'est disponible ce jour-là dans ta zone avec ces critères. Essaie un autre jour ou élargis les critères.":"Les premiers remplaçants sont en cours d'inscription. Reviens bientôt."}</div>`}</div>`;
  el.querySelectorAll("[data-ask]").forEach(b=>b.onclick=()=>askModal(b.dataset.ask));
}
function askModal(rid){
  const r=RV[rid], ph=myP;
  layer.innerHTML=`<div class="overlay" id="ov"><form class="sheet" id="ask" role="dialog" aria-modal="true" aria-labelledby="ask-t">
    <div><h2 id="ask-t">Demander ${esc(r.nom.split(" ")[0])}</h2><p class="muted" style="margin:4px 0 0;font-size:14px">${nice(search.date)} · ${esc(ph.nom)}, ${esc(ph.commune)}</p></div>
    <div class="grid" style="grid-template-columns:1fr 1fr"><label>Début<input id="a-deb" type="time" value="${search.debut}" required></label><label>Fin<input id="a-fin" type="time" value="${search.fin}" required></label></div>
    <label>Message (logiciel, consignes, accès…)<textarea id="a-msg" maxlength="600" placeholder="Ex. : remplacement de notre assistante, logiciel Officinall, arrivée par l'arrière-boutique."></textarea></label>
    <div class="total"><span class="muted">Estimation <span id="a-h"></span></span><b id="a-cost"></b></div>
    ${r.statut==="assistant"?`<div class="notice" style="font-size:13px"><b>Rappel :</b> un·e assistant·e pharmaceutico-technique travaille sous la responsabilité d'un pharmacien. Un pharmacien doit être présent dans l'officine pendant ce remplacement.</div>`:""}
    <p class="muted" style="margin:0;font-size:12px">Hors TVA et frais de déplacement éventuels. Le remplaçant facture directement l'officine.</p>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" id="a-x">Annuler</button><button class="btn primary" type="submit">Envoyer la demande</button></div>
  </form></div>`;
  const calc=()=>{const h=hours(document.getElementById("a-deb").value,document.getElementById("a-fin").value);
    document.getElementById("a-h").textContent=`${fmtH(h)} h × ${fmtH(r.tarif)} €`;document.getElementById("a-cost").textContent=Math.round(h*r.tarif)+" €"};
  calc();["a-deb","a-fin"].forEach(id=>document.getElementById(id).oninput=calc);
  const close=()=>layer.innerHTML="";
  document.getElementById("a-x").onclick=close;
  document.getElementById("ov").onclick=e=>{if(e.target.id==="ov")close()};
  document.getElementById("ask").onsubmit=e=>{e.preventDefault();
    const deb=document.getElementById("a-deb").value,fin=document.getElementById("a-fin").value;
    if(hours(deb,fin)<=0){toast("L'heure de fin doit être après l'heure de début.");return}
    search.debut=deb;search.fin=fin;const t=nowIso();
    write(()=>addDoc(collection(db,"demandes"),{rid,rnom:r.nom,pid:uid,pnom:ph.nom,pcommune:ph.commune,date:search.date,debut:deb,fin,tarif:r.tarif,message:document.getElementById("a-msg").value.trim(),statut:"attente",cree:t,maj:t}),`Demande envoyée à ${r.nom.split(" ")[0]}`);
    close()};
  document.getElementById("a-deb").focus();
}

/* ---------- PHARMACIE : MES DEMANDES ---------- */
function vMesDemandes(){
  const draw=()=>{
  const ph=myP, mine=D.filter(d=>d.pid===uid).sort((a,b)=>a.date<b.date?1:-1);
  const up=mine.filter(d=>d.date>=TODAY_ISO).reverse(), old=mine.filter(d=>d.date<TODAY_ISO);
  app.innerHTML=`<div class="stack">${banner()}<div><h1>Mes demandes</h1><p class="lede">${esc(ph.nom)}, ${esc(ph.commune)}. Les réponses des remplaçants s'affichent ici en direct.</p></div>
  ${up.length?`<div class="cards">${up.map(d=>reqCard(d,"p")).join("")}</div>`:`<div class="empty">Aucune demande à venir. Cherche un remplaçant dans l'onglet « Trouver un remplaçant ».</div>`}
  ${old.length?`<h2>Missions passées</h2><div class="cards">${old.map(d=>reqCard(d,"p")).join("")}</div>`:""}</div>`;
  bindBanner();bindReqActions(app);};
  draw();return{refresh:draw};
}

/* ---------- MON COMPTE ---------- */
function vCompte(){
  app.innerHTML=`<div class="stack">${banner()}<div><h1>Mon compte</h1><p class="lede">Connecté avec ${esc(user.email)}.</p></div>
  ${myR?abonnementPanel():""}
  <div class="panel stack"><h2>Session</h2><div class="row"><button class="btn" id="c-out">Me déconnecter</button></div></div>
  <div class="panel stack"><h2>Supprimer mon compte</h2><p class="muted" style="margin:0;font-size:14px">Supprime ton profil, ton officine, tes coordonnées, tes factures préparées et ton accès. Télécharge d'abord tes factures : tu dois les conserver pour ta comptabilité. L'historique des missions passées reste visible par l'autre partie.</p><div class="row"><button class="btn danger" id="c-del">Supprimer mon compte</button></div></div></div>`;
  bindBanner();
  if(myR){bindAbonnement(app,()=>vCompte());if(abo===null){abo={};getDoc(doc(db,"remplacants",uid,"prive","abonnement")).then(s=>{abo=s.data()||{};if(tab==="compte")vCompte()}).catch(()=>{})}}
  document.getElementById("c-out").onclick=()=>signOut(auth);
  document.getElementById("c-del").onclick=()=>confirmSheet("Supprimer ton compte ?","Cette action est définitive.","Supprimer définitivement",async()=>{
    try{
      for(const c of [["remplacants",uid,"prive"],["pharmacies",uid,"prive"]]){const l=await getDocs(collection(db,...c)).catch(()=>null);for(const d of l?.docs||[])await deleteDoc(d.ref).catch(()=>{})}
      for(const p of [["remplacants",uid],["pharmacies",uid]])await deleteDoc(doc(db,...p)).catch(()=>{});
      await deleteUser(user);toast("Compte supprimé");
    }catch(e){toast(e?.code==="auth/requires-recent-login"?"Par sécurité, déconnecte-toi, reconnecte-toi puis recommence.":"Suppression impossible pour l'instant.")}
  });
  return{refresh:()=>{}};
}

/* ---------- ABONNEMENT : à la mission ou Premium ---------- */
const FORMULES={
  mission:{nom:"À la mission",prix:"2 € TVAC",unite:"par mission acceptée",slogan:"Tu ne paies que quand tu travailles."},
  mois:{nom:"Premium mensuel",prix:"4,99 € TVAC",unite:"par mois, missions illimitées",slogan:"Missions illimitées : rentabilisé dès la 3e mission du mois."},
  an:{nom:"Premium annuel",prix:"34,99 € TVAC",unite:"par an, missions illimitées",slogan:"Moins de 3 € par mois : 5 mois offerts par rapport au mensuel."}
};
// Premium actif à une date donnée (r.premium = {formule, debut, fin}, posé par l'administrateur)
const premiumA=(r,date)=>!!(r?.premium&&r.premium.debut<=date&&date<=r.premium.fin);
const fraisMission=(d)=>premiumA(rem(d.rid),d.date)?0:FRAIS;
function addMonths(isoDate,n){const d=parse(isoDate);d.setMonth(d.getMonth()+n);d.setDate(d.getDate()-1);return iso(d)}
function abonnementPanel(){
  const r=myR, p=r.premium, actif=premiumA(r,TODAY_ISO);
  const courant=actif?p.formule:"mission";
  const monthPre=TODAY_ISO.slice(0,7);
  const mois=D.filter(d=>d.rid===uid&&d.statut==="acceptee"&&d.date.startsWith(monthPre));
  const du=mois.reduce((s,d)=>s+fraisMission(d),0);
  const demande=abo?.formule&&abo.formule!==courant?abo:null;
  const carte=k=>{const f=FORMULES[k],on=k===courant;
    return `<div class="card" style="${on?"border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)":""}">
      <div class="req-top"><h3>${f.nom}</h3>${on?`<span class="status st-acceptee">Ta formule</span>`:demande?.formule===k?`<span class="status st-attente">Demandée</span>`:""}</div>
      <div><b class="mono" style="font-size:22px">${f.prix}</b><br><span class="muted" style="font-size:13px">${f.unite}</span></div>
      <p style="margin:0;font-style:italic">« ${f.slogan} »</p>
      ${on||demande?.formule===k?"":`<button class="btn ${k==="mission"?"":"primary"} small" data-abo="${k}">${k==="mission"?"Revenir à la mission":"Choisir"}</button>`}
    </div>`};
  return `<div class="panel stack"><h2>Mon abonnement</h2>
    ${actif?`<div class="notice ok"><b>${FORMULES[p.formule].nom} actif</b> jusqu'au ${niceY(p.fin)} : aucune mission facturée jusque-là.</div>`:""}
    ${demande?`<div class="notice"><b>Demande de ${FORMULES[demande.formule].nom} envoyée.</b> L'administrateur te communique les informations de virement ; ton Premium démarre dès réception du paiement.</div>`:""}
    <div class="cards">${["mission","mois","an"].map(carte).join("")}</div>
    <p style="margin:0">Ce mois-ci : <b class="mono">${mois.length}</b> mission${mois.length>1?"s":""} acceptée${mois.length>1?"s":""}, frais <b class="mono">${du} €</b> TVAC${actif?" (couvertes par ton Premium)":""}.</p>
    <p class="muted" style="margin:0;font-size:14px">Gratuit pendant le pilote : ces montants sont indicatifs et ne seront pas facturés. Tu pourras choisir ta formule avant la fin du pilote.</p>
  </div>`;
}
let abo=null; // demande d'abonnement du remplaçant connecté (prive/abonnement)
function bindAbonnement(root,redraw){
  root.querySelectorAll("[data-abo]").forEach(b=>b.onclick=()=>{
    const k=b.dataset.abo;b.disabled=true;
    write(()=>setDoc(doc(db,"remplacants",uid,"prive","abonnement"),{formule:k,demandeLe:nowIso()}),
      k==="mission"?"C'est noté : tu restes à la mission.":"Demande envoyée. Tu recevras les infos de virement de l'administrateur.")
      .then(ok=>{if(ok){abo={formule:k,demandeLe:nowIso()};redraw()}else b.disabled=false});
  });
}

/* ---------- FACTURATION (remplaçant → officine, format Peppol) ---------- */
const REGIMES={
  S:{label:"TVA 21 % (assujetti normal)",cat:"S",taux:21,mention:""},
  F:{label:"Franchise des petites entreprises (art. 56bis)",cat:"E",taux:0,mention:"Régime particulier de franchise des petites entreprises"},
  X:{label:"Exonéré (art. 44 du Code de la TVA)",cat:"E",taux:0,mention:"Exonération de la TVA, article 44 du Code de la TVA"}
};
let factu=null, factures=null;
const eur=n=>n.toFixed(2).replace(".",",")+" €";
const r2=n=>Math.round(n*100)/100;
function nextNumero(n){const m=String(n||"").match(/^(.*?)(\d+)$/);if(!m)return n+"-1";return m[1]+String(+m[2]+1).padStart(m[2].length,"0")}
async function loadFactu(){
  const [f,list]=await Promise.all([getDoc(doc(db,"remplacants",uid,"prive","factu")),getDocs(collection(db,"remplacants",uid,"prive"))]);
  const v=(await getDoc(doc(db,"remplacants",uid,"prive","verif"))).data()||{};
  const zip=GEO.get(myR.commune)?.[1]||"";
  factu=f.exists()?f.data():{nom:myR.nom,rue:"",cp:zip,ville:myR.commune,bce:v.bce||"",tva:v.bce?"BE"+v.bce:"",iban:"",regime:"S",delai:30,prochain:new Date().getFullYear()+"-001",nouveau:true};
  factures=list.docs.filter(x=>x.id.startsWith("f-")).map(x=>({id:x.id,...x.data()})).sort((a,b)=>a.date<b.date?1:-1);
}
function vFacturation(){
  const draw=()=>{
  if(!factu){app.innerHTML=`<div class="stack"><h1>Facturation</h1><p class="lede">Chargement…</p></div>`;loadFactu().then(draw).catch(()=>toast("Chargement impossible pour l'instant."));return}
  const faites=new Map(factures.map(f=>[f.demandeId,f]));
  const aFacturer=D.filter(d=>d.rid===uid&&d.statut==="acceptee"&&d.date<=TODAY_ISO).sort((a,b)=>a.date<b.date?1:-1);
  const reg=REGIMES[factu.regime]||REGIMES.S;
  app.innerHTML=`<div class="stack">${banner()}<div><h1>Facturation</h1><p class="lede">Après chaque mission, prépare ta facture pour l'officine en un geste. Le fichier est au format <b>Peppol</b> (UBL), obligatoire entre entreprises en Belgique depuis 2026 : importe-le dans ton outil Peppol ou transmets-le à ton comptable.</p><p class="hint" style="margin:6px 0 0">Si tu es exonéré (art. 44), Peppol n'est pas obligatoire pour toi. En franchise des petites entreprises, vérifie ta situation avec ton comptable. L'appli t'aide à préparer la facture : tu restes responsable de son contenu et de son envoi.</p></div>
  ${factu.nouveau?`<div class="notice"><b>Complète d'abord tes infos de facturation</b> : adresse, IBAN et régime TVA.</div>`:""}
  <details class="panel" ${factu.nouveau?"open":""}><summary style="cursor:pointer"><b>Mes infos de facturation</b> <span class="muted" style="font-size:13px">${esc(factu.nom)} · ${esc(reg.label)}</span></summary>
  <form class="stack" id="ff" style="margin-top:14px">
    <div class="grid">
      <label>Nom ou raison sociale<input id="f-nom" value="${esc(factu.nom)}" required></label>
      <label>Rue et numéro<input id="f-rue" value="${esc(factu.rue)}" required></label>
      <label>Code postal<input id="f-cp" value="${esc(factu.cp)}" required inputmode="numeric"></label>
      <label>Localité<input id="f-ville" value="${esc(factu.ville)}" required></label>
      <label>N° d'entreprise (BCE)<input id="f-bce" value="${esc(bceFmt(factu.bce))}" required></label>
      <label>N° de TVA<input id="f-tva" value="${esc(factu.tva)}" required placeholder="BE0123456749"><span class="hint">En général BE + ton n° d'entreprise, même en franchise ou exonéré.</span></label>
      <label>IBAN<input id="f-iban" value="${esc(factu.iban)}" required placeholder="BE00 0000 0000 0000"></label>
      <label>Régime TVA<select id="f-reg">${Object.entries(REGIMES).map(([k,x])=>`<option value="${k}" ${k===factu.regime?"selected":""}>${x.label}</option>`).join("")}</select><span class="hint">En cas de doute, demande à ton comptable.</span></label>
      <label>Délai de paiement (jours)<input id="f-delai" type="number" min="0" max="90" value="${factu.delai}"></label>
      <label>Prochain n° de facture<input id="f-num" value="${esc(factu.prochain)}" required></label>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Enregistrer</button></div>
  </form></details>
  <h2>Missions à facturer</h2>
  ${aFacturer.length?`<div class="cards">${aFacturer.map(d=>{const f=faites.get(d.id),h=hours(d.debut,d.fin),ht=r2(h*d.tarif);return `<div class="card">
    <div class="req-top"><div style="min-width:0"><h3>${esc(P[d.pid]?.nom||d.pnom)}</h3><p class="muted" style="margin:0;font-size:13px">${nice(d.date)} · <span class="mono">${d.debut}–${d.fin}</span></p></div>${f?`<span class="status st-acceptee">Facturée</span>`:`<span class="status st-attente">À facturer</span>`}</div>
    <div class="facts"><div><b>${fmtH(h)} h</b><span>prestées</span></div><div><b>${fmtH(d.tarif)} €</b><span>par heure</span></div><div><b>${eur(ht)}</b><span>HTVA</span></div></div>
    ${f?`<p class="muted" style="margin:0;font-size:13px">Facture n° <b class="mono">${esc(f.numero)}</b> du ${nice(f.date)} · ${eur(f.total)}</p><div class="row"><button class="btn small" data-xml="${f.id}">Fichier Peppol</button><button class="btn small" data-pdf="${f.id}">Voir / imprimer</button></div>`
      :`<button class="btn primary" data-fac="${d.id}" ${factu.nouveau?"disabled":""}>Préparer la facture</button>`}
  </div>`}).join("")}</div>`:`<div class="empty">Aucune mission à facturer pour l'instant. Tes missions confirmées apparaîtront ici à partir de leur date.</div>`}
  </div>`;
  bindBanner();
  document.getElementById("ff").onsubmit=e=>{e.preventDefault();
    const bce=bceNorm(document.getElementById("f-bce").value);
    if(!bceOk(bce)){toast("Ce n° d'entreprise n'est pas valide.");return}
    const iban=document.getElementById("f-iban").value.replace(/\s/g,"").toUpperCase();
    if(!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)){toast("Vérifie ton IBAN.");return}
    const v={nom:document.getElementById("f-nom").value.trim(),rue:document.getElementById("f-rue").value.trim(),cp:document.getElementById("f-cp").value.trim(),ville:document.getElementById("f-ville").value.trim(),
      bce,tva:document.getElementById("f-tva").value.replace(/[\s.]/g,"").toUpperCase(),iban,regime:document.getElementById("f-reg").value,
      delai:+document.getElementById("f-delai").value||0,prochain:document.getElementById("f-num").value.trim(),maj:nowIso()};
    write(()=>setDoc(doc(db,"remplacants",uid,"prive","factu"),v),"Infos de facturation enregistrées").then(ok=>{if(ok){factu=v;draw()}});
  };
  app.querySelectorAll("[data-fac]").forEach(b=>b.onclick=()=>factureModal(D.find(x=>x.id===b.dataset.fac),draw));
  app.querySelectorAll("[data-xml]").forEach(b=>b.onclick=()=>{const f=factures.find(x=>x.id===b.dataset.xml);telecharger(f.numero+".xml",ublXml(f),"application/xml")});
  app.querySelectorAll("[data-pdf]").forEach(b=>b.onclick=()=>imprimer(factures.find(x=>x.id===b.dataset.pdf)));
  };
  draw();return{refresh:()=>{if(factu&&!document.querySelector(".overlay")&&!document.activeElement?.closest?.("#ff"))draw()},keep:true};
}
async function factureModal(d,redraw){
  const p=P[d.pid]||{nom:d.pnom,commune:d.pcommune};
  let c={};try{c=(await getDoc(doc(db,"pharmacies",d.pid,"prive","contact"))).data()||{}}catch(e){}
  const zip=GEO.get(p.commune)?.[1]||"";
  const reg=REGIMES[factu.regime]||REGIMES.S;
  layer.innerHTML=`<div class="overlay" id="ov"><form class="sheet" id="fm" role="dialog" aria-modal="true" aria-labelledby="fm-t">
    <div><h2 id="fm-t">Facture n° ${esc(factu.prochain)}</h2><p class="muted" style="margin:4px 0 0;font-size:14px">Mission du ${nice(d.date)} chez ${esc(p.nom)}</p></div>
    <fieldset class="stack" style="gap:10px"><legend>Client</legend>
      <div class="grid">
        <label>Officine<input id="c-nom" value="${esc(p.nom)}" required></label>
        <label>N° d'entreprise (BCE)<input id="c-bce" value="${esc(bceFmt(c.bce||""))}" required placeholder="0xxx.xxx.xxx"><span class="hint">Sert d'adresse Peppol de l'officine.</span></label>
        <label>Adresse<input id="c-rue" value="${esc(c.adresse||"")}" required></label>
        <label>Code postal<input id="c-cp" value="${esc(zip)}" required></label>
        <label>Localité<input id="c-ville" value="${esc(p.commune||"")}" required></label>
      </div></fieldset>
    <fieldset class="stack" style="gap:10px"><legend>Prestation</legend>
      <div class="grid">
        <label>Début<input id="p-deb" type="time" value="${d.debut}" required></label>
        <label>Fin<input id="p-fin" type="time" value="${d.fin}" required></label>
        <label>Tarif horaire (€ HTVA)<input id="p-tarif" type="number" step="0.01" min="0" value="${d.tarif}" required></label>
        <label>Frais de déplacement (€ HTVA)<input id="p-depl" type="number" step="0.01" min="0" value="0"></label>
      </div></fieldset>
    <div class="total"><span class="muted" id="fm-detail"></span><b id="fm-total"></b></div>
    <p class="muted" style="margin:0;font-size:12px">${esc(reg.label)}${reg.mention?" · mention ajoutée sur la facture":""}. Le numéro suivant sera proposé automatiquement.</p>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" id="fm-x">Annuler</button><button class="btn primary" type="submit">Créer la facture</button></div>
  </form></div>`;
  const val=()=>{const h=r2(hours(document.getElementById("p-deb").value,document.getElementById("p-fin").value)),t=+document.getElementById("p-tarif").value||0,dep=+document.getElementById("p-depl").value||0;
    const ht=r2(r2(h*t)+dep),tva=r2(ht*reg.taux/100);return{h,t,dep,ht,tva,total:r2(ht+tva)}};
  const calc=()=>{const v=val();document.getElementById("fm-detail").textContent=`${fmtH(v.h)} h × ${fmtH(v.t)} €${v.dep?` + ${eur(v.dep)} déplacement`:""}${reg.taux?` + TVA ${eur(v.tva)}`:""}`;document.getElementById("fm-total").textContent=eur(v.total)};
  calc();["p-deb","p-fin","p-tarif","p-depl"].forEach(id=>document.getElementById(id).oninput=calc);
  const close=()=>layer.innerHTML="";
  document.getElementById("fm-x").onclick=close;document.getElementById("ov").onclick=e=>{if(e.target.id==="ov")close()};
  document.getElementById("fm").onsubmit=e=>{e.preventDefault();
    const cbce=bceNorm(document.getElementById("c-bce").value);
    if(!bceOk(cbce)){toast("Le n° d'entreprise de l'officine n'est pas valide.");return}
    const v=val();if(v.h<=0){toast("L'heure de fin doit être après l'heure de début.");return}
    const due=iso(addDays(TODAY,factu.delai||0));
    const f={id:"f-"+d.id,demandeId:d.id,numero:factu.prochain,date:TODAY_ISO,echeance:due,
      vendeur:{nom:factu.nom,rue:factu.rue,cp:factu.cp,ville:factu.ville,bce:factu.bce,tva:factu.tva,iban:factu.iban},
      client:{nom:document.getElementById("c-nom").value.trim(),bce:cbce,rue:document.getElementById("c-rue").value.trim(),cp:document.getElementById("c-cp").value.trim(),ville:document.getElementById("c-ville").value.trim()},
      mission:{date:d.date,debut:document.getElementById("p-deb").value,fin:document.getElementById("p-fin").value},
      heures:v.h,tarif:v.t,deplacement:v.dep,regime:factu.regime,ht:v.ht,tva:v.tva,total:v.total,cree:nowIso()};
    const {id,...data}=f;
    write(async()=>{const b=writeBatch(db);b.set(doc(db,"remplacants",uid,"prive",id),data);b.update(doc(db,"remplacants",uid,"prive","factu"),{prochain:nextNumero(factu.prochain)});await b.commit()},`Facture ${f.numero} créée`)
      .then(ok=>{if(!ok)return;factu.prochain=nextNumero(factu.prochain);factures.unshift(f);close();redraw();telecharger(f.numero+".xml",ublXml(f),"application/xml")});
  };
}
const xmlEsc=s=>String(s??"").replace(/[<>&'"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]));
const amt=n=>`currencyID="EUR">${n.toFixed(2)}`;
// Facture UBL 2.1 conforme Peppol BIS Billing 3.0 (identifiant Peppol belge : schéma 0208 = n° BCE)
function ublXml(f){
  const reg=REGIMES[f.regime]||REGIMES.S, cat=reg.cat, taux=reg.taux;
  const party=(p,tva)=>`<cac:Party><cbc:EndpointID schemeID="0208">${p.bce}</cbc:EndpointID><cac:PartyName><cbc:Name>${xmlEsc(p.nom)}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>${xmlEsc(p.rue)}</cbc:StreetName><cbc:CityName>${xmlEsc(p.ville)}</cbc:CityName><cbc:PostalZone>${xmlEsc(p.cp)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>${tva?`<cac:PartyTaxScheme><cbc:CompanyID>${xmlEsc(tva)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`:""}<cac:PartyLegalEntity><cbc:RegistrationName>${xmlEsc(p.nom)}</cbc:RegistrationName><cbc:CompanyID schemeID="0208">${p.bce}</cbc:CompanyID></cac:PartyLegalEntity></cac:Party>`;
  const taxCat=`<cbc:ID>${cat}</cbc:ID><cbc:Percent>${taux}</cbc:Percent>`;
  const lignes=[[`Remplacement en officine le ${f.mission.date} (${f.mission.debut}-${f.mission.fin})`,f.heures,"HUR",f.tarif,r2(f.heures*f.tarif)]];
  if(f.deplacement)lignes.push(["Frais de déplacement",1,"C62",f.deplacement,f.deplacement]);
  const lineExt=r2(lignes.reduce((s,l)=>s+l[4],0));
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
<cbc:ID>${xmlEsc(f.numero)}</cbc:ID>
<cbc:IssueDate>${f.date}</cbc:IssueDate>
<cbc:DueDate>${f.echeance}</cbc:DueDate>
<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
${reg.mention?`<cbc:Note>${xmlEsc(reg.mention)}</cbc:Note>\n`:""}<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
<cbc:BuyerReference>Mission ${f.mission.date}</cbc:BuyerReference>
<cac:AccountingSupplierParty>${party(f.vendeur,f.vendeur.tva)}</cac:AccountingSupplierParty>
<cac:AccountingCustomerParty>${party(f.client,"BE"+f.client.bce)}</cac:AccountingCustomerParty>
<cac:Delivery><cbc:ActualDeliveryDate>${f.mission.date}</cbc:ActualDeliveryDate></cac:Delivery>
<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentID>${xmlEsc(f.numero)}</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>${xmlEsc(f.vendeur.iban)}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount ${amt(f.tva)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount ${amt(lineExt)}</cbc:TaxableAmount><cbc:TaxAmount ${amt(f.tva)}</cbc:TaxAmount><cac:TaxCategory>${taxCat}${cat==="E"?`<cbc:TaxExemptionReason>${xmlEsc(reg.mention)}</cbc:TaxExemptionReason>`:""}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount ${amt(lineExt)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount ${amt(lineExt)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount ${amt(r2(lineExt+f.tva))}</cbc:TaxInclusiveAmount><cbc:PayableAmount ${amt(r2(lineExt+f.tva))}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${lignes.map((l,i)=>`<cac:InvoiceLine><cbc:ID>${i+1}</cbc:ID><cbc:InvoicedQuantity unitCode="${l[2]}">${l[1]}</cbc:InvoicedQuantity><cbc:LineExtensionAmount ${amt(l[4])}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${xmlEsc(l[0])}</cbc:Name><cac:ClassifiedTaxCategory>${taxCat}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount ${amt(l[3])}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join("\n")}
</Invoice>
`;
}
function telecharger(nom,contenu,type){
  const url=URL.createObjectURL(new Blob([contenu],{type}));
  const a=document.createElement("a");a.href=url;a.download=nom;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
function imprimer(f){
  const reg=REGIMES[f.regime]||REGIMES.S, w=window.open("","_blank");
  if(!w){toast("Autorise les fenêtres pour imprimer la facture.");return}
  const bloc=p=>`<b>${esc(p.nom)}</b><br>${esc(p.rue)}<br>${esc(p.cp)} ${esc(p.ville)}<br>BCE ${esc(bceFmt(p.bce))}${p.tva?`<br>TVA ${esc(p.tva)}`:""}`;
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facture ${esc(f.numero)}</title>
  <style>body{font:15px/1.5 system-ui,sans-serif;color:#12302b;max-width:760px;margin:0 auto;padding:32px 20px}h1{font-size:26px;margin:0 0 4px}.two{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;margin:28px 0}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #d6e0dc}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.tot td{border:0;padding:4px 8px}.big{font-size:18px;font-weight:700}.muted{color:#5a6e68}@media print{button{display:none}}</style></head><body>
  <h1>Facture ${esc(f.numero)}</h1><div class="muted">Date : ${f.date.split("-").reverse().join("/")} · Échéance : ${f.echeance.split("-").reverse().join("/")}</div>
  <div class="two"><div><span class="muted">De</span><br>${bloc(f.vendeur)}</div><div><span class="muted">Pour</span><br>${bloc({...f.client,tva:"BE"+f.client.bce})}</div></div>
  <table><thead><tr><th>Description</th><th class="n">Quantité</th><th class="n">Prix unitaire</th><th class="n">Montant HTVA</th></tr></thead><tbody>
  <tr><td>Remplacement en officine le ${f.mission.date.split("-").reverse().join("/")} (${f.mission.debut}–${f.mission.fin})</td><td class="n">${fmtH(f.heures)} h</td><td class="n">${eur(f.tarif)}</td><td class="n">${eur(r2(f.heures*f.tarif))}</td></tr>
  ${f.deplacement?`<tr><td>Frais de déplacement</td><td class="n">1</td><td class="n">${eur(f.deplacement)}</td><td class="n">${eur(f.deplacement)}</td></tr>`:""}
  </tbody></table>
  <table class="tot"><tr><td class="n">Total HTVA</td><td class="n" style="width:140px">${eur(f.ht)}</td></tr><tr><td class="n">TVA ${reg.taux} %</td><td class="n">${eur(f.tva)}</td></tr><tr><td class="n big">Total à payer</td><td class="n big">${eur(f.total)}</td></tr></table>
  ${reg.mention?`<p>${esc(reg.mention)}.</p>`:""}
  <p>À payer avant le ${f.echeance.split("-").reverse().join("/")} sur le compte <b>${esc(f.vendeur.iban)}</b>, communication : <b>${esc(f.numero)}</b>.</p>
  <p class="muted" style="font-size:12px;margin-top:40px">Facture établie via Pharma Remplaçant. Version électronique Peppol disponible.</p>
  <button onclick="print()" style="padding:10px 16px;font-size:15px">Imprimer ou enregistrer en PDF</button></body></html>`);
  w.document.close();
}

/* ---------- ADMINISTRATION ---------- */
const verifs=new Map();
function loadVerif(id){
  if(verifs.has(id))return verifs.get(id);
  verifs.set(id,"…");
  Promise.all([getDoc(doc(db,"remplacants",id,"prive","verif")),getDoc(doc(db,"remplacants",id,"prive","contact")),getDoc(doc(db,"remplacants",id,"prive","abonnement"))])
    .then(([v,c,a])=>{verifs.set(id,{...(c.data()||{}),...(v.data()||{}),abo:a.data()||null});rerender()}).catch(()=>{verifs.set(id,{});rerender()});
  return "…";
}
function setBloque(id,b){return write(()=>updateDoc(doc(db,"remplacants",id),{bloque:b,valide:!b,maj:nowIso()}),b?"Profil suspendu : il n'est plus visible":"Profil réactivé : il est à nouveau visible")}
function vValidation(){
  verifs.clear(); // recharge BCE, contact et demandes d'abonnement à chaque ouverture de l'onglet
  const draw=()=>{
  const all=Object.entries(RA).sort(([,x],[,y])=>(x.cree<y.cree?1:-1));
  const susp=all.filter(([,r])=>r.bloque).length;
  app.innerHTML=`<div class="stack"><div><h1>Remplaçants inscrits</h1><p class="lede">Les profils complets sont visibles automatiquement, les plus récents en premier. En cas de doute, contrôle le n° sur le site public de la BCE (kbopub.economie.fgov.be) et suspends le profil si besoin.</p></div>
  ${susp?`<div class="notice"><b>${susp} profil${susp>1?"s":""} suspendu${susp>1?"s":""}.</b></div>`:""}
  ${all.length?`<div class="cards">${all.map(([id,r])=>{const v=loadVerif(id),x=v==="…"?{}:v;return `<div class="card">
    <div class="req-top"><div class="who"><div class="av">${esc(initials(r.nom))}</div><div style="min-width:0"><h3>${esc(r.nom)}</h3><p>${statutLabel(r.statut)} · ${esc(locLabel(r.commune))}</p></div></div>${r.bloque?`<span class="status st-annulee">Suspendu</span>`:r.valide?`<span class="status st-acceptee">Visible</span>`:`<span class="status st-attente">Incomplet</span>`}</div>
    <div class="tbl"><table><tbody>
      <tr><th>BCE</th><td class="mono">${x.bce?`<a href="https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?lang=fr&ondernemingsnummer=${esc(x.bce)}" target="_blank" rel="noopener">${esc(bceFmt(x.bce))}</a>`:"—"}</td></tr>
      <tr><th>Diplôme</th><td>${esc(x.diplome||"—")}</td></tr>
      <tr><th>Tél.</th><td class="mono">${esc(x.tel||"—")}</td></tr>
      <tr><th>E-mail</th><td style="overflow-wrap:anywhere">${esc(x.email||"—")}</td></tr>
      <tr><th>Inscrit</th><td>${r.cree?nice(r.cree.slice(0,10)):"—"}</td></tr>
      <tr><th>Formule</th><td>${premiumA(r,TODAY_ISO)?`<b>${FORMULES[r.premium.formule].nom}</b> jusqu'au ${niceY(r.premium.fin)}`:"À la mission"}${x.abo?.formule&&x.abo.formule!=="mission"&&!(premiumA(r,TODAY_ISO)&&r.premium.formule===x.abo.formule)?`<br><span class="status st-attente">Demande : ${FORMULES[x.abo.formule].nom}</span> <span class="muted" style="font-size:12px">le ${nice(x.abo.demandeLe.slice(0,10))}</span>`:""}</td></tr>
    </tbody></table></div>
    <div class="row"><button class="btn small" data-prem="${esc(id)}|mois">Activer Premium mensuel</button><button class="btn small" data-prem="${esc(id)}|an">Activer Premium annuel</button>${premiumA(r,TODAY_ISO)?`<button class="btn small danger" data-prem="${esc(id)}|stop">Arrêter le Premium</button>`:""}</div>
    ${r.bloque?`<button class="btn small" data-unblock="${esc(id)}">Réactiver</button>`:`<button class="btn danger small" data-block="${esc(id)}">Suspendre</button>`}
  </div>`}).join("")}</div>`:`<div class="empty">Aucun remplaçant inscrit pour l'instant. Partage le lien d'inscription à tes collègues.</div>`}</div>`;
  app.querySelectorAll("[data-prem]").forEach(b=>b.onclick=()=>{const [id,k]=b.dataset.prem.split("|"),r=RA[id];
    if(k==="stop"){confirmSheet("Arrêter le Premium ?","Les missions suivantes seront de nouveau à 2 €.","Arrêter",()=>write(()=>updateDoc(doc(db,"remplacants",id),{premium:{...r.premium,fin:iso(addDays(TODAY,-1))}}),"Premium arrêté"));return}
    const debut=premiumA(r,TODAY_ISO)?iso(addDays(parse(r.premium.fin),1)):TODAY_ISO, fin=addMonths(debut,k==="an"?12:1);
    confirmSheet(`Activer ${FORMULES[k].nom} ?`,`À faire après réception du paiement (${FORMULES[k].prix}). Valable du ${niceY(debut)} au ${niceY(fin)}.`,"Activer",()=>write(()=>updateDoc(doc(db,"remplacants",id),{premium:{formule:k,debut,fin}}),"Premium activé"));
  });
  app.querySelectorAll("[data-unblock]").forEach(b=>b.onclick=()=>{b.disabled=true;setBloque(b.dataset.unblock,false)});
  app.querySelectorAll("[data-block]").forEach(b=>b.onclick=()=>confirmSheet("Suspendre ce profil ?","Il ne sera plus visible par les pharmacies et ne pourra pas se réactiver seul.","Suspendre",()=>setBloque(b.dataset.block,true)));
  };
  draw();return{refresh:draw};
}
function vVue(){
  const draw=()=>{
  const nR=Object.keys(RA).length,nV=Object.values(RA).filter(r=>r.valide).length,nP=Object.keys(P).length;
  const conf=D.filter(d=>d.statut==="acceptee"),att=D.filter(d=>d.statut==="attente"&&d.date>=TODAY_ISO);
  const notes=A.length?A.reduce((s,a)=>s+a.note,0)/A.length:0;
  // Estimation de la consommation Firebase (offre gratuite : environ 50 000 lectures par jour).
  // Chaque ouverture de l'appli lit les remplaçants visibles, les officines et les avis.
  const parOuverture=nV+nP+A.length+10, utilisateurs=nR+nP, lecturesJour=utilisateurs*2*parOuverture;
  const quota=lecturesJour<25000?["ok","Tout va bien","Tu restes largement dans l'offre gratuite de Firebase."]
    :lecturesJour<45000?["warn","Optimisation conseillée","La plateforme grandit : demande à Claude d'optimiser le chargement des données avant d'atteindre le quota gratuit."]
    :["bad","Risque de dépasser le quota gratuit","Préviens Claude rapidement : optimisation ou passage à l'offre Firebase à l'usage (quelques euros par mois)."];
  const perR=Object.entries(conf.reduce((m,d)=>{m[d.rid]=m[d.rid]||[0,0];m[d.rid][0]++;m[d.rid][1]+=fraisMission(d);return m},{})).sort((a,b)=>b[1][0]-a[1][0]);
  const fraisTot=conf.reduce((s,d)=>s+fraisMission(d),0);
  const prem=Object.values(RA).filter(r=>premiumA(r,TODAY_ISO)), nMois=prem.filter(r=>r.premium.formule==="mois").length, nAn=prem.length-nMois;
  app.innerHTML=`<div class="stack"><div><h1>Vue d'ensemble</h1><p class="lede">L'activité de la plateforme, en direct.</p></div>
  <div class="panel"><div class="stat"><div><b>${nV}/${nR}</b><span>remplaçants visibles</span></div><div><b>${nP}</b><span>officines inscrites</span></div><div><b>${att.length}</b><span>demandes en attente</span></div><div><b>${conf.length}</b><span>missions confirmées</span></div><div><b>${A.length?fmtNote(notes):"—"}</b><span>note moyenne (${A.length} avis)</span></div><div><b>${fraisTot} €</b><span>frais missions (${FRAIS} € TVAC/mission)</span></div><div><b>${nMois}+${nAn}</b><span>Premium mensuels + annuels</span></div></div></div>
  <div class="notice ${quota[0]==="ok"?"ok":""} install" style="${quota[0]==="bad"?"background:var(--bad-soft)":""}"><span><b style="${quota[0]==="bad"?"color:var(--bad)":""}">Capacité Firebase : ${quota[1]}.</b> ${quota[2]}<br><span class="hint">Estimation : ${lecturesJour.toLocaleString("fr-BE")} lectures par jour sur environ 50 000 gratuites (${utilisateurs} inscrits, 2 ouvertures par jour chacun). Chiffre réel : Firebase > Firestore > Utilisation.</span></span></div>
  <div class="panel stack"><h2>Frais par remplaçant</h2><p class="muted" style="margin:0;font-size:14px">${FRAIS} € TVAC par mission acceptée, sauf pendant un Premium (4,99 €/mois ou 34,99 €/an). Pendant le pilote, ces montants sont indicatifs.</p>${perR.length?`<div class="tbl"><table><thead><tr><th>Remplaçant</th><th>Missions acceptées</th><th>Montant</th></tr></thead><tbody>${perR.map(([rid,[n,f]])=>`<tr><td>${esc(RA[rid]?.nom||"—")}${premiumA(RA[rid],TODAY_ISO)?` <span class="chip ok">Premium</span>`:""}</td><td class="mono">${n}</td><td class="mono">${f} €</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin:0">Aucune mission acceptée pour l'instant.</p>`}</div>
  <div class="panel stack"><h2>Derniers avis</h2>${A.length?`<div class="tbl"><table><thead><tr><th>Date</th><th>Pour</th><th>Note</th><th>Commentaire</th><th></th></tr></thead><tbody>${A.slice().sort((a,b)=>a.cree<b.cree?1:-1).slice(0,30).map(a=>`<tr><td>${a.cree?nice(a.cree.slice(0,10)):"—"}</td><td>${esc(RA[a.pour]?.nom||P[a.pour]?.nom||"—")}</td><td><span class="stars">${"★".repeat(a.note)}</span></td><td style="overflow-wrap:anywhere">${esc(a.texte||"")}</td><td><button class="btn small danger" data-delavis="${esc(a.id)}">Retirer</button></td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin:0">Aucun avis pour l'instant.</p>`}</div>
  ${(()=>{const lim=iso(addDays(TODAY,-3*365)),vieux=D.filter(d=>d.date<lim);return vieux.length?`<div class="notice"><b>${vieux.length} demande${vieux.length>1?"s":""} de plus de 3 ans.</b> La politique de confidentialité prévoit de les supprimer. <button class="btn small" id="purge">Supprimer maintenant</button></div>`:""})()}
  <div class="panel stack"><h2>Officines inscrites</h2>${nP?`<div class="tbl"><table><thead><tr><th>Officine</th><th>Localité</th><th>Titulaire</th><th>Inscrite</th></tr></thead><tbody>${Object.values(P).map(p=>`<tr><td>${esc(p.nom)}</td><td>${esc(locLabel(p.commune))}</td><td>${esc(p.titulaire)}</td><td>${p.cree?nice(p.cree.slice(0,10)):"—"}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin:0">Aucune officine inscrite pour l'instant.</p>`}</div>
  <div class="panel stack"><h2>Dernières missions confirmées</h2>${conf.length?`<div class="tbl"><table><thead><tr><th>Date</th><th>Officine</th><th>Remplaçant</th><th>Horaire</th></tr></thead><tbody>${conf.sort((a,b)=>a.date<b.date?1:-1).slice(0,20).map(d=>`<tr><td>${nice(d.date)}</td><td>${esc(P[d.pid]?.nom||d.pnom)}</td><td>${esc(RA[d.rid]?.nom||d.rnom||"—")}</td><td class="mono">${d.debut}–${d.fin}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin:0">Aucune mission confirmée pour l'instant.</p>`}</div></div>`;
  document.getElementById("purge")?.addEventListener("click",()=>{const lim=iso(addDays(TODAY,-3*365)),vieux=D.filter(d=>d.date<lim);
    confirmSheet("Supprimer les anciennes demandes ?",`${vieux.length} demande(s) et leurs avis seront supprimés définitivement.`,"Supprimer",()=>write(async()=>{for(const d of vieux){for(const a of A.filter(a=>a.demandeId===d.id))await deleteDoc(doc(db,"avis",a.id));await deleteDoc(doc(db,"demandes",d.id))}},"Anciennes demandes supprimées"))});
  app.querySelectorAll("[data-delavis]").forEach(b=>b.onclick=()=>confirmSheet("Retirer cet avis ?","Il disparaîtra définitivement du profil concerné.","Retirer",()=>write(()=>deleteDoc(doc(db,"avis",b.dataset.delavis)),"Avis retiré")));
  };
  draw();return{refresh:draw};
}
