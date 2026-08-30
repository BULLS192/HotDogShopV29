import fs from 'node:fs';
import vm from 'node:vm';

const POINTS = { 1: 10, 2: 7, 3: 5, 4: 3, other: 1 };
const ADMIN_NAMES = new Set(['buy back','bye','open spot','vacant']);

function loadConfig(){
  const source = fs.readFileSync('firebase-config.js','utf8');
  const sandbox = { window:{} };
  vm.runInNewContext(source,sandbox,{filename:'firebase-config.js'});
  return sandbox.window.DARTS_FIREBASE_CONFIG;
}

const config = loadConfig();
const ledger = JSON.parse(fs.readFileSync('perpetual/reconstruction-ledger.json','utf8'));
const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents`;
const headers = { Referer:'https://bulls192.github.io/HotDogShopV29/' };

function decodeValue(value){
  if(!value || typeof value!=='object') return value;
  if('nullValue' in value) return null;
  if('stringValue' in value) return value.stringValue;
  if('booleanValue' in value) return Boolean(value.booleanValue);
  if('integerValue' in value) return Number(value.integerValue);
  if('doubleValue' in value) return Number(value.doubleValue);
  if('timestampValue' in value) return value.timestampValue;
  if('arrayValue' in value) return (value.arrayValue?.values||[]).map(decodeValue);
  if('mapValue' in value) return decodeFields(value.mapValue?.fields||{});
  return value;
}
function decodeFields(fields){ const out={}; for(const [k,v] of Object.entries(fields||{})) out[k]=decodeValue(v); return out; }
function decodeCustom(value){
  if(value && typeof value==='object' && value.__encodedArray && Array.isArray(value.items)) return value.items.map(decodeCustom);
  if(Array.isArray(value)) return value.map(decodeCustom);
  if(value && typeof value==='object'){ const out={}; for(const [k,v] of Object.entries(value)) if(k!=='__encodedArray') out[k]=decodeCustom(v); return out; }
  return value;
}
async function requestJson(url){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),15000);
  try{
    const r = await fetch(url,{headers,signal:controller.signal});
    const text = await r.text();
    if(!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,300)}`);
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(timer); }
}
async function getDoc(path){
  const json = await requestJson(`${base}/${path}?key=${encodeURIComponent(config.apiKey)}`);
  return decodeCustom(decodeFields(json.fields||{}));
}
async function listCollection(name){
  const rows=[]; let pageToken='';
  do{
    const p = new URLSearchParams({key:config.apiKey,pageSize:'300'});
    if(pageToken) p.set('pageToken',pageToken);
    const json = await requestJson(`${base}/${name}?${p}`);
    for(const doc of json.documents||[]) rows.push({id:String(doc.name).split('/').pop(),data:decodeCustom(decodeFields(doc.fields||{}))});
    pageToken=json.nextPageToken||'';
  } while(pageToken);
  return rows;
}

function arr(v){ return Array.isArray(v)?v:[]; }
function norm(v){ return String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' '); }
function playerName(p){
  if(!p) return '';
  const first=String(p.firstName||p.name||'').trim();
  const last=String(p.lastName||'').trim();
  const nick=String(p.nickname||'').trim();
  if(nick && last) return `${first} “${nick}” ${last}`.trim();
  if(nick) return `${first} “${nick}”`.trim();
  return `${first} ${last}`.trim();
}
function exactKey(p){
  const first=norm(p?.firstName||p?.name); if(!first) return '';
  return [first,norm(p?.lastName),norm(p?.nickname),norm(p?.gender)].join('|');
}
function pid(p){ return p?.persistentId ? String(p.persistentId) : ''; }
function isAdminName(name){ return ADMIN_NAMES.has(norm(name)); }
function tournamentState(bundle){
  if(bundle?.tournamentState && typeof bundle.tournamentState==='object') return bundle.tournamentState;
  if(bundle?.currentTournament?.tournamentState) return bundle.currentTournament.tournamentState;
  if(bundle?.players && bundle?.teams) return bundle;
  return null;
}
function findTeam(ts,id){ return arr(ts?.teams).find(t=>String(t?.id)===String(id))||null; }
function rankTeams(ts){
  const out=[],seen=new Set();
  const add=t=>{ if(!t) return; const k=String(t.id ?? [playerName(t.player1),playerName(t.player2)].join('|')); if(!seen.has(k)){seen.add(k);out.push(t);} };
  add(ts?.finalsState?.champion); add(ts?.finalsState?.runnerUp);
  arr(ts?.eliminationOrder).slice().reverse().forEach(id=>add(findTeam(ts,id)));
  return out;
}

