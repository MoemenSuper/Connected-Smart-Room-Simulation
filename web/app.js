// ====================== FIREBASE CONFIG ======================
const firebaseConfig = {
  apiKey: "AIzaSyADPTCXrgHgYMTNg5miTyZonTOfBfOS9aA",
  authDomain: "simulation-8d577.firebaseapp.com",
  databaseURL: "https://simulation-8d577-default-rtdb.firebaseio.com",
  authDatabaseURL: "https://simulation-8d577-default-rtdb.firebaseio.com",
  projectId: "simulation-8d577",
  storageBucket: "simulation-8d577.firebasestorage.app",
  messagingSenderId: "287966730234",
  appId: "1:287966730234:web:8be9c696cea6c7d4cc7643"
};
// =============================================================

const PATH_BASE    = "smart-room";
const PATH_SENSORS = `${PATH_BASE}/sensors`;
const PATH_LOGS    = `${PATH_BASE}/logs`;
const PATH_EVENTS  = `${PATH_BASE}/events`;
const TICK_MS      = 3000;
const MAX_LOGS     = 50;

const rulesMeta = [
  { id:"R1", priority:"HAUTE",    conditionText:"Absence détectée pendant 10 ticks consécutifs (50s)", actionText:"LED OFF — Extinction auto éclairage",  evaluator:(s)=>s.noPresenceTicks>=10 },
  { id:"R2", priority:"CRITIQUE", conditionText:"Température > 30°C",                                  actionText:"BUZZER ON — Alerte thermique",          evaluator:(s)=>s.temperature>30 },
  { id:"R3", priority:"NORMALE",  conditionText:"Présence = true ET luminosité < 200 lux",             actionText:"LED ON — Allumage intelligent",         evaluator:(s)=>s.presence===true&&s.luminosity<200 },
  { id:"R4", priority:"NORMALE",  conditionText:"Température < 16°C",                                  actionText:"Alerte Froid — Notification confort",   evaluator:(s)=>s.temperature<16 },
  { id:"R5", priority:"NORMALE",  conditionText:"Humidité > 85%",                                      actionText:"Log & Alerte — Prévention moisissure",  evaluator:(s)=>s.humidity>85 }
];

const rulesState = { R1:false, R2:false, R3:false, R4:false, R5:false };
const runtime = {
  started:false,
  noPresenceTicks:0,
  last:{ temperature:22, humidity:55, luminosity:300, presence:false },
  previousDisplay:null,
  scenario:{ name:"normal", ticksLeft:0 }
};
const seenEventIds = new Set();
let app=null, db=null, tempHumChart=null, lumChart=null;

const dom = {
  firebaseDot:   document.getElementById("firebaseDot"),
  firebaseLabel: document.getElementById("firebaseLabel"),
  lastUpdatedLabel: document.getElementById("lastUpdatedLabel"),
  tempValue:     document.getElementById("tempValue"),
  humValue:      document.getElementById("humValue"),
  presenceValue: document.getElementById("presenceValue"),
  lumValue:      document.getElementById("lumValue"),
  tempTrend:     document.getElementById("tempTrend"),
  humTrend:      document.getElementById("humTrend"),
  presenceTrend: document.getElementById("presenceTrend"),
  lumTrend:      document.getElementById("lumTrend"),
  tempState:     document.getElementById("tempState"),
  humState:      document.getElementById("humState"),
  presenceState: document.getElementById("presenceState"),
  lumState:      document.getElementById("lumState"),
  rulesGrid:     document.getElementById("rulesGrid"),
  eventList:     document.getElementById("eventList")
};

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function randomWalk(cur,step,min,max){ return clamp(cur+(Math.random()*2-1)*step,min,max); }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

function pickScenario(){
  const r = Math.random();
  if(r < 0.15) return { name:"hot", ticksLeft:randInt(4,8) };
  if(r < 0.30) return { name:"cold", ticksLeft:randInt(4,8) };
  if(r < 0.48) return { name:"humid", ticksLeft:randInt(4,9) };
  if(r < 0.66) return { name:"dark", ticksLeft:randInt(4,8) };
  return { name:"normal", ticksLeft:randInt(3,6) };
}

