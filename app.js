import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification, sendPasswordResetEmail, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, addDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e;rerender()});
const standalone=()=>window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
function installBanner(){
  if(standalone()||store.get("pr-install-hide"))return"";
  if(installEvt)return `<div class="notice ok install"><span><b>Installe l'appli</b> sur ton écran d'accueil pour l'ouvrir en un geste.</span><span class="row"><button class="btn small primary" id="inst-go">Installer</button><button class="linkbtn" id="inst-x">Plus tard</button></span></div>`;
  if(isIOS)return `<div class="notice ok install"><span><b>Installe l'appli</b> : touche le bouton Partager de Safari, puis « Sur l'écran d'accueil ».</span><button class="linkbtn" id="inst-x">OK</button></div>`;
  return "";
}
function bindInstall(){
  document.getElementById("inst-go")?.addEventListener("click",async()=>{installEvt.prompt();await installEvt.userChoice.catch(()=>{});installEvt=null;rerender()});
  document.getElementById("inst-x")?.addEventListener("click",()=>{store.set("pr-install-hide","1");rerender()});
}

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
  return `<details class="avis"><summary>Lire les ${list.length} avis</summary><ul>${list.slice().sort((a,b)=>a.cree<b.cree?1:-1).map(a=>`<li><span class="stars">${"★".repeat(a.note)}</span><span class="muted">${"★".repeat(5-a.note)}</span>${a.texte?`<br>${esc(a.texte)}`:""}</li>`).join("")}</ul></details>`}

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
      <div class="auth-links">${reset?`<button type="button" class="linkbtn" id="m-back">Retour à la connexion</button>`:`<button type="button" class="linkbtn" id="m-reset">Mot de passe oublié ?</button>`}</div>
    </form>
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
function resetState(){myR=myP=null;RV={};RA={};P={};Dmap={};D=[];A=[];isAdmin=false;ready=false;localDispo=null}

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
    return[["agenda","Mon agenda"],["demandes","Demandes"+(pend?`<span class="count">${pend}</span>`:"")],["profil","Mon profil"],["compte","Mon compte"]];
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

