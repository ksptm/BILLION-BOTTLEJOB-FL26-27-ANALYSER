
'use strict';

const API = {
  bootstrap: 'data/bootstrap.json',
  fixtures: 'data/fixtures.json',
  history: 'data/history.json',
  media: 'data/media.json',
  updated: 'data/updated.json'
};

const FORMATIONS = [
  {name:'3-4-3',DEF:3,MID:4,FWD:3},{name:'3-5-2',DEF:3,MID:5,FWD:2},
  {name:'4-3-3',DEF:4,MID:3,FWD:3},{name:'4-4-2',DEF:4,MID:4,FWD:2},
  {name:'4-5-1',DEF:4,MID:5,FWD:1},{name:'5-2-3',DEF:5,MID:2,FWD:3},
  {name:'5-3-2',DEF:5,MID:3,FWD:2},{name:'5-4-1',DEF:5,MID:4,FWD:1}
];

const SLOTS = [
  ['GKP 1','GKP'],['GKP 2','GKP'],
  ['DEF 1','DEF'],['DEF 2','DEF'],['DEF 3','DEF'],['DEF 4','DEF'],['DEF 5','DEF'],
  ['MID 1','MID'],['MID 2','MID'],['MID 3','MID'],['MID 4','MID'],['MID 5','MID'],
  ['FWD 1','FWD'],['FWD 2','FWD'],['FWD 3','FWD']
];

