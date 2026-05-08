/**
 * JARVIS EPC — CalcView  ·  Engineering Calculator & Analysis
 *
 * v4.28.0 — Denver Engineering Suite integration
 * Two top-level panels:
 *   1. EPC Calculators  — EVM, Schedule, Manpower, Unit Rate  (preserved)
 *   2. Engineering Tools — Denver Suite iframes (WWTP, AquaSimPro, MEP, Stormwater, P&ID)
 */
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useBizStore } from '../modules/biz/store'
import { KpiCard } from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface CalcViewProps { policy?: Partial<PolicyConfig> }

// ─── Top-level panel ──────────────────────────────────────────────────────────
type Panel = 'epc' | 'engineering'

// ─── EPC calculator modes (existing) ─────────────────────────────────────────
type CalcMode = 'evm' | 'schedule' | 'manpower' | 'unit'

// ─── Denver tool registry ─────────────────────────────────────────────────────
interface DenverTool {
  id: string; name: string; description: string
  path: string; icon: string
  domain: 'water' | 'mep' | 'stormwater' | 'pid'
  version: string
}

const DENVER_TOOLS: DenverTool[] = [
  { id:'wwtp',         name:'WWTP DesignPro',  description:'ASM1/2d/3 biomodels, BNR, MBR, sludge, EPA compliance',            path:'/tools/denver/WWTP-DesignPro-v5_0-MCP-API.html',     icon:'🏭', domain:'water',      version:'v5.0' },
  { id:'aquasim',      name:'AquaSimPro',      description:'RO/NF membranes, clarifiers, GAC, UV, chlorine CT, pump curves',   path:'/tools/denver/AquaSimPro-v4_9-MCP-API.html',         icon:'💧', domain:'water',      version:'v4.9' },
  { id:'mep',          name:'Denver MEP',      description:'HVAC load calc (ASHRAE), duct/pipe sizing, electrical, plumbing',  path:'/tools/denver/Denver-v3_4-MCP-API.html',             icon:'⚙️', domain:'mep',        version:'v3.4' },
  { id:'stormwater',   name:'Stormwater',      description:'Detention/retention, LID design, runoff calculations',             path:'/tools/denver/Stormwater-Designer-v1_4-MCP-API.html', icon:'🌊', domain:'stormwater', version:'v1.4' },
  { id:'pid-universal',name:'PFD Generator',   description:'Quick process flow diagrams — ISA loops, line specs',              path:'/tools/denver/pid-universal.html',                    icon:'📐', domain:'pid',        version:'v3.5' },
  { id:'pid-true',     name:'TRUE P&ID',       description:'ISA-5.1 — valve actuators, bubbles, title blocks, DXF export',    path:'/tools/denver/pid-true.html',                        icon:'📋', domain:'pid',        version:'v2.1' },
]

const DOMAIN_META = {
  water:      { label:'Water / Wastewater', color:'#0C447C', bg:'#E6F1FB', border:'#185FA5' },
  mep:        { label:'MEP',                color:'#3B6D11', bg:'#EAF3DE', border:'#639922' },
  stormwater: { label:'Stormwater',         color:'#534AB7', bg:'#EEEDFE', border:'#7F77DD' },
  pid:        { label:'P&ID Generation',    color:'#854F0B', bg:'#FAEEDA', border:'#BA7517' },
}