const VIEWS={agenda:vAgenda,demandes:vDemandes,profil:vProfil,inscription:vProfil,trouver:vTrouver,mesdemandes:vMesDemandes,officine:vOfficine,validation:vValidation,vue:vVue,compte:vCompte};
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
    <div><h2 id="rf-t">Noter ${esc(target)}</h2><p class="muted" style="margin:4px 0 0;font-size:14px">Mission du ${nice(d.date)}. Ton avis sera visible par les autres utilisateurs.</p></div>
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
    ${isNew?`<label class="check"><input type="checkbox" id="p-ok" required>J'accepte les conditions du pilote et que mon profil et mon agenda soient visibles par les officines inscrites. L'inscription est gratuite ; après le pilote, chaque mission acceptée coûtera ${FRAIS} € TVAC.</label>`:""}
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
      <label>N° APB / AFMPS (facultatif)<input id="o-apb"></label>
    </div>
    ${isNew?`<label class="check"><input type="checkbox" id="o-ok" required>J'accepte les conditions du pilote. L'accès est gratuit pour les officines.</label>`:""}
    <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">${isNew?"Inscrire mon officine":"Enregistrer"}</button></div>
  </form></div>`;
  bindBanner();
  if(!isNew)getDoc(doc(db,"pharmacies",uid,"prive","contact")).then(s=>{const c=s.data()||{};for(const[id,k]of[["o-adr","adresse"],["o-tel","tel"],["o-email","email"],["o-apb","apb"]]){const el=document.getElementById(id);if(el&&!el.value)el.value=c[k]||""}}).catch(()=>{});
  document.getElementById("of").onsubmit=e=>{e.preventDefault();
    const commune=document.getElementById("o-commune").value.trim();
    if(!GEO.has(commune)){toast("Choisis une localité wallonne dans la liste.");document.getElementById("o-commune").focus();return}
    const t=nowIso();
    const pub={nom:document.getElementById("o-nom").value.trim(),titulaire:document.getElementById("o-tit").value.trim(),commune,maj:t};
    const contact={adresse:document.getElementById("o-adr").value.trim(),tel:document.getElementById("o-tel").value.trim(),email:document.getElementById("o-email").value.trim(),apb:document.getElementById("o-apb").value.trim(),maj:t};
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
  const monthPre=TODAY_ISO.slice(0,7);
  const nMois=D.filter(d=>d.rid===uid&&d.statut==="acceptee"&&d.date.startsWith(monthPre)).length;
  app.innerHTML=`<div class="stack">${banner()}<div><h1>Mon compte</h1><p class="lede">Connecté avec ${esc(user.email)}.</p></div>
  ${myR?`<div class="panel stack"><h2>Frais de missions</h2><p style="margin:0">Ce mois-ci : <b class="mono">${nMois}</b> mission${nMois>1?"s":""} acceptée${nMois>1?"s":""}, soit <b class="mono">${nMois*FRAIS} €</b> TVAC.</p><p class="muted" style="margin:0;font-size:14px">Gratuit pendant le pilote : ce montant est indicatif et ne sera pas facturé.</p></div>`:""}
  <div class="panel stack"><h2>Session</h2><div class="row"><button class="btn" id="c-out">Me déconnecter</button></div></div>
  <div class="panel stack"><h2>Supprimer mon compte</h2><p class="muted" style="margin:0;font-size:14px">Supprime ton profil, ton officine, tes coordonnées et ton accès. L'historique des missions passées reste visible par l'autre partie.</p><div class="row"><button class="btn danger" id="c-del">Supprimer mon compte</button></div></div></div>`;
  bindBanner();
  document.getElementById("c-out").onclick=()=>signOut(auth);
  document.getElementById("c-del").onclick=()=>confirmSheet("Supprimer ton compte ?","Cette action est définitive.","Supprimer définitivement",async()=>{
    try{
      for(const p of [["remplacants",uid,"prive","contact"],["remplacants",uid,"prive","verif"],["remplacants",uid],["pharmacies",uid,"prive","contact"],["pharmacies",uid]])await deleteDoc(doc(db,...p)).catch(()=>{});
      await deleteUser(user);toast("Compte supprimé");
    }catch(e){toast(e?.code==="auth/requires-recent-login"?"Par sécurité, déconnecte-toi, reconnecte-toi puis recommence.":"Suppression impossible pour l'instant.")}
  });
  return{refresh:()=>{}};
}

/* ---------- ADMINISTRATION ---------- */
const verifs=new Map();
function loadVerif(id){
  if(verifs.has(id))return verifs.get(id);
  verifs.set(id,"…");
  Promise.all([getDoc(doc(db,"remplacants",id,"prive","verif")),getDoc(doc(db,"remplacants",id,"prive","contact"))])
    .then(([v,c])=>{verifs.set(id,{...(c.data()||{}),...(v.data()||{})});rerender()}).catch(()=>{verifs.set(id,{});rerender()});
  return "…";
}
function setBloque(id,b){return write(()=>updateDoc(doc(db,"remplacants",id),{bloque:b,valide:!b,maj:nowIso()}),b?"Profil suspendu : il n'est plus visible":"Profil réactivé : il est à nouveau visible")}
function vValidation(){
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
    </tbody></table></div>
    ${r.bloque?`<button class="btn small" data-unblock="${esc(id)}">Réactiver</button>`:`<button class="btn danger small" data-block="${esc(id)}">Suspendre</button>`}
  </div>`}).join("")}</div>`:`<div class="empty">Aucun remplaçant inscrit pour l'instant. Partage le lien d'inscription à tes collègues.</div>`}</div>`;
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
  const perR=Object.entries(conf.reduce((m,d)=>(m[d.rid]=(m[d.rid]||0)+1,m),{})).sort((a,b)=>b[1]-a[1]);
  app.innerHTML=`<div class="stack"><div><h1>Vue d'ensemble</h1><p class="lede">L'activité de la plateforme, en direct.</p></div>
  <div class="panel"><div class="stat"><div><b>${nV}/${nR}</b><span>remplaçants visibles</span></div><div><b>${nP}</b><span>officines inscrites</span></div><div><b>${att.length}</b><span>demandes en attente</span></div><div><b>${conf.length}</b><span>missions confirmées</span></div><div><b>${A.length?fmtNote(notes):"—"}</b><span>note moyenne (${A.length} avis)</span></div><div><b>${conf.length*FRAIS} €</b><span>frais missions (${FRAIS} € TVAC/mission)</span></div></div></div>
  <div class="notice ${quota[0]==="ok"?"ok":""} install" style="${quota[0]==="bad"?"background:var(--bad-soft)":""}"><span><b style="${quota[0]==="bad"?"color:var(--bad)":""}">Capacité Firebase : ${quota[1]}.</b> ${quota[2]}<br><span class="hint">Estimation : ${lecturesJour.toLocaleString("fr-BE")} lectures par jour sur environ 50 000 gratuites (${utilisateurs} inscrits, 2 ouvertures par jour chacun). Chiffre réel : Firebase > Firestore > Utilisation.</span></span></div>
  <div class="panel stack"><h2>Frais par remplaçant</h2><p class="muted" style="margin:0;font-size:14px">${FRAIS} € TVAC par mission acceptée. Pendant le pilote, ces montants sont indicatifs.</p>${perR.length?`<div class="tbl"><table><thead><tr><th>Remplaçant</th><th>Missions acceptées</th><th>Montant</th></tr></thead><tbody>${perR.map(([rid,n])=>`<tr><td>${esc(RA[rid]?.nom||"—")}</td><td class="mono">${n}</td><td class="mono">${n*FRAIS} €</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin:0">Aucune mission acceptée pour l'instant.</p>`}</div>
  <div class="panel stack"><h2>Officines inscrites</h2>${nP?`<div class="tbl"><table><thead><tr><th>Officine</th><th>Localité</th><th>Titulaire</th><th>Inscrite</th></tr></thead><tbody>${Object.values(P).map(p=>`<tr><td>${esc(p.nom)}</td><td>${esc(locLabel(p.commune))}</td><td>${esc(p.titulaire)}</td><td>${p.cree?nice(p.cree.slice(0,10)):"—"}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin:0">Aucune officine inscrite pour l'instant.</p>`}</div>
  <div class="panel stack"><h2>Dernières missions confirmées</h2>${conf.length?`<div class="tbl"><table><thead><tr><th>Date</th><th>Officine</th><th>Remplaçant</th><th>Horaire</th></tr></thead><tbody>${conf.sort((a,b)=>a.date<b.date?1:-1).slice(0,20).map(d=>`<tr><td>${nice(d.date)}</td><td>${esc(P[d.pid]?.nom||d.pnom)}</td><td>${esc(RA[d.rid]?.nom||d.rnom||"—")}</td><td class="mono">${d.debut}–${d.fin}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin:0">Aucune mission confirmée pour l'instant.</p>`}</div></div>`;
  };
  draw();return{refresh:draw};
}