const state = {
  bootstrap:null, fixtures:[], teamsById:{}, positionsById:{},
  players:[], history:{}, media:{}, team:Array(15).fill(null), sellPrices:{}, bank:0,
  weekly:null, benchSwaps:[], assetTransfers:[], singleTransfers:[], builder:null
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const num = v => Number(v) || 0;
const fmt = (v,d=2) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '0.00';

function toast(message){
  const el=$('#toast'); el.textContent=message; el.classList.add('show');
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),3000);
}
function setStatus(message){ $('#statusLine').textContent=message; }
function saveState(){
  localStorage.setItem('fpl-app-team', JSON.stringify({
    team:state.team, sellPrices:state.sellPrices, bank:state.bank
  }));
}
function loadState(){
  try{
    const s=JSON.parse(localStorage.getItem('fpl-app-team')||'{}');
    if(Array.isArray(s.team)&&s.team.length===15) state.team=s.team;
    state.sellPrices=s.sellPrices||{}; state.bank=num(s.bank);
  }catch{}
  try{ state.history=JSON.parse(localStorage.getItem('fpl-app-history')||'{}'); }catch{}
}
async function fetchJSON(url){
  const bust = url.includes('?') ? '&' : '?';
  const res = await fetch(url + bust + 'v=' + Date.now(), {cache:'no-store'});
  if(!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

function currentGW(){
  let gw=1;
  for(const e of (state.bootstrap?.events||[])){
    if(e.is_current) gw=e.id;
    else if(e.finished && e.id>gw) gw=e.id;
  }
  return gw;
}
function seasonWeights(gw){
  if(gw<=1)return [0.25,0.75];
  if(gw===2)return [0.30,0.70];
  if(gw===3)return [0.35,0.65];
  if(gw<=5)return [0.45,0.55];
  if(gw<=8)return [0.60,0.40];
  if(gw<=12)return [0.75,0.25];
  if(gw<=19)return [0.80,0.20];
  return [0.85,0.15];
}

function buildLiveModel(){
  const data=state.bootstrap;
  state.teamsById=Object.fromEntries(data.teams.map(t=>[t.id,t]));
  state.positionsById=Object.fromEntries(data.element_types.map(p=>[p.id,p.singular_name_short]));
  const upcoming={};
  for(const f of state.fixtures){
    if(f.finished) continue;
    (upcoming[f.team_h]??=[]).push({gw:f.event,opponent:state.teamsById[f.team_a].name,location:'H',difficulty:f.team_h_difficulty});
    (upcoming[f.team_a]??=[]).push({gw:f.event,opponent:state.teamsById[f.team_h].name,location:'A',difficulty:f.team_a_difficulty});
  }

  state.players=data.elements.map(p=>{
    const position=state.positionsById[p.element_type];
    const team=state.teamsById[p.team].name;
    const fx=(upcoming[p.team]||[]).sort((a,b)=>(a.gw||999)-(b.gw||999)).slice(0,5);
    const difficulties=fx.map(x=>x.difficulty);
    const avgDifficulty=difficulties.length ? difficulties.reduce((a,b)=>a+b,0)/difficulties.length : null;
    const price=p.now_cost/10, ppg=num(p.points_per_game), totalPoints=num(p.total_points);
    const minutes=num(p.minutes), starts=num(p.starts), xg=num(p.expected_goals), xa=num(p.expected_assists);
    const xgi=num(p.expected_goal_involvements), cleanSheets=num(p.clean_sheets), bonus=num(p.bonus);
    const fixtureScore=avgDifficulty!==null?Math.max(0,Math.min(100,(6-avgDifficulty)*20)):50;
    const performanceScore=Math.min(100,ppg*10+totalPoints/10);
    let expectedOutputScore=0;
    if(position==='GKP') expectedOutputScore=Math.min(100,cleanSheets*4+bonus*1.2);
    else if(position==='DEF') expectedOutputScore=Math.min(100,cleanSheets*3+xgi*3+bonus*1.2);
    else if(position==='MID') expectedOutputScore=Math.min(100,xgi*3.2+bonus*1.1);
    else if(position==='FWD') expectedOutputScore=Math.min(100,xgi*3.5+bonus);
    const valueScore=price>0?Math.min(100,(ppg/price)*90+(totalPoints/price)*1.2):0;
    const minutesScore=Math.min(100,(minutes/3420)*100), startsScore=Math.min(100,(starts/38)*100);
    const reliabilityScore=minutesScore*.65+startsScore*.35;
    let availabilityScore=100;
    if(p.status==='d')availabilityScore=60;
    if(p.status==='i')availabilityScore=20;
    if(p.status==='s')availabilityScore=0;
    if(p.status==='u')availabilityScore=10;
    if(p.news?.trim()) availabilityScore=Math.min(availabilityScore,70);
    let positionScore=50;
    if(position==='GKP')positionScore=Math.min(100,cleanSheets*4+ppg*7);
    else if(position==='DEF')positionScore=Math.min(100,cleanSheets*3+xgi*2.5+ppg*6);
    else if(position==='MID')positionScore=Math.min(100,xgi*3+ppg*7);
    else if(position==='FWD')positionScore=Math.min(100,xgi*3.2+ppg*7);
    const aiScore=fixtureScore*.20+performanceScore*.20+expectedOutputScore*.20+valueScore*.15+reliabilityScore*.10+availabilityScore*.10+positionScore*.05;

    return {
      id:p.id,player:p.web_name,firstName:p.first_name,surname:p.second_name,team,teamId:p.team,
      position,price,ownership:num(p.selected_by_percent),totalPoints,ppg,form:num(p.form),
      minutes,starts,goals:num(p.goals_scored),assists:num(p.assists),cleanSheets,bonus,bps:num(p.bps),
      xg,xa,xgi,ict:num(p.ict_index),status:p.status,news:p.news||'',
      fixtures:fx, fixture1:fixtureText(fx[0]),fixture2:fixtureText(fx[1]),fixture3:fixtureText(fx[2]),
      fixture4:fixtureText(fx[3]),fixture5:fixtureText(fx[4]),avgDifficulty,
      fixtureScore,performanceScore,expectedOutputScore,valueScore,reliabilityScore,availabilityScore,positionScore,aiScore
    };
  });
  attachHistoricalTransferScores();
}
function fixtureText(f){ return f ? `${f.opponent} (${f.location}) - ${f.difficulty}` : ''; }

function seasonScore(position, season){
  let target=200;
  if(position==='GKP')target=175; else if(position==='DEF')target=185; else if(position==='MID')target=220; else if(position==='FWD')target=210;
  const pointsScore=Math.min(100,(num(season.total_points)/target)*100);
  const minutesScore=Math.min(100,(num(season.minutes)/3420)*100);
  return pointsScore*.80+minutesScore*.20;
}
function historicalScoreFor(id){
  const entries=state.history[id]||[];
  const recent=[...entries].sort((a,b)=>String(b.season).localeCompare(String(a.season))).slice(0,3);
  const weights=[.55,.30,.15];
  let total=0, used=0;
  recent.forEach((s,i)=>{total+=num(s.score)*weights[i];used+=weights[i]});
  let confidence=0;
  if(recent.length>=3)confidence=1; else if(recent.length===2)confidence=.8; else if(recent.length===1)confidence=.55;
  return {score:used?total/used:0,confidence,seasons:recent.length};
}
function attachHistoricalTransferScores(){
  const [currentWeight,historicalWeight]=seasonWeights(currentGW());
  state.players.forEach(p=>{
    const h=historicalScoreFor(p.id);
    const effectiveHistoricalWeight=historicalWeight*h.confidence;
    const effectiveCurrentWeight=1-effectiveHistoricalWeight;
    p.historicalScore=h.score;p.historyConfidence=h.confidence;p.historicalSeasons=h.seasons;
    p.transferScore=p.aiScore*effectiveCurrentWeight+h.score*effectiveHistoricalWeight;
    const m=state.media[String(p.id)] || state.media[p.id] || {};
    p.mediaArticles=num(m.articlesSinceLastMatch);
    p.mediaUniqueSources=num(m.uniqueSources);
    p.mediaBaseline=num(m.baselineArticles);
    p.mediaActivityIndex=num(m.activityIndex);
    p.mediaLast24h=num(m.last24h);
    p.mediaLast72h=num(m.last72h);
    p.mediaWindowHours=num(m.windowHours);
    p.mediaLastMatch=m.lastMatch || '';
    p.mediaStatus=m.status || (p.mediaActivityIndex>=200?'HIGH':p.mediaActivityIndex>=125?'ELEVATED':'NORMAL');
    p.currentSeasonWeight=currentWeight;p.historicalWeight=historicalWeight;
  });
}

async function refreshLive(){
  try{
    setStatus('Loading published FPL data…');
    const [bootstrap,fixtures,history,media,updated]=await Promise.all([
      fetchJSON(API.bootstrap),
      fetchJSON(API.fixtures),
      fetchJSON(API.history),
      fetchJSON(API.media).catch(()=>({})),
      fetchJSON(API.updated).catch(()=>({updated_at:null}))
    ]);
    if(!bootstrap.elements || !bootstrap.elements.length){
      throw new Error('FPL snapshots have not been generated yet. Run the GitHub Action "Update FPL Data" once.');
    }
    state.bootstrap=bootstrap;
    state.fixtures=fixtures;
    state.history=history || {};
    state.media=media || {};
    buildLiveModel();
    $('#gwBadge').textContent=`GW ${currentGW()}`;
    reconcileSavedTeam();
    renderAll();
    const stamp=updated?.updated_at ? ` • snapshot ${updated.updated_at}` : '';
    setStatus(`Published data loaded • ${state.players.length} players • GW ${currentGW()}${stamp}`);
    toast('Published FPL data refreshed');
  }catch(err){
    console.error(err);
    setStatus('Published FPL data could not be loaded.');
    toast(`Live data failed: ${err.message}`);
  }
}
function reconcileSavedTeam(){
  const ids=new Set(state.players.map(p=>p.id));
  state.team=state.team.map(id=>ids.has(Number(id))?Number(id):null);
}

async function refreshHistory(){
  try{
    setStatus('Reloading published historical data…');
    state.history = await fetchJSON(API.history);
    attachHistoricalTransferScores();
    renderAll();
    setStatus(`Historical snapshot loaded for ${Object.keys(state.history||{}).length} players.`);
    toast('Published historical data refreshed');
  }catch(err){
    console.error(err);
    toast(`History refresh failed: ${err.message}`);
  }
}

function selectedSquad(){
  return state.team.map((id,i)=>{
    const p=state.players.find(x=>x.id===Number(id)); if(!p)return null;
    return {...p,slot:SLOTS[i][0],currentPrice:p.price,sellPrice:state.sellPrices[p.id]??p.price};
  }).filter(Boolean);
}
function validateSquad(squad=selectedSquad()){
  const errors=[];
  if(squad.length!==15)errors.push(`Select all 15 players (${squad.length}/15 currently selected).`);
  const pos={GKP:0,DEF:0,MID:0,FWD:0};const clubs={};
  squad.forEach(p=>{pos[p.position]=(pos[p.position]||0)+1;clubs[p.team]=(clubs[p.team]||0)+1});
  const req={GKP:2,DEF:5,MID:5,FWD:3};
  for(const k in req)if(pos[k]!==req[k])errors.push(`${k}: ${pos[k]} selected, ${req[k]} required.`);
  for(const [club,c] of Object.entries(clubs))if(c>3)errors.push(`${club}: ${c} players (maximum 3).`);
  return errors;
}
function bestXIFromSquad(squad){
  function top(position,count){return squad.filter(p=>p.position===position).sort((a,b)=>b.aiScore-a.aiScore).slice(0,count)}
  const goalkeeper=top('GKP',1);const results=[];
  for(const f of FORMATIONS){
    const players=[...goalkeeper,...top('DEF',f.DEF),...top('MID',f.MID),...top('FWD',f.FWD)];
    if(players.length!==11)continue;
    const score=players.reduce((s,p)=>s+p.aiScore,0);
    results.push({formation:f.name,score,starters:players});
  }
  results.sort((a,b)=>b.score-a.score);
  if(!results.length)return null;
  const best=results[0], ids=new Set(best.starters.map(p=>p.id));
  const bench=squad.filter(p=>!ids.has(p.id));
  const benchGK=bench.filter(p=>p.position==='GKP');
  const benchOut=bench.filter(p=>p.position!=='GKP').sort((a,b)=>b.aiScore-a.aiScore);
  return {...best,bench:[...benchOut,...benchGK],squad,formations:results};
}
function legalXI(players){
  if(players.length!==11)return false;
  const c={GKP:0,DEF:0,MID:0,FWD:0};players.forEach(p=>c[p.position]++);
  return c.GKP===1&&c.DEF>=3&&c.DEF<=5&&c.MID>=2&&c.MID<=5&&c.FWD>=1&&c.FWD<=3;
}
function analyseBench(squad){
  const result=bestXIFromSquad(squad);if(!result)return [];
  const swaps=[];
  for(const b of result.bench)for(const s of result.starters){
    if(b.position==='GKP'&&s.position!=='GKP')continue;
    if(b.position!=='GKP'&&s.position==='GKP')continue;
    const test=result.starters.map(p=>p.id===s.id?b:p);
    if(!legalXI(test))continue;
    const gain=b.aiScore-s.aiScore;
    swaps.push({benchPlayer:b.player,benchPosition:b.position,starter:s.player,starterPosition:s.position,benchScore:b.aiScore,starterScore:s.aiScore,gain,decision:gain>=3?'START BENCH PLAYER':gain>0?'CLOSE':'KEEP CURRENT XI'});
  }
  return swaps.sort((a,b)=>b.gain-a.gain);
}

function clubCounts(squad){const c={};squad.forEach(p=>c[p.team]=(c[p.team]||0)+1);return c}
function legalReplacement(outgoing,incoming,squad,bank){
  if(incoming.position!==outgoing.position||incoming.status!=='a')return false;
  if(squad.some(p=>p.id===incoming.id))return false;
  if(incoming.price>outgoing.sellPrice+bank+.001)return false;
  const c=clubCounts(squad);c[outgoing.team]=(c[outgoing.team]||0)-1;c[incoming.team]=(c[incoming.team]||0)+1;
  return c[incoming.team]<=3;
}
function assetTransferAnalysis(squad,bank){
  const currentIds=new Set(squad.map(p=>p.id)); const clubs=clubCounts(squad); const out=[];
  for(const owned of squad){
    const alternatives=state.players.filter(c=>{
      if(c.position!==owned.position||currentIds.has(c.id)||c.status!=='a'||c.price>owned.sellPrice+bank+.001)return false;
      const newCount=(clubs[c.team]||0)+(c.team===owned.team?0:1);
      return c.team===owned.team||newCount<=3;
    }).map(c=>({...c,improvement:c.transferScore-owned.transferScore}))
      .sort((a,b)=>b.improvement-a.improvement).slice(0,3);
    if(!alternatives.length){
      out.push({decision:'KEEP',owned,replacement:null,improvement:0,reason:'No legal affordable upgrade found'});continue;
    }
    alternatives.forEach((r,i)=>{
      let decision=r.improvement>=7?'SELL':r.improvement>=3?'WATCH':'KEEP';if(i>0)decision='ALT';
      const reasons=[];
      if(r.aiScore>owned.aiScore+3)reasons.push('higher current AI');
      if(r.historicalScore>owned.historicalScore+5)reasons.push('stronger historical record');
      if(r.fixtureScore>owned.fixtureScore+5)reasons.push('better fixtures');
      if(r.expectedOutputScore>owned.expectedOutputScore+5)reasons.push('better expected output');
      if(r.valueScore>owned.valueScore+5)reasons.push('better value');
      if(r.reliabilityScore>owned.reliabilityScore+5)reasons.push('more reliable minutes');
      const cost=r.price-owned.sellPrice;if(cost<0)reasons.push(`releases £${Math.abs(cost).toFixed(1)}m`);
      if(!reasons.length)reasons.push('small overall model improvement');
      out.push({decision,owned,replacement:r,improvement:r.improvement,costDifference:cost,reason:reasons.join(', ')});
    });
  }
  return out;
}
function singleTransferAnalysis(squad,bank){
  const current=bestXIFromSquad(squad);if(!current)return [];
  const results=[];
  for(const outgoing of squad){
    for(const incoming of state.players){
      if(!legalReplacement(outgoing,incoming,squad,bank))continue;
      const test=squad.map(p=>p.id===outgoing.id?{...incoming,slot:outgoing.slot,currentPrice:incoming.price,sellPrice:incoming.price}:p);
      const next=bestXIFromSquad(test);if(!next)continue;
      const xiGain=next.score-current.score;
      const assetImprovement=num(incoming.transferScore)-num(outgoing.transferScore);
      const transferValue=xiGain*.70+assetImprovement*.30;
      results.push({
        outgoing,incoming,costDifference:incoming.price-outgoing.sellPrice,assetImprovement,
        currentXI:current.score,newXI:next.score,xiGain,newFormation:next.formation,transferValue,
        verdict:xiGain>=5?'MAKE TRANSFER':xiGain>=2?'CONSIDER':'ROLL / HOLD'
      });
    }
  }
  return results.sort((a,b)=>b.transferValue-a.transferValue).slice(0,50);
}

function squadWeightedScore(squad){
  const by={};
  for(const pos of ['GKP','DEF','MID','FWD'])by[pos]=squad.filter(p=>p.position===pos).sort((a,b)=>b.aiScore-a.aiScore);
  let best=-Infinity;
  for(const f of FORMATIONS){
    const starters=[by.GKP[0],...by.DEF.slice(0,f.DEF),...by.MID.slice(0,f.MID),...by.FWD.slice(0,f.FWD)].filter(Boolean);
    if(starters.length!==11)continue;
    const ids=new Set(starters.map(p=>p.id));
    const benchGK=by.GKP[1];
    const bench=squad.filter(p=>!ids.has(p.id)&&p.position!=='GKP').sort((a,b)=>b.aiScore-a.aiScore);
    const starting=starters.reduce((s,p)=>s+p.aiScore,0);
    const benchScore=(bench[0]?.aiScore||0)*.25+(bench[1]?.aiScore||0)*.15+(bench[2]?.aiScore||0)*.10+(benchGK?.aiScore||0)*.05;
    const captain=Math.max(...starters.map(p=>p.aiScore));
    best=Math.max(best,starting+captain+benchScore);
  }
  return best;
}
function legalBuiltSquad(squad){
  if(squad.length!==15||squad.reduce((s,p)=>s+p.price,0)>100.001)return false;
  const req={GKP:2,DEF:5,MID:5,FWD:3}, pos={GKP:0,DEF:0,MID:0,FWD:0};
  squad.forEach(p=>pos[p.position]++);
  for(const k in req)if(pos[k]!==req[k])return false;
  return Object.values(clubCounts(squad)).every(c=>c<=3);
}
function buildOptimisedSquad(){
  const candidates=state.players.filter(p=>p.status==='a');
  const req={GKP:2,DEF:5,MID:5,FWD:3};let squad=[];
  for(const position in req){
    const list=candidates.filter(p=>p.position===position).sort((a,b)=>a.price-b.price||b.aiScore-a.aiScore);
    let needed=req[position];
    for(const p of list){
      if(!needed)break;const test=[...squad,p];if((clubCounts(test)[p.team]||0)<=3){squad.push(p);needed--}
    }
  }
  const top={};for(const pos of Object.keys(req))top[pos]=candidates.filter(p=>p.position===pos).sort((a,b)=>b.aiScore-a.aiScore).slice(0,15);
  const alternatives=(cur,s,limit)=>top[cur.position].filter(c=>c.id!==cur.id&&!s.some(x=>x.id===c.id)).slice(0,limit);
  let improved=true,passes=0;
  while(improved&&passes<12){
    improved=false;passes++;let bestScore=squadWeightedScore(squad),bestSquad=null;
    for(let i=0;i<squad.length;i++)for(const r of alternatives(squad[i],squad,10)){
      const t=[...squad];t[i]=r;if(!legalBuiltSquad(t))continue;const sc=squadWeightedScore(t);
      if(sc>bestScore+.001){bestScore=sc;bestSquad=t}
    }
    for(let i=0;i<squad.length;i++)for(let j=i+1;j<squad.length;j++){
      for(const a of alternatives(squad[i],squad,6))for(const b of alternatives(squad[j],squad,6)){
        if(a.id===b.id)continue;const t=[...squad];t[i]=a;t[j]=b;if(new Set(t.map(p=>p.id)).size!==15||!legalBuiltSquad(t))continue;
        const sc=squadWeightedScore(t);if(sc>bestScore+.001){bestScore=sc;bestSquad=t}
      }
    }
    if(bestSquad){squad=bestSquad;improved=true}
  }
  return squad;
}

function runWeeklyAnalysis(){
  const squad=selectedSquad(), errors=validateSquad(squad);
  if(errors.length){showTeamValidation(errors);toast('Complete a legal 15-player squad first.');return}
  state.weekly=bestXIFromSquad(squad);state.benchSwaps=analyseBench(squad);
  state.assetTransfers=assetTransferAnalysis(squad,state.bank);state.singleTransfers=singleTransferAnalysis(squad,state.bank);
  renderAll();toast('Weekly analysis complete');
}

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function tag(text,cls='neutral'){return `<span class="tag ${cls}">${esc(text)}</span>`}
let sortableTableCounter=0;
function table(headers,rows){
  if(!rows.length)return '<div class="notice">No results.</div>';
  const id=`sortable-table-${++sortableTableCounter}`;
  const head=headers.map((h,i)=>`<th><button type="button" class="sort-head" data-sort-table="${id}" data-sort-col="${i}" aria-label="Sort by ${esc(h)}">${esc(h)} <span class="sort-indicator">↕</span></button></th>`).join('');
  const body=rows.map(r=>`<tr>${r.map(c=>`<td class="${typeof c==='number'?'num':''}">${typeof c==='object'&&c?.html?c.html:esc(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table id="${id}" class="sortable-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function bindSortableTables(root=document){
  root.querySelectorAll('.sort-head').forEach(btn=>{
    if(btn.dataset.bound==='1')return;
    btn.dataset.bound='1';
    btn.addEventListener('click',()=>{
      const tableEl=document.getElementById(btn.dataset.sortTable);
      if(!tableEl)return;
      const col=Number(btn.dataset.sortCol);
      const tbody=tableEl.tBodies[0];
      const rows=[...tbody.rows];
      const previous=tableEl.dataset.sortCol===String(col)?tableEl.dataset.sortDir:'';
      const dir=previous==='asc'?'desc':'asc';
      const valueOf=cell=>{
        const raw=(cell?.textContent||'').trim();
        const clean=raw.replace(/[£,%+]/g,'').replace(/,/g,'');
        if(clean!=='' && /^-?\d+(\.\d+)?$/.test(clean)) return {type:'num',value:Number(clean)};
        return {type:'text',value:raw.toLowerCase()};
      };
      rows.sort((a,b)=>{
        const av=valueOf(a.cells[col]), bv=valueOf(b.cells[col]);
        let cmp;
        if(av.type==='num'&&bv.type==='num') cmp=av.value-bv.value;
        else cmp=String(av.value).localeCompare(String(bv.value),undefined,{numeric:true,sensitivity:'base'});
        return dir==='asc'?cmp:-cmp;
      });
      rows.forEach(r=>tbody.appendChild(r));
      tableEl.dataset.sortCol=String(col);
      tableEl.dataset.sortDir=dir;
      tableEl.querySelectorAll('.sort-indicator').forEach(x=>x.textContent='↕');
      const ind=btn.querySelector('.sort-indicator');
      if(ind)ind.textContent=dir==='asc'?'▲':'▼';
    });
  });
}
function renderAll(){
  renderDashboard();renderTeamEditor();renderWeekly();renderTransfers();renderPlayers();renderBuilder();renderSettings();
  bindSortableTables();
}
function renderDashboard(){
  const squad=selectedSquad();$('#dashPlayers').textContent=squad.length;$('#dashBank').textContent=fmt(state.bank,1);
  $('#dashFormation').textContent=state.weekly?.formation||'—';
  const best=state.singleTransfers[0];
  $('#dashTransfer').textContent=best?`${best.outgoing.player} → ${best.incoming.player}`:'—';
  $('#dashTransferMeta').textContent=best?`XI +${fmt(best.xiGain)} • Transfer Value ${fmt(best.transferValue)} • ${best.verdict}`:'Run weekly analysis.';
  const warnings=[];
  const errors=validateSquad(squad);if(errors.length)warnings.push(`<div class="notice warn"><b>Team incomplete:</b> ${esc(errors[0])}</div>`);
  const b=state.benchSwaps.find(x=>x.gain>0);if(b)warnings.push(`<div class="notice good"><b>Bench opportunity:</b> ${esc(b.benchPlayer)} can replace ${esc(b.starter)} for +${fmt(b.gain)} AI.</div>`);
  $('#dashboardWarnings').innerHTML=warnings.join('');
}
function renderTeamEditor(){
  if(!state.players.length){$('#teamEditor').innerHTML='<div class="notice">Refresh live FPL data first.</div>';return}
  $('#bankInput').value=state.bank;
  const groups={GKP:[],DEF:[],MID:[],FWD:[]};SLOTS.forEach((s,i)=>groups[s[1]].push([s[0],i]));
  $('#teamEditor').innerHTML=Object.entries(groups).map(([pos,slots])=>{
    const opts=state.players.filter(p=>p.position===pos).sort((a,b)=>a.player.localeCompare(b.player));
    return `<div class="position-card"><h3>${pos}<span class="muted">${slots.length} slots</span></h3>${slots.map(([label,i])=>{
      const id=state.team[i];const p=state.players.find(x=>x.id===Number(id));const sell=p?(state.sellPrices[p.id]??p.price):'';
      return `<div class="slot-row"><span class="pos">${label}</span><select data-team-index="${i}"><option value="">Select player…</option>${opts.map(o=>`<option value="${o.id}" ${o.id===Number(id)?'selected':''}>${esc(o.player)} [${esc(o.team)}] — £${fmt(o.price,1)}</option>`).join('')}</select><span class="price">${p?'£'+fmt(p.price,1):'—'}</span><input data-sell-id="${p?.id||''}" type="number" step="0.1" min="3" max="20" value="${p?fmt(sell,1):''}" ${p?'':'disabled'} title="Selling price"></div>`;
    }).join('')}</div>`;
  }).join('');
  $$('[data-team-index]').forEach(el=>el.addEventListener('change',e=>{
    const i=Number(e.target.dataset.teamIndex),old=state.team[i],id=e.target.value?Number(e.target.value):null;
    state.team[i]=id;if(id&&!state.sellPrices[id])state.sellPrices[id]=state.players.find(p=>p.id===id)?.price||0;
    if(old&&old!==id&&!state.team.includes(old)) delete state.sellPrices[old];
    state.weekly=null;state.benchSwaps=[];state.assetTransfers=[];state.singleTransfers=[];saveState();renderAll();
  }));
  $$('[data-sell-id]').forEach(el=>el.addEventListener('change',e=>{const id=Number(e.target.dataset.sellId);state.sellPrices[id]=num(e.target.value);saveState();}));
  showTeamValidation(validateSquad(selectedSquad()));
}
function showTeamValidation(errors){
  const el=$('#teamValidation');if(!el)return;
  el.innerHTML=errors.length?`<div class="notice warn">${errors.map(esc).join('<br>')}</div>`:`<div class="notice good">Legal 15-player squad selected.</div>`;
}
function renderWeekly(){
  if(!state.weekly){$('#weeklySummary').innerHTML='<article class="card">Run Weekly Analysis.</article>';$('#startingXI').innerHTML='';$('#benchList').innerHTML='';$('#benchSwaps').innerHTML='';return}
  $('#weeklySummary').innerHTML=`<article class="card"><div class="eyebrow">Formation</div><div class="big-number">${esc(state.weekly.formation)}</div></article><article class="card"><div class="eyebrow">XI score</div><div class="big-number">${fmt(state.weekly.score)}</div></article><article class="card"><div class="eyebrow">Bench best swap</div><div class="big-number">${state.benchSwaps[0]?fmt(state.benchSwaps[0].gain):'—'}</div></article>`;
  const list=arr=>`<div class="player-list">${arr.map(p=>`<div class="player-pill"><span class="pos">${p.position}</span><span>${esc(p.player)} <span class="muted">(${esc(p.team)})</span></span><span class="score">${fmt(p.aiScore)}</span><span class="muted">${esc(p.fixture1)}</span></div>`).join('')}</div>`;
  $('#startingXI').innerHTML=list(state.weekly.starters);$('#benchList').innerHTML=list(state.weekly.bench);
  $('#benchSwaps').innerHTML=table(['Bench','Pos','Replace','Starter Pos','Bench AI','Starter AI','Gain','Decision'],state.benchSwaps.slice(0,30).map(x=>[x.benchPlayer,x.benchPosition,x.starter,x.starterPosition,Number(fmt(x.benchScore)),Number(fmt(x.starterScore)),Number(fmt(x.gain)),{html:tag(x.decision,x.decision==='START BENCH PLAYER'?'good':x.decision==='CLOSE'?'warn':'neutral')}]));
  bindSortableTables($('#benchSwaps'));
}
function renderTransfers(){
  $('#singleTransfers').innerHTML=table(
    ['Rank','Sell','Buy','Pos','Sell £m','Buy £m','Cost Δ','Asset Improvement','Current XI','New XI','GW XI Gain','New Formation','Transfer Value','Buy Media','Media Index','Next Fixture','Verdict'],
    state.singleTransfers.map((x,i)=>[
      i+1,x.outgoing.player,x.incoming.player,x.outgoing.position,Number(fmt(x.outgoing.sellPrice,1)),Number(fmt(x.incoming.price,1)),
      Number(fmt(x.costDifference,1)),Number(fmt(x.assetImprovement)),Number(fmt(x.currentXI)),Number(fmt(x.newXI)),Number(fmt(x.xiGain)),
      x.newFormation,Number(fmt(x.transferValue)),x.incoming.mediaArticles,Number(fmt(x.incoming.mediaActivityIndex,0)),x.incoming.fixture1,
      {html:tag(x.verdict,x.verdict==='MAKE TRANSFER'?'good':x.verdict==='CONSIDER'?'warn':'neutral')}
    ])
  );
  $('#assetTransfers').innerHTML=table(
    ['Decision','Your Player','Pos','Sell £m','Current AI','History','Transfer Score','Replacement','Buy £m','Replacement Score','Improvement','Media Articles','Media Index','Reason'],
    state.assetTransfers.map(x=>[
      x.decision,x.owned.player,x.owned.position,Number(fmt(x.owned.sellPrice,1)),Number(fmt(x.owned.aiScore)),Number(fmt(x.owned.historicalScore)),
      Number(fmt(x.owned.transferScore)),x.replacement?.player||'',x.replacement?Number(fmt(x.replacement.price,1)):'',x.replacement?Number(fmt(x.replacement.transferScore)):'',
      Number(fmt(x.improvement)),x.replacement?.mediaArticles||0,Number(fmt(x.replacement?.mediaActivityIndex||0,0)),x.reason
    ])
  );
  bindSortableTables($('#singleTransfers'));
  bindSortableTables($('#assetTransfers'));
}
function renderPlayers(){
  if(!state.players.length){$('#playerTable').innerHTML='<div class="notice">Refresh live data first.</div>';return}
  const q=($('#playerSearch')?.value||'').toLowerCase(),pos=$('#positionFilter')?.value||'';
  const rows=state.players.filter(p=>(!pos||p.position===pos)&&(!q||`${p.player} ${p.team}`.toLowerCase().includes(q))).sort((a,b)=>b.aiScore-a.aiScore).slice(0,250);
  $('#playerTable').innerHTML=table(
    ['Player','Team','Pos','£m','Pts','PPG','xGI','Fixtures Avg','AI','History','Confidence','Transfer Score','Media Articles','Sources','Media Index','24h','72h','Media Status','Status'],
    rows.map(p=>[
      p.player,p.team,p.position,Number(fmt(p.price,1)),p.totalPoints,Number(fmt(p.ppg)),Number(fmt(p.xgi)),
      p.avgDifficulty===null?'':Number(fmt(p.avgDifficulty)),Number(fmt(p.aiScore)),Number(fmt(p.historicalScore)),
      `${Math.round(p.historyConfidence*100)}%`,Number(fmt(p.transferScore)),
      p.mediaArticles,p.mediaUniqueSources,Number(fmt(p.mediaActivityIndex,0)),p.mediaLast24h,p.mediaLast72h,
      {html:tag(p.mediaStatus,p.mediaStatus==='HIGH'?'bad':p.mediaStatus==='ELEVATED'?'warn':'neutral')},p.status
    ])
  );
  bindSortableTables($('#playerTable'));
}
function renderBuilder(){
  if(!state.builder){$('#builderOutput').innerHTML='<div class="notice">Click Build Optimised Squad.</div>';return}
  const cost=state.builder.reduce((s,p)=>s+p.price,0),best=bestXIFromSquad(state.builder);
  $('#builderOutput').innerHTML=`<div class="hero-grid compact"><article class="card"><div class="eyebrow">Cost</div><div class="big-number">£${fmt(cost,1)}m</div></article><article class="card"><div class="eyebrow">Best formation</div><div class="big-number">${best?.formation||'—'}</div></article><article class="card"><div class="eyebrow">Weighted score</div><div class="big-number">${fmt(squadWeightedScore(state.builder))}</div></article></div>`+
  table(['Pos','Player','Team','£m','AI','Media Index','Next Fixture'],state.builder.sort((a,b)=>['GKP','DEF','MID','FWD'].indexOf(a.position)-['GKP','DEF','MID','FWD'].indexOf(b.position)||b.aiScore-a.aiScore).map(p=>[p.position,p.player,p.team,Number(fmt(p.price,1)),Number(fmt(p.aiScore)),Number(fmt(p.mediaActivityIndex||0,0)),p.fixture1]));
  bindSortableTables($('#builderOutput'));
}
function renderSettings(){}
function bind(){
  $$('.tab').forEach(b=>b.addEventListener('click',()=>{$$('.tab').forEach(x=>x.classList.remove('active'));$$('.page').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(`#tab-${b.dataset.tab}`).classList.add('active')}));
  $('#refreshLiveBtn').addEventListener('click',refreshLive);$('#refreshHistoryBtn').addEventListener('click',refreshHistory);
  $('#runWeeklyBtn').addEventListener('click',runWeeklyAnalysis);$('#weeklyOnlyBtn').addEventListener('click',()=>{const s=selectedSquad(),e=validateSquad(s);if(e.length)return showTeamValidation(e);state.weekly=bestXIFromSquad(s);state.benchSwaps=analyseBench(s);renderAll();toast('Weekly plan recalculated')});
  $('#transferOnlyBtn').addEventListener('click',()=>{const s=selectedSquad(),e=validateSquad(s);if(e.length)return showTeamValidation(e);state.assetTransfers=assetTransferAnalysis(s,state.bank);state.singleTransfers=singleTransferAnalysis(s,state.bank);renderAll();toast('Transfers analysed')});
  $('#clearTeamBtn').addEventListener('click',()=>{state.team=Array(15).fill(null);state.sellPrices={};state.bank=0;state.weekly=null;state.benchSwaps=[];state.assetTransfers=[];state.singleTransfers=[];saveState();renderAll();toast('Team cleared')});
  $('#bankInput').addEventListener('change',e=>{state.bank=num(e.target.value);saveState();renderDashboard()});
  $('#playerSearch').addEventListener('input',renderPlayers);$('#positionFilter').addEventListener('change',renderPlayers);
  $('#buildSquadBtn').addEventListener('click',()=>{if(!state.players.length)return toast('Refresh live data first.');setStatus('Optimising £100m squad…');setTimeout(()=>{state.builder=buildOptimisedSquad();renderBuilder();setStatus('Squad optimisation complete.');toast('Optimised squad built')},20)});
  $('#clearCacheBtn').addEventListener('click',async()=>{state.history={};attachHistoricalTransferScores();renderAll();toast('In-memory history cleared; click Refresh History to reload the published snapshot.')});
}
async function init(){
  loadState();bind();renderAll();$('#bankInput').value=state.bank;
  await refreshLive();
}
init();
