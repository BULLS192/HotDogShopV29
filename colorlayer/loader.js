(async()=>{
  const parts=['app.part1.js.txt', 'app.part2.js.txt', 'app.part3.js.txt', 'app.part4.js.txt', 'app.part5.js.txt'];
  try {
    const chunks=await Promise.all(parts.map(p=>fetch(p,{cache:"no-cache"}).then(r=>{if(!r.ok) throw new Error(`${p}: ${r.status}`); return r.text();})));
    (0,eval)(chunks.join("\n"));
  } catch(err) {
    console.error("ColorLayer failed to load",err);
    const s=document.getElementById("status"); if(s) s.textContent="App load failed — refresh to retry.";
  }
})();
