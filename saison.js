// Saisons : choisit les couleurs selon la date et ajoute un décor discret
// (feuilles, flocons, pétales, soleil). Pour prévisualiser : ?saison=hiver
(function(){
  const d=new Date(), md=(d.getMonth()+1)*100+d.getDate();
  let s=md>=1221||md<320?"hiver":md<621?"printemps":md<922?"ete":"automne";
  const q=new URLSearchParams(location.search).get("saison");
  if(["hiver","printemps","ete","automne"].includes(q)) s=q;
  const root=document.documentElement;
  root.dataset.saison=s;
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content=getComputedStyle(root).getPropertyValue("--accent").trim()||meta.content;

  const SVG={
    automne:'<svg viewBox="0 0 24 24"><path d="M12 1.5c-4.6 3.5-7.6 7.6-6.8 12.3.6 3.6 3.6 6 6.8 7.2 3.2-1.2 6.2-3.6 6.8-7.2.8-4.7-2.2-8.8-6.8-12.3z"/><path class="n" d="M12 5v18M12 11l-3.5-2.5M12 11l3.5-2.5M12 15.5l-4-2.8M12 15.5l4-2.8"/></svg>',
    hiver:'<svg viewBox="0 0 24 24"><g class="n"><path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5M3.7 10.4l3.4-.9-.9-3.4M20.3 13.6l-3.4.9.9 3.4M3.7 13.6l3.4.9-.9 3.4M20.3 10.4l-3.4-.9.9-3.4"/></g></svg>',
    printemps:'<svg viewBox="0 0 24 24"><path d="M12 2c4.5 3.5 6 8.5 3.2 14.2C14 18.7 13 20.6 12 22c-1-1.4-2-3.3-3.2-5.8C6 10.5 7.5 5.5 12 2z"/><path class="n" d="M12 7v10"/></svg>',
    ete:'<svg viewBox="0 0 24 24"><path d="M12 3l1.6 6.4L20 11l-6.4 1.6L12 19l-1.6-6.4L4 11l6.4-1.6z"/></svg>'
  };
  const COUL={automne:["#d9532f","#e08a2c","#a8432a","#c9a227"],hiver:["#7fa8d8","#a9c6ea","#5f8cc4"],printemps:["#f2a0c0","#f7c3d6","#e07aa6","#fbe0ea"],ete:["#f2b632","#ffd36b","#f59e2b"]};

  function decor(){
    if(document.querySelector(".saison-deco")) return;
    const box=document.createElement("div");
    box.className="saison-deco"; box.setAttribute("aria-hidden","true");
    if(s==="ete"){
      const sun=document.createElement("div");
      sun.className="saison-soleil";
      sun.innerHTML='<svg viewBox="0 0 200 200"><g class="r">'+Array.from({length:12},(_,i)=>`<path transform="rotate(${i*30} 100 100)" d="M100 4l7 38h-14z"/>`).join("")+'</g><circle cx="100" cy="100" r="44"/></svg>';
      box.appendChild(sun);
    }
    const n=s==="ete"?7:window.innerWidth<700?10:16, c=COUL[s];
    for(let i=0;i<n;i++){
      const el=document.createElement("span");
      el.className="saison-p";
      el.innerHTML=SVG[s];
      const t=10+Math.random()*12, sz=s==="ete"?9+Math.random()*9:14+Math.random()*14;
      el.style.left=(Math.random()*100)+"vw";
      el.style.top=s==="ete"?(Math.random()*100)+"vh":"0";
      el.style.width=el.style.height=sz+"px";
      el.style.color=c[i%c.length];
      el.style.animationDuration=(s==="ete"?6+Math.random()*6:t*1.6)+"s, "+(4+Math.random()*4)+"s";
      el.style.animationDelay=(-Math.random()*30)+"s, "+(-Math.random()*8)+"s";
      el.style.setProperty("--rot",(Math.random()*360)+"deg");
      box.appendChild(el);
    }
    document.body.prepend(box);
  }
  if(document.body) decor(); else document.addEventListener("DOMContentLoaded",decor);
})();