function scenarioTargets(name){
  if(name==="hot")   return { temp:32.0, humidity:52.0, luminosity:420 };
  if(name==="cold")  return { temp:14.5, humidity:62.0, luminosity:250 };
  if(name==="humid") return { temp:24.0, humidity:88.0, luminosity:240 };
  if(name==="dark")  return { temp:22.5, humidity:60.0, luminosity:120 };
  return { temp:22.5, humidity:57.0, luminosity:320 };
}

function evolveSensor(cur, target, pull, noise, min, max){
  return clamp(cur + (target - cur) * pull + (Math.random()*2-1) * noise, min, max);
}

function nextPresence(currentPresence, absentTicks, scenarioName){
  let switchProb;
  if(currentPresence){
    switchProb = scenarioName==="dark" ? 0.13 : 0.10;
  }else{
    if(absentTicks >= 12) switchProb = 0.38;
    else if(absentTicks >= 9) switchProb = 0.22;
    else if(absentTicks >= 6) switchProb = 0.14;
    else switchProb = 0.09;
    if(scenarioName==="dark") switchProb += 0.05;
  }
  return Math.random() < switchProb ? !currentPresence : currentPresence;
}

function setFirebaseStatus(ok,text){
  dom.firebaseDot.className = "conn-dot " + (ok?"connected":"disconnected");
  dom.firebaseLabel.textContent = text;
}

function updateLastUpdated(ts){
  if(!dom.lastUpdatedLabel) return;
  dom.lastUpdatedLabel.textContent = "Dernière mise à jour: " + toTimeLabel(ts);
}

function placeholderConfigDetected(){
  return Object.values(firebaseConfig).some(v=>typeof v==="string"&&v.includes("YOUR_"));
}

function priorityClass(p){
  if(p==="CRITIQUE") return "priority-critical";
  if(p==="HAUTE")    return "priority-high";
  return "priority-normal";
}

function initRuleCards(){
  dom.rulesGrid.innerHTML="";
  for(const rule of rulesMeta){
    const card = document.createElement("article");
    card.className = "rule-card";
    card.id = `rule-${rule.id}`;
    card.innerHTML = `
      <div class="rule-head">
        <span class="rule-id">${rule.id}</span>
        <span class="priority-badge ${priorityClass(rule.priority)}">${rule.priority}</span>
      </div>
      <div class="rule-condition">${rule.conditionText}</div>
      <div class="rule-action">${rule.actionText}</div>
      <div class="rule-progress-meta">
        <span>Proximite</span>
        <span id="progressText-${rule.id}">0%</span>
      </div>
      <div class="rule-progress-track">
        <div id="progressFill-${rule.id}" class="rule-progress-fill ${rule.priority==="CRITIQUE"?"critical":(rule.priority==="HAUTE"?"high":"normal")}"></div>
      </div>
      <span class="rule-status standby" id="status-${rule.id}">VEILLE</span>
    `;
    dom.rulesGrid.appendChild(card);
  }
}

function getRuleProgress(ruleId, s){
  const pct = (v)=>Math.max(0, Math.min(100, v));
  if(ruleId==="R1"){
    const ratio = pct((s.noPresenceTicks/10)*100);
    return { ratio, text: `${Math.min(10,s.noPresenceTicks)}/10 ticks` };
  }
  if(ruleId==="R2"){
    const ratio = pct((s.temperature/30)*100);
    return { ratio, text: `${s.temperature.toFixed(1)} / 30C` };
  }
  if(ruleId==="R3"){
    if(!s.presence) return { ratio: 0, text: "presence requise" };
    const ratio = s.luminosity < 200 ? 100 : pct(((350 - s.luminosity) / 150) * 100);
    return { ratio, text: `${Math.round(s.luminosity)} / 200 lux` };
  }
  if(ruleId==="R4"){
    const ratio = s.temperature <= 16 ? 100 : pct(((26 - s.temperature) / 10) * 100);
    return { ratio, text: `${s.temperature.toFixed(1)} / 16C` };
  }
  if(ruleId==="R5"){
    const ratio = s.humidity >= 85 ? 100 : pct(((s.humidity - 55) / 30) * 100);
    return { ratio, text: `${s.humidity.toFixed(1)} / 85%` };
  }
  return { ratio: 0, text: "0%" };
}