const weekly = await listCollection('tournamentByWeek');
const playerDbDoc = await getDoc('appState/playerDatabase').catch(()=>null);
const series = await getDoc('seriesSeasons/hotdogshop-2026').catch(()=>null);

const identityByPid = new Map();
const identityByExact = new Map();
function remember(p){
  if(!p || typeof p!=='object') return;
  const name=playerName(p); if(!name) return;
  const record={...p,displayName:name};
  if(pid(p)) identityByPid.set(pid(p),record);
  const key=exactKey(p); if(key && !identityByExact.has(key)) identityByExact.set(key,record);
}
function normalizePlayerDb(x){
  const pdb=x?.playerDatabase;
  if(Array.isArray(pdb?.items?.items)) return pdb.items.items;
  if(Array.isArray(pdb?.items?.players)) return pdb.items.players;
  if(Array.isArray(pdb?.items)) return pdb.items;
  if(Array.isArray(pdb?.players)) return pdb.players;
  if(Array.isArray(pdb)) return pdb;
  if(Array.isArray(x?.items?.items)) return x.items.items;
  if(Array.isArray(x?.items)) return x.items;
  if(Array.isArray(x?.players)) return x.players;
  return [];
}
normalizePlayerDb(playerDbDoc||{}).forEach(remember);
for(const row of weekly){
  const ts=tournamentState(row.data); if(!ts) continue;
  arr(ts.players).forEach(remember);
  arr(ts.teams).forEach(t=>{remember(t?.player1);remember(t?.player2);});
}

function canonicalName(p){
  if(!p) return '';
  const byPid = pid(p) && identityByPid.get(pid(p));
  const byExact = identityByExact.get(exactKey(p));
  const chosen = byPid || byExact || p;
  return playerName(chosen);
}
function eventDateFromRow(row){
  const ts=tournamentState(row.data);
  const raw=String(ts?.tournamentMeta?.date || row.id.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '').slice(0,10);
  const match = ledger.events.find(e=>e.firebaseTournamentDate===raw || e.date===raw);
  return match?.date || raw;
}

const weeklyByCanonicalDate = new Map();
for(const row of weekly){
  const ts=tournamentState(row.data); if(!ts) continue;
  const date=eventDateFromRow(row);
  const meaningful=arr(ts.players).length>0 || arr(ts.teams).length>0 || ts?.finalsState?.champion;
  if(!meaningful) continue;
  if(!weeklyByCanonicalDate.has(date)) weeklyByCanonicalDate.set(date,row);
}

function rowsFromTournament(date,row){
  const ts=tournamentState(row.data); const ranking=rankTeams(ts); const per=new Map();
  const add=(p,placement,points)=>{
    const name=canonicalName(p); if(!name || isAdminName(name)) return;
    const key=norm(name);
    const old=per.get(key);
    const next={name,placement,points,date};
    if(!old || points>old.points || (placement && (!old.placement || placement<old.placement))) per.set(key,next);
  };
  arr(ts.players).forEach(p=>add(p,null,POINTS.other));
  ranking.slice(0,4).forEach((team,i)=>[team?.player1,team?.player2].filter(Boolean).forEach(p=>add(p,i+1,POINTS[i+1])));
  return [...per.values()];
}