interface DenverResult {
  tool: string; version: string
  summary: Record<string, unknown>
  pidSvg?: string | null; timestamp: string
}
interface CalcSession {
  id: string; tool_name: string; tool_version: string
  output_summary: Record<string, unknown>
  has_pid: boolean; created_at: string; created_by_name: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
export function CalcView({ policy: _p }: CalcViewProps) {
  const [panel, setPanel] = useState<Panel>('epc')

  return (
    <div role="main" aria-label="Engineering Calculator" style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {/* Top panel switcher */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--jarvis-bd)', flexShrink:0 }}>
        {([
          { id:'epc',         label:'EPC Calculators',  icon:'📊' },
          { id:'engineering', label:'Engineering Tools', icon:'🔬' },
        ] as {id:Panel;label:string;icon:string}[]).map(p => (
          <button key={p.id} onClick={() => setPanel(p.id)} style={{ padding:'10px 18px', background:'transparent', border:'none', borderBottom: panel===p.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: panel===p.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: panel===p.id ? 700 : 500, fontSize:12, cursor:'pointer', paddingBottom:10, whiteSpace:'nowrap' }}>
            {p.icon} {p.label}
          </button>
        ))}
      </div>
      {panel === 'epc' && (
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <EPCCalculators />
        </div>
      )}
      {panel === 'engineering' && (
        <div style={{ flex:1, minHeight:0, display:'flex' }}>
          <DenverHub />
        </div>
      )}
    </div>
  )
}
export default CalcView

// ─── EPC Calculators (existing, preserved) ────────────────────────────────────
function EPCCalculators() {
  const [mode, setMode] = useState<CalcMode>('evm')
  const manpower = useBizStore(s => s.biz.manpower ?? [])
  const [bac,setBac]=useState(''); const [ev,setEv]=useState(''); const [ac,setAc]=useState(''); const [pv,setPv]=useState('')
  const [origDuration,setOrigDuration]=useState(''); const [elapsed,setElapsed]=useState(''); const [pctDone,setPctDone]=useState('')
  const [workers,setWorkers]=useState(''); const [hours,setHours]=useState(''); const [outputUnits,setOutputUnits]=useState('')
  const [quantity,setQuantity]=useState(''); const [duration,setDuration]=useState(''); const [labor,setLabor]=useState('')

  const evmResult = useMemo(()=>{ const B=parseFloat(bac),E=parseFloat(ev),A=parseFloat(ac),P=parseFloat(pv); if(!B||!E||!A)return null; const cpi=A?E/A:1,spi=P?E/P:1; return{cpi:cpi.toFixed(3),spi:spi.toFixed(3),eac:(B/cpi).toFixed(0),vac:(B-B/cpi).toFixed(0),cv:(E-A).toFixed(0),sv:(P?E-P:0).toFixed(0),tcpi:((B-E)/(B-A)).toFixed(3)} },[bac,ev,ac,pv])
  const schedResult = useMemo(()=>{ const T=parseFloat(origDuration),El=parseFloat(elapsed),Pc=parseFloat(pctDone); if(!T||!El||!Pc)return null; const remaining=T*(1-Pc/100),forecast=El+remaining,slippage=forecast-T; return{remainDays:remaining.toFixed(1),forecastDays:forecast.toFixed(1),slippage:slippage.toFixed(1),efficiencyPct:((Pc/100/(El/T))*100).toFixed(1)} },[origDuration,elapsed,pctDone])
  const manpowerResult = useMemo(()=>{ const W=parseFloat(workers),H=parseFloat(hours),O=parseFloat(outputUnits); if(!W||!H)return null; const totalHours=W*H,productivity=O?(O/totalHours).toFixed(3):null; return{totalHours:totalHours.toFixed(0),productivity} },[workers,hours,outputUnits])
  const unitResult = useMemo(()=>{ const Q=parseFloat(quantity),D=parseFloat(duration),L=parseFloat(labor); if(!Q||!D)return null; const rate=(Q/D).toFixed(2),laborRate=L&&Q?(L/Q).toFixed(2):null; return{rate,laborRate} },[quantity,duration,labor])

  const MODES:[CalcMode,string,string][]=[['evm','EVM Metrics','📊'],['schedule','Schedule','📅'],['manpower','Manpower','👷'],['unit','Unit Rate','📐']]
  const inp=(label:string,val:string,set:(v:string)=>void,ph='')=>(<div key={label}><label className="jarvis-small" style={{display:'block',marginBottom:4}}>{label}</label><input className="jarvis-input" type="number" placeholder={ph} value={val} onChange={e=>set(e.target.value)}/></div>)

  return (<>
    <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'1px solid var(--jarvis-bd)'}}>
      {MODES.map(([id,label,icon])=><button key={id} onClick={()=>setMode(id)} style={{padding:'8px 14px',background:'transparent',border:'none',borderBottom:mode===id?'2px solid var(--jarvis-ac)':'2px solid transparent',color:mode===id?'var(--jarvis-tx)':'var(--jarvis-ts)',fontWeight:mode===id?700:500,fontSize:12,cursor:'pointer',paddingBottom:10}}>{icon} {label}</button>)}
    </div>
    {mode==='evm'&&(<div><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>{inp('Budget at Completion (BAC)',bac,setBac,'1000000')}{inp('Earned Value (EV)',ev,setEv,'650000')}{inp('Actual Cost (AC)',ac,setAc,'700000')}{inp('Planned Value (PV)',pv,setPv,'680000')}</div>{evmResult&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8}}><KpiCard label="CPI" value={evmResult.cpi} color={parseFloat(evmResult.cpi)>=1?'var(--jarvis-grn)':'var(--jarvis-red)'} sub={parseFloat(evmResult.cpi)>=1?'under budget':'over budget'}/><KpiCard label="SPI" value={evmResult.spi} color={parseFloat(evmResult.spi)>=1?'var(--jarvis-grn)':'var(--jarvis-red)'}/><KpiCard label="TCPI" value={evmResult.tcpi} color="var(--jarvis-blue)"/><KpiCard label="EAC" value={`$${Number(evmResult.eac).toLocaleString()}`} color="var(--jarvis-amb)"/><KpiCard label="VAC" value={`$${Number(evmResult.vac).toLocaleString()}`} color={parseFloat(evmResult.vac)>=0?'var(--jarvis-grn)':'var(--jarvis-red)'}/><KpiCard label="CV" value={`$${Number(evmResult.cv).toLocaleString()}`} color={parseFloat(evmResult.cv)>=0?'var(--jarvis-grn)':'var(--jarvis-red)'}/><KpiCard label="SV" value={`$${Number(evmResult.sv).toLocaleString()}`} color={parseFloat(evmResult.sv)>=0?'var(--jarvis-grn)':'var(--jarvis-red)'}/></div>}{!evmResult&&<p className="jarvis-muted" style={{fontStyle:'italic'}}>Enter BAC, EV, and AC to compute EVM metrics.</p>}</div>)}
    {mode==='schedule'&&(<div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>{inp('Original Duration (days)',origDuration,setOrigDuration,'120')}{inp('Elapsed Days',elapsed,setElapsed,'45')}{inp('Percent Complete (%)',pctDone,setPctDone,'30')}</div>{schedResult&&<div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}><KpiCard label="Remaining Days" value={schedResult.remainDays} color="var(--jarvis-blue)"/><KpiCard label="Forecast Duration" value={schedResult.forecastDays} color="var(--jarvis-amb)"/><KpiCard label="Schedule Slippage" value={`${schedResult.slippage}d`} color={parseFloat(schedResult.slippage)<=0?'var(--jarvis-grn)':'var(--jarvis-red)'}/><KpiCard label="Efficiency" value={`${schedResult.efficiencyPct}%`} color={parseFloat(schedResult.efficiencyPct)>=100?'var(--jarvis-grn)':'var(--jarvis-amb)'}/></div>}{!schedResult&&<p className="jarvis-muted" style={{fontStyle:'italic'}}>Enter original duration, elapsed days, and percent complete.</p>}</div>)}
    {mode==='manpower'&&(<div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>{inp('Number of Workers',workers,setWorkers,'20')}{inp('Hours per Worker',hours,setHours,'8')}{inp('Output Units (optional)',outputUnits,setOutputUnits,'150')}</div>{manpowerResult&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8}}><KpiCard label="Total Labour Hours" value={manpowerResult.totalHours} color="var(--jarvis-blue)"/>{manpowerResult.productivity&&<KpiCard label="Units / Hour" value={manpowerResult.productivity} color="var(--jarvis-grn)"/>}</div>}{!manpowerResult&&<p className="jarvis-muted" style={{fontStyle:'italic'}}>Enter worker count and hours worked.</p>}{manpower.length>0&&<div style={{marginTop:20}}><h4 className="jarvis-label" style={{marginBottom:8}}>Project Manpower Records</h4><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8}}>{manpower.slice(0,6).map(m=><div key={String(m['id'])} className="jarvis-card" style={{padding:'10px 12px'}}><div className="jarvis-muted" style={{fontSize:9}}>{String(m['role']??m['trade']??'Worker')}</div><div style={{fontWeight:700,fontSize:14}}>{String(m['count']??m['headcount']??'—')}</div><div className="jarvis-small">{String(m['project']??'—')}</div></div>)}</div></div>}</div>)}
    {mode==='unit'&&(<div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>{inp('Quantity Installed',quantity,setQuantity,'500')}{inp('Duration (days)',duration,setDuration,'10')}{inp('Labour Cost (optional)',labor,setLabor,'8000')}</div>{unitResult&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8}}><KpiCard label="Unit Rate / Day" value={unitResult.rate} color="var(--jarvis-blue)"/>{unitResult.laborRate&&<KpiCard label="Labour Cost / Unit" value={`$${unitResult.laborRate}`} color="var(--jarvis-grn)"/>}</div>}{!unitResult&&<p className="jarvis-muted" style={{fontStyle:'italic'}}>Enter quantity and duration to compute unit rate.</p>}</div>)}
  </>)
}

