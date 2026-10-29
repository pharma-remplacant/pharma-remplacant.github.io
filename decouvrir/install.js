// Bandeau et bouton d'installation de l'appli, et boutons de partage de la page.
(function(){
  var bar=document.getElementById("installbar"),go=document.getElementById("inst-go"),go2=document.getElementById("inst-go2"),txt=document.getElementById("inst-txt"),evt=null;
  var ua=navigator.userAgent,ios=/iphone|ipad|ipod/i.test(ua),mobile=/android|iphone|ipad|ipod|mobile/i.test(ua);
  var standalone=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
  var hide=0;try{hide=+(localStorage.getItem("pr-install-hide")||0)}catch(e){}
  if("serviceWorker" in navigator)navigator.serviceWorker.register("../sw.js").catch(function(){});
  function show(){
    if(standalone||Date.now()-hide<7*864e5)return;
    txt.textContent=evt?"Accès en un geste, en plein écran, comme une vraie appli."
      :ios?"Dans Safari : bouton Partager, puis « Sur l'écran d'accueil »."
      :mobile?"Menu ⋮ du navigateur, puis « Ajouter à l'écran d'accueil »."
      :"Cliquez sur « Installer » dans la barre d'adresse du navigateur.";
    go.textContent=evt?"Installer":"Ouvrir l'appli";
    bar.hidden=false;
  }
  function install(e){if(!evt){if(this===go2){e.preventDefault();document.getElementById("installer").querySelector(".how").scrollIntoView({behavior:"smooth"})}return}e.preventDefault();evt.prompt();evt.userChoice.then(function(){evt=null;bar.hidden=true})}
  window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();evt=e;show()});
  go.addEventListener("click",install);go2.addEventListener("click",install);
  document.getElementById("inst-x").addEventListener("click",function(){try{localStorage.setItem("pr-install-hide",String(Date.now()))}catch(e){}bar.hidden=true});
  show();

  // Partage : garde le lien de parrainage s'il y en a un
  var url=location.origin+location.pathname+(location.search.indexOf("ref=")>=0?location.search:"");
  var msg="Pharma Remplaçant : trouvez un remplaçant en officine en 2 minutes, partout en Wallonie. Gratuit pendant le pilote.";
  document.getElementById("sh-wa").href="https://wa.me/?text="+encodeURIComponent(msg+" "+url);
  document.getElementById("sh-fb").href="https://www.facebook.com/sharer/sharer.php?u="+encodeURIComponent(url);
  var sg=document.getElementById("sh-go");
  if(navigator.share){sg.hidden=false;sg.addEventListener("click",function(){navigator.share({title:"Pharma Remplaçant",text:msg,url:url}).catch(function(){})})}
  var cp=document.getElementById("sh-cp");
  cp.addEventListener("click",function(){(navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).then(function(){cp.textContent="Lien copié ✓"},function(){prompt("Copiez ce lien :",url)})});
})();