function updateRuleCards(activeMap, sensorState){
  for(const rule of rulesMeta){
    const chip = document.getElementById(`status-${rule.id}`);
    const card = document.getElementById(`rule-${rule.id}`);
    if(!chip||!card) continue;
    const active = !!activeMap[rule.id];
    chip.textContent = active ? "ACTIVE" : "VEILLE";
    chip.classList.toggle("active",  active);
    chip.classList.toggle("standby", !active);
    card.classList.toggle("rule-active", active);

    if(sensorState){
      const progress = getRuleProgress(rule.id, sensorState);
      const fill = document.getElementById(`progressFill-${rule.id}`);
      const txt = document.getElementById(`progressText-${rule.id}`);
      if(fill) fill.style.width = `${progress.ratio.toFixed(1)}%`;
      if(txt) txt.textContent = `${Math.round(progress.ratio)}% · ${progress.text}`;
    }
  }
}

function setTrend(el, direction, marker){
  if(!el) return;
  el.className = "sensor-trend " + direction;
  el.textContent = marker;
}

function updateSensorCards(s){
  const prev = runtime.previousDisplay;
  if(!prev){
    setTrend(dom.tempTrend, "flat", "->");
    setTrend(dom.humTrend, "flat", "->");
    setTrend(dom.presenceTrend, "flat", "->");
    setTrend(dom.lumTrend, "flat", "->");
  }else{
    const td = s.temperature - prev.temperature;
    const hd = s.humidity - prev.humidity;
    const ld = s.luminosity - prev.luminosity;
    const presenceChanged = s.presence !== prev.presence;
    setTrend(dom.tempTrend, td > 0.05 ? "up" : td < -0.05 ? "down" : "flat", td > 0.05 ? "↑" : td < -0.05 ? "↓" : "->");
    setTrend(dom.humTrend,  hd > 0.05 ? "up" : hd < -0.05 ? "down" : "flat", hd > 0.05 ? "↑" : hd < -0.05 ? "↓" : "->");
    setTrend(dom.lumTrend,  ld > 0.5  ? "up" : ld < -0.5  ? "down" : "flat", ld > 0.5  ? "↑" : ld < -0.5  ? "↓" : "->");
    if(presenceChanged) setTrend(dom.presenceTrend, s.presence ? "up" : "down", s.presence ? "↑" : "↓");
    else setTrend(dom.presenceTrend, "flat", "->");
  }

  function flashVal(el, txt) {
    el.textContent = txt;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  flashVal(dom.tempValue,     `${s.temperature.toFixed(1)} °C`);
  flashVal(dom.humValue,      `${s.humidity.toFixed(1)} %`);
  flashVal(dom.presenceValue, s.presence ? "Détectée" : "Absente");
  flashVal(dom.lumValue,      `${Math.round(s.luminosity)} lux`);

  dom.tempValue.className  = "sensor-value";
  dom.humValue.className   = "sensor-value";
  dom.presenceValue.className = "sensor-value";
  dom.lumValue.className   = "sensor-value";

  dom.tempState.textContent  = s.temperature>30?"Critique":s.temperature>28?"Élevée":"Normale";
  dom.humState.textContent   = s.humidity>85?"Critique":s.humidity>80?"Élevée":"Normale";
  dom.presenceState.textContent = s.presence?"Occupée":"Inoccupée";
  dom.lumState.textContent   = s.luminosity<200?"Faible":"Normale";

  if(s.temperature>30)      dom.tempValue.classList.add("danger");
  else if(s.temperature>28) dom.tempValue.classList.add("warn");
  else                      dom.tempValue.classList.add("ok");

  if(s.humidity>85)      dom.humValue.classList.add("danger");
  else if(s.humidity>80) dom.humValue.classList.add("warn");
  else                   dom.humValue.classList.add("ok");

  dom.presenceValue.classList.add(s.presence?"ok":"warn");
  if(s.luminosity<200) dom.lumValue.classList.add("warn");
  else                 dom.lumValue.classList.add("ok");

  runtime.previousDisplay = { ...s };
  updateLastUpdated(Date.now());
}

function toTimeLabel(ts){
  return new Date(ts).toLocaleTimeString("fr-FR",{hour12:false});
}

function initCharts(){
  const chartDefaults = {
    responsive:true, maintainAspectRatio:false,
    animation:{ duration:220 },
    plugins:{ legend:{ labels:{ color:"#8888a0", font:{ family:"DM Mono, monospace", size:11 } } } },
    scales:{
      x:{ ticks:{ color:"#5c5c6e", font:{ family:"DM Mono, monospace", size:10 }, maxRotation:0, autoSkip:true, maxTicksLimit:8 }, grid:{ color:"rgba(255,255,255,0.04)" } },
      y:{ ticks:{ color:"#5c5c6e", font:{ family:"DM Mono, monospace", size:10 } }, grid:{ color:"rgba(255,255,255,0.04)" } }
    }
  };

  tempHumChart = new Chart(document.getElementById("tempHumChart"),{
    type:"line",
    data:{
      labels:[],
      datasets:[
        { label:"Température (°C)", data:[], borderColor:"#c8ff57", backgroundColor:"rgba(200,255,87,0.06)", borderWidth:1.5, pointRadius:0, tension:0.4, fill:true },
        { label:"Humidité (%)",     data:[], borderColor:"#57ffd8", backgroundColor:"rgba(87,255,216,0.05)", borderWidth:1.5, pointRadius:0, tension:0.4, fill:true }
      ]
    },
    options: chartDefaults
  });

  lumChart = new Chart(document.getElementById("lumChart"),{
    type:"bar",
    data:{
      labels:[],
      datasets:[
        { label:"Luminosité (lux)", data:[], borderColor:"rgba(200,255,87,0.6)", backgroundColor:"rgba(200,255,87,0.12)", borderWidth:1, borderRadius:3 }
      ]
    },
    options: chartDefaults
  });
}

function renderEvents(entries){
  dom.eventList.innerHTML="";
  if(!entries.length){
    const e = document.createElement("div");
    e.className="empty"; e.textContent="Aucun événement déclenché pour le moment.";
    dom.eventList.appendChild(e); return;
  }
  for(const item of entries){
    const div = document.createElement("article");
    div.className="event-item";
    if(item.priority==="CRITIQUE" || item.rule==="R2") div.classList.add("critical");
    if(seenEventIds.has(item.id)) div.style.animation="none";
    else seenEventIds.add(item.id);
    div.innerHTML=`
      <div class="event-top">
        <span class="event-time">${toTimeLabel(item.timestamp)}</span>
        <span class="event-rule">${item.rule}</span>
        <span class="priority-badge ${priorityClass(item.priority)}">${item.priority}</span>
      </div>
      <div class="event-main">${item.condition} → ${item.action}</div>
    `;
    dom.eventList.appendChild(div);
  }
}

function evaluateAndHandleRules(sv){
  const input = { ...sv, noPresenceTicks:runtime.noPresenceTicks };
  const next  = {};
  for(const rule of rulesMeta){
    const activeNow = !!rule.evaluator(input);
    next[rule.id] = activeNow;
    if(activeNow && !rulesState[rule.id] && db){
      db.ref(PATH_EVENTS).push({ timestamp:Date.now(), rule:rule.id, condition:rule.conditionText, action:rule.actionText, priority:rule.priority }).catch(()=>setFirebaseStatus(false,"Firebase: ERREUR ÉCRITURE"));
    }
  }
  for(const id of Object.keys(rulesState)) rulesState[id]=!!next[id];
  updateRuleCards(rulesState, input);
}

async function pruneOldLogs(){
  if(!db) return;
  try{
    const snap = await db.ref(PATH_LOGS).orderByKey().once("value");
    const keys = Object.keys(snap.val()||{});
    if(keys.length<=MAX_LOGS) return;
    const upd={};
    for(const k of keys.slice(0,keys.length-MAX_LOGS)) upd[`${PATH_LOGS}/${k}`]=null;
    await db.ref().update(upd);
  }catch(_){ }
}

async function simulationTick(){
  if(!db) return;
  const c = runtime.last;
  if(runtime.scenario.ticksLeft<=0) runtime.scenario = pickScenario();
  const mode = runtime.scenario.name;
  runtime.scenario.ticksLeft -= 1;
  const targets = scenarioTargets(mode);
  const next = {
    temperature: Number(evolveSensor(c.temperature, targets.temp, 0.30, 0.46, 15, 35).toFixed(1)),
    humidity:    Number(evolveSensor(c.humidity, targets.humidity, 0.26, 0.85, 30, 90).toFixed(1)),
    luminosity:  Math.round(evolveSensor(c.luminosity, targets.luminosity, 0.34, 24, 50, 800)),
    presence:    nextPresence(c.presence, runtime.noPresenceTicks, mode)
  };
  runtime.last = next;
  runtime.noPresenceTicks = next.presence ? 0 : runtime.noPresenceTicks+1;
  try{
    await db.ref(PATH_SENSORS).set(next);
    await db.ref(PATH_LOGS).push({ ...next, timestamp:Date.now() });
    await pruneOldLogs();
    evaluateAndHandleRules(next);
  }catch(_){ setFirebaseStatus(false,"Firebase: ERREUR SIMULATION"); }
}

function attachRealtimeListeners(){
  db.ref(".info/connected").on("value",(s)=>setFirebaseStatus(s.val()===true,"Firebase: "+(s.val()?"CONNECTÉ":"DÉCONNECTÉ")));

  db.ref(PATH_SENSORS).on("value",(snap)=>{
    const s=snap.val(); if(!s) return;
    const sensorState = { temperature:Number(s.temperature??22), humidity:Number(s.humidity??55), luminosity:Number(s.luminosity??300), presence:Boolean(s.presence) };
    updateSensorCards(sensorState);
    updateRuleCards(rulesState, { ...sensorState, noPresenceTicks: runtime.noPresenceTicks });
  });

  db.ref(PATH_LOGS).orderByChild("timestamp").limitToLast(20).on("value",(snap)=>{
    const arr=Object.values(snap.val()||{}).sort((a,b)=>a.timestamp-b.timestamp);
    const labels=arr.map(r=>toTimeLabel(r.timestamp));
    tempHumChart.data.labels=labels;
    tempHumChart.data.datasets[0].data=arr.map(r=>Number(r.temperature));
    tempHumChart.data.datasets[1].data=arr.map(r=>Number(r.humidity));
    tempHumChart.update("none");
    lumChart.data.labels=labels;
    lumChart.data.datasets[0].data=arr.map(r=>Number(r.luminosity));
    lumChart.update("none");
  });

  db.ref(PATH_EVENTS).orderByChild("timestamp").limitToLast(10).on("value",(snap)=>{
    renderEvents(Object.entries(snap.val()||{}).map(([id,v])=>({id,...v})).sort((a,b)=>b.timestamp-a.timestamp));
  });
}

function startSimulationLoop(){
  if(runtime.started) return;
  runtime.started=true;
  simulationTick();
  setInterval(simulationTick,TICK_MS);
}

function boot(){
  initRuleCards(); initCharts();
  if(placeholderConfigDetected()){ setFirebaseStatus(false,"Firebase: CONFIG MANQUANTE"); return; }
  // Animate boot status text
  const bootStatus = document.getElementById('bootStatus');
  const bootSteps = ["Connexion Firebase...", "Chargement des règles...", "Démarrage simulation...", "Système opérationnel"];
  let si = 0;
  const bootInterval = setInterval(() => {
    si++;
    if(si < bootSteps.length && bootStatus) bootStatus.textContent = bootSteps[si];
    if(si >= bootSteps.length - 1) clearInterval(bootInterval);
  }, 550);
  try{
    app = firebase.initializeApp(firebaseConfig);
    db  = firebase.database(app);
    attachRealtimeListeners();
    startSimulationLoop();
  }catch(_){ setFirebaseStatus(false,"Firebase: INITIALISATION ÉCHOUÉE"); }
}

boot();