function resolveSeriesId(id){
  const p=identityByPid.get(String(id));
  return p ? playerName(p) : `UNRESOLVED:${id}`;
}
function recoveredMay20Rows(){
  const weeks = series?.weeks || {};
  const w=weeks['2026-05-20']; if(!w) return [];
  const per=new Map();
  const addId=(id,placement,points)=>{
    const name=resolveSeriesId(id); if(!name || isAdminName(name)) return;
    const key=norm(name);
    const old=per.get(key); const next={name,placement,points,date:'2026-05-20'};
    if(!old || points>old.points) per.set(key,next);
  };
  for(const [place,ids] of Object.entries(w.placements||{})) arr(ids).forEach(id=>addId(id,Number(place),POINTS[Number(place)]||POINTS.other));
  arr(w.others).forEach(id=>addId(id,null,POINTS.other));
  return [...per.values()];
}

const eventRows = new Map();
for(const event of ledger.events){
  if(event.date==='2026-05-20') eventRows.set(event.date,recoveredMay20Rows());
  else if(weeklyByCanonicalDate.has(event.date)) eventRows.set(event.date,rowsFromTournament(event.date,weeklyByCanonicalDate.get(event.date)));
  else eventRows.set(event.date,[]);
}

const trustedStatuses = new Set(['confirmed','recovered-reviewed']);
const expandedStatuses = new Set(['confirmed','recovered-reviewed','recovered-pending-review','partial']);

function buildStandings(allowed){
  const m=new Map(); const included=[];
  for(const event of ledger.events){
    if(!allowed.has(event.status)) continue;
    const rows=eventRows.get(event.date)||[];
    if(!rows.length) continue;
    included.push(event.date);
    for(const r of rows){
      const key=norm(r.name);
      if(!m.has(key)) m.set(key,{player:r.name,points:0,played:0,wins:0,podiums:0,lastPlayed:''});
      const s=m.get(key); s.points+=r.points; s.played+=1; if(r.placement===1)s.wins++; if(r.placement && r.placement<=3)s.podiums++; if(r.date>s.lastPlayed)s.lastPlayed=r.date;
    }
  }
  return {includedDates:included,rows:[...m.values()].map(x=>({...x,ppe:x.played?Number((x.points/x.played).toFixed(2)):0})).sort((a,b)=>b.points-a.points||b.wins-a.wins||b.podiums-a.podiums||b.played-a.played||a.player.localeCompare(b.player))};
}

const trusted=buildStandings(trustedStatuses);
const expanded=buildStandings(expandedStatuses);
const expandedMap=new Map(expanded.rows.map((r,i)=>[norm(r.player),{...r,rank:i+1}]));
const trustedWithDelta=trusted.rows.map((r,i)=>{const e=expandedMap.get(norm(r.player));return {...r,rank:i+1,expandedRank:e?.rank??null,expandedPoints:e?.points??null,pointDelta:e?e.points-r.points:null,rankDelta:e?i+1-e.rank:null};});

const output={
  generatedAt:new Date().toISOString(),
  policy:{trustedStatuses:[...trustedStatuses],expandedStatuses:[...expandedStatuses],excluded:['missing','disputed','cancelled-unverified'],aug27Excluded:true},
  trusted:{includedDates:trusted.includedDates,eventCount:trusted.includedDates.length,standings:trustedWithDelta},
  expanded:{includedDates:expanded.includedDates,eventCount:expanded.includedDates.length,standings:expanded.rows.map((r,i)=>({...r,rank:i+1}))},
  unresolvedRecoveredPlayers:recoveredMay20Rows().filter(r=>r.name.startsWith('UNRESOLVED:')).map(r=>r.name),
  eventRowCounts:Object.fromEntries([...eventRows.entries()].map(([d,rows])=>[d,rows.length]))
};

console.log('HDS_RECONSTRUCTED_STANDINGS_JSON_BEGIN');
console.log(JSON.stringify(output));
console.log('HDS_RECONSTRUCTED_STANDINGS_JSON_END');