// ─── Denver Engineering Hub ───────────────────────────────────────────────────
function DenverHub() {
  const [activeTool,setActiveTool]=useState<DenverTool>(DENVER_TOOLS[0])
  const [iframeReady,setIframeReady]=useState(false)
  const [pendingResult,setPendingResult]=useState<DenverResult|null>(null)
  const [saving,setSaving]=useState(false)
  const [saveMsg,setSaveMsg]=useState<{text:string;ok:boolean}|null>(null)
  const [sessions,setSessions]=useState<CalcSession[]>([])
  const [showHistory,setShowHistory]=useState(false)
  const [historyLoading,setHistoryLoading]=useState(false)
  const iframeRef=useRef<HTMLIFrameElement>(null)

  const projects=useBizStore(s=>s.biz?.projects??[])
  const activeProjectId=useBizStore(s=>(s.biz as Record<string,unknown>)?.activeProjectId as string|undefined??s.biz?.projects?.[0]?.id)
  const activeProject=projects.find(p=>p.id===activeProjectId)??projects[0]??null

  useEffect(()=>{
    const handler=(e:MessageEvent)=>{ if(e.data?.type==='DENVER_RESULT'){setPendingResult(e.data.payload as DenverResult);setSaveMsg({text:'Result received — ready to save',ok:true})} }
    window.addEventListener('message',handler)
    return()=>window.removeEventListener('message',handler)
  },[])

  const handleIframeLoad=useCallback(()=>{
    setIframeReady(true);setPendingResult(null);setSaveMsg(null)
    const cw=iframeRef.current?.contentWindow
    if(activeProject&&cw){
      cw.postMessage({type:'JARVIS_CONTEXT',payload:{
        projectId:activeProject.id,
        projectName:(activeProject as Record<string,unknown>).name as string??activeProject.id,
        projectType:(activeProject as Record<string,unknown>).type as string??'',
        site:(activeProject as Record<string,unknown>).site as string??'',
      }},'*')
    }
  },[activeProject])

  const handleSaveSession=useCallback(async()=>{
    if(!pendingResult||!activeProjectId)return
    setSaving(true);setSaveMsg(null)
    try{
      const res=await fetch(`/api/v1/projects/${activeProjectId}/calc-sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool_name:pendingResult.tool,tool_version:pendingResult.version,output_summary:pendingResult.summary,pid_svg:pendingResult.pidSvg??null})})
      if(res.ok){setSaveMsg({text:'Saved to project ✓',ok:true});setPendingResult(null);if(showHistory)void fetchHistory()}
      else{const b=await res.json().catch(()=>({}));setSaveMsg({text:(b?.error as string)??`Save failed (${res.status})`,ok:false})}
    }catch{setSaveMsg({text:'Network error',ok:false})}
    finally{setSaving(false)}
  },[pendingResult,activeProjectId,showHistory])

  const fetchHistory=useCallback(async()=>{
    if(!activeProjectId)return;setHistoryLoading(true)
    try{const res=await fetch(`/api/v1/projects/${activeProjectId}/calc-sessions?tool_name=${activeTool.id}&limit=10`);if(res.ok)setSessions((await res.json()).sessions??[])}
    catch{}finally{setHistoryLoading(false)}
  },[activeProjectId,activeTool.id])

  useEffect(()=>{if(showHistory)void fetchHistory()},[showHistory,activeTool.id,fetchHistory])

  const selectTool=useCallback((tool:DenverTool)=>{setActiveTool(tool);setIframeReady(false);setPendingResult(null);setSaveMsg(null)},[])

  const grouped=DENVER_TOOLS.reduce<Record<string,DenverTool[]>>((acc,t)=>{(acc[t.domain]??=[]).push(t);return acc},{})
  const meta=DOMAIN_META[activeTool.domain]

  return(
    <div style={{display:'flex',flex:1,minHeight:0}}>
      {/* Sidebar */}
      <aside style={{width:196,flexShrink:0,borderRight:'0.5px solid var(--jarvis-bd)',overflowY:'auto',padding:'6px 0',background:'var(--jarvis-bg2)'}}>
        {Object.entries(grouped).map(([domain,tools])=>{
          const dm=DOMAIN_META[domain as keyof typeof DOMAIN_META]
          return(<div key={domain} style={{marginBottom:4}}>
            <div style={{fontSize:9,fontWeight:600,color:'var(--jarvis-ts)',letterSpacing:'.06em',textTransform:'uppercase',padding:'6px 10px 3px',borderTop:'0.5px solid var(--jarvis-bd)',marginTop:4}}>{dm.label}</div>
            {tools.map(tool=>{const active=activeTool.id===tool.id;return(
              <button key={tool.id} onClick={()=>selectTool(tool)} title={tool.description} style={{display:'flex',alignItems:'flex-start',gap:7,width:'100%',padding:'5px 10px',border:'none',background:active?'var(--jarvis-bg)':'transparent',borderLeft:`2px solid ${active?dm.border:'transparent'}`,cursor:'pointer',textAlign:'left'}}>
                <span style={{fontSize:14,lineHeight:1.4,flexShrink:0}}>{tool.icon}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:active?700:400,color:active?'var(--jarvis-tx)':'var(--jarvis-ts)',lineHeight:1.3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tool.name}</div>
                  <div style={{fontSize:9,color:'var(--jarvis-ts)',marginTop:1}}>{tool.version}</div>
                </div>
              </button>
            )})}
          </div>)
        })}
      </aside>

      {/* Main */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,position:'relative'}}>
        {/* Context bar */}
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'5px 12px',flexShrink:0,borderBottom:'0.5px solid var(--jarvis-bd)',background:'var(--jarvis-bg)'}}>
          <span style={{fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:3,background:meta.bg,color:meta.color,flexShrink:0}}>{meta.label.toUpperCase()}</span>
          <span style={{fontSize:12,fontWeight:600,color:'var(--jarvis-tx)',flexShrink:0}}>{activeTool.name} <span style={{fontWeight:400,color:'var(--jarvis-ts)'}}>{activeTool.version}</span></span>
          {activeProject&&(<><span style={{color:'var(--jarvis-bd)',fontSize:11}}>·</span><span style={{fontSize:11,color:'var(--jarvis-ts)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(activeProject as Record<string,unknown>).name as string??activeProjectId}</span></>)}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            {saveMsg&&<span style={{fontSize:11,color:saveMsg.ok?'var(--jarvis-grn)':'var(--jarvis-red)'}}>{saveMsg.text}</span>}
            <button onClick={()=>setShowHistory(h=>!h)} style={{fontSize:11,padding:'3px 8px',borderRadius:4,border:'0.5px solid var(--jarvis-bd)',background:showHistory?'var(--jarvis-bg2)':'var(--jarvis-bg)',color:'var(--jarvis-ts)',cursor:'pointer'}}>History</button>
            <button onClick={handleSaveSession} disabled={!pendingResult||saving||!activeProjectId} style={{fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:4,border:`0.5px solid ${pendingResult?meta.border:'var(--jarvis-bd)'}`,background:pendingResult?meta.bg:'var(--jarvis-bg2)',color:pendingResult?meta.color:'var(--jarvis-ts)',cursor:pendingResult&&!saving?'pointer':'not-allowed'}}>
              {saving?'Saving…':'Save to Project'}
            </button>
          </div>
        </div>

        {/* Loading overlay */}
        {!iframeReady&&(<div style={{position:'absolute',top:37,left:0,right:0,bottom:0,zIndex:2,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--jarvis-bg2)'}}><div style={{textAlign:'center'}}><div style={{fontSize:32,marginBottom:8}}>{activeTool.icon}</div><div style={{fontSize:12,color:'var(--jarvis-ts)'}}>Loading {activeTool.name}…</div></div></div>)}

        {/* iframe */}
        <iframe ref={iframeRef} key={activeTool.id} src={activeTool.path} title={activeTool.name} onLoad={handleIframeLoad} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups" style={{flex:1,border:'none',width:'100%',opacity:iframeReady?1:0,transition:'opacity .2s'}}/>

        {/* History panel */}
        {showHistory&&(<div style={{position:'absolute',top:37,right:0,bottom:0,width:272,zIndex:3,background:'var(--jarvis-bg)',borderLeft:'0.5px solid var(--jarvis-bd)',overflowY:'auto',padding:12,display:'flex',flexDirection:'column',gap:8}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontSize:12,fontWeight:600}}>Session history</span>
            <button onClick={()=>setShowHistory(false)} style={{fontSize:11,border:'none',background:'transparent',cursor:'pointer',color:'var(--jarvis-ts)'}}>✕</button>
          </div>
          <div style={{fontSize:10,color:'var(--jarvis-ts)'}}>{activeTool.name} · {activeProject?String((activeProject as Record<string,unknown>).name):'no project'}</div>
          {historyLoading?<div style={{fontSize:11,color:'var(--jarvis-ts)',textAlign:'center',padding:20}}>Loading…</div>
            :sessions.length===0?<div style={{fontSize:11,color:'var(--jarvis-ts)',textAlign:'center',padding:20}}>No saved sessions yet.</div>
            :sessions.map(s=><SessionCard key={s.id} session={s}/>)}
        </div>)}
      </div>
    </div>
  )
}

function SessionCard({session}:{session:CalcSession}){
  const [expanded,setExpanded]=useState(false)
  const keys=Object.keys(session.output_summary)
  const shown=expanded?keys:keys.slice(0,3)
  return(
    <div style={{border:'0.5px solid var(--jarvis-bd)',borderRadius:6,padding:9,fontSize:11}}>
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
        <span style={{fontWeight:600,flex:1}}>{session.tool_version}</span>
        {session.has_pid&&<span style={{fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:3,background:'#FAEEDA',color:'#854F0B'}}>P&ID</span>}
      </div>
      <div style={{color:'var(--jarvis-ts)',marginBottom:5,fontSize:10}}>{new Date(session.created_at).toLocaleString()} · {session.created_by_name??'You'}</div>
      {shown.map(k=><div key={k} style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:1}}><span style={{color:'var(--jarvis-ts)'}}>{k.replace(/_/g,' ')}</span><span style={{fontWeight:600,textAlign:'right'}}>{String(session.output_summary[k])}</span></div>)}
      {keys.length>3&&<button onClick={()=>setExpanded(e=>!e)} style={{fontSize:10,border:'none',background:'transparent',cursor:'pointer',color:'var(--jarvis-blue)',padding:'4px 0 0'}}>{expanded?'▲ Less':`▼ ${keys.length-3} more`}</button>}
    </div>
  )
}
