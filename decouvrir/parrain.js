// Lien de parrainage (?ref=…&de=…) : retient le parrain pour l'inscription et affiche qui invite.
(function(){
  const q=new URLSearchParams(location.search), ref=q.get("ref");
  if(!ref||!/^[A-Za-z0-9]{10,64}$/.test(ref))return;
  try{localStorage.setItem("pr-parrain",ref)}catch(e){}
  const de=(q.get("de")||"").replace(/[\u0000-\u001f<>]/g,"").trim().slice(0,40);
  const go=()=>{
    const h=document.querySelector(".hero > div");if(!h)return;
    const p=document.createElement("p");p.className="invite";
    p.textContent=(de?de+" vous invite":"Vous êtes invité·e")+" sur Pharma Remplaçant 👋";
    h.prepend(p);
    document.querySelectorAll('a[href^="../#inscription"]').forEach(a=>a.href=a.getAttribute("href").replace("../#","../?ref="+ref+"#"));
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();
})();
