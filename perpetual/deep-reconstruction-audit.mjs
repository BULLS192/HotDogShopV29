import fs from 'node:fs';
import vm from 'node:vm';

function loadConfig(){const s=fs.readFileSync('firebase-config.js','utf8');const x={window:{}};vm.runInNewContext(s,x);return x.window.DARTS_FIREBASE_CONFIG;}
const config=loadConfig();
const base=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents`;
const headers={Referer:'https://bulls192.github.io/HotDogShopV29/'};
function dv(v){if(!v||typeof v!=='object')return v;if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return !!v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return Number(v.doubleValue);if('timestampValue'in v)return v.timestampValue;if('arrayValue'in v)return (v.arrayValue?.values||[]).map(dv);if('mapValue'in v)return df(v.mapValue?.fields||{});return v;}
function df(f){const o={};for(const[k,v]of Object.entries(f||{}))o[k]=dv(v);return o;}
function dc(v){if(v&&typeof v==='object'&&v.__encodedArray&&Array.isArray(v.items))return v.items.map(dc);if(Array.isArray(v))return v.map(dc);if(v&&typeof v==='object'){const o={};for(const[k,c]of Object.entries(v))if(k!=='__encodedArray')o[k]=dc(c);return o;}return v;}
async function rq(url,label){const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);try{const r=await fetch(url,{headers,signal:c.signal});const text=await r.text();if(!r.ok)throw new Error(`${label}: HTTP ${r.status} ${text.slice(0,300)}`);return text?JSON.parse(text):{};}finally{clearTimeout(t)}}
async function getDoc(path){const j=await rq(`${base}/${path}?key=${encodeURIComponent(config.apiKey)}`,path);return dc(df(j.fields||{}));}
async function listCol(name){const rows=[];let token='';do{const p=new URLSearchParams({key:config.apiKey,pageSize:'300'});if(token)p.set('pageToken',token);const j=await rq(`${base}/${name}?${p}`,name);for(const d of j.documents||[])rows.push({id:String(d.name).split('/').pop(),data:dc(df(d.fields||{}))});token=j.nextPageToken||'';}while(token);return rows;}
const arr=v=>Array.isArray(v)?v:[];const clean=v=>String(v||'').trim();
function pname(p){if(!p)return'';return [clean(p.firstName||p.name),clean(p.nickname)?`“${clean(p.nickname)}”`:'',clean(p.lastName)].filter(Boolean).join(' ');}
function pid(p){return clean(p?.persistentId||p?.playerId||'');}
function state(b){if(b?.tournamentState&&typeof b.tournamentState==='object')return b.tournamentState;if(b?.currentTournament?.tournamentState)return b.currentTournament.tournamentState;if(b?.players&&b?.teams)return b;return null;}
function weeks(b){const c=[b?.weeks,b?.weeklySeriesState?.weeks,b?.tournamentState?.weeklySeriesState?.weeks,b?.seriesState?.weeks];return c.find(x=>x&&typeof x==='object'&&!Array.isArray(x))||{};}
function pdb(b){const c=[b?.playerDatabase,b?.currentTournament?.playerDatabase];for(const x of c){if(Array.isArray(x))return x;if(Array.isArray(x?.items?.items))return x.items.items;if(Array.isArray(x?.items?.players))return x.items.players;if(Array.isArray(x?.items))return x.items;if(Array.isArray(x?.players))return x.players;if(x?.byId&&typeof x.byId==='object')return Object.values(x.byId);}return[];}
function addIdentity(map,p,source){if(!p||typeof p!=='object')return;const id=pid(p);if(!id)return;const n=pname(p);if(!map.has(id))map.set(id,{id,names:new Map(),sources:new Set()});const e=map.get(id);if(n)e.names.set(n,(e.names.get(n)||0)+1);e.sources.add(source);}
function bestName(e){return [...e.names.entries()].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length)[0]?.[0]||e.id;}
function normRefs(v){return arr(v).map(x=>typeof x==='object'?(pid(x)||pname(x)):clean(x)).filter(Boolean);}
function placementMap(w){const p=w?.placements||w?.places||{};const out={};for(const k of ['1','2','3','4']){const v=p[k]??p[Number(k)];out[k]=normRefs(v);}return out;}
function snapSignature(w){const p=placementMap(w);const o=normRefs(w?.others||w?.otherPlayers||w?.participants);return JSON.stringify({p,o});}
function completeness(w){const p=placementMap(w);return Object.values(p).reduce((n,x)=>n+x.length,0)+normRefs(w?.others||w?.otherPlayers||w?.participants).length;}
function resolveRef(ref,ids){return ids.has(ref)?bestName(ids.get(ref)):ref;}
function teamName(t){return [t?.player1,t?.player2].filter(Boolean).map(pname).filter(Boolean).join(' & ');}
function summarizeMatch(m,teams){if(!m||typeof m!=='object')return null;const byId=id=>teams.find(t=>String(t?.id)===String(id));const t1=m.team1||byId(m.team1Id)||byId(m.teamAId);const t2=m.team2||byId(m.team2Id)||byId(m.teamBId);const win=m.winner||byId(m.winnerId);const lose=m.loser||byId(m.loserId);return {id:m.id??null,team1:teamName(t1)||clean(m.team1Name),team2:teamName(t2)||clean(m.team2Name),winner:teamName(win)||clean(m.winnerName),loser:teamName(lose)||clean(m.loserName),status:m.status||'',rawKeys:Object.keys(m)};}

const errors=[];async function safe(label,fn,fallback){try{return await fn()}catch(e){errors.push(`${label}: ${e?.message||e}`);return fallback}}
const [weekly,archives,series,current,playerDoc]=await Promise.all([
 safe('weekly',()=>listCol('tournamentByWeek'),[]),safe('archives',()=>listCol('tournaments'),[]),safe('series',()=>getDoc('seriesSeasons/hotdogshop-2026'),null),safe('current',()=>getDoc('appState/currentTournament'),null),safe('players',()=>getDoc('appState/playerDatabase'),null)
]);

const ids=new Map();
function harvest(bundle,source){pdb(bundle||{}).forEach(p=>addIdentity(ids,p,`${source}:playerDatabase`));const ts=state(bundle);arr(ts?.players).forEach(p=>addIdentity(ids,p,`${source}:players`));arr(ts?.teams).forEach(t=>{addIdentity(ids,t?.player1,`${source}:teams`);addIdentity(ids,t?.player2,`${source}:teams`)});}
harvest(playerDoc,'appState/playerDatabase');harvest(current,'appState/currentTournament');weekly.forEach(r=>harvest(r.data,`weekly:${r.id}`));archives.forEach(r=>harvest(r.data,`archive:${r.id}`));

const snapshots=[];
function collectWeeks(bundle,source,savedAt){for(const[date,w]of Object.entries(weeks(bundle||{}))){snapshots.push({date,source,savedAt:savedAt||bundle?.savedAt||w?.savedAt||'',signature:snapSignature(w),completeness:completeness(w),raw:w});}}
collectWeeks(series,'seriesSeasons/hotdogshop-2026',series?.savedAt);weekly.forEach(r=>collectWeeks(r.data,`weekly:${r.id}`,r.data?.savedAt));archives.forEach(r=>collectWeeks(r.data,`archive:${r.id}`,r.data?.savedAt));collectWeeks(current,'appState/currentTournament',current?.savedAt);

const byWeek=new Map();for(const s of snapshots){if(!byWeek.has(s.date))byWeek.set(s.date,[]);byWeek.get(s.date).push(s);}
const reconstructedWeeks=[];
for(const[date,ss]of [...byWeek.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){const variants=new Map();for(const s of ss){if(!variants.has(s.signature))variants.set(s.signature,[]);variants.get(s.signature).push(s);}const ranked=[...ss].sort((a,b)=>b.completeness-a.completeness||clean(b.savedAt).localeCompare(clean(a.savedAt)));const chosen=ranked[0];const p=placementMap(chosen.raw);const others=normRefs(chosen.raw?.others||chosen.raw?.otherPlayers||chosen.raw?.participants);reconstructedWeeks.push({date,confidence:variants.size===1?'consistent-snapshot':'conflicting-snapshots',snapshotCount:ss.length,variantCount:variants.size,chosenSource:chosen.source,chosenSavedAt:chosen.savedAt,completeness:chosen.completeness,placements:Object.fromEntries(Object.entries(p).map(([k,v])=>[k,v.map(x=>resolveRef(x,ids))])),others:others.map(x=>resolveRef(x,ids)),unresolvedRefs:[...new Set([...Object.values(p).flat(),...others].filter(x=>x.startsWith('plr_')&&!ids.has(x)))],variants:[...variants.values()].map(group=>({count:group.length,sources:group.map(x=>x.source),savedAts:group.map(x=>x.savedAt),completeness:Math.max(...group.map(x=>x.completeness))}))});}

const tournaments=weekly.map(r=>{const ts=state(r.data);const date=clean(ts?.tournamentMeta?.date||r.id.match(/^\d{4}-\d{2}-\d{2}/)?.[0]);return{date,id:r.id,savedAt:r.data?.savedAt||'',players:arr(ts?.players).length,teams:arr(ts?.teams).length,champion:teamName(ts?.finalsState?.champion),runnerUp:teamName(ts?.finalsState?.runnerUp),completed:!!ts?.finalsState?.champion&&ts?.tournamentLocked===true};});
const aug=weekly.find(r=>r.id.startsWith('2026-08-27'))?.data||current||null;const ats=state(aug);const augTeams=arr(ats?.teams);
const aug27=ats?{savedAt:aug?.savedAt||'',players:arr(ats.players).map(p=>({id:pid(p),name:pname(p)})),teams:augTeams.map(t=>({id:t.id,name:teamName(t),losses:ats?.teamLosses?.[t.id]??ats?.teamLosses?.[String(t.id)]??null})),finalsState:{champion:teamName(ats?.finalsState?.champion),runnerUp:teamName(ats?.finalsState?.runnerUp),keys:Object.keys(ats?.finalsState||{})},eliminationOrder:arr(ats?.eliminationOrder),matches:arr(ats?.matches).map(m=>summarizeMatch(m,augTeams)),winnersBracket:arr(ats?.winnersBracket).map(m=>summarizeMatch(m,augTeams)),losersMatches:arr(ats?.losersMatches).map(m=>summarizeMatch(m,augTeams)),tournamentLocked:ats?.tournamentLocked??null}:null;

const output={generatedAt:new Date().toISOString(),projectId:config.projectId,readOnly:true,errors,identityCount:ids.size,identityMap:Object.fromEntries([...ids.entries()].map(([id,e])=>[id,{name:bestName(e),aliases:[...e.names.keys()],sourceCount:e.sources.size}])),snapshotStats:{total:snapshots.length,weekDates:byWeek.size},reconstructedWeeks,tournamentDocuments:tournaments,aug27};
console.log('HDS_DEEP_RECONSTRUCTION_BEGIN');console.log(JSON.stringify(output));console.log('HDS_DEEP_RECONSTRUCTION_END');
