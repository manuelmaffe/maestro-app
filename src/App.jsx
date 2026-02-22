import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { fetchUserInfo, fetchCalendars, fetchEvents, mapGoogleCalendar, mapGoogleEvent, createEvent, updateEvent, deleteEvent } from "./googleCalendar.js";
import { supabase } from "./supabase.js";

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange({ target: { checked: !checked } })}
      style={{
        width: 36, height: 20, borderRadius: 10, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "#22c55e" : "#d1d5db",
        position: "relative", flexShrink: 0,
        transition: "background .2s",
        opacity: disabled ? 0.5 : 1,
        padding: 0,
      }}
    >
      <span style={{
        display: "block", width: 14, height: 14, borderRadius: "50%", background: "#fff",
        position: "absolute", top: 3,
        left: checked ? 19 : 3,
        transition: "left .2s",
        boxShadow: "0 1px 3px rgba(0,0,0,.25)",
      }}/>
    </button>
  );
}

const DAYS_SHORT = ["L","M","X","J","V","S","D"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const pad = n => String(n).padStart(2,"0");
const fmt = (h,m) => `${pad(h)}:${pad(m)}`;
const dimF = (y,m) => new Date(y,m+1,0).getDate();
const fdow = (y,m) => { const d=new Date(y,m,1).getDay(); return d===0?6:d-1; };
const same = (a,b) => a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
const uid = () => Math.random().toString(36).substr(2,9);
const today = new Date();
const YR=today.getFullYear(), MO=today.getMonth(), DA=today.getDate();

// Data
const PROVIDERS = [
  {id:"google",name:"Google",icon:"G",bg:"#fff",logoUrl:"https://developers.google.com/identity/images/g-logo.png"},
  {id:"outlook",name:"Outlook",icon:"O",bg:"#fff",logoUrl:"https://upload.wikimedia.org/wikipedia/commons/c/cc/Microsoft_Outlook_Icon_%282025%E2%80%93present%29.svg"},
  {id:"apple",name:"Apple",icon:"",bg:"#333"},
];

function getRecs(events,date,calIds){
  const r=[],evts=events.filter(e=>same(e.date,date)&&calIds.includes(e.cid)).sort((a,b)=>(a.sh*60+a.sm)-(b.sh*60+b.sm));
  for(let i=0;i<evts.length;i++){for(let j=i+1;j<evts.length;j++){const a=evts[i],b=evts[j];if(a.allDay||b.allDay)continue;if((a.eh*60+a.em)>(b.sh*60+b.sm)){r.push({type:"conflict",icon:"⚡",title:"Conflicto",desc:`"${a.title}" y "${b.title}"`,act:"Resolver"});break;}}if(r.length)break;}
  const real=evts.filter(e=>!e.allDay);
  for(let i=0;i<real.length-1;i++){const gap=(real[i+1].sh*60+real[i+1].sm)-(real[i].eh*60+real[i].em);if(gap>=60&&gap<=180){const gh=Math.floor((real[i].eh*60+real[i].em)/60),gm=(real[i].eh*60+real[i].em)%60;r.push({type:"focus",icon:"🎯",title:`${Math.floor(gap/60)}h${gap%60>0?" "+(gap%60)+"m":""} libres`,desc:`${fmt(gh,gm)} – ${fmt(real[i+1].sh,real[i+1].sm)}`,act:"Bloquear"});break;}}
  if(real.length>=4)r.push({type:"warning",icon:"🔋",title:"Día intenso",desc:`${evts.length} eventos`,act:"Optimizar"});
  return r.slice(0,3);
}

const I = {
  left:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
  right:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>,
  plus:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  x:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  clock:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  pin:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  cal:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  layers:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  edit:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  trash:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  check:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  today:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none"/></svg>,
  video:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
  link:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  text:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>,
  task:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>,
  taskDone:<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  taskOpen:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>,
  share:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  copy:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  globe:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></svg>,
  sync:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  users:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
};

const CSS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500&display=swap');
    *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    :root{
      --w:#FFF;--bg:#FAFAFA;--hover:#F4F4F5;--brd:#E8E8EB;--bl:#F0F0F2;
      --t:#111;--t2:#555;--t3:#999;--t4:#BBB;
      --danger:#DC2626;--dbg:#FEF2F2;--ok:#059669;--obg:#ECFDF5;
      --wbg:#FFFBEB;--warn:#D97706;--blue:#2563EB;--bbg:#EFF6FF;
      --r:12px;--rs:8px;
      --f:'Instrument Sans',-apple-system,sans-serif;
      --fs:'Instrument Serif',Georgia,serif;
      --fm:'IBM Plex Mono',monospace;
    }
    body{font-family:var(--f);background:var(--bg);color:var(--t);-webkit-font-smoothing:antialiased;overflow:hidden}

    /* ── Responsive Shell ── */
    .app{margin:0 auto;height:100dvh;display:flex;flex-direction:column;background:var(--w);position:relative;overflow:hidden;border-left:1px solid var(--brd);border-right:1px solid var(--brd)}

    /* Mobile: single column like before */
    @media(max-width:767px){
      .app{max-width:430px}
      .mobile-col{flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden}
      .desktop-sidebar{display:none}
      .desktop-tl{display:none}
    }

    /* Desktop: header on top, then side-by-side body */
    @media(min-width:768px){
      .app{max-width:100%;flex-direction:column;border-radius:0;margin-top:0;height:100dvh;box-shadow:none;border-left:none;border-right:none}
      .mobile-col{display:flex;flex-direction:column;width:360px;flex-shrink:0;border-right:1px solid var(--bl);position:relative;overflow:hidden}
      .desktop-tl{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative}
      .desktop-sidebar{display:none}
      .today-card{display:none!important}
      .tl-overlay{display:none!important}
      .tl-panel{display:none!important}
    }

    .top{padding:14px 20px 10px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
    .top-l{display:flex;align-items:baseline;gap:8px}
    .brand{font-family:var(--fs);font-size:22px;font-style:italic;letter-spacing:-0.5px}
    .tag{font-size:10px;font-family:var(--fm);color:var(--t3);background:var(--bg);padding:2px 7px;border-radius:4px;font-weight:500;letter-spacing:.5px;text-transform:uppercase}
    .top-r{display:flex;gap:12px;align-items:center}
    .ib{width:36px;height:36px;border-radius:var(--rs);border:none;background:transparent;color:var(--t2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s;padding:0}
    .ib:hover{background:var(--hover);color:var(--t)}

    /* Desktop header — spans full width */
    .desk-header{display:none}
    .desk-body{display:contents}
    .mob-top{padding:14px 20px 10px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}

    @media(max-width:767px){
      .desk-header{display:none}
      .mob-top{display:flex}
    }
    @media(min-width:768px){
      .desk-header{
        display:flex;align-items:center;justify-content:space-between;
        padding:12px 24px;border-bottom:1px solid var(--bl);flex-shrink:0;
        width:100%;
      }
      .desk-body{display:flex;flex:1;overflow:hidden}
      .mob-top{display:none}
    }

    /* Calendar fills remaining space */
    .cal-area{flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden}
    .mbar{display:flex;align-items:center;justify-content:space-between;padding:6px 20px 4px;flex-shrink:0}
    .ml{font-size:14px;font-weight:600;letter-spacing:-0.3px;display:flex;align-items:center;gap:6px}
    .ml span{color:var(--t3);font-weight:400}
    .marr{display:flex}
    .ma{width:28px;height:28px;border:none;background:none;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:var(--rs);transition:all .12s;padding:0}
    .ma:hover{background:var(--hover);color:var(--t)}
    .cgrid{padding:0 16px 4px;flex-shrink:0}
    .wrow{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:2px}
    .wc{text-align:center;font-size:10px;font-weight:600;color:var(--t4);padding:3px 0;font-family:var(--fm);letter-spacing:.8px}
    .dgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}
    .dc{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:var(--rs);cursor:pointer;border:none;background:transparent;color:var(--t2);font-family:var(--f);font-size:13px;font-weight:500;transition:all .12s;position:relative}
    .dc:hover{background:var(--hover)}
    .dc.today{background:var(--t);color:var(--w);font-weight:700}
    .dc.sel:not(.today){background:var(--hover);font-weight:700;color:var(--t);box-shadow:inset 0 0 0 1.5px var(--t4)}
    .dc.oth{color:var(--t4)}
    .ddots{display:flex;gap:2px;margin-top:1px;height:3px}
    .ddot{width:3px;height:3px;border-radius:50%}

    /* ── Today Card (collapsed) ── */
    .today-card{
      position:absolute;bottom:16px;left:14px;right:14px;
      background:var(--w);border-radius:16px;
      box-shadow:0 4px 24px rgba(0,0,0,.10),0 1px 4px rgba(0,0,0,.06);
      border:1px solid var(--bl);
      cursor:pointer;transition:all .2s ease;
      z-index:10;overflow:hidden;
      -webkit-user-select:none;user-select:none;
      touch-action:pan-y;
    }
    .today-card:hover{box-shadow:0 8px 32px rgba(0,0,0,.13)}

    /* Timeline nav buttons */
    .tl-nav-btn{
      width:28px;height:28px;border:none;background:var(--brd);
      border-radius:6px;cursor:pointer;display:flex;align-items:center;
      justify-content:center;color:var(--t2);transition:all .12s;flex-shrink:0;padding:0;
    }
    .tl-nav-btn:hover{background:var(--t4);color:var(--t)}
    .tl-nav-btn:active{transform:scale(.9)}

    /* Today quick-access button */
    .dtl-today-btn{
      padding:4px 10px;border-radius:6px;border:1.5px solid var(--t);
      background:transparent;color:var(--t);font-size:11px;font-weight:700;
      font-family:var(--f);cursor:pointer;transition:all .12s;letter-spacing:-.2px;
      margin-left:2px;
    }
    .dtl-today-btn:hover{background:var(--t);color:var(--w)}
    .dtl-today-btn:active{transform:scale(.95)}
    .tc-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 0}
    .tc-title{font-size:15px;font-weight:700;letter-spacing:-0.3px;display:flex;align-items:center;gap:8px}
    .tc-count{font-size:11px;font-family:var(--fm);color:var(--t3);background:var(--bg);padding:2px 8px;border-radius:20px;font-weight:500}
    .tc-hint{font-size:10px;color:var(--t4);font-family:var(--fm);letter-spacing:.3px;display:flex;align-items:center;gap:4px}
    .tc-swipe-arrows{
      font-size:11px;letter-spacing:2px;opacity:.6;
      animation:swipeHint 2s ease-in-out infinite;
    }
    @keyframes swipeHint{0%,100%{opacity:.3}50%{opacity:.7}}
    .tc-preview{display:flex;gap:6px;padding:10px 16px 14px;overflow-x:auto;scrollbar-width:none}
    .tc-preview::-webkit-scrollbar{display:none}
    .tc-pip{
      flex-shrink:0;padding:6px 10px;border-radius:8px;
      border-left:3px solid;font-size:11px;font-weight:600;
      display:flex;flex-direction:column;gap:1px;min-width:0;
    }
    .tc-pip-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;color:var(--t)}
    .tc-pip-time{font-size:10px;font-family:var(--fm);color:var(--t3);font-weight:400}

    /* Recs strip inside card */
    .tc-recs{display:flex;gap:6px;padding:0 16px 12px;overflow-x:auto;scrollbar-width:none}
    .tc-recs::-webkit-scrollbar{display:none}
    .tc-rec{
      flex-shrink:0;padding:6px 10px;border-radius:8px;font-size:11px;font-weight:600;
      display:flex;align-items:center;gap:5px;white-space:nowrap;
    }
    .tc-rec.conflict{background:var(--dbg);color:var(--danger)}
    .tc-rec.focus{background:var(--obg);color:var(--ok)}
    .tc-rec.warning{background:var(--wbg);color:var(--warn)}

    .tc-empty{padding:10px 16px 14px;font-size:13px;color:var(--t3);text-align:center}

    /* ── Expanded Timeline Panel ── */
    .tl-overlay{
      position:absolute;inset:0;z-index:50;
      background:rgba(0,0,0,.12);
      animation:fi .15s ease;
    }
    .tl-panel{
      position:absolute;left:0;right:0;bottom:0;
      background:var(--w);border-radius:20px 20px 0 0;
      z-index:51;display:flex;flex-direction:column;
      box-shadow:0 -8px 50px rgba(0,0,0,.1);
      touch-action:none;
      will-change:transform,height;
    }
    .tl-panel.entering{animation:su .35s cubic-bezier(.16,1,.3,1)}
    .tl-panel.dismissing{transform:translateY(100%);transition:transform .3s ease-in}

    .tl-grab{padding:8px 0 2px;display:flex;flex-direction:column;align-items:center;cursor:grab;user-select:none;-webkit-user-select:none;flex-shrink:0}
    .tl-grab-bar{width:36px;height:4px;background:var(--brd);border-radius:2px}
    .tl-head{display:flex;align-items:center;justify-content:space-between;padding:8px 20px 10px;flex-shrink:0;border-bottom:1px solid var(--bl)}
    .tl-title{font-size:15px;font-weight:700;letter-spacing:-0.3px;display:flex;align-items:center;gap:8px}
    .tl-cnt{font-size:11px;font-family:var(--fm);color:var(--t3);background:var(--bg);padding:2px 8px;border-radius:20px;font-weight:500}

    /* Recs inside expanded */
    .tl-recs{padding:8px 16px 4px;display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;flex-shrink:0}
    .tl-recs::-webkit-scrollbar{display:none}
    .tl-rec{
      flex-shrink:0;scroll-snap-align:start;padding:10px 12px;border-radius:var(--r);
      display:flex;align-items:flex-start;gap:8px;border:1px solid transparent;min-width:220px;
    }
    .tl-rec.conflict{background:var(--dbg)}.tl-rec.focus{background:var(--obg)}.tl-rec.warning{background:var(--wbg)}.tl-rec.preview{background:var(--bbg)}
    .tl-rec-i{font-size:14px;flex-shrink:0}
    .tl-rec-b{flex:1;min-width:0}
    .tl-rec-t{font-size:12px;font-weight:600}
    .tl-rec-d{font-size:11px;color:var(--t2);margin-top:1px;line-height:1.3}

    .tl-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:40px}
    .tl-scroll::-webkit-scrollbar{display:none}
    .tl{padding:8px 0 0}
    .tl-allday{margin:0 12px 6px 54px;padding:8px 12px;border-radius:var(--rs);border-left:3px solid;font-size:13px;font-weight:600;cursor:pointer}
    .tl-allday-sub{font-size:10px;color:var(--t3);font-family:var(--fm);font-weight:400;margin-left:8px}
    .tl-hour{display:flex;min-height:56px;position:relative}
    .tl-h-label{width:54px;font-size:10px;font-family:var(--fm);color:var(--t4);text-align:right;padding-right:10px;flex-shrink:0;margin-top:-6px;font-weight:500}
    .tl-h-track{flex:1;border-top:1px solid var(--bl);position:relative;min-height:56px;cursor:pointer}
    .tl-h-track:hover{background:var(--bg);transition:background .15s}

    .tl-evt{
      position:absolute;left:2px;right:10px;border-radius:var(--rs);
      padding:7px 10px;cursor:pointer;overflow:hidden;z-index:2;
      border-left:3px solid;transition:all .12s;
      display:flex;flex-direction:column;justify-content:center;
    }
    .tl-evt:hover{filter:brightness(.97)}.tl-evt:active{transform:scale(.98)}
    .tl-evt.dragging{cursor:grabbing!important}
    .tl-evt.dragging:active{transform:none}
    .tl-evt-title{font-size:12px;font-weight:600;letter-spacing:-0.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tl-evt-sub{font-size:10px;font-family:var(--fm);color:var(--t2);margin-top:1px;display:flex;align-items:center;gap:6px}
    .tl-evt-conf{color:var(--danger);font-weight:700}

    /* Resize handle */
    .tl-evt-resize{
      position:absolute;bottom:0;left:0;right:0;height:8px;
      cursor:ns-resize;border-radius:0 0 var(--rs) var(--rs);
      display:flex;align-items:center;justify-content:center;
    }
    .tl-evt-resize::after{
      content:'';width:20px;height:3px;border-radius:2px;
      background:rgba(0,0,0,.12);opacity:0;transition:opacity .15s;
    }
    .tl-evt:hover .tl-evt-resize::after{opacity:1}

    .now-line{position:absolute;left:0;right:10px;height:2px;z-index:4;display:flex;align-items:center;pointer-events:none}
    .now-dot{width:8px;height:8px;border-radius:50%;background:var(--danger);flex-shrink:0;margin-left:-4px}
    .now-rule{flex:1;height:2px;background:var(--danger)}

    /* ── Desktop Timeline (always visible) ── */
    .dtl-head{
      display:flex;align-items:center;justify-content:space-between;padding:14px 20px 10px;
      flex-shrink:0;border-bottom:1px solid var(--bl);
    }
    .dtl-title{font-size:18px;font-weight:700;letter-spacing:-0.3px;display:flex;align-items:center;gap:10px;font-family:var(--fs);font-style:italic}
    .dtl-cnt{font-size:11px;font-family:var(--fm);color:var(--t3);background:var(--bg);padding:2px 8px;border-radius:20px;font-weight:500}
    .dtl-recs{padding:10px 20px 6px;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;flex-shrink:0}
    .dtl-recs::-webkit-scrollbar{display:none}
    .dtl-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:40px}
    .dtl-scroll::-webkit-scrollbar{width:6px}
    .dtl-scroll::-webkit-scrollbar-thumb{background:var(--brd);border-radius:3px}
    .dtl-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--t3);gap:8px;cursor:pointer}
    .dtl-empty:hover{color:var(--t2)}

    /* Event detail sheet */
    .evt-ov{position:absolute;inset:0;z-index:60;background:rgba(0,0,0,.15);backdrop-filter:blur(2px);animation:fi .15s ease}
    .evt-sh{
      position:absolute;bottom:0;left:0;right:0;background:var(--w);border-radius:20px 20px 0 0;
      z-index:61;max-height:85vh;overflow-y:auto;box-shadow:0 -8px 50px rgba(0,0,0,.1);
      touch-action:none;
    }
    .evt-sh.entering{animation:su .3s cubic-bezier(.16,1,.3,1)}
    .evt-sh.dismissing{transform:translateY(100%);transition:transform .25s ease-in}
    .evt-sh::-webkit-scrollbar{display:none}

    @media(min-width:768px){
      .evt-ov{position:fixed;inset:0}
      .evt-sh{position:fixed;left:50%;right:auto;bottom:auto;top:50%;
        transform:translate(-50%,-50%);max-width:440px;width:calc(100% - 40px);
        border-radius:16px;max-height:80vh;
        animation:modalIn .25s cubic-bezier(.16,1,.3,1);
        box-shadow:0 16px 80px rgba(0,0,0,.15)}
      .evt-sh.entering{animation:modalIn .25s cubic-bezier(.16,1,.3,1)}
      .evt-sh.dismissing{opacity:0;transform:translate(-50%,-50%) scale(.96);transition:all .2s ease-in}
      .evt-sh-grab{display:none}
    }
    .evt-sh-grab{padding:8px 0 2px;display:flex;flex-direction:column;align-items:center;cursor:grab;user-select:none;-webkit-user-select:none}
    .evt-sh-bar{width:36px;height:4px;background:var(--brd);border-radius:2px}
    .evt-sh-head{padding:10px 20px 6px;display:flex;align-items:flex-start;justify-content:space-between}
    .evt-sh-dot{width:10px;height:10px;border-radius:50%;margin-top:6px;flex-shrink:0}
    .evt-sh-info{flex:1;padding:0 12px}
    .evt-sh-cal{font-size:11px;font-family:var(--fm);color:var(--t3)}
    .evt-sh-title{font-family:var(--fs);font-size:26px;font-style:italic;letter-spacing:-0.5px;line-height:1.15;margin-top:2px}
    .evt-sh-body{padding:0 20px 32px}
    .evt-sh-row{display:flex;align-items:center;gap:10px;padding:10px 0;font-size:13px;color:var(--t2)}
    .evt-sh-row svg{color:var(--t4);flex-shrink:0}
    .evt-sh-desc{padding:12px;background:var(--bg);border-radius:var(--rs);font-size:13px;color:var(--t2);line-height:1.6;margin:8px 0}
    .evt-sh-acts{display:flex;gap:6px;margin-top:16px}
    .evt-sh-acts>button{flex:1}

    .ib.add-btn{background:var(--t);color:var(--w);border-radius:var(--rs);transition:all .15s}
    .ib.add-btn:hover{opacity:.85;background:var(--t)}
    .ib.add-btn:active{transform:scale(.92)}

    /* Sheets */
    .ov{position:absolute;inset:0;background:rgba(0,0,0,.2);backdrop-filter:blur(2px);z-index:70;animation:fi .15s ease}
    .sh{position:absolute;bottom:0;left:0;right:0;background:var(--w);border-radius:20px 20px 0 0;z-index:71;max-height:92vh;overflow-y:auto;animation:su .3s cubic-bezier(.16,1,.3,1);box-shadow:0 -10px 60px rgba(0,0,0,.08)}
    .sh::-webkit-scrollbar{display:none}

    @media(min-width:768px){
      .ov{position:fixed;inset:0}
      .sh{position:fixed;left:50%;right:auto;bottom:auto;top:50%;
        transform:translate(-50%,-50%);max-width:480px;width:calc(100% - 40px);
        max-height:85vh;border-radius:16px;
        animation:modalIn .25s cubic-bezier(.16,1,.3,1);
        box-shadow:0 16px 80px rgba(0,0,0,.15)}
      @keyframes modalIn{from{opacity:0;transform:translate(-50%,-48%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
      .sh-grab{display:none}
    }
    .sh-grab{width:32px;height:4px;background:var(--brd);border-radius:2px;margin:8px auto 0}
    .sh-head{display:flex;align-items:center;justify-content:space-between;padding:14px 20px 10px;position:sticky;top:0;background:var(--w);z-index:2;border-bottom:1px solid var(--bl)}
    .sh-h{font-size:16px;font-weight:700;letter-spacing:-0.3px}
    .sh-body{padding:0 20px 36px}

    .fg{margin-bottom:20px}
    .fl{font-size:10px;font-weight:600;color:var(--t3);margin-bottom:6px;display:flex;align-items:center;gap:5px;font-family:var(--fm);text-transform:uppercase;letter-spacing:1px}
    .fl svg{opacity:.5}
    .fi{width:100%;padding:12px 14px;border-radius:var(--rs);border:1px solid var(--brd);background:var(--w);color:var(--t);font-size:15px;font-family:var(--f);outline:none;transition:border .15s}
    .fi:focus{border-color:var(--t)}.fi::placeholder{color:var(--t4)}
    .fr{display:flex;gap:10px}.fr>*{flex:1}

    /* Divider */
    .form-div{height:1px;background:var(--bl);margin:20px 0}

    /* Event/Task type switch */
    .type-switch{
      display:flex;gap:0;background:var(--bg);border-radius:var(--r);padding:3px;
    }
    .type-btn{
      flex:1;display:flex;align-items:center;justify-content:center;gap:6px;
      padding:10px 12px;border:none;border-radius:10px;background:transparent;
      cursor:pointer;font-family:var(--f);font-size:13px;font-weight:600;
      color:var(--t3);transition:all .15s;letter-spacing:-0.2px;
    }
    .type-btn.act{background:var(--w);color:var(--t);box-shadow:0 1px 4px rgba(0,0,0,.08)}
    .type-btn:not(.act):hover{color:var(--t2)}
    .type-btn svg{flex-shrink:0}

    /* Priority row */
    .priority-row{display:flex;gap:6px}
    .prio-btn{
      flex:1;padding:9px 0;border-radius:var(--rs);border:1.5px solid var(--brd);
      background:var(--w);cursor:pointer;font-family:var(--f);font-size:12px;
      font-weight:600;color:var(--t2);transition:all .12s;text-align:center;
    }
    .prio-btn:hover{border-color:var(--t4)}
    .prio-btn.sel{border-color:transparent}

    /* Task items in timeline */
    .tl-task{
      display:flex;align-items:center;gap:10px;margin:0 12px 4px 54px;
      padding:9px 12px;border-radius:var(--rs);background:var(--bg);
      cursor:pointer;transition:all .12s;border:1px solid var(--bl);
    }
    .tl-task:hover{border-color:var(--brd);background:var(--w)}
    .tl-task.done{opacity:.5}
    .tl-task-check{
      width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;
      justify-content:center;cursor:pointer;color:var(--t3);transition:all .12s;
    }
    .tl-task-check:hover{color:var(--t)}
    .tl-task-check.checked{color:var(--ok)}
    .tl-task-info{flex:1;min-width:0}
    .tl-task-title{font-size:13px;font-weight:500;letter-spacing:-0.2px}
    .tl-task.done .tl-task-title{text-decoration:line-through;color:var(--t3)}
    .tl-task-meta{font-size:10px;font-family:var(--fm);color:var(--t4);margin-top:1px;display:flex;align-items:center;gap:6px}
    .tl-task-prio{font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;text-transform:uppercase;letter-spacing:.5px}

    /* Task in today card */
    .tc-task{
      display:flex;align-items:center;gap:6px;flex-shrink:0;
      padding:6px 10px;border-radius:8px;background:var(--bg);
      border:1px dashed var(--brd);font-size:11px;font-weight:500;color:var(--t2);
    }
    .tc-task svg{flex-shrink:0;opacity:.5}

    /* Maestro task badge in form */
    .maestro-task-badge{
      display:flex;align-items:center;gap:12px;padding:12px 14px;
      border-radius:var(--r);background:linear-gradient(135deg,#6366F108,#6366F10D);
      border:1px solid #6366F120;
    }

    /* ── Booking Builder ── */
    .booking-builder{padding:0}
    .bk-hero{
      display:flex;align-items:flex-start;gap:12px;padding:14px 16px;
      background:linear-gradient(135deg,#11101708,#1110170D);border-radius:var(--r);
      margin-bottom:20px;border:1px solid var(--bl);
    }
    .bk-hero-icon{
      width:36px;height:36px;border-radius:10px;
      background:var(--t);color:var(--w);display:flex;align-items:center;
      justify-content:center;flex-shrink:0;
    }
    .bk-hero-title{font-size:14px;font-weight:700;letter-spacing:-0.3px}
    .bk-hero-desc{font-size:12px;color:var(--t3);line-height:1.4;margin-top:2px}

    .bk-dur-row{display:flex;gap:6px}
    .bk-dur{
      flex:1;padding:10px 0;border-radius:var(--rs);border:1.5px solid var(--brd);
      background:var(--w);cursor:pointer;font-family:var(--f);font-size:13px;
      font-weight:600;color:var(--t2);transition:all .12s;text-align:center;
    }
    .bk-dur:hover{border-color:var(--t4)}
    .bk-dur.sel{background:var(--t);color:var(--w);border-color:var(--t)}

    .bk-days{display:flex;gap:4px}
    .bk-day{
      flex:1;padding:8px 0;border-radius:var(--rs);border:1.5px solid var(--brd);
      background:var(--w);cursor:pointer;font-family:var(--f);font-size:11px;
      font-weight:600;color:var(--t3);transition:all .12s;text-align:center;
    }
    .bk-day:hover{border-color:var(--t4)}
    .bk-day.sel{background:var(--t);color:var(--w);border-color:var(--t)}

    .bk-opt{
      display:flex;align-items:center;gap:10px;cursor:pointer;
      padding:10px 12px;border-radius:var(--rs);border:1px solid var(--bl);
      transition:background .12s;
    }
    .bk-opt:hover{background:var(--bg)}

    .bk-preview-summary{
      display:flex;align-items:center;gap:6px;font-size:13px;color:var(--t2);
      margin-bottom:10px;font-weight:500;
    }
    .bk-slot-count{
      font-size:20px;font-weight:700;color:var(--ok);font-family:var(--fm);
      line-height:1;
    }
    .bk-slots-scroll{
      max-height:180px;overflow-y:auto;scrollbar-width:none;
      border:1px solid var(--bl);border-radius:var(--rs);padding:8px 10px;
    }
    .bk-slots-scroll::-webkit-scrollbar{display:none}
    .bk-day-group{margin-bottom:8px}
    .bk-day-group:last-child{margin-bottom:0}
    .bk-day-label{
      font-size:11px;font-weight:600;color:var(--t3);margin-bottom:4px;
      font-family:var(--fm);text-transform:capitalize;
    }
    .bk-slot-chips{display:flex;flex-wrap:wrap;gap:4px}
    .bk-slot-chip{
      padding:4px 8px;border-radius:6px;background:var(--obg);color:var(--ok);
      font-size:11px;font-weight:600;font-family:var(--fm);
    }

    .bk-link-result{margin-top:4px}
    .bk-link-box{
      display:flex;align-items:center;gap:8px;padding:10px 12px;
      border-radius:var(--rs);background:var(--bg);border:1px solid var(--brd);
    }
    .bk-link-url{
      flex:1;font-size:12px;font-family:var(--fm);color:var(--t);
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    }
    .bk-link-copy{
      border:none;background:none;color:var(--blue);font-size:12px;
      font-weight:600;font-family:var(--f);cursor:pointer;display:flex;
      align-items:center;gap:4px;white-space:nowrap;flex-shrink:0;
    }
    .bk-link-copy:hover{opacity:.7}
    .mtb-icon{
      width:32px;height:32px;border-radius:8px;
      background:linear-gradient(135deg,#6366F1,#818CF8);
      color:white;display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:14px;font-family:var(--fs);font-style:italic;
      flex-shrink:0;
    }
    .mtb-info{flex:1}
    .mtb-name{font-size:13px;font-weight:600;color:var(--t);letter-spacing:-0.2px}
    .mtb-desc{font-size:11px;color:var(--t3);margin-top:1px}

    /* Calendar selector cards */
    .cal-sel{display:flex;flex-direction:column;gap:6px}
    .cal-opt{
      display:flex;align-items:center;gap:10px;padding:10px 12px;
      border-radius:var(--rs);border:1.5px solid var(--brd);background:var(--w);
      cursor:pointer;transition:all .12s;
    }
    .cal-opt:hover{border-color:var(--t4)}
    .cal-opt.sel{border-color:transparent;box-shadow:0 0 0 2px var(--t)}
    .cal-opt-prov{
      width:28px;height:28px;border-radius:6px;display:flex;
      align-items:center;justify-content:center;font-weight:800;
      font-size:12px;color:white;flex-shrink:0;
    }
    .cal-opt-info{flex:1;min-width:0}
    .cal-opt-name{font-size:13px;font-weight:600;letter-spacing:-0.2px}
    .cal-opt-acc{font-size:10px;color:var(--t3);font-family:var(--fm)}
    .cal-opt-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .cal-opt-check{
      width:20px;height:20px;border-radius:50%;border:1.5px solid var(--brd);
      display:flex;align-items:center;justify-content:center;flex-shrink:0;
      transition:all .12s;color:transparent;
    }
    .cal-opt.sel .cal-opt-check{background:var(--t);border-color:var(--t);color:var(--w)}

    /* Video link field */
    .video-field{display:flex;gap:8px;align-items:stretch}
    .video-field .fi{flex:1}
    .video-quick{
      display:flex;gap:4px;flex-shrink:0;
    }
    .vq-btn{
      padding:0 10px;border-radius:var(--rs);border:1px solid var(--brd);
      background:var(--w);cursor:pointer;display:flex;align-items:center;
      justify-content:center;transition:all .12s;font-size:11px;font-weight:600;
      color:var(--t2);font-family:var(--f);gap:4px;white-space:nowrap;
    }
    .vq-btn:hover{background:var(--hover);border-color:var(--t4)}
    .vq-btn img,.vq-btn svg{width:14px;height:14px}
    select.fi{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px}
    .cpills{display:flex;gap:6px;flex-wrap:wrap}
    .cp{padding:7px 14px;border-radius:20px;font-size:12px;font-weight:600;border:1.5px solid var(--brd);background:var(--w);color:var(--t2);cursor:pointer;transition:all .12s}
    .cp.sel{color:var(--w);border-color:transparent}
    .tg-row{display:flex;align-items:center;gap:10px;cursor:pointer}
    .tg{width:38px;height:22px;border-radius:11px;border:none;cursor:pointer;position:relative;transition:all .2s}
    .tg.on{background:var(--ok)}.tg.off{background:var(--brd)}
    .tg-d{width:16px;height:16px;border-radius:50%;background:white;position:absolute;top:3px;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)}
    .tg.on .tg-d{left:19px}.tg.off .tg-d{left:3px}
    .tg.tg-sm{width:26px;height:14px;border-radius:7px}
    .tg.tg-sm .tg-d{width:10px;height:10px;top:2px}
    .tg.tg-sm.on .tg-d{left:14px}.tg.tg-sm.off .tg-d{left:2px}
    .btn-m{width:100%;padding:13px;border-radius:var(--rs);border:none;background:var(--t);color:var(--w);font-size:14px;font-weight:600;font-family:var(--f);cursor:pointer;transition:all .12s}
    .btn-m:hover{opacity:.9}.btn-m:active{transform:scale(.98)}
    .btn-g{width:100%;padding:11px;border-radius:var(--rs);border:1px solid var(--brd);background:var(--w);color:var(--t2);font-size:13px;font-weight:500;font-family:var(--f);cursor:pointer;margin-top:8px;transition:all .12s;display:flex;align-items:center;justify-content:center;gap:6px}
    .btn-g:hover{background:var(--hover);color:var(--t)}
    .btn-g.dng{border-color:rgba(220,38,38,.2);color:var(--danger)}.btn-g.dng:hover{background:var(--dbg)}

    .acc-i{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--bl)}
    .acc-av{width:36px;height:36px;border-radius:var(--rs);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:white;flex-shrink:0}
    .acc-inf{flex:1;min-width:0}.acc-n{font-size:13px;font-weight:600}.acc-e{font-size:11px;color:var(--t3);font-family:var(--fm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cal-si{display:flex;align-items:center;gap:8px;padding:8px 0 8px 48px}
    .cal-d{width:8px;height:8px;border-radius:50%;flex-shrink:0}.cal-n{flex:1;font-size:12px;color:var(--t2)}
    .add-ab{display:flex;align-items:center;gap:10px;padding:12px 0;width:100%;border:none;background:none;color:var(--t3);font-size:13px;font-weight:500;font-family:var(--f);cursor:pointer}
    .add-ab:hover{color:var(--t)}
    .add-ac{width:36px;height:36px;border-radius:var(--rs);border:1.5px dashed var(--brd);display:flex;align-items:center;justify-content:center;color:var(--t4)}
    .prov-c{display:flex;align-items:center;gap:12px;padding:14px;border-radius:var(--r);border:1px solid var(--brd);cursor:pointer;transition:all .12s;margin-bottom:6px}
    .prov-c:hover{border-color:var(--t3);background:var(--bg)}
    .prov-ic{width:40px;height:40px;border-radius:var(--rs);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:white}
    .prov-n{font-size:14px;font-weight:600}.prov-d{font-size:11px;color:var(--t3)}

    .toast{position:absolute;top:12px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:var(--r);background:var(--t);color:var(--w);font-size:13px;font-weight:500;z-index:100;box-shadow:0 8px 30px rgba(0,0,0,.2);animation:ti .2s ease;display:flex;align-items:center;gap:6px}

    /* ── Auth Screen ── */
    .auth-wrap{
      max-width:430px;margin:0 auto;height:100dvh;display:flex;flex-direction:column;
      background:var(--w);position:relative;overflow:hidden;overflow-y:auto;
      border-left:1px solid var(--brd);border-right:1px solid var(--brd);
    }
    @media(min-width:768px){
      .auth-wrap{max-width:100%;border:none;background:var(--bg);align-items:center;justify-content:center}
      .auth-bg{display:none}
      .auth-card{margin:0;max-width:420px;width:100%;box-shadow:0 12px 60px rgba(0,0,0,.1);border:1px solid var(--brd)}
    }
    .auth-wrap::-webkit-scrollbar{display:none}
    .auth-bg{
      position:absolute;top:0;left:0;right:0;height:220px;
      background:linear-gradient(135deg,#111 0%,#2a2a2e 100%);
      border-radius:0 0 32px 32px;flex-shrink:0;
    }
    .auth-card{
      position:relative;z-index:2;margin:60px 20px 40px;
      background:var(--w);border-radius:20px;padding:32px 24px;
      box-shadow:0 8px 40px rgba(0,0,0,.08);
      animation:authIn .5s cubic-bezier(.16,1,.3,1);
    }
    @keyframes authIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}

    .auth-logo{text-align:center;margin-bottom:28px}
    .auth-brand{
      font-family:var(--fs);font-size:36px;font-style:italic;
      letter-spacing:-1px;display:block;color:var(--t);line-height:1;
    }
    .auth-tagline{
      font-size:13px;color:var(--t3);margin-top:6px;display:block;
      letter-spacing:-0.2px;
    }

    .auth-providers{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}
    .auth-prov-btn{
      display:flex;align-items:center;gap:12px;padding:12px 16px;
      border-radius:var(--r);border:1px solid var(--brd);background:var(--w);
      cursor:pointer;transition:all .12s;font-family:var(--f);
      font-size:14px;font-weight:500;color:var(--t);width:100%;
    }
    .auth-prov-btn:hover{background:var(--hover);border-color:var(--t4)}
    .auth-prov-btn:active{transform:scale(.98)}
    .auth-prov-btn:disabled{opacity:.5;pointer-events:none}
    .auth-prov-icon{
      width:28px;height:28px;border-radius:6px;display:flex;
      align-items:center;justify-content:center;font-weight:800;
      font-size:13px;color:white;flex-shrink:0;
    }

    .auth-divider{display:flex;align-items:center;gap:12px;margin:4px 0 20px}
    .auth-div-line{flex:1;height:1px;background:var(--brd)}
    .auth-div-text{font-size:11px;color:var(--t4);font-family:var(--fm);letter-spacing:.5px;white-space:nowrap}

    .auth-form{margin-bottom:16px}
    .auth-fg{margin-bottom:14px}
    .auth-fl{
      font-size:10px;font-weight:600;color:var(--t3);margin-bottom:5px;
      display:block;font-family:var(--fm);text-transform:uppercase;letter-spacing:1px;
    }
    .auth-fi{
      width:100%;padding:12px 14px;border-radius:var(--rs);
      border:1px solid var(--brd);background:var(--bg);color:var(--t);
      font-size:15px;font-family:var(--f);outline:none;transition:all .15s;
    }
    .auth-fi:focus{border-color:var(--t);background:var(--w)}
    .auth-fi::placeholder{color:var(--t4)}

    .auth-error{
      font-size:12px;color:var(--danger);margin-bottom:12px;
      padding:8px 12px;background:var(--dbg);border-radius:var(--rs);
      font-weight:500;
    }
    .auth-info{
      font-size:12px;color:#16a34a;margin-bottom:12px;
      padding:8px 12px;background:#f0fdf4;border-radius:var(--rs);
      font-weight:500;
    }
    .att-input-row{display:flex;gap:6px;margin-bottom:8px}
    .att-add-btn{padding:0 12px;height:36px;border-radius:var(--rs);border:1px solid var(--brd);background:var(--bg);cursor:pointer;font-size:12px;font-weight:600;color:var(--t2);white-space:nowrap;font-family:var(--fm)}
    .att-add-btn:hover{border-color:var(--t3)}
    .att-chip{display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--bg);border:1px solid var(--brd);border-radius:20px;font-size:12px;margin-bottom:4px}
    .att-chip-email{flex:1;color:var(--t2)}
    .att-chip-remove{background:none;border:none;cursor:pointer;color:var(--t4);padding:0;line-height:1;font-size:14px}
    .att-chip-remove:hover{color:var(--danger)}
    .drag-time-tip{position:absolute;top:-22px;left:4px;background:var(--t);color:var(--w);font-size:10px;font-weight:700;font-family:var(--fm);padding:2px 6px;border-radius:4px;white-space:nowrap;pointer-events:none;z-index:20}
    .tl-evt-resize{position:absolute;bottom:0;left:0;right:0;height:6px;cursor:ns-resize;border-radius:0 0 4px 4px}
    .tl-evt-resize:hover{background:rgba(0,0,0,.08)}
    .evt-sh-attendees{margin:12px 0;border-top:1px solid var(--bl);padding-top:12px}
    .evt-sh-att-label{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
    .evt-sh-att-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
    .evt-sh-att-av{width:28px;height:28px;border-radius:50%;background:var(--hover);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--t2);flex-shrink:0}
    .evt-sh-att-info{flex:1;min-width:0}
    .evt-sh-att-name{font-size:12px;font-weight:600;color:var(--t);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .evt-sh-att-email{font-size:11px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

    /* ── Sidebar booking links ── */
    .bk-sidebar-section{border-top:1px solid var(--bl);padding:4px 0}
    .bk-sidebar-hdr{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;cursor:pointer;padding:8px 16px;font-family:var(--fm);color:var(--t2)}
    .bk-sidebar-hdr-icon{font-size:10px;color:var(--t4);flex-shrink:0}
    .bk-sidebar-hdr-label{flex:1;font-size:12px;font-weight:600;text-align:left}
    .bk-sidebar-add{background:none;border:none;cursor:pointer;color:var(--t3);padding:2px 4px;border-radius:4px;line-height:1;display:flex;align-items:center}
    .bk-sidebar-add:hover{color:var(--t);background:var(--hover)}
    .bk-sidebar-list{padding:0 8px 8px}
    .bk-sidebar-empty{font-size:11px;color:var(--t4);padding:8px 8px;font-family:var(--fm)}
    .bk-sidebar-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:default}
    .bk-sidebar-item:hover{background:var(--hover)}
    .bk-sidebar-dot{width:8px;height:8px;border-radius:50%;background:var(--blue);flex-shrink:0}
    .bk-sidebar-info{flex:1;min-width:0}
    .bk-sidebar-name{font-size:12px;font-weight:600;color:var(--t);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--fm)}
    .bk-sidebar-meta{font-size:10px;color:var(--t3);font-family:var(--fm)}
    .bk-sidebar-copy,.bk-sidebar-del{background:none;border:none;cursor:pointer;color:var(--t4);padding:4px;border-radius:4px;display:flex;align-items:center;opacity:0}
    .bk-sidebar-item:hover .bk-sidebar-copy,.bk-sidebar-item:hover .bk-sidebar-del{opacity:1}
    .bk-sidebar-del:hover{color:var(--danger)}
    .bk-sidebar-copy:hover{color:var(--t)}

    /* ── Public booking page ── */
    .bk-page{min-height:100vh;background:#f8fafc;font-family:var(--fm)}
    .bk-page-header{background:var(--w);border-bottom:1px solid var(--bl);padding:16px 24px;display:flex;align-items:center;gap:12px}
    .bk-page-brand{font-size:14px;font-weight:700;color:var(--t);letter-spacing:-.3px}
    .bk-page-body{max-width:860px;margin:0 auto;padding:32px 16px;display:grid;grid-template-columns:280px 1fr;gap:24px}
    @media(max-width:600px){.bk-page-body{grid-template-columns:1fr;padding:16px}}
    .bk-page-info{background:var(--w);border-radius:12px;border:1px solid var(--bl);padding:24px}
    .bk-page-host{display:flex;align-items:center;gap:12px;margin-bottom:20px}
    .bk-page-av{width:44px;height:44px;border-radius:50%;background:var(--t);color:var(--w);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700}
    .bk-page-meta{font-size:12px;color:var(--t3);margin-top:4px;display:flex;flex-direction:column;gap:4px}
    .bk-page-right{display:flex;flex-direction:column;gap:16px}
    .bk-cal-nav{display:flex;align-items:center;gap:8px;margin-bottom:12px}
    .bk-cal-nav-title{flex:1;font-size:14px;font-weight:700;color:var(--t)}
    .bk-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
    .bk-cal-dh{font-size:10px;font-weight:600;color:var(--t3);text-align:center;padding:4px 0}
    .bk-cal-day{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:13px;font-weight:500;color:var(--t2);cursor:default}
    .bk-cal-day.avail{cursor:pointer;color:var(--t);font-weight:600}
    .bk-cal-day.avail:hover{background:var(--hover)}
    .bk-cal-day.sel{background:var(--t);color:var(--w)}
    .bk-cal-day.oth{color:var(--t4)}
    .bk-slots-panel{background:var(--w);border-radius:12px;border:1px solid var(--bl);padding:20px}
    .bk-slots-date{font-size:14px;font-weight:700;color:var(--t);margin-bottom:14px;text-transform:capitalize}
    .bk-slots-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}
    .bk-slot-btn{padding:10px;border-radius:8px;border:1.5px solid var(--brd);background:var(--w);font-size:13px;font-weight:600;color:var(--t);cursor:pointer;font-family:var(--fm);transition:all .1s}
    .bk-slot-btn:hover{border-color:var(--t);background:var(--hover)}
    .bk-slot-btn.sel{background:var(--t);color:var(--w);border-color:var(--t)}
    .bk-slot-btn:disabled{opacity:.35;cursor:not-allowed}
    .bk-confirm-panel{background:var(--w);border-radius:12px;border:1px solid var(--bl);padding:20px;display:flex;flex-direction:column;gap:12px}
    .bk-confirm-slot{font-size:13px;font-weight:600;color:var(--t);background:var(--hover);padding:10px 14px;border-radius:8px;margin-bottom:4px}
    .bk-done-panel{background:var(--w);border-radius:12px;border:1px solid var(--bl);padding:32px;text-align:center}
    .bk-done-icon{font-size:40px;margin-bottom:12px}
    .bk-done-title{font-size:20px;font-weight:700;color:var(--t);margin-bottom:6px}
    .bk-done-sub{font-size:13px;color:var(--t3);margin-bottom:20px}

    .auth-submit{
      width:100%;padding:14px;border-radius:var(--r);border:none;
      background:var(--t);color:var(--w);font-size:15px;font-weight:600;
      font-family:var(--f);cursor:pointer;transition:all .12s;
      letter-spacing:-0.2px;display:flex;align-items:center;justify-content:center;
      min-height:48px;
    }
    .auth-submit:hover{opacity:.9}
    .auth-submit:active{transform:scale(.98)}
    .auth-submit:disabled{opacity:.6;pointer-events:none}

    .auth-spinner{
      width:20px;height:20px;border:2px solid rgba(255,255,255,.3);
      border-top-color:white;border-radius:50%;
      animation:spin .6s linear infinite;
    }
    @keyframes spin{to{transform:rotate(360deg)}}

    .auth-link{
      display:block;width:100%;border:none;background:none;
      color:var(--t3);font-size:12px;font-family:var(--f);
      cursor:pointer;margin-top:10px;text-align:center;
      transition:color .12s;
    }
    .auth-link:hover{color:var(--t)}

    .auth-toggle{
      text-align:center;font-size:13px;color:var(--t3);
      padding-top:16px;border-top:1px solid var(--bl);
    }
    .auth-toggle-btn{
      border:none;background:none;color:var(--t);font-weight:600;
      font-family:var(--f);cursor:pointer;font-size:13px;
      text-decoration:underline;text-underline-offset:2px;
    }
    .auth-toggle-btn:hover{opacity:.7}

    /* User menu in app */
    .user-avatar{
      width:36px;height:36px;border-radius:50%;background:var(--t);
      color:var(--w);display:flex;align-items:center;justify-content:center;
      font-weight:700;font-size:13px;cursor:pointer;transition:all .12s;
      border:none;flex-shrink:0;
    }
    .user-avatar:hover{opacity:.8}
    .user-menu{
      position:fixed;top:60px;right:16px;background:var(--w);
      border-radius:var(--r);border:1px solid var(--brd);
      box-shadow:0 8px 30px rgba(0,0,0,.1);z-index:90;
      min-width:220px;overflow:hidden;animation:authIn .15s ease;
    }
    .user-menu-header{padding:14px 16px;border-bottom:1px solid var(--bl)}
    .user-menu-name{font-size:14px;font-weight:600}
    .user-menu-email{font-size:11px;color:var(--t3);font-family:var(--fm);margin-top:1px}
    .user-menu-item{
      display:flex;align-items:center;gap:8px;padding:12px 16px;
      border:none;background:none;width:100%;cursor:pointer;
      font-family:var(--f);font-size:13px;color:var(--t2);
      transition:all .12s;text-align:left;
    }
    .user-menu-item:hover{background:var(--hover);color:var(--t)}
    .user-menu-item.danger{color:var(--danger)}
    .user-menu-item.danger:hover{background:var(--dbg)}

    @keyframes fi{from{opacity:0}to{opacity:1}}
    @keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
    @keyframes ti{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

    /* ── Multi-day view ── */
    .dtl-view-btns{display:flex;gap:2px;background:var(--bg);border-radius:8px;padding:2px}
    .dtl-view-btn{padding:4px 10px;border:none;border-radius:6px;font-size:11px;font-weight:600;font-family:var(--fm);cursor:pointer;color:var(--t3);background:transparent;transition:all .12s;letter-spacing:-.2px}
    .dtl-view-btn.active{background:var(--w);color:var(--t);box-shadow:0 1px 4px rgba(0,0,0,.08)}
    .dtl-day-hdr{display:flex;flex-direction:column;align-items:center;padding:6px 4px;cursor:pointer;gap:2px}
    .dtl-day-name{font-size:10px;font-weight:600;color:var(--t3);font-family:var(--fm);text-transform:uppercase;letter-spacing:.5px}
    .dtl-day-num{font-size:18px;font-weight:700;color:var(--t2);width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%}
    .dtl-day-num.today{background:var(--t);color:var(--w)}
    .dtl-day-num.sel:not(.today){background:var(--hover);color:var(--t)}
    .dtl-allday-chip{font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;margin-bottom:2px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `}</style>
);

// ── Swipe-to-dismiss hook ──
function useSwipeDismiss(ref, onDismiss) {
  const drag = useRef({startY:0,cur:0,active:false});
  
  const onTS = useCallback(e => {
    drag.current = {startY:e.touches[0].clientY, cur:e.touches[0].clientY, active:true};
  },[]);
  const onTM = useCallback(e => {
    if(!drag.current.active) return;
    const dy = e.touches[0].clientY - drag.current.startY;
    drag.current.cur = e.touches[0].clientY;
    if(dy > 0 && ref.current) ref.current.style.transform = `translateY(${dy}px)`;
  },[ref]);
  const onTE = useCallback(() => {
    const dy = drag.current.cur - drag.current.startY;
    drag.current.active = false;
    if(dy > 80) onDismiss();
    else if(ref.current) ref.current.style.transform = '';
  },[ref,onDismiss]);
  const onMD = useCallback(e => {
    drag.current = {startY:e.clientY, cur:e.clientY, active:true};
    const mv = ev => { const dy=ev.clientY-drag.current.startY; drag.current.cur=ev.clientY; if(dy>0&&ref.current)ref.current.style.transform=`translateY(${dy}px)`; };
    const up = () => { const dy=drag.current.cur-drag.current.startY; drag.current.active=false; if(dy>80)onDismiss(); else if(ref.current)ref.current.style.transform=''; window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
    window.addEventListener('mousemove',mv);
    window.addEventListener('mouseup',up);
  },[ref,onDismiss]);

  return {onTouchStart:onTS,onTouchMove:onTM,onTouchEnd:onTE,onMouseDown:onMD};
}

// ── Event Detail Sheet ──
function EventDetail({evt,cal,onClose,onEdit,onDelete,onToggleDone}){
  const ref=useRef(null);
  const [phase,setPhase]=useState("entering");
  useEffect(()=>{const t=setTimeout(()=>setPhase("idle"),300);return()=>clearTimeout(t)},[]);
  const dismiss=useCallback(()=>{setPhase("dismissing");setTimeout(onClose,250)},[onClose]);
  const sw=useSwipeDismiss(ref,dismiss);
  return(
    <>
      <div className="evt-ov" onClick={dismiss}/>
      <div ref={ref} className={`evt-sh ${phase}`}>
        <div className="evt-sh-grab" {...sw}><div className="evt-sh-bar"/></div>
        <div className="evt-sh-head" {...sw}>
          <div className="evt-sh-dot" style={{background:cal?.color}}/>
          <div className="evt-sh-info">
            <div className="evt-sh-cal">
              {evt.isTask && <span style={{background:"var(--bg)",padding:"1px 6px",borderRadius:4,fontSize:10,fontWeight:600,marginRight:4,letterSpacing:".3px"}}>TAREA</span>}
              {cal?.name} · {cal?.account?.email}
            </div>
            <div className="evt-sh-title">{evt.title}</div>
          </div>
          <button className="ib" onClick={dismiss} style={{flexShrink:0}}>{I.x}</button>
        </div>
        <div className="evt-sh-body">
          {evt.isTask && (
            <button className="btn-g" onClick={onToggleDone} style={{marginBottom:12,marginTop:0,borderColor:evt.done?"var(--ok)":"var(--brd)",color:evt.done?"var(--ok)":"var(--t2)"}}>
              {evt.done ? I.taskDone : I.taskOpen}
              {evt.done ? " Completada" : " Marcar como completada"}
            </button>
          )}
          {!evt.isTask && <div className="evt-sh-row">{I.clock}<span>{evt.allDay?"Todo el día":`${fmt(evt.sh,evt.sm)} – ${fmt(evt.eh,evt.em)}`}</span></div>}
          {evt.isTask && <div className="evt-sh-row">{I.clock}<span>{fmt(evt.sh,evt.sm)} – {fmt(evt.eh,evt.em)}</span></div>}
          <div className="evt-sh-row">{I.cal}<span>{evt.isTask?"Fecha límite: ":""}{evt.date.toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"})}</span></div>
          {evt.loc&&<div className="evt-sh-row">{I.pin}<span>{evt.loc}</span></div>}
          {evt.videoLink&&<div className="evt-sh-row">{I.video}<a href={evt.videoLink} target="_blank" rel="noopener noreferrer" style={{color:"var(--blue)",textDecoration:"none",fontWeight:500}} onClick={e=>e.stopPropagation()}>Unirse a videollamada</a></div>}
          {evt.priority && (
            <div className="evt-sh-row">{I.task}<span>Prioridad: {evt.priority==="high"?"Alta":evt.priority==="medium"?"Media":"Baja"}</span></div>
          )}
          {evt.desc&&<div className="evt-sh-desc">{evt.desc}</div>}
          {evt.attendees?.length>0&&(
            <div className="evt-sh-attendees">
              <div className="evt-sh-att-label">{I.users} Invitados ({evt.attendees.length})</div>
              {evt.attendees.map((a,i)=>{
                const statusIcon=a.status==="accepted"?"✓":a.status==="declined"?"✗":a.status==="tentative"?"~":"?";
                const statusColor=a.status==="accepted"?"var(--ok)":a.status==="declined"?"var(--danger)":a.status==="tentative"?"#f59e0b":"var(--t4)";
                return(
                  <div key={i} className="evt-sh-att-row">
                    <span className="evt-sh-att-av">{(a.name||a.email)[0].toUpperCase()}</span>
                    <div className="evt-sh-att-info">
                      {a.name&&<div className="evt-sh-att-name">{a.name}</div>}
                      <div className="evt-sh-att-email">{a.email}</div>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,color:statusColor,flexShrink:0}}>{statusIcon}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="evt-sh-acts">
            <button className="btn-g" onClick={onEdit}>{I.edit} Editar</button>
            <button className="btn-g dng" onClick={onDelete}>{I.trash} Eliminar</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Public Booking Page ──────────────────────────────────────────────────────
function BookingPage({ linkId }) {
  const [link, setLink] = useState(null);
  const [takenSlots, setTakenSlots] = useState([]);
  const [selDate, setSelDate] = useState(null);
  const [selSlot, setSelSlot] = useState(null);
  const [step, setStep] = useState("cal"); // "cal" | "form" | "done"
  const [form, setForm] = useState({ name: "", email: "" });
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState(null);
  const [pageError, setPageError] = useState("");
  const [formErr, setFormErr] = useState("");
  const [vM, setVM] = useState(new Date().getMonth());
  const [vY, setVY] = useState(new Date().getFullYear());

  const DAYS_SHORT = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
  const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.rpc("get_booking_link_public", { p_id: linkId });
      if (error || !data) { setPageError("Link no encontrado o expirado."); setLoading(false); return; }
      setLink(data);
      // Fetch confirmed bookings (to exclude taken slots)
      const { data: bks } = await supabase
        .from("booking_requests")
        .select("slot_date,slot_sh,slot_sm")
        .eq("link_id", linkId)
        .eq("status", "confirmed");
      setTakenSlots(bks || []);
      // Set initial date to date_from or today
      const from = new Date(data.date_from + "T00:00:00");
      const initial = from > new Date() ? from : new Date();
      initial.setHours(0,0,0,0);
      setSelDate(initial);
      setVM(initial.getMonth()); setVY(initial.getFullYear());
      setLoading(false);
    };
    load();
  }, [linkId]);

  // Build available slots for a given date
  const getSlotsForDate = (date) => {
    if (!link) return [];
    const dateStr = date.toISOString().split("T")[0];
    const dateFrom = new Date(link.date_from + "T00:00:00");
    const dateTo = new Date(link.date_to + "T23:59:59");
    dateFrom.setHours(0,0,0,0);
    if (date < dateFrom || date > dateTo) return [];
    const dow = date.getDay() === 0 ? 7 : date.getDay(); // 1=Mon..7=Sun
    if (!link.weekdays.includes(dow === 7 ? 0 : dow)) return [];

    // Busy blocks from snapshot + taken slots from bookings
    const busy = [
      ...(link.busy_blocks || []).filter(b => b.date === dateStr).map(b => ({ s: b.sh*60+b.sm, e: b.eh*60+b.em })),
      ...takenSlots.filter(b => b.slot_date === dateStr).map(b => ({ s: b.slot_sh*60+b.slot_sm, e: b.slot_sh*60+b.slot_sm+link.duration })),
    ].sort((a,b) => a.s - b.s);

    const slots = [];
    let cursor = link.hour_start * 60;
    const endOfDay = link.hour_end * 60;
    for (const evt of busy) {
      const evtStart = evt.s - link.buffer;
      const evtEnd = evt.e + link.buffer;
      while (cursor + link.duration <= Math.min(evtStart, endOfDay)) {
        slots.push({ sh: Math.floor(cursor/60), sm: cursor%60 });
        cursor += link.duration + link.buffer;
      }
      cursor = Math.max(cursor, evtEnd);
    }
    while (cursor + link.duration <= endOfDay) {
      slots.push({ sh: Math.floor(cursor/60), sm: cursor%60 });
      cursor += link.duration + link.buffer;
    }
    if (link.max_per_day > 0) return slots.slice(0, link.max_per_day);
    return slots;
  };

  // Build calendar cells for current month
  const calCells = useMemo(() => {
    if (!link) return [];
    const cells = [];
    const firstDow = new Date(vY, vM, 1).getDay(); // 0=Sun
    const firstMon = firstDow === 0 ? 6 : firstDow - 1; // shift to Mon-start
    const dim = new Date(vY, vM+1, 0).getDate();
    const prevDim = new Date(vY, vM, 0).getDate();
    for (let i = firstMon-1; i >= 0; i--) {
      const d = new Date(vY, vM-1 === -1 ? 11 : vM-1, prevDim-i);
      cells.push({ date: d, oth: true });
    }
    for (let i = 1; i <= dim; i++) cells.push({ date: new Date(vY, vM, i), oth: false });
    while (cells.length < 42) {
      const n = cells.length - firstMon - dim + 1;
      cells.push({ date: new Date(vY, vM+1 === 12 ? 0 : vM+1, n), oth: true });
    }
    return cells;
  }, [vM, vY, link]);

  const dateHasSlots = (date) => {
    if (!link) return false;
    return getSlotsForDate(date).length > 0;
  };

  const selSlots = selDate ? getSlotsForDate(selDate) : [];
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtTime = (sh, sm) => `${pad2(sh)}:${pad2(sm)}`;
  const fmtDate = (d) => d ? d.toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"}) : "";

  const handleConfirm = async () => {
    if (!form.name.trim()) { setFormErr("Ingresá tu nombre"); return; }
    if (!form.email.trim() || !form.email.includes("@")) { setFormErr("Ingresá un email válido"); return; }
    setFormErr(""); setBooking(true);
    try {
      const { data, error } = await supabase.functions.invoke("book-slot", {
        body: {
          link_id: linkId,
          guest_name: form.name.trim(),
          guest_email: form.email.trim(),
          slot_date: selDate.toISOString().split("T")[0],
          slot_sh: selSlot.sh,
          slot_sm: selSlot.sm,
        },
      });
      if (error) {
        let msg = error.message || "Error al confirmar";
        try {
          const text = await error.context?.text();
          if (text) {
            const body = JSON.parse(text);
            if (body?.error === "SLOT_TAKEN") { setFormErr("Este horario ya fue reservado. Elegí otro."); setBooking(false); return; }
            msg = body?.error || msg;
          }
        } catch {}
        setFormErr("Error: " + msg);
        setBooking(false); return;
      }
      setResult(data);
      setStep("done");
      setTakenSlots(ts => [...ts, { slot_date: selDate.toISOString().split("T")[0], slot_sh: selSlot.sh, slot_sm: selSlot.sm }]);
    } catch(e) {
      setFormErr("Error: " + (e.message || "conexión fallida"));
    }
    setBooking(false);
  };

  if (loading) {
    return (
      <div className="bk-page" style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
        <CSS />
        <div style={{fontSize:14,color:"#6b7280",fontFamily:"sans-serif"}}>Cargando...</div>
      </div>
    );
  }
  if (pageError || !link) {
    return (
      <div className="bk-page" style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
        <CSS />
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:12}}>🗓</div>
          <div style={{fontSize:16,fontWeight:700,color:"#111",marginBottom:8}}>Link no encontrado</div>
          <div style={{fontSize:13,color:"#6b7280"}}>{pageError || "Este link de agendamiento no existe o expiró."}</div>
        </div>
      </div>
    );
  }

  const endMin = selSlot ? selSlot.sh*60+selSlot.sm+(link.duration||30) : 0;
  const endH = Math.floor(endMin/60), endM = endMin%60;

  return (
    <div className="bk-page">
      <CSS />
      {/* Header */}
      <div className="bk-page-header">
        <span style={{fontSize:18}}>🗓</span>
        <span className="bk-page-brand">Maestro</span>
      </div>

      {step === "done" ? (
        <div style={{maxWidth:480,margin:"40px auto",padding:"0 16px"}}>
          <div className="bk-done-panel">
            <div className="bk-done-icon">✅</div>
            <div className="bk-done-title">¡Reserva confirmada!</div>
            <div className="bk-done-sub">
              Se agendó <strong>{link.title}</strong> el{" "}
              <strong style={{textTransform:"capitalize"}}>{fmtDate(selDate)}</strong>{" "}
              de <strong>{fmtTime(selSlot.sh,selSlot.sm)}</strong> a{" "}
              <strong>{fmtTime(endH,endM)}</strong>.
              <br/>Un evento fue creado en el calendario del organizador y te enviaron una invitación a <strong>{form.email}</strong>.
            </div>
            {result?.meetLink && (
              <a href={result.meetLink} target="_blank" rel="noopener noreferrer"
                style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 20px",background:"#1a73e8",color:"#fff",borderRadius:8,textDecoration:"none",fontWeight:600,fontSize:14}}>
                📹 Unirse a Google Meet
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="bk-page-body">
          {/* Left: host info + nav (desktop) or just title+slots (mobile) */}
          <div className="bk-page-info">
            <div className="bk-page-host">
              <div className="bk-page-av">{(link.user_slug||"M")[0].toUpperCase()}</div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#111"}}>{link.user_slug?.replace(/-/g," ")}</div>
              </div>
            </div>
            <div style={{fontSize:18,fontWeight:700,color:"#111",marginBottom:16}}>{link.title}</div>
            <div className="bk-page-meta">
              <span>⏱ {link.duration} min</span>
              {link.add_video && <span>📹 Google Meet</span>}
            </div>

            {step === "form" && selSlot && (
              <div style={{marginTop:20}}>
                <div className="bk-confirm-slot">
                  📅 {fmtDate(selDate)}<br/>
                  🕐 {fmtTime(selSlot.sh,selSlot.sm)} – {fmtTime(endH,endM)}
                </div>
                <div className="bk-confirm-panel">
                  <div className="fg">
                    <label className="fl">Tu nombre *</label>
                    <input className="fi" placeholder="Juan García" value={form.name}
                      onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
                  </div>
                  <div className="fg">
                    <label className="fl">Tu email *</label>
                    <input className="fi" type="email" placeholder="juan@ejemplo.com" value={form.email}
                      onChange={e=>setForm(f=>({...f,email:e.target.value}))}/>
                  </div>
                  {formErr && <div style={{color:"var(--danger)",fontSize:12,fontFamily:"var(--fm)"}}>{formErr}</div>}
                  <button className="btn-m" onClick={handleConfirm} disabled={booking} style={{marginTop:4}}>
                    {booking ? "Confirmando..." : "Confirmar reserva"}
                  </button>
                  <button className="btn-g" onClick={()=>{setStep("cal");setSelSlot(null);setFormErr("")}} style={{marginTop:0}}>
                    ← Volver
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: calendar + slots */}
          {step === "cal" && (
            <div className="bk-page-right">
              {/* Month nav */}
              <div className="bk-slots-panel">
                <div className="bk-cal-nav">
                  <button className="tl-nav-btn" onClick={()=>{ if(vM===0){setVM(11);setVY(y=>y-1)}else setVM(m=>m-1) }}>‹</button>
                  <span className="bk-cal-nav-title">{MONTHS_ES[vM]} {vY}</span>
                  <button className="tl-nav-btn" onClick={()=>{ if(vM===11){setVM(0);setVY(y=>y+1)}else setVM(m=>m+1) }}>›</button>
                </div>
                {/* Day headers Mon-Sun */}
                <div className="bk-cal-grid">
                  {DAYS_SHORT.map(d => <div key={d} className="bk-cal-dh">{d}</div>)}
                  {calCells.map((c,i) => {
                    const today = new Date(); today.setHours(0,0,0,0);
                    const isPast = c.date < today;
                    const hasSlots = !c.oth && !isPast && dateHasSlots(c.date);
                    const isSel = selDate && same(c.date, selDate);
                    return (
                      <div key={i}
                        className={`bk-cal-day${c.oth||isPast?"":" "}${hasSlots?" avail":""}${isSel?" sel":""}`}
                        style={{opacity: c.oth||isPast ? 0.3 : 1}}
                        onClick={() => { if(hasSlots){ setSelDate(new Date(c.date)); setSelSlot(null); } }}>
                        {c.date.getDate()}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Time slots for selected date */}
              {selDate && (
                <div className="bk-slots-panel">
                  <div className="bk-slots-date">{fmtDate(selDate)}</div>
                  {selSlots.length === 0 ? (
                    <div style={{fontSize:13,color:"#9ca3af",padding:"8px 0"}}>Sin disponibilidad este día</div>
                  ) : (
                    <div className="bk-slots-grid">
                      {selSlots.map((s,i) => {
                        const isSel = selSlot && s.sh===selSlot.sh && s.sm===selSlot.sm;
                        return (
                          <button key={i} className={`bk-slot-btn${isSel?" sel":""}`}
                            onClick={() => { setSelSlot(s); setStep("form"); setFormErr(""); }}>
                            {fmtTime(s.sh,s.sm)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Booking Link Builder ──
function BookingBuilder({ events, accounts, enabledCals, user, onFlash, onClose, onLinkCreated }) {
  const [bk, setBk] = useState({
    title: "Reunión con " + (user?.name || ""),
    duration: 30,
    dateFrom: (() => { const d=new Date(); d.setDate(d.getDate()+1); return d.toISOString().split("T")[0]; })(),
    dateTo: (() => { const d=new Date(); d.setDate(d.getDate()+14); return d.toISOString().split("T")[0]; })(),
    hourStart: 9,
    hourEnd: 18,
    weekdays: [1,2,3,4,5],
    buffer: 15,
    maxPerDay: 4,
    addVideo: true,
    targetCal: accounts.filter(a=>a.on).flatMap(a=>a.cals.filter(c=>c.on))[0]?.id || "",
  });
  const [generated, setGenerated] = useState(null);

  const WDAYS = [{v:1,l:"Lun"},{v:2,l:"Mar"},{v:3,l:"Mié"},{v:4,l:"Jue"},{v:5,l:"Vie"},{v:6,l:"Sáb"},{v:0,l:"Dom"}];
  const PROVIDERS = [{id:"google",name:"Google",icon:"G",bg:"#EA4335"},{id:"outlook",name:"Outlook",icon:"O",bg:"#0078D4"},{id:"apple",name:"Apple",icon:"",bg:"#333"}];

  // Resolve which account/provider owns the target calendar
  const getCalInfo = (calId) => {
    for (const a of accounts) for (const c of a.cals) if (c.id === calId) return { cal: c, account: a, prov: PROVIDERS.find(p=>p.id===a.provider) };
    return null;
  };
  const targetInfo = getCalInfo(bk.targetCal);
  const videoLabel = targetInfo?.prov?.id === "google" ? "Google Meet"
    : targetInfo?.prov?.id === "outlook" ? "Microsoft Teams"
    : targetInfo?.prov?.id === "apple" ? "FaceTime" : "Videoconferencia";

  // Calculate available slots based on all calendar events
  const getSlots = useCallback(() => {
    const slots = [];
    const from = new Date(bk.dateFrom + "T00:00:00");
    const to = new Date(bk.dateTo + "T23:59:59");
    const d = new Date(from);
    while (d <= to) {
      const date = new Date(d);
      date.setHours(0,0,0,0);
      const dow = date.getDay();
      if (!bk.weekdays.includes(dow)) { d.setDate(d.getDate()+1); continue; }

      // Get all events for this day across ALL calendars
      const dayEvents = events.filter(e =>
        same(e.date, date) && !e.allDay && (e.isTask || enabledCals.includes(e.cid))
      ).map(e => ({ s: e.sh * 60 + e.sm, e: e.eh * 60 + e.em }))
       .sort((a, b) => a.s - b.s);

      // Find free windows
      let slotsForDay = [];
      let cursor = bk.hourStart * 60;
      const endOfDay = bk.hourEnd * 60;

      for (const evt of dayEvents) {
        // Add buffer around events
        const evtStart = evt.s - bk.buffer;
        const evtEnd = evt.e + bk.buffer;
        while (cursor + bk.duration <= Math.min(evtStart, endOfDay)) {
          slotsForDay.push({ date: new Date(date), sh: Math.floor(cursor/60), sm: cursor%60 });
          cursor += bk.duration + bk.buffer;
        }
        cursor = Math.max(cursor, evtEnd);
      }
      // Remaining time after last event
      while (cursor + bk.duration <= endOfDay) {
        slotsForDay.push({ date: new Date(date), sh: Math.floor(cursor/60), sm: cursor%60 });
        cursor += bk.duration + bk.buffer;
      }

      if (bk.maxPerDay > 0) slotsForDay = slotsForDay.slice(0, bk.maxPerDay);
      slots.push(...slotsForDay);
      d.setDate(d.getDate()+1);
    }
    return slots;
  }, [bk, events, enabledCals]);

  const availSlots = useMemo(() => getSlots(), [getSlots]);

  // Group by date for display
  const slotsByDate = useMemo(() => {
    const map = {};
    availSlots.forEach(s => {
      const key = s.date.toISOString().split("T")[0];
      if (!map[key]) map[key] = { date: s.date, slots: [] };
      map[key].slots.push(s);
    });
    return Object.values(map);
  }, [availSlots]);

  const generateLink = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const refreshToken = session?.provider_refresh_token;
    if (!refreshToken) { onFlash("Necesitás reautenticarte con Google"); return; }

    const id = Math.random().toString(36).substr(2, 8);
    const slug = user?.name?.toLowerCase().replace(/\s+/g, "-") || "user";
    const busyBlocks = events
      .filter(e => !e.allDay && (e.isTask || enabledCals.includes(e.cid)))
      .map(e => ({
        date: e.date.toISOString().split("T")[0],
        sh: e.sh, sm: e.sm, eh: e.eh, em: e.em,
      }));

    const { error } = await supabase.from("booking_links").insert({
      id,
      user_id: session.user.id,
      user_slug: slug,
      title: bk.title,
      duration: bk.duration,
      date_from: bk.dateFrom,
      date_to: bk.dateTo,
      hour_start: bk.hourStart,
      hour_end: bk.hourEnd,
      weekdays: bk.weekdays,
      buffer: bk.buffer,
      max_per_day: bk.maxPerDay,
      add_video: bk.addVideo,
      target_cal: bk.targetCal,
      busy_blocks: busyBlocks,
      refresh_token: refreshToken,
    });
    if (error) { onFlash("Error al guardar link: " + error.message); return; }

    const link = `${window.location.origin}/book/${id}`;
    setGenerated(link);
    onFlash("Link creado");
    onLinkCreated?.();
  };

  const copyLink = () => {
    if (generated) {
      navigator.clipboard?.writeText(generated).then(() => onFlash("Link copiado")).catch(() => onFlash("Link copiado"));
    }
  };

  const toggleDay = (v) => {
    setBk(b => ({
      ...b,
      weekdays: b.weekdays.includes(v) ? b.weekdays.filter(x=>x!==v) : [...b.weekdays, v]
    }));
    setGenerated(null);
  };

  return (
    <div className="booking-builder">
      {/* Hero */}
      <div className="bk-hero">
        <div className="bk-hero-icon">{I.share}</div>
        <div className="bk-hero-text">
          <div className="bk-hero-title">Link de agendamiento</div>
          <div className="bk-hero-desc">Compartí este link y dejá que otros agenden en tus horarios disponibles. Maestro revisa todos tus calendarios.</div>
        </div>
      </div>

      {/* Title */}
      <div className="fg">
        <label className="fl">{I.edit} Título de la reunión</label>
        <input className="fi" value={bk.title}
          onChange={e => { setBk(b=>({...b,title:e.target.value})); setGenerated(null); }}
          placeholder="Ej: Reunión introductoria" />
      </div>

      {/* Duration */}
      <div className="fg">
        <label className="fl">{I.clock} Duración</label>
        <div className="bk-dur-row">
          {[15,30,45,60,90].map(m => (
            <button key={m} className={`bk-dur ${bk.duration===m?"sel":""}`}
              onClick={() => { setBk(b=>({...b,duration:m})); setGenerated(null); }}>
              {m < 60 ? `${m}min` : `${m/60}h`}
            </button>
          ))}
        </div>
      </div>

      <div className="form-div" />

      {/* Availability window */}
      <div className="fg">
        <label className="fl">{I.cal} Ventana de disponibilidad</label>
        <div className="fr">
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>Desde</div>
            <input type="date" className="fi" value={bk.dateFrom}
              onChange={e=>{setBk(b=>({...b,dateFrom:e.target.value}));setGenerated(null)}} />
          </div>
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>Hasta</div>
            <input type="date" className="fi" value={bk.dateTo}
              onChange={e=>{setBk(b=>({...b,dateTo:e.target.value}));setGenerated(null)}} />
          </div>
        </div>
      </div>

      {/* Hours */}
      <div className="fg">
        <label className="fl">{I.clock} Horario</label>
        <div className="fr">
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>Desde</div>
            <select className="fi" value={bk.hourStart} onChange={e=>{setBk(b=>({...b,hourStart:+e.target.value}));setGenerated(null)}}>
              {Array.from({length:14},(_,i)=>i+6).map(h => (<option key={h} value={h}>{pad(h)}:00</option>))}
            </select>
          </div>
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>Hasta</div>
            <select className="fi" value={bk.hourEnd} onChange={e=>{setBk(b=>({...b,hourEnd:+e.target.value}));setGenerated(null)}}>
              {Array.from({length:14},(_,i)=>i+10).map(h => (<option key={h} value={h}>{pad(h)}:00</option>))}
            </select>
          </div>
        </div>
      </div>

      {/* Weekdays */}
      <div className="fg">
        <label className="fl">{I.cal} Días disponibles</label>
        <div className="bk-days">
          {WDAYS.map(d => (
            <button key={d.v} className={`bk-day ${bk.weekdays.includes(d.v)?"sel":""}`}
              onClick={() => toggleDay(d.v)}>{d.l}</button>
          ))}
        </div>
      </div>

      <div className="form-div" />

      {/* Options */}
      <div className="fg">
        <label className="fl">{I.cal} Agendar en calendario</label>
        <div className="cal-sel">
          {accounts.filter(a=>a.on).flatMap(a=>{
            const prov = getCalInfo(a.cals[0]?.id)?.prov;
            return a.cals.filter(c=>c.on).map(c=>(
              <div key={c.id}
                className={`cal-opt ${bk.targetCal===c.id?"sel":""}`}
                onClick={()=>{setBk(b=>({...b,targetCal:c.id}));setGenerated(null)}}>
                <div className="cal-opt-prov" style={{background:prov?.bg||"#333"}}>{prov?.icon||a.name[0]}</div>
                <div className="cal-opt-info">
                  <div className="cal-opt-name">{c.name}</div>
                  <div className="cal-opt-acc">{a.email}</div>
                </div>
                <div className="cal-opt-dot" style={{background:c.color}} />
                <div className="cal-opt-check">{bk.targetCal===c.id && I.check}</div>
              </div>
            ));
          })}
        </div>
      </div>

      <div className="fg">
        <label className="fl">{I.video} Videoconferencia</label>
        <div className="bk-opt" onClick={()=>{setBk(b=>({...b,addVideo:!b.addVideo}));setGenerated(null)}}>
          <Toggle checked={bk.addVideo} onChange={e=>{setBk(b=>({...b,addVideo:e.target.checked}));setGenerated(null)}} icons={false}/>
          <div>
            <div style={{fontSize:13,fontWeight:500}}>Agregar videoconferencia</div>
            <div style={{fontSize:11,color:"var(--t3)"}}>
              {bk.addVideo
                ? `Se creará un link de ${videoLabel} automáticamente`
                : "Sin videoconferencia"}
            </div>
          </div>
        </div>
      </div>

      <div className="fg">
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}>
            <label className="fl">Buffer</label>
            <select className="fi" value={bk.buffer} onChange={e=>{setBk(b=>({...b,buffer:+e.target.value}));setGenerated(null)}}>
              {[0,5,10,15,30].map(v => (<option key={v} value={v}>{v} min</option>))}
            </select>
          </div>
          <div style={{flex:1}}>
            <label className="fl">Máx por día</label>
            <select className="fi" value={bk.maxPerDay} onChange={e=>{setBk(b=>({...b,maxPerDay:+e.target.value}));setGenerated(null)}}>
              {[2,3,4,5,8,0].map(v => (<option key={v} value={v}>{v===0?"Sin límite":v}</option>))}
            </select>
          </div>
        </div>
      </div>

      <div className="form-div" />

      {/* Availability preview */}
      <div className="fg">
        <label className="fl">{I.globe} Vista previa de disponibilidad</label>
        <div className="bk-preview-summary">
          <span className="bk-slot-count">{availSlots.length}</span>
          <span>slots disponibles en {slotsByDate.length} días</span>
        </div>
        <div className="bk-slots-scroll">
          {slotsByDate.slice(0, 5).map((group, gi) => (
            <div key={gi} className="bk-day-group">
              <div className="bk-day-label">
                {group.date.toLocaleDateString("es-AR",{weekday:"short",day:"numeric",month:"short"})}
              </div>
              <div className="bk-slot-chips">
                {group.slots.map((s, si) => (
                  <span key={si} className="bk-slot-chip">{pad(s.sh)}:{pad(s.sm)}</span>
                ))}
              </div>
            </div>
          ))}
          {slotsByDate.length > 5 && (
            <div style={{fontSize:11,color:"var(--t4)",padding:"4px 0",fontFamily:"var(--fm)"}}>
              +{slotsByDate.length - 5} días más...
            </div>
          )}
          {availSlots.length === 0 && (
            <div style={{padding:16,textAlign:"center",color:"var(--t4)",fontSize:13}}>
              No hay disponibilidad con esta configuración
            </div>
          )}
        </div>
      </div>

      {/* Generate / Copy */}
      {!generated ? (
        <button className="btn-m" onClick={generateLink} disabled={availSlots.length===0}
          style={{marginTop:4,opacity:availSlots.length===0?.4:1}}>
          Generar link de agendamiento
        </button>
      ) : (
        <div className="bk-link-result">
          <div className="bk-link-box">
            <span className="bk-link-url">{generated}</span>
            <button className="bk-link-copy" onClick={copyLink}>{I.copy} Copiar</button>
          </div>
        </div>
      )}
    </div>
  );
}

const AUTH_ERRORS = {
  "Invalid login credentials": "Email o contraseña incorrectos.",
  "User already registered": "El email ya está registrado. Iniciá sesión.",
  "Email not confirmed": "Confirmá tu email antes de ingresar.",
  "Password should be at least 6 characters": "La contraseña debe tener al menos 6 caracteres.",
};
function authMsg(msg){ return AUTH_ERRORS[msg] || msg; }

// ── Auth Screen ──
function AuthScreen() {
  const [mode, setMode] = useState("login"); // login | register | forgot
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(""); setInfo("");
    if (mode === "forgot") {
      if (!email.trim() || !email.includes("@")) { setError("Ingresá un email válido"); return; }
      setLoading(true);
      const { error: e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      setLoading(false);
      if (e) { setError(authMsg(e.message)); return; }
      setInfo("Revisá tu email para recuperar la contraseña.");
      setMode("login");
      return;
    }
    if (!email.trim() || !email.includes("@")) { setError("Ingresá un email válido"); return; }
    if (pass.length < 6) { setError("La contraseña debe tener al menos 6 caracteres"); return; }
    if (mode === "register" && !name.trim()) { setError("Ingresá tu nombre"); return; }
    setLoading(true);
    if (mode === "register") {
      const { error: e } = await supabase.auth.signUp({ email, password: pass, options: { data: { full_name: name } } });
      setLoading(false);
      if (e) { setError(authMsg(e.message)); return; }
      setInfo("¡Cuenta creada! Revisá tu email para confirmarla y luego iniciá sesión.");
      setMode("login"); setPass("");
    } else {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password: pass });
      setLoading(false);
      if (e) { setError(authMsg(e.message)); }
    }
  };

  const googleLogin = async () => {
    setLoading(true);
    try {
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: "https://www.googleapis.com/auth/calendar email profile",
          redirectTo: window.location.origin,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
    } catch {
      setError("Error al conectar con Google. Intentá de nuevo.");
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-bg" />
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <span className="auth-brand">Maestro</span>
          <span className="auth-tagline">Todos tus calendarios, un solo lugar.</span>
        </div>

        {/* Provider buttons */}
        <div className="auth-providers">
          <button className="auth-prov-btn" onClick={googleLogin} disabled={loading}>
            <span className="auth-prov-icon" style={{background:"#fff",border:"1px solid #e5e7eb"}}><img src="https://developers.google.com/identity/images/g-logo.png" style={{width:18,height:18}}/></span>
            <span>Continuar con Google</span>
          </button>
          <button className="auth-prov-btn" disabled>
            <span className="auth-prov-icon" style={{background:"#fff",border:"1px solid #e5e7eb"}}><img src="https://upload.wikimedia.org/wikipedia/commons/c/cc/Microsoft_Outlook_Icon_%282025%E2%80%93present%29.svg" style={{width:18,height:18}}/></span>
            <span>Continuar con Outlook</span>
            <span style={{fontSize:10,color:"var(--t4)",marginLeft:"auto",fontStyle:"italic"}}>Próximamente</span>
          </button>
          <button className="auth-prov-btn" disabled>
            <span className="auth-prov-icon" style={{background:"#333"}}></span>
            <span>Continuar con Apple</span>
            <span style={{fontSize:10,color:"var(--t4)",marginLeft:"auto",fontStyle:"italic"}}>Próximamente</span>
          </button>
        </div>

        {/* Divider */}
        <div className="auth-divider">
          <div className="auth-div-line" />
          <span className="auth-div-text">o con email</span>
          <div className="auth-div-line" />
        </div>

        {/* Form */}
        <div className="auth-form">
          {mode === "register" && (
            <div className="auth-fg">
              <label className="auth-fl">Nombre</label>
              <input className="auth-fi" placeholder="Tu nombre"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          <div className="auth-fg">
            <label className="auth-fl">Email</label>
            <input className="auth-fi" type="email" placeholder="tu@email.com"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          {mode !== "forgot" && (
            <div className="auth-fg">
              <label className="auth-fl">Contraseña</label>
              <input className="auth-fi" type="password" placeholder={mode === "register" ? "Mínimo 6 caracteres" : "Tu contraseña"}
                value={pass} onChange={e => setPass(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}
          {info && <div className="auth-info">{info}</div>}

          <button className="auth-submit" onClick={submit} disabled={loading}>
            {loading ? (
              <span className="auth-spinner" />
            ) : mode === "login" ? "Iniciar sesión" : mode === "register" ? "Crear cuenta" : "Enviar link de recuperación"}
          </button>

          {mode === "login" && (
            <button className="auth-link" onClick={() => { setMode("forgot"); setError(""); }}>
              ¿Olvidaste tu contraseña?
            </button>
          )}
        </div>

        {/* Toggle mode */}
        <div className="auth-toggle">
          {mode === "login" ? (
            <span>¿No tenés cuenta? <button className="auth-toggle-btn" onClick={() => { setMode("register"); setError(""); }}>Registrate</button></span>
          ) : (
            <span>¿Ya tenés cuenta? <button className="auth-toggle-btn" onClick={() => { setMode("login"); setError(""); }}>Iniciá sesión</button></span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──
function sessionToUser(session) {
  return {
    id: session.user.id,
    name: session.user.user_metadata?.full_name || session.user.email,
    email: session.user.email,
    picture: session.user.user_metadata?.avatar_url,
    accessToken: session.provider_token,
  };
}

export default function Maestro(){
  // Public booking page — no auth required
  const bookMatch = window.location.pathname.match(/^\/book\/([^/]+)/);
  if (bookMatch) {
    return <><CSS /><BookingPage linkId={bookMatch[1]} /></>;
  }

  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restaurar sesión al cargar
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(sessionToUser(session));
        setAuthed(true);
      }
      setLoading(false);
    });
    // Escuchar cambios de sesión (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(sessionToUser(session));
        setAuthed(true);
      } else {
        setAuthed(false);
        setUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("maestro_tasks");
    localStorage.removeItem("maestro_secondary_accounts");
  };

  if (loading) {
    return (
      <>
        <CSS />
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100dvh",background:"var(--bg)"}}>
          <div style={{fontSize:13,color:"var(--t3)",fontFamily:"var(--f)"}}>Cargando...</div>
        </div>
      </>
    );
  }

  if (!authed) {
    return (
      <>
        <CSS />
        <AuthScreen />
      </>
    );
  }

  return <MaestroApp user={user} onLogout={handleLogout} />;
}

function AttendeeField({ attendees, onChange }) {
  const [input, setInput] = useState("");
  const add = () => {
    const email = input.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    if (attendees.some(a => a.email === email)) { setInput(""); return; }
    onChange([...attendees, { email }]);
    setInput("");
  };
  return (
    <div className="fg">
      <label className="fl">Invitados</label>
      <div className="att-input-row">
        <input className="fi" placeholder="email@ejemplo.com" value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();add();}}}
          style={{flex:1}}
        />
        <button type="button" className="att-add-btn" onClick={add}>Agregar</button>
      </div>
      {attendees.map((a,i)=>(
        <div key={i} className="att-chip">
          <span className="att-chip-email">{a.email}</span>
          <button className="att-chip-remove" onClick={()=>onChange(attendees.filter((_,j)=>j!==i))}>×</button>
        </div>
      ))}
    </div>
  );
}

function layoutEvents(evts){
  if(!evts.length) return [];
  const res=evts.map(e=>({...e,_col:0,_cols:1}));
  const colEnds=[];
  for(let i=0;i<res.length;i++){
    const s=res[i].sh*60+res[i].sm, e=res[i].eh*60+res[i].em;
    let placed=false;
    for(let c=0;c<colEnds.length;c++){if(colEnds[c]<=s){res[i]._col=c;colEnds[c]=e;placed=true;break;}}
    if(!placed){res[i]._col=colEnds.length;colEnds.push(e);}
  }
  for(let i=0;i<res.length;i++){
    const s1=res[i].sh*60+res[i].sm,e1=res[i].eh*60+res[i].em;
    let maxCol=res[i]._col;
    for(let j=0;j<res.length;j++){
      if(i===j)continue;
      const s2=res[j].sh*60+res[j].sm,e2=res[j].eh*60+res[j].em;
      if(s1<e2&&e1>s2)maxCol=Math.max(maxCol,res[j]._col);
    }
    res[i]._cols=maxCol+1;
  }
  return res;
}

function MaestroApp({ user, onLogout }){
  // Restaurar cuentas secundarias desde localStorage (la primaria la recrea syncCalendars)
  const [accounts,setAccounts]=useState(()=>{
    try{ return JSON.parse(localStorage.getItem("maestro_secondary_accounts")||"[]"); }
    catch{ return []; }
  });
  const [events,setEvents]=useState([]);
  const [calLoading,setCalLoading]=useState(false);
  const [selDate,setSelDate]=useState(new Date());
  const [vM,setVM]=useState(MO);
  const [vY,setVY]=useState(YR);
  const [sheet,setSheet]=useState(null);
  const [expandedEvt,setExpandedEvt]=useState(null);
  const [tlOpen,setTlOpen]=useState(false);
  const [tlPhase,setTlPhase]=useState("idle");
  const [toast,setToast]=useState(null);
  const [form,setForm]=useState({});
  const [formError,setFormError]=useState("");
  const [userMenu,setUserMenu]=useState(false);
  const [tlView,setTlView]=useState(()=>localStorage.getItem("maestro_tlview")||"3day");
  const [bookingLinks,setBookingLinks]=useState([]);
  const [bookingLinksOpen,setBookingLinksOpen]=useState(false);
  const tlRef=useRef(null);
  const tlPanelRef=useRef(null);

  const enabledCals=accounts.filter(a=>a.on).flatMap(a=>a.cals.filter(c=>c.on).map(c=>c.id));
  const MAESTRO_CAL = {id:"maestro-tasks",name:"Maestro Tasks",color:"#6366F1",account:{id:"maestro",provider:"maestro",email:user?.email||"",name:"Maestro"}};
  const getCal=id=>{
    if(id==="maestro-tasks") return MAESTRO_CAL;
    for(const a of accounts)for(const c of a.cals)if(c.id===id)return{...c,account:a};return null;
  };

  const dayEvts=useMemo(()=>
    events.filter(e=>same(e.date,selDate)&&(e.isTask||enabledCals.includes(e.cid)))
      .sort((a,b)=>{if(a.allDay&&!b.allDay)return-1;if(!a.allDay&&b.allDay)return 1;return(a.sh*60+a.sm)-(b.sh*60+b.sm)}),
    [events,selDate,enabledCals.join(",")]
  );
  const recs=useMemo(()=>getRecs(events,selDate,enabledCals),[events,selDate,enabledCals.join(",")]);
  const hasConflict=evt=>{if(evt.allDay)return false;const s=evt.sh*60+evt.sm,e=evt.eh*60+evt.em;return dayEvts.some(o=>o.id!==evt.id&&!o.allDay&&s<(o.eh*60+o.em)&&e>(o.sh*60+o.sm))};

  // Multi-day view: array of Date objects for the current view window
  const viewDays=useMemo(()=>{
    const days=[];
    if(tlView==="day"){
      days.push(new Date(selDate));
    } else if(tlView==="3day"){
      for(let i=0;i<3;i++){const d=new Date(selDate);d.setDate(d.getDate()+i);days.push(d);}
    } else { // week — Monday to Sunday
      const dow=selDate.getDay();
      const monday=new Date(selDate);
      monday.setDate(selDate.getDate()-(dow===0?6:dow-1));
      for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(monday.getDate()+i);days.push(d);}
    }
    return days;
  },[selDate,tlView]);

  const getEventsForDay=useCallback((date)=>
    events.filter(e=>same(e.date,date)&&(e.isTask||enabledCals.includes(e.cid)))
      .sort((a,b)=>(a.sh*60+a.sm)-(b.sh*60+b.sm)),
  [events,enabledCals]);;

  // Cargar tareas desde Supabase al montar
  useEffect(()=>{
    supabase.from("tasks").select("*").then(({data,error})=>{
      if(error||!data) return;
      const tasks=data.map(t=>{
        const [yr,mn,dy]=t.date.split("-").map(Number);
        return {id:t.id,title:t.title,desc:t.description||"",cid:"maestro-tasks",date:new Date(yr,mn-1,dy),sh:t.sh??9,sm:t.sm??0,eh:t.eh??10,em:t.em??0,allDay:false,loc:"",videoLink:"",isTask:true,done:t.done||false,priority:t.priority||null};
      });
      setEvents(es=>[...es.filter(e=>!e.isTask),...tasks]);
    });
  },[]);

  // Persistir vista seleccionada
  useEffect(()=>{ localStorage.setItem("maestro_tlview",tlView); },[tlView]);

  // Persistir cuentas secundarias (excluir la primaria g1 que se recrea en cada sync)
  useEffect(()=>{
    try{ localStorage.setItem("maestro_secondary_accounts",JSON.stringify(accounts.filter(a=>a.id!=="g1"))); }
    catch{}
  },[accounts]);

  // Persistir preferencias on/off de cuentas y calendarios (merge para no perder la cuenta primaria al recargar)
  useEffect(()=>{
    try{
      const existing=JSON.parse(localStorage.getItem("maestro_cal_prefs")||"{}");
      const updated={...existing};
      for(const acc of accounts){ updated[acc.id]=acc.on; for(const c of acc.cals) updated[c.id]=c.on; }
      localStorage.setItem("maestro_cal_prefs",JSON.stringify(updated));
    }catch{}
  },[accounts]);

  // Ref para acceder a las cuentas actuales dentro de syncCalendars sin dependencias reactivas
  const accountsRef = useRef(accounts);
  useEffect(()=>{ accountsRef.current = accounts; },[accounts]);

  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(null),2200)};

  const loadBookingLinks=useCallback(async()=>{
    const{data}=await supabase.from("booking_links")
      .select("id,title,duration,date_from,date_to,created_at")
      .order("created_at",{ascending:false});
    setBookingLinks(data||[]);
  },[]);
  useEffect(()=>{loadBookingLinks();},[loadBookingLinks]);

  // Returns the access token for the account that owns a given calendar
  const getTokenForCal=useCallback((calId)=>{
    for(const acc of accounts){
      if(acc.cals?.some(c=>c.id===calId)) return acc.accessToken||user?.accessToken;
    }
    return user?.accessToken;
  },[accounts,user?.accessToken]);

  // Add additional Google account from within the app
  const addGoogleAccount=useGoogleLogin({
    onSuccess: async (tokenResponse)=>{
      try{
        const [userInfo,cals]=await Promise.all([
          fetchUserInfo(tokenResponse.access_token),
          fetchCalendars(tokenResponse.access_token),
        ]);
        const newAcc={id:uid(),provider:"google",email:userInfo.email,name:userInfo.name||userInfo.email,on:true,accessToken:tokenResponse.access_token,cals:cals.map(mapGoogleCalendar)};
        setAccounts(as=>[...as,newAcc]);
        const timeMin=new Date(); timeMin.setDate(timeMin.getDate()-30); timeMin.setHours(0,0,0,0);
        const timeMax=new Date(); timeMax.setDate(timeMax.getDate()+90);
        const newEvts=[];
        for(const cal of cals){
          try{
            const evts=await fetchEvents(tokenResponse.access_token,cal.id,timeMin.toISOString(),timeMax.toISOString());
            newEvts.push(...evts.map(e=>mapGoogleEvent(e,cal.id)));
          }catch(_){}
        }
        setEvents(es=>[...es,...newEvts]);
        setSheet("accounts");
        flash(`${userInfo.name||userInfo.email} conectado`);
      }catch(e){
        console.error("Error adding account:",e);
        flash("Error al conectar la cuenta");
      }
    },
    onError:()=>flash("Error al conectar con Google"),
    scope:"https://www.googleapis.com/auth/calendar email profile",
    flow:"implicit",
    prompt:"select_account",
  });

  const prevMonth=()=>{if(vM===0){setVM(11);setVY(y=>y-1)}else setVM(m=>m-1)};
  const nextMonth=()=>{if(vM===11){setVM(0);setVY(y=>y+1)}else setVM(m=>m+1)};
  const goToday=()=>{setVM(MO);setVY(YR);setSelDate(new Date())};

  const daysInM=dimF(vY,vM),firstD=fdow(vY,vM),prevDimV=dimF(vY,vM===0?11:vM-1);
  const cells=[];
  for(let i=firstD-1;i>=0;i--){const d=prevDimV-i;const m2=vM===0?11:vM-1;const y2=vM===0?vY-1:vY;cells.push({day:d,date:new Date(y2,m2,d),oth:true})}
  for(let i=1;i<=daysInM;i++)cells.push({day:i,date:new Date(vY,vM,i),oth:false});
  while(cells.length<42){const n=cells.length-firstD-daysInM+1;const m2=vM===11?0:vM+1;const y2=vM===11?vY+1:vY;cells.push({day:n,date:new Date(y2,m2,n),oth:true})}

  // Open timeline
  const openTl=()=>{setTlOpen(true);setTlPhase("entering");setTimeout(()=>setTlPhase("idle"),350)};
  const closeTl=useCallback(()=>{setTlPhase("dismissing");setTimeout(()=>{setTlOpen(false);setTlPhase("idle")},300)},[]);

  // Sync calendars — re-fetchea la cuenta primaria (Supabase) y todas las secundarias
  const syncCalendars=useCallback(async()=>{
    setCalLoading(true);
    try {
      const timeMin = new Date(); timeMin.setDate(timeMin.getDate()-30); timeMin.setHours(0,0,0,0);
      const timeMax = new Date(); timeMax.setDate(timeMax.getDate()+90);
      const allEvents = [];

      // ── Cuenta primaria (token fresco desde Supabase) ──
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.provider_token;
      if(!token){ flash("Sesión vencida. Recargá la página."); return; }
      const userEmail = session.user.email;
      const userName = session.user.user_metadata?.full_name || userEmail;
      const cals = await fetchCalendars(token);
      const primaryAcc = {id:"g1",provider:"google",email:userEmail,name:userName,on:true,accessToken:token,cals:cals.map(mapGoogleCalendar)};
      for (const cal of cals) {
        try {
          const evts = await fetchEvents(token, cal.id, timeMin.toISOString(), timeMax.toISOString());
          allEvents.push(...evts.map(e => mapGoogleEvent(e, cal.id)));
        } catch(_) {}
      }

      // ── Cuentas secundarias (token almacenado, puede estar vencido) ──
      const secondaryAccounts = accountsRef.current.filter(a=>a.id!=="g1");
      const updatedSecondary = [];
      for (const acc of secondaryAccounts) {
        if (!acc.accessToken) { updatedSecondary.push(acc); continue; }
        try {
          const secCals = await fetchCalendars(acc.accessToken);
          updatedSecondary.push({...acc, cals:secCals.map(mapGoogleCalendar)});
          for (const cal of secCals) {
            try {
              const evts = await fetchEvents(acc.accessToken, cal.id, timeMin.toISOString(), timeMax.toISOString());
              allEvents.push(...evts.map(e => mapGoogleEvent(e, cal.id)));
            } catch(_) {}
          }
        } catch(_) {
          // Token vencido para esta cuenta — conservar metadata, omitir eventos
          updatedSecondary.push(acc);
        }
      }

      const prefs=JSON.parse(localStorage.getItem("maestro_cal_prefs")||"{}");
      const applyPrefs=acc=>({...acc,on:prefs[acc.id]??acc.on,cals:acc.cals.map(c=>({...c,on:prefs[c.id]??c.on}))});
      setAccounts([applyPrefs(primaryAcc),...updatedSecondary.map(applyPrefs)]);
      setEvents(es=>[...es.filter(e=>e.isTask),...allEvents]);
      flash("Calendarios actualizados");
    } catch(e) {
      console.error("Calendar API error:", e);
      flash("Error: " + (e.message || "al cargar el calendario"));
    } finally {
      setCalLoading(false);
    }
  },[]);

  // Load on mount
  useEffect(()=>{ syncCalendars(); },[]);

  // Scroll to now when timeline opens
  useEffect(()=>{
    if(tlOpen&&tlRef.current){
      const scrollTo=Math.max(0,(today.getHours()-6)*56-30);
      setTimeout(()=>{if(tlRef.current)tlRef.current.scrollTop=scrollTo},100);
    }
  },[tlOpen]);

  const tlSwipe=useSwipeDismiss(tlPanelRef,closeTl);

  const tlHours=[];for(let h=6;h<=23;h++)tlHours.push(h);
  const nowH=today.getHours(),nowMin=today.getMinutes();
  const TL_FIRST_HOUR = 6;
  const PX_H = 56; // px per hour

  // ── Drag to move/resize events ──
  const dragEvt = useRef(null);
  const [dragPreview, setDragPreview] = useState(null); // {id, sh, sm, eh, em, date?}
  const dragMoved = useRef(false);

  // Stable refs so drag closures always see fresh values
  const eventsRef   = useRef(events);
  const viewDaysRef = useRef(viewDays);
  useEffect(() => { eventsRef.current = events; },   [events]);
  useEffect(() => { viewDaysRef.current = viewDays; }, [viewDays]);
  const syncDraggedRef = useRef(null);
  // Assigned each render so the closure is always fresh
  syncDraggedRef.current = async (origEvt, p) => {
    const newDate = p.date instanceof Date ? p.date : origEvt.date;
    const updated = { ...origEvt, sh: p.sh, sm: p.sm, eh: p.eh, em: p.em, date: newDate };
    try {
      if (origEvt.isTask) {
        await supabase.from("tasks").update({ sh: p.sh, sm: p.sm, eh: p.eh, em: p.em }).eq("id", origEvt.id);
      } else {
        const token = getTokenForCal(origEvt.cid);
        if (token) await updateEvent(token, origEvt.cid, origEvt.googleId || origEvt.id, updated);
      }
    } catch(e) { flash("Error al sincronizar: " + (e.message || "")); }
  };

  const snapTo15 = (totalMin) => {
    const snapped = Math.round(totalMin / 15) * 15;
    return Math.max(0, Math.min(23 * 60 + 45, snapped));
  };

  const startDrag = useCallback((e, evt, mode) => {
    e.stopPropagation();
    e.preventDefault();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scrollTop = tlRef.current ? tlRef.current.scrollTop : 0;
    dragEvt.current = {
      id: evt.id, mode, startY: clientY, scrollTop,
      origSh: evt.sh, origSm: evt.sm, origEh: evt.eh, origEm: evt.em,
      dur: (evt.eh * 60 + evt.em) - (evt.sh * 60 + evt.sm),
    };
    dragMoved.current = false;
    setDragPreview({ id: evt.id, sh: evt.sh, sm: evt.sm, eh: evt.eh, em: evt.em, date: evt.date });
  }, []);

  // Multi-day drag: also tracks horizontal position for cross-day movement
  const startDragMulti = useCallback((e, evt, mode) => {
    e.stopPropagation();
    e.preventDefault();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    dragEvt.current = {
      id: evt.id, mode, startY: clientY, startX: clientX,
      scrollTop: dtlRef.current?.scrollTop || 0,
      origSh: evt.sh, origSm: evt.sm, origEh: evt.eh, origEm: evt.em,
      origDate: evt.date,
      dur: (evt.eh*60+evt.em) - (evt.sh*60+evt.sm),
      isMulti: true,
    };
    dragMoved.current = false;
    setDragPreview({ id: evt.id, sh: evt.sh, sm: evt.sm, eh: evt.eh, em: evt.em, date: evt.date });
  }, []);

  useEffect(() => {
    if (!dragPreview) return;

    const onMove = (e) => {
      if (!dragEvt.current) return;
      e.preventDefault();
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const d = dragEvt.current;
      // Use dtlRef scroll for multi-day drag, tlRef for single-day
      const scrollRef = d.isMulti ? dtlRef : tlRef;
      const scrollNow = scrollRef.current ? scrollRef.current.scrollTop : 0;
      const scrollDelta = scrollNow - d.scrollTop;
      const dy = (clientY - d.startY) + scrollDelta;

      if (Math.abs(dy) > 4) dragMoved.current = true;

      const dMin = (dy / PX_H) * 60;

      if (d.mode === "move") {
        const origStart = d.origSh * 60 + d.origSm;
        const newStart = snapTo15(origStart + dMin);
        const newEnd = newStart + d.dur;
        if (newEnd <= 24 * 60) {
          setDragPreview(prev => ({
            ...(prev || {}),
            id: d.id,
            sh: Math.floor(newStart / 60), sm: newStart % 60,
            eh: Math.floor(newEnd / 60), em: newEnd % 60,
          }));
        }
      } else {
        const origEnd = d.origEh * 60 + d.origEm;
        const newEnd = snapTo15(origEnd + dMin);
        const origStart = d.origSh * 60 + d.origSm;
        if (newEnd > origStart + 15) {
          setDragPreview(prev => ({
            ...(prev || {}),
            id: d.id, sh: d.origSh, sm: d.origSm,
            eh: Math.floor(newEnd / 60), em: newEnd % 60,
          }));
        }
      }

      // Cross-day detection (multi-day desktop view only)
      if (d.isMulti && d.mode === "move" && viewDaysRef.current?.length > 0 && dtlRef.current) {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = dtlRef.current.getBoundingClientRect();
        const x = clientX - rect.left - 54; // subtract 54px time gutter
        const colW = (rect.width - 54) / viewDaysRef.current.length;
        const idx = Math.max(0, Math.min(viewDaysRef.current.length - 1, Math.floor(x / colW)));
        const newDate = viewDaysRef.current[idx];
        setDragPreview(prev => prev ? { ...prev, date: newDate } : prev);
      }
    };

    const onEnd = () => {
      if (dragEvt.current && dragPreview && dragMoved.current) {
        const p = dragPreview;
        const origEvt = eventsRef.current.find(e => e.id === p.id);
        const newDate = p.date instanceof Date ? p.date : origEvt?.date;
        setEvents(es => es.map(e => e.id === p.id
          ? { ...e, sh: p.sh, sm: p.sm, eh: p.eh, em: p.em, ...(newDate && { date: newDate }) }
          : e));
        flash("Reprogramado");
        if (origEvt) syncDraggedRef.current?.({ ...origEvt }, { ...p, date: newDate || origEvt.date });
      }
      dragEvt.current = null;
      setDragPreview(null);
      // Reset dragMoved after a tick so click handler can read it
      setTimeout(() => { dragMoved.current = false; }, 50);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [dragPreview]);

  // ── Swipe day navigation ──
  const swipeRef = useRef(null);
  const [swipeX, setSwipeX] = useState(0);
  const [swipeAnim, setSwipeAnim] = useState(null); // 'left'|'right'|null
  const swipeData = useRef({startX:0,startY:0,swiping:false,locked:null}); // locked: 'h'|'v'|null

  const changeDay = useCallback((dir) => {
    const next = new Date(selDate);
    next.setDate(next.getDate() + dir);
    setSelDate(next);
    // Update month view if needed
    if(next.getMonth()!==vM||next.getFullYear()!==vY){
      setVM(next.getMonth()); setVY(next.getFullYear());
    }
  }, [selDate, vM, vY]);

  // Multi-view navigation: advance by 1/3/7 days depending on active view
  const changeView = useCallback((dir) => {
    const step = tlView==="day" ? 1 : tlView==="3day" ? 3 : 7;
    const next = new Date(selDate);
    next.setDate(next.getDate() + dir * step);
    setSelDate(next);
    if(next.getMonth()!==vM||next.getFullYear()!==vY){
      setVM(next.getMonth()); setVY(next.getFullYear());
    }
  }, [selDate, tlView, vM, vY]);

  const onSwipeStart = useCallback((e) => {
    const t = e.touches ? e.touches[0] : e;
    swipeData.current = {startX:t.clientX, startY:t.clientY, swiping:true, locked:null};
    setSwipeX(0);
    setSwipeAnim(null);
  }, []);

  const onSwipeMove = useCallback((e) => {
    const sd = swipeData.current;
    if(!sd.swiping) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - sd.startX;
    const dy = t.clientY - sd.startY;

    // Lock direction on first significant movement
    if(!sd.locked && (Math.abs(dx)>8 || Math.abs(dy)>8)){
      sd.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if(sd.locked !== 'h') return;

    e.preventDefault();
    // Rubber-band resistance at edges
    const dampened = dx * 0.6;
    setSwipeX(dampened);
  }, []);

  const onSwipeEnd = useCallback((e) => {
    const sd = swipeData.current;
    if(!sd.swiping) return;
    sd.swiping = false;
    if(sd.locked !== 'h') { setSwipeX(0); return; }

    const t = e.changedTouches ? e.changedTouches[0] : e;
    const dx = t.clientX - sd.startX;
    const vx = dx / Math.max(1, Date.now() - (sd.ts||Date.now())); // velocity
    const threshold = 50;

    if(Math.abs(dx) > threshold || Math.abs(vx) > 0.3){
      const dir = dx > 0 ? -1 : 1; // swipe right = prev day, swipe left = next day
      setSwipeAnim(dir > 0 ? 'left' : 'right');
      setTimeout(() => {
        changeDay(dir);
        setSwipeX(0);
        setSwipeAnim(null);
      }, 180);
    } else {
      // Spring back
      setSwipeX(0);
    }
  }, [changeDay]);

  // Attach timestamp on start for velocity calc
  const onSwipeStartWrapped = useCallback((e) => {
    onSwipeStart(e);
    swipeData.current.ts = Date.now();
  }, [onSwipeStart]);

  const swipeHandlers = {
    onTouchStart: onSwipeStartWrapped,
    onTouchMove: onSwipeMove,
    onTouchEnd: onSwipeEnd,
  };

  const cardSwipeStyle = swipeAnim
    ? { transform: `translateX(${swipeAnim==='left'?'-110%':'110%'})`, transition: 'transform .18s ease-in', opacity: 0.4 }
    : swipeX !== 0
      ? { transform: `translateX(${swipeX}px)`, transition: 'none' }
      : { transform: 'translateX(0)', transition: 'transform .25s cubic-bezier(.16,1,.3,1)' };

  const fmtDateInput = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  const openNew=()=>{setFormError("");setForm({title:"",desc:"",cid:enabledCals[0]||"",date:fmtDateInput(selDate),sh:9,sm:0,eh:10,em:0,allDay:false,loc:"",videoLink:"",addMeet:false,attendees:[],isTask:false,isBooking:false,done:false,priority:null});setTlOpen(false);setTlPhase("idle");setExpandedEvt(null);setSheet("new")};
  const openNewAt=(hour,min,date)=>{
    const startM=Math.round((hour*60+min)/30)*30; // redondear total a intervalos de 30 min (= opciones del select)
    const sh2=Math.floor(startM/60), sm2=startM%60;
    const endM=Math.min(23*60+30, startM+60);
    const eh2=Math.floor(endM/60), em2=endM%60;
    setFormError("");
    setForm({title:"",desc:"",cid:enabledCals[0]||"",date:fmtDateInput(date||selDate),sh:sh2,sm:sm2,eh:eh2,em:em2,allDay:false,loc:"",videoLink:"",addMeet:false,attendees:[],isTask:false,isBooking:false,done:false,priority:null});
    setTlOpen(false);setTlPhase("idle");setExpandedEvt(null);setSheet("new");
  };
  const openEdit=evt=>{setForm({id:evt.id,title:evt.title,desc:evt.desc||"",cid:evt.cid,date:fmtDateInput(evt.date),sh:evt.sh,sm:evt.sm,eh:evt.eh,em:evt.em,allDay:evt.allDay||false,loc:evt.loc||"",videoLink:evt.videoLink||"",addMeet:!!(evt.videoLink),attendees:evt.attendees||[],isTask:evt.isTask||false,done:evt.done||false,priority:evt.priority||null});setExpandedEvt(null);setTlOpen(false);setTlPhase("idle");setSheet("edit")};
  const save=async()=>{
    if(!form.title.trim()){setFormError("El título es obligatorio");return;}
    setFormError("");
    const [yr,mn,dy] = form.date.split("-").map(Number);
    const d={title:form.title,desc:form.desc,cid:form.isTask?"maestro-tasks":form.cid,date:new Date(yr,mn-1,dy),sh:+form.sh,sm:+form.sm,eh:+form.eh,em:+form.em,allDay:form.isTask?false:form.allDay,loc:form.isTask?"":form.loc,videoLink:form.isTask?"":form.videoLink,addMeet:!form.isTask&&form.addMeet&&!form.videoLink,attendees:form.isTask?[]:(form.attendees||[]),isTask:form.isTask,done:form.done,priority:form.isTask?(form.priority||null):null};
    if(d.isTask){
      const row={user_id:user.id,title:d.title,description:d.desc,date:fmtDateInput(d.date),sh:d.sh,sm:d.sm,eh:d.eh,em:d.em,done:d.done,priority:d.priority};
      if(form.id){
        await supabase.from("tasks").update(row).eq("id",form.id);
        setEvents(es=>es.map(e=>e.id===form.id?{...e,...d}:e));flash("Actualizado");
      } else {
        const {data,error}=await supabase.from("tasks").insert(row).select().single();
        if(error){flash("Error al guardar");return;}
        setEvents(es=>[...es,{...d,id:data.id}]);flash("Creado");
      }
    } else {
      const token=getTokenForCal(d.cid);
      if(token){
        try{
          if(form.id){
            const evt=events.find(e=>e.id===form.id);
            await updateEvent(token, d.cid, evt?.googleId||form.id, d);
            setEvents(es=>es.map(e=>e.id===form.id?{...e,...d}:e));flash("Actualizado");
          } else {
            const gEvt=await createEvent(token, d.cid, d);
            const meetEntry=gEvt.conferenceData?.entryPoints?.find(e=>e.entryPointType==="video");
            const meetUrl=meetEntry?.uri||gEvt.hangoutLink||"";
            setEvents(es=>[...es,{...d,id:gEvt.id,googleId:gEvt.id,videoLink:meetUrl}]);flash("Creado");
          }
        } catch(e){ flash("Error al guardar el evento"); return; }
      } else {
        if(form.id){setEvents(es=>es.map(e=>e.id===form.id?{...e,...d}:e));flash("Actualizado")}
        else{setEvents(es=>[...es,{...d,id:uid()}]);flash("Creado")}
      }
    }
    setSheet(null);
  };
  const del=async(id)=>{
    const evt=events.find(e=>e.id===id);
    if(evt?.isTask){
      await supabase.from("tasks").delete().eq("id",id);
    } else if(evt&&!evt.isTask){
      const token=getTokenForCal(evt.cid);
      if(token){
        try{ await deleteEvent(token, evt.cid, evt.googleId||id); }
        catch(e){ flash("Error al eliminar el evento"); return; }
      }
    }
    setEvents(es=>es.filter(e=>e.id!==id));setSheet(null);setExpandedEvt(null);flash("Eliminado");
  };
  const toggleDone=async(id)=>{
    const evt=events.find(e=>e.id===id);
    const newDone=!evt?.done;
    setEvents(es=>es.map(e=>e.id===id?{...e,done:newDone}:e));
    if(evt?.isTask) await supabase.from("tasks").update({done:newDone}).eq("id",id);
  };

  const fmtDay=d=>{
    if(same(d,today))return"Hoy";
    const t2=new Date(today);t2.setDate(DA+1);if(same(d,t2))return"Mañana";
    const y2=new Date(today);y2.setDate(DA-1);if(same(d,y2))return"Ayer";
    return`${["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)}`;
  };

  // Next event for card
  const nextEvt=dayEvts.find(e=>!e.allDay&&(e.sh>nowH||(e.sh===nowH&&e.sm>=nowMin)));

  // ── Timeline content (shared between mobile panel and desktop column) ──
  const renderTimeline = (scrollRef, isDesktop) => (
    <>
      {dayEvts.length===0?(
        <div className={isDesktop?"dtl-empty":""} style={isDesktop?{}:{textAlign:"center",padding:"40px 20px",color:"var(--t3)",cursor:"pointer"}}
          onClick={()=>openNewAt(9,0)}>
          <div style={{fontSize:32,opacity:.3,marginBottom:8}}>○</div>
          <div style={{fontSize:14,fontWeight:500}}>Agenda libre</div>
          <div style={{fontSize:12,color:"var(--t4)",marginTop:4}}>Tocá para crear un evento</div>
        </div>
      ):(
        <div className="tl">
          {dayEvts.filter(e=>e.allDay&&!e.isTask).map(evt=>{
            const cal=getCal(evt.cid);
            return(
              <div key={evt.id} className="tl-allday" style={{borderLeftColor:cal?.color,background:`${cal?.color}0D`}}
                onClick={()=>setExpandedEvt(evt)}>
                {evt.title}<span className="tl-allday-sub">Todo el día</span>
              </div>
            );
          })}
          {tlHours.map(h=>{
            const hourEvts=dayEvts.filter(e=>{
              if(e.allDay) return false;
              if(dragPreview?.id===e.id) return dragPreview.sh===h;
              return e.sh===h;
            });
            return(
              <div key={h} className="tl-hour">
                <div className="tl-h-label">{fmt(h,0)}</div>
                <div className="tl-h-track"
                  onClick={(e)=>{
                    if(e.target!==e.currentTarget) return;
                    if(dragMoved.current) return;
                    const rect=e.currentTarget.getBoundingClientRect();
                    const yOff=e.clientY-rect.top;
                    const min=Math.round((yOff/PX_H)*60);
                    openNewAt(h,min);
                  }}>
                  {same(selDate,today)&&nowH===h&&(
                    <div className="now-line" style={{top:`${(nowMin/60)*100}%`}}><div className="now-dot"/><div className="now-rule"/></div>
                  )}
                  {hourEvts.map(evt=>{
                    const cal=getCal(evt.cid);
                    const dp = dragPreview?.id===evt.id ? dragPreview : null;
                    const eSh = dp ? dp.sh : evt.sh;
                    const eSm = dp ? dp.sm : evt.sm;
                    const eEh = dp ? dp.eh : evt.eh;
                    const eEm = dp ? dp.em : evt.em;
                    const dur=(eEh*60+eEm)-(eSh*60+eSm);
                    const top=(eSm/60)*PX_H;
                    const h2=Math.max(28,(dur/60)*PX_H);
                    const conf=hasConflict(evt);
                    const isTask=evt.isTask;
                    const taskColor="#6366F1";
                    const evtColor=isTask?taskColor:(cal?.color||"#ccc");
                    const isDragging = dp !== null;
                    return(
                      <div key={evt.id} className={`tl-evt ${isDragging?"dragging":""}`}
                        style={{
                          top,height:h2,
                          borderLeftColor:evtColor,
                          background:isDragging?`${evtColor}1A`:`${evtColor}0D`,
                          opacity:evt.done?.5:1,
                          zIndex:isDragging?10:2,
                          boxShadow:isDragging?"0 4px 20px rgba(0,0,0,.12)":"none",
                          cursor:isDragging?"grabbing":"pointer",
                          transition:isDragging?"none":"all .12s",
                        }}
                        onClick={()=>{if(!isDragging && !dragMoved.current)setExpandedEvt(evt)}}
                        onMouseDown={(e)=>startDrag(e,evt,"move")}
                        onTouchStart={(e)=>startDrag(e,evt,"move")}
                      >
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          {isTask && (
                            <span style={{flexShrink:0,cursor:"pointer",display:"flex",color:evt.done?"var(--ok)":"var(--t4)"}}
                              onClick={(e)=>{e.stopPropagation();toggleDone(evt.id)}}>
                              {evt.done ? I.taskDone : I.taskOpen}
                            </span>
                          )}
                          <div className="tl-evt-title" style={{textDecoration:evt.done?"line-through":"none"}}>
                            {evt.title}
                          </div>
                        </div>
                        {h2>32&&(
                          <div className="tl-evt-sub">
                            <span>{fmt(eSh,eSm)}–{fmt(eEh,eEm)}</span>
                            {isTask && <span style={{color:taskColor,fontWeight:600,fontSize:9}}>TAREA</span>}
                            {conf&&!isTask&&<span className="tl-evt-conf">⚡</span>}
                            {evt.loc&&<span>{evt.loc}</span>}
                          </div>
                        )}
                        {!evt.allDay && h2 >= 28 && (
                          <div className="tl-evt-resize"
                            onMouseDown={(e)=>{e.stopPropagation();startDrag(e,evt,"resize")}}
                            onTouchStart={(e)=>{e.stopPropagation();startDrag(e,evt,"resize")}}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // ── Multi-day timeline (desktop only) ──────────────────────────────────────
  const renderMultiTimeline = () => {
    const totalH = tlHours.length * PX_H;
    const hasAllDay = viewDays.some(d => getEventsForDay(d).some(e => e.allDay && !e.isTask));
    const DAY_NAMES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>

        {/* Day headers row */}
        <div style={{display:"flex",flexShrink:0,borderBottom:"1px solid var(--bl)"}}>
          <div style={{width:54,flexShrink:0}}/>
          {viewDays.map((d,i) => {
            const isToday = same(d, today);
            const isSel = same(d, selDate);
            return (
              <div key={i} className="dtl-day-hdr"
                style={{flex:1,borderLeft:"1px solid var(--bl)"}}
                onClick={() => setSelDate(new Date(d))}>
                <span className="dtl-day-name">{DAY_NAMES[d.getDay()]}</span>
                <span className={`dtl-day-num${isToday?" today":isSel&&!isToday?" sel":""}`}>{d.getDate()}</span>
              </div>
            );
          })}
        </div>

        {/* All-day row (conditional) */}
        {hasAllDay && (
          <div style={{display:"flex",flexShrink:0,borderBottom:"1px solid var(--bl)",minHeight:32}}>
            <div style={{width:54,flexShrink:0,fontSize:9,color:"var(--t4)",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:8}}>TODO DÍA</div>
            {viewDays.map((d,i) => (
              <div key={i} style={{flex:1,borderLeft:"1px solid var(--bl)",padding:"2px 4px"}}>
                {getEventsForDay(d).filter(e=>e.allDay&&!e.isTask).map(evt => {
                  const cal=getCal(evt.cid);
                  return (
                    <div key={evt.id} className="dtl-allday-chip"
                      style={{background:`${cal?.color}22`,borderLeft:`3px solid ${cal?.color}`}}
                      onClick={()=>setExpandedEvt(evt)}>
                      {evt.title}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Scrollable time grid */}
        <div ref={dtlRef} style={{flex:1,overflowY:"auto",paddingBottom:40}} className="dtl-scroll">
          <div style={{display:"flex",height:totalH,position:"relative"}}>

            {/* Time gutter */}
            <div style={{width:54,flexShrink:0,position:"relative"}}>
              {tlHours.map(h => (
                <div key={h} className="tl-h-label" style={{height:PX_H,display:"flex",alignItems:"flex-start",justifyContent:"flex-end",paddingRight:10,paddingTop:0,marginTop:0}}>
                  {fmt(h,0)}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {viewDays.map((d,i) => {
              const dayEvtsForCol = getEventsForDay(d).filter(e => !e.allDay);
              const isToday = same(d, today);
              const nowTop = isToday ? ((nowH - TL_FIRST_HOUR) * 60 + nowMin) / 60 * PX_H : null;
              return (
                <div key={i} style={{flex:1,borderLeft:"1px solid var(--bl)",position:"relative",height:totalH}}>
                  {/* Hour divider lines / click targets */}
                  {tlHours.map(h => (
                    <div key={h} style={{position:"absolute",top:(h-TL_FIRST_HOUR)*PX_H,left:0,right:0,height:PX_H,borderTop:"1px solid var(--bl)",cursor:"pointer"}}
                      onClick={(e)=>{
                        if(dragMoved.current) return;
                        setSelDate(new Date(d));
                        const rect=e.currentTarget.getBoundingClientRect();
                        const min=Math.round(((e.clientY-rect.top)/PX_H)*60);
                        openNewAt(h,min,d);
                      }}/>
                  ))}

                  {/* Now line */}
                  {nowTop !== null && (
                    <div className="now-line" style={{position:"absolute",top:nowTop,left:0,right:10,zIndex:4}}>
                      <div className="now-dot"/><div className="now-rule"/>
                    </div>
                  )}

                  {/* Events */}
                  {layoutEvents(dayEvtsForCol).map(evt => {
                    const cal=getCal(evt.cid);
                    const evtColor=evt.isTask?"#6366F1":(cal?.color||"#ccc");
                    const isDraggingThis=dragPreview?.id===evt.id;
                    const crossDay=isDraggingThis&&dragPreview.date&&!same(dragPreview.date,d);
                    const eSh=(isDraggingThis&&!crossDay)?dragPreview.sh:evt.sh;
                    const eSm=(isDraggingThis&&!crossDay)?dragPreview.sm:evt.sm;
                    const eEh=(isDraggingThis&&!crossDay)?dragPreview.eh:evt.eh;
                    const eEm=(isDraggingThis&&!crossDay)?dragPreview.em:evt.em;
                    const topPx=((eSh-TL_FIRST_HOUR)*60+eSm)/60*PX_H;
                    const h2=Math.max(20,((eEh*60+eEm)-(eSh*60+eSm))/60*PX_H);
                    const leftPct=evt._col/evt._cols;
                    const widthPct=1/evt._cols;
                    return (
                      <div key={evt.id} className="tl-evt"
                        style={{position:"absolute",top:topPx,height:h2,
                          left:`calc(${leftPct*100}% + 2px)`,
                          width:`calc(${widthPct*100}% - 6px)`,
                          borderLeft:`3px solid ${evtColor}`,
                          background:crossDay?"transparent":`${evtColor}18`,
                          opacity:crossDay?0.25:(evt.done?0.5:1),
                          outline:crossDay?`1.5px dashed ${evtColor}`:"none",
                          zIndex:(isDraggingThis&&!crossDay)?10:2,
                          cursor:(isDraggingThis&&!crossDay)?"grabbing":"grab",
                          boxShadow:(isDraggingThis&&!crossDay)?"0 4px 20px rgba(0,0,0,.15)":"none",
                          transition:(isDraggingThis&&!crossDay)?"none":"top .12s,height .12s",
                          userSelect:"none",
                        }}
                        onClick={()=>{if(!dragMoved.current)setExpandedEvt(evt)}}
                        onMouseDown={e=>startDragMulti(e,evt,"move")}
                        onTouchStart={e=>startDragMulti(e,evt,"move")}
                      >
                        {isDraggingThis&&!crossDay&&(
                          <div className="drag-time-tip">{fmt(eSh,eSm)} – {fmt(eEh,eEm)}</div>
                        )}
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          {evt.isTask&&(
                            <span style={{flexShrink:0,cursor:"pointer",display:"flex",color:evt.done?"var(--ok)":"var(--t4)"}}
                              onClick={e=>{e.stopPropagation();toggleDone(evt.id)}}>
                              {evt.done?I.taskDone:I.taskOpen}
                            </span>
                          )}
                          <div className="tl-evt-title" style={{textDecoration:evt.done?"line-through":"none"}}>{evt.title}</div>
                        </div>
                        {h2>28&&<div className="tl-evt-sub"><span>{fmt(eSh,eSm)}–{fmt(eEh,eEm)}</span></div>}
                        {!evt.allDay&&h2>=28&&(
                          <div className="tl-evt-resize"
                            onMouseDown={e=>{e.stopPropagation();startDragMulti(e,evt,"resize")}}
                            onTouchStart={e=>{e.stopPropagation();startDragMulti(e,evt,"resize")}}/>
                        )}
                      </div>
                    );
                  })}

                  {/* Cross-day preview: event dragged INTO this column from another day */}
                  {(()=>{
                    if(!dragPreview?.date||!same(dragPreview.date,d))return null;
                    const srcEvt=eventsRef.current.find(e=>e.id===dragPreview.id);
                    if(!srcEvt||same(srcEvt.date,d))return null;
                    const srcCal=getCal(srcEvt.cid);
                    const pc=srcEvt.isTask?"#6366F1":(srcCal?.color||"#ccc");
                    const pTop=((dragPreview.sh-TL_FIRST_HOUR)*60+dragPreview.sm)/60*PX_H;
                    const pH=Math.max(20,((dragPreview.eh*60+dragPreview.em)-(dragPreview.sh*60+dragPreview.sm))/60*PX_H);
                    return(
                      <div style={{position:"absolute",top:pTop,height:pH,left:2,right:4,zIndex:10,
                        borderLeft:`3px solid ${pc}`,background:`${pc}30`,borderRadius:4,
                        pointerEvents:"none",boxShadow:"0 4px 20px rgba(0,0,0,.15)"}}>
                        <div className="drag-time-tip">{fmt(dragPreview.sh,dragPreview.sm)} – {fmt(dragPreview.eh,dragPreview.em)}</div>
                        <div className="tl-evt-title">{srcEvt.title}</div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // Desktop timeline ref
  const dtlRef = useRef(null);
  useEffect(()=>{
    if(dtlRef.current){
      const scrollTo=Math.max(0,(today.getHours()-6)*56-30);
      setTimeout(()=>{if(dtlRef.current)dtlRef.current.scrollTop=scrollTo},100);
    }
  },[selDate]);

  return(
    <>
      <CSS/>
      <div className="app">

        {/* ── Desktop unified header (only on >=768) ── */}
        <div className="desk-header">
          <div className="top-l"><span className="brand" onClick={goToday} style={{cursor:"pointer"}}>Maestro</span><span className="tag">{user?.name}</span></div>
          <div className="top-r">
            <button className="ib" onClick={syncCalendars} title="Sincronizar calendarios" style={{opacity:calLoading?0.5:1}}>{I.sync}</button>
            <button className="ib add-btn" onClick={openNew}>{I.plus}</button>
            <button className="user-avatar" onClick={()=>setUserMenu(v=>!v)}>
              {(user?.name||"U")[0].toUpperCase()}
            </button>
          </div>
        </div>

        {/* ── Desktop body row ── */}
        <div className="desk-body">

        {/* ── Left column (calendar + mobile stuff) ── */}
        <div className="mobile-col">
        {/* Mobile-only top */}
        <div className="mob-top">
          <div className="top-l"><span className="brand" onClick={goToday} style={{cursor:"pointer"}}>Maestro</span><span className="tag">{user?.name}</span></div>
          <div className="top-r">
            <button className="ib" onClick={syncCalendars} title="Sincronizar" style={{opacity:calLoading?0.5:1}}>{I.sync}</button>
            <button className="ib add-btn" onClick={openNew}>{I.plus}</button>
            <button className="user-avatar" onClick={()=>setUserMenu(v=>!v)}>
              {(user?.name||"U")[0].toUpperCase()}
            </button>
          </div>
        </div>

        {/* Calendar area with floating card */}
        <div className="cal-area">
          <div className="mbar">
            <div className="ml">{MONTHS[vM]} <span>{vY}</span></div>
            <div className="marr"><button className="ma" onClick={prevMonth}>{I.left}</button><button className="ma" onClick={nextMonth}>{I.right}</button></div>
          </div>
          <div className="cgrid">
            <div className="wrow">{DAYS_SHORT.map(d=><div key={d} className="wc">{d}</div>)}</div>
            <div className="dgrid">
              {cells.map((c,i)=>{
                const ce=events.filter(e=>same(e.date,c.date)&&(e.isTask||enabledCals.includes(e.cid)));
                const dots=[...new Set(ce.slice(0,3).map(e=>getCal(e.cid)?.color||"#ccc"))];
                const isT=same(c.date,today),isS=same(c.date,selDate);
                return(
                  <button key={i} className={`dc ${isT?"today":""} ${isS&&!isT?"sel":""} ${c.oth?"oth":""}`}
                    onClick={()=>{setSelDate(c.date);if(c.oth){setVM(c.date.getMonth());setVY(c.date.getFullYear())}}}>
                    {c.day}
                    <div className="ddots">{dots.map((col,j)=><div key={j} className="ddot" style={{background:isT?"rgba(255,255,255,.7)":col}}/>)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Booking Links Section ── */}
          <div className="bk-sidebar-section">
            <button className="bk-sidebar-hdr" onClick={()=>setBookingLinksOpen(o=>!o)}>
              <span className="bk-sidebar-hdr-icon">{bookingLinksOpen?"▾":"▸"}</span>
              <span className="bk-sidebar-hdr-label">Links de agendamiento</span>
              <span className="bk-sidebar-add" onClick={e=>{e.stopPropagation();setSheet("new");setForm(f=>({...f,isBooking:true}))}}>{I.plus}</span>
            </button>
            {bookingLinksOpen&&(
              <div className="bk-sidebar-list">
                {bookingLinks.length===0&&(
                  <div className="bk-sidebar-empty">Sin links creados</div>
                )}
                {bookingLinks.map(bl=>{
                  const url=`${window.location.origin}/book/${bl.id}`;
                  return(
                    <div key={bl.id} className="bk-sidebar-item">
                      <div className="bk-sidebar-dot"/>
                      <div className="bk-sidebar-info">
                        <div className="bk-sidebar-name">{bl.title}</div>
                        <div className="bk-sidebar-meta">{bl.duration}min · {new Date(bl.date_from+"T00:00").toLocaleDateString("es-AR",{day:"numeric",month:"short"})} – {new Date(bl.date_to+"T00:00").toLocaleDateString("es-AR",{day:"numeric",month:"short"})}</div>
                      </div>
                      <button className="bk-sidebar-copy" title="Copiar link"
                        onClick={()=>navigator.clipboard?.writeText(url).then(()=>flash("Link copiado"))}>
                        {I.copy}
                      </button>
                      <button className="bk-sidebar-del" title="Eliminar"
                        onClick={async()=>{await supabase.from("booking_links").delete().eq("id",bl.id);loadBookingLinks();flash("Link eliminado");}}>
                        {I.trash}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Today Card ── */}
          {!tlOpen && (
            <div className="today-card" {...swipeHandlers}>
              <div style={{...cardSwipeStyle, willChange:'transform'}}>
                <div className="tc-head" onClick={openTl}>
                  <div className="tc-title">
                    {fmtDay(selDate)}
                    {dayEvts.length>0&&<span className="tc-count">{dayEvts.length}</span>}
                  </div>
                  <div className="tc-hint">
                    <span className="tc-swipe-arrows">← →</span>
                  </div>
                </div>

                <div onClick={openTl}>
                {dayEvts.length===0?(
                  <div className="tc-empty">
                    Sin eventos
                    <div style={{marginTop:6,fontSize:11,color:"var(--t4)"}}>Tocá + para crear uno</div>
                  </div>
                ):(
                  <>
                    <div className="tc-preview">
                      {dayEvts.filter(e=>!e.isTask).slice(0,4).map(evt=>{
                        const cal=getCal(evt.cid);
                        return(
                          <div key={evt.id} className="tc-pip" style={{borderLeftColor:cal?.color||"#ccc",background:`${cal?.color}08`}}>
                            <span className="tc-pip-title">{evt.title}</span>
                            <span className="tc-pip-time">{evt.allDay?"Todo el día":fmt(evt.sh,evt.sm)}</span>
                          </div>
                        );
                      })}
                      {dayEvts.filter(e=>e.isTask&&!e.done).slice(0,2).map(evt=>(
                        <div key={evt.id} className="tc-task">
                          {I.taskOpen}
                          <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:90}}>{evt.title}</span>
                        </div>
                      ))}
                    </div>
                    {recs.length>0&&(
                      <div className="tc-recs">
                        {recs.map((r,i)=>(
                          <div key={i} className={`tc-rec ${r.type}`}>
                            <span>{r.icon}</span>
                            <span>{r.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Expanded Timeline ── */}
        {tlOpen&&(
          <>
            <div className="tl-overlay" onClick={closeTl}/>
            <div ref={tlPanelRef} className={`tl-panel ${tlPhase}`} style={{height:'72vh'}}>
              <div className="tl-grab" {...tlSwipe}><div className="tl-grab-bar"/></div>
              <div className="tl-head" {...tlSwipe}>
                <div className="tl-title">
                  <button className="tl-nav-btn" onClick={(e)=>{e.stopPropagation();changeDay(-1)}}>{I.left}</button>
                  <span style={{...cardSwipeStyle,display:"inline-block",willChange:"transform"}}>{fmtDay(selDate)}</span>
                  {dayEvts.length>0&&<span className="tl-cnt">{dayEvts.length}</span>}
                  <button className="tl-nav-btn" onClick={(e)=>{e.stopPropagation();changeDay(1)}}>{I.right}</button>
                  {!same(selDate,today) && (
                    <button className="dtl-today-btn" onClick={(e)=>{e.stopPropagation();goToday()}}>Hoy</button>
                  )}
                </div>
                <div style={{display:"flex",gap:2}}>
                  <button className="ib" onClick={(e)=>{e.stopPropagation();openNew()}} style={{width:28,height:28}}>{I.plus}</button>
                  <button className="ib" onClick={closeTl} style={{width:28,height:28}}>{I.x}</button>
                </div>
              </div>

              {recs.length>0&&(
                <div className="tl-recs">
                  {recs.map((r,i)=>(
                    <div key={i} className={`tl-rec ${r.type}`}>
                      <div className="tl-rec-i">{r.icon}</div>
                      <div className="tl-rec-b"><div className="tl-rec-t">{r.title}</div><div className="tl-rec-d">{r.desc}</div></div>
                    </div>
                  ))}
                </div>
              )}

              <div className="tl-scroll" ref={tlRef} {...swipeHandlers}>
                {renderTimeline(tlRef, false)}
              </div>
            </div>
          </>
        )}

        </div>{/* end mobile-col */}

        {/* ── Desktop Timeline (always visible on >=768px) ── */}
        <div className="desktop-tl">
          <div className="dtl-head">
            <div className="dtl-title">
              <button className="tl-nav-btn" onClick={()=>changeView(-1)}>{I.left}</button>
              <span style={{fontSize:15}}>
                {tlView==="day" ? fmtDay(selDate) :
                  `${viewDays[0].getDate()} ${MONTHS[viewDays[0].getMonth()].slice(0,3)} – ${viewDays[viewDays.length-1].getDate()} ${MONTHS[viewDays[viewDays.length-1].getMonth()].slice(0,3)}`}
              </span>
              <button className="tl-nav-btn" onClick={()=>changeView(1)}>{I.right}</button>
              {!viewDays.some(d=>same(d,today)) && (
                <button className="dtl-today-btn" onClick={goToday}>Hoy</button>
              )}
            </div>
            <div className="dtl-view-btns">
              {[["day","Día"],["3day","3 Días"],["week","Semana"]].map(([v,label])=>(
                <button key={v} className={`dtl-view-btn${tlView===v?" active":""}`}
                  onClick={()=>setTlView(v)}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
            {renderMultiTimeline()}
          </div>
        </div>

        </div>{/* end desk-body */}

        {/* User menu (app-level for proper z-index) */}
        {userMenu && (
          <>
            <div style={{position:"fixed",inset:0,zIndex:89}} onClick={()=>setUserMenu(false)} />
            <div className="user-menu">
              <div className="user-menu-header">
                <div className="user-menu-name">{user?.name||"Usuario"}</div>
                <div className="user-menu-email">{user?.email||""}</div>
              </div>
              <button className="user-menu-item" onClick={()=>{setUserMenu(false);setSheet("accounts")}}>
                {I.layers} Cuentas y calendarios
              </button>
              <button className="user-menu-item danger" onClick={()=>{setUserMenu(false);onLogout()}}>
                {I.x} Cerrar sesión
              </button>
            </div>
          </>
        )}

        {/* Toast */}
        {toast&&<div className="toast">{I.check} {toast}</div>}

        {/* Event Detail */}
        {expandedEvt&&!sheet&&(
          <EventDetail evt={expandedEvt} cal={getCal(expandedEvt.cid)}
            onClose={()=>setExpandedEvt(null)}
            onEdit={()=>openEdit(expandedEvt)}
            onDelete={()=>del(expandedEvt.id)}
            onToggleDone={()=>{
              toggleDone(expandedEvt.id);
              if(!expandedEvt.done) setExpandedEvt(null);
            }}/>
        )}

        {/* Sheets */}
        {sheet&&<div className="ov" onClick={()=>setSheet(null)}/>}

        {(sheet==="new"||sheet==="edit")&&(
          <div className="sh">
            <div className="sh-grab"/>
            <div className="sh-head">
              <span className="sh-h">{sheet==="new" ? (form.isBooking ? "Link de agendamiento" : form.isTask ? "Nueva tarea" : "Nuevo evento") : (form.isTask ? "Editar tarea" : "Editar evento")}</span>
              <button className="ib" onClick={()=>setSheet(null)}>{I.x}</button>
            </div>
            <div className="sh-body">

              {/* Type toggle: Event vs Task vs Booking */}
              {sheet==="new" && (
              <div className="fg">
                <div className="type-switch">
                  <button className={`type-btn ${!form.isTask&&!form.isBooking?"act":""}`}
                    onClick={()=>setForm(f=>({...f,isTask:false,isBooking:false}))}>
                    {I.cal} Evento
                  </button>
                  <button className={`type-btn ${form.isTask?"act":""}`}
                    onClick={()=>setForm(f=>({...f,isTask:true,isBooking:false,allDay:true}))}>
                    {I.task} Tarea
                  </button>
                  <button className={`type-btn ${form.isBooking?"act":""}`}
                    onClick={()=>setForm(f=>({...f,isTask:false,isBooking:true}))}>
                    {I.share} Link
                  </button>
                </div>
              </div>
              )}

              {/* ── Booking link builder ── */}
              {form.isBooking ? (
                <BookingBuilder
                  events={events}
                  accounts={accounts}
                  enabledCals={enabledCals}
                  user={user}
                  onFlash={flash}
                  onClose={()=>setSheet(null)}
                  onLinkCreated={loadBookingLinks}
                />
              ) : (
              <>

              {/* Title */}
              <div className="fg">
                <input className="fi" placeholder={form.isTask ? "¿Qué necesitás hacer?" : "Título del evento"} value={form.title}
                  onChange={e=>{setForm(f=>({...f,title:e.target.value}));if(e.target.value.trim())setFormError("");}}
                  autoFocus
                  style={{fontSize:18,fontWeight:600,border:"none",borderBottom:`1.5px solid ${formError?"var(--danger)":"var(--brd)"}`,borderRadius:0,padding:"12px 0",letterSpacing:"-0.3px"}}
                />
                {formError&&<div style={{fontSize:12,color:"var(--danger)",marginTop:4,fontWeight:500}}>{formError}</div>}
              </div>

              {/* Calendar selector — events only */}
              {!form.isTask ? (
                <div className="fg">
                  <label className="fl">{I.cal} Calendario</label>
                  <div className="cal-sel">
                    {accounts.filter(a=>a.on).flatMap(a=>{
                      const prov = PROVIDERS.find(p=>p.id===a.provider);
                      return a.cals.filter(c=>c.on).map(c=>(
                        <div key={c.id}
                          className={`cal-opt ${form.cid===c.id?"sel":""}`}
                          onClick={()=>setForm(f=>({...f,cid:c.id}))}
                        >
                          <div className="cal-opt-prov" style={{background:prov?.logoUrl?"#fff":prov?.bg||"#333",border:prov?.logoUrl?"1px solid #e5e7eb":"none"}}>{prov?.logoUrl?<img src={prov.logoUrl} style={{width:12,height:12}}/>:prov?.icon||a.name[0]}</div>
                          <div className="cal-opt-info">
                            <div className="cal-opt-name">{c.name}</div>
                            <div className="cal-opt-acc">{a.email}</div>
                          </div>
                          <div className="cal-opt-dot" style={{background:c.color}} />
                          <div className="cal-opt-check">{form.cid===c.id && I.check}</div>
                        </div>
                      ));
                    })}
                  </div>
                </div>
              ) : (
                <div className="fg">
                  <div className="maestro-task-badge">
                    <div className="mtb-icon">M</div>
                    <div className="mtb-info">
                      <div className="mtb-name">Maestro Tasks</div>
                      <div className="mtb-desc">Guardado en tu cuenta Maestro</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="form-div" />

              {/* Date & Time — both events and tasks */}
              <div className="fg">
                <label className="fl">{I.clock} Fecha y hora</label>
                <input className="fi" type="date" value={form.date}
                  onChange={e=>setForm(f=>({...f,date:e.target.value}))}
                  style={{marginBottom:10}}
                />
                {!form.isTask && (
                  <label className="tg-row" style={{marginTop:0,cursor:"pointer"}}>
                    <Toggle checked={form.allDay} onChange={e=>setForm(f=>({...f,allDay:e.target.checked}))} icons={false}/>
                    <span style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>Todo el día</span>
                  </label>
                )}
              </div>

              {(form.isTask || (!form.isTask && !form.allDay)) && (
                <div className="fr">
                  <div className="fg">
                    <label className="fl">Inicio</label>
                    <select className="fi" value={`${form.sh}:${form.sm}`}
                      onChange={e=>{const[h,m]=e.target.value.split(":").map(Number);setForm(f=>{const endM=Math.min(23*60+30,(h*60+m)+60);return{...f,sh:h,sm:m,eh:Math.floor(endM/60),em:endM%60};})}}>
                      {Array.from({length:48},(_,i)=>{
                        const h=Math.floor(i/2),m=(i%2)*30;
                        return (<option key={i} value={`${h}:${m}`}>{fmt(h,m)}</option>);
                      })}
                    </select>
                  </div>
                  <div className="fg">
                    <label className="fl">Fin</label>
                    <select className="fi" value={`${form.eh}:${form.em}`}
                      onChange={e=>{const[h,m]=e.target.value.split(":").map(Number);setForm(f=>({...f,eh:h,em:m}))}}>
                      {Array.from({length:48},(_,i)=>{
                        const h=Math.floor(i/2),m=(i%2)*30;
                        return (<option key={i} value={`${h}:${m}`}>{fmt(h,m)}</option>);
                      })}
                    </select>
                  </div>
                </div>
              )}

              {/* Task priority */}
              {form.isTask && (
                <>
                  <div className="fg">
                    <label className="fl">{I.task} Prioridad</label>
                    <div className="priority-row">
                      {[{v:"low",l:"Baja",c:"var(--ok)"},{v:"medium",l:"Media",c:"var(--warn)"},{v:"high",l:"Alta",c:"var(--danger)"}].map(p=>(
                        <button key={p.v}
                          className={`prio-btn ${form.priority===p.v?"sel":""}`}
                          style={form.priority===p.v?{background:p.c,borderColor:p.c,color:"white"}:{}}
                          onClick={()=>setForm(f=>({...f,priority:f.priority===p.v?null:p.v}))}>
                          {p.l}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="form-div" />

              {/* Location — events only */}
              {!form.isTask && (
                <div className="fg">
                  <label className="fl">{I.pin} Ubicación</label>
                  <input className="fi" placeholder="Oficina, café, dirección..."
                    value={form.loc} onChange={e=>setForm(f=>({...f,loc:e.target.value}))} />
                </div>
              )}

              {/* Invitados — events only */}
              {!form.isTask && (
                <AttendeeField
                  attendees={form.attendees||[]}
                  onChange={attendees=>setForm(f=>({...f,attendees}))}
                />
              )}

              {/* Google Meet — events only */}
              {!form.isTask && (
                <div>
                  <div className="cal-si" style={{paddingLeft:0}}>
                    <img src="https://developers.google.com/identity/images/g-logo.png" style={{width:8,height:8,flexShrink:0}}/>
                    <span className="cal-n" style={{fontSize:13,color:"var(--t)"}}>Google Meet</span>
                    <Toggle checked={!!(form.addMeet||form.videoLink)} disabled={!!form.videoLink}
                      onChange={e=>setForm(f=>({...f,addMeet:e.target.checked}))}/>
                  </div>
                  {form.videoLink && (
                    <a href={form.videoLink} target="_blank" rel="noopener noreferrer"
                      style={{fontSize:11,color:"var(--blue)",textDecoration:"none",paddingLeft:16,display:"block",marginTop:-4}}>
                      {form.videoLink}
                    </a>
                  )}
                  {form.addMeet && !form.videoLink && (
                    <div style={{fontSize:11,color:"var(--t4)",paddingLeft:16,marginTop:-4}}>Se generará al guardar</div>
                  )}
                </div>
              )}

              {!form.isTask && <div className="form-div" />}

              {/* Notes */}
              <div className="fg">
                <label className="fl">{I.text} Notas</label>
                <textarea className="fi" placeholder="Agregar contexto, agenda, links..."
                  value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))}
                  rows={3}
                  style={{resize:"vertical",minHeight:60,fontFamily:"var(--f)",lineHeight:1.5}}
                />
              </div>

              <button className="btn-m" onClick={save} style={{marginTop:4}}>
                {sheet==="new" ? (form.isTask ? "Crear tarea" : "Crear evento") : "Guardar cambios"}
              </button>
              {sheet==="edit"&&(
                <button className="btn-g dng" onClick={()=>del(form.id)}>Eliminar evento</button>
              )}
              </>
              )}
            </div>
          </div>
        )}

        {sheet==="accounts"&&(
          <div className="sh">
            <div className="sh-grab"/><div className="sh-head"><span className="sh-h">Cuentas</span><button className="ib" onClick={()=>setSheet(null)}>{I.x}</button></div>
            <div className="sh-body">
              {accounts.map(acc=>{const prov=PROVIDERS.find(p=>p.id===acc.provider);const isPrimary=acc.id==="g1";return(<div key={acc.id}><div className="acc-i"><div className="acc-av" style={{background:prov?.logoUrl?"#fff":prov?.bg||"#333",border:prov?.logoUrl?"1px solid #e5e7eb":"none"}}>{prov?.logoUrl?<img src={prov.logoUrl} style={{width:20,height:20}}/>:prov?.icon||acc.name[0]}</div><div className="acc-inf"><div className="acc-n">{acc.name}</div><div className="acc-e">{acc.email}</div></div><div style={{display:"flex",alignItems:"center",gap:6}}><Toggle checked={acc.on} onChange={e=>setAccounts(as=>as.map(a=>a.id===acc.id?{...a,on:e.target.checked}:a))} icons={false}/>{!isPrimary&&<button className="ib" style={{width:28,height:28,color:"var(--danger)"}} title="Eliminar cuenta" onClick={()=>{setAccounts(as=>as.filter(a=>a.id!==acc.id));setEvents(es=>es.filter(e=>e.isTask||!acc.cals.some(c=>c.id===e.cid)));flash("Cuenta eliminada")}}>{I.trash}</button>}</div></div>{acc.on&&acc.cals.map(cal=>(<div key={cal.id} className="cal-si"><div className="cal-d" style={{background:cal.color}}/><span className="cal-n">{cal.name}</span><Toggle checked={cal.on} onChange={e=>setAccounts(as=>as.map(a=>a.id===acc.id?{...a,cals:a.cals.map(c=>c.id===cal.id?{...c,on:e.target.checked}:c)}:a))} icons={false}/></div>))}</div>)})}
              <button className="add-ab" onClick={()=>setSheet("addAcc")}><div className="add-ac">{I.plus}</div>Agregar cuenta</button>
            </div>
          </div>
        )}

        {sheet==="addAcc"&&(
          <div className="sh">
            <div className="sh-grab"/><div className="sh-head"><span className="sh-h">Conectar cuenta</span><button className="ib" onClick={()=>setSheet("accounts")}>{I.x}</button></div>
            <div className="sh-body">
              <p style={{fontSize:13,color:"var(--t3)",marginBottom:14,lineHeight:1.5}}>Conectá una cuenta para sincronizar calendarios.</p>
              {PROVIDERS.map(p=>{const dis=p.id!=="google";return(<div key={p.id} className="prov-c" style={dis?{opacity:0.4,cursor:"not-allowed",pointerEvents:"none"}:{}} onClick={dis?undefined:addGoogleAccount}><div className="prov-ic" style={{background:p.logoUrl?"#fff":p.bg,border:p.logoUrl?"1px solid #e5e7eb":"none"}}>{p.logoUrl?<img src={p.logoUrl} style={{width:22,height:22}}/>:p.icon}</div><div style={{flex:1}}><div className="prov-n">{p.name}{dis&&<span style={{fontSize:10,marginLeft:8,color:"var(--t4)",fontStyle:"italic"}}>Próximamente</span>}</div><div className="prov-d">{p.id==="google"?"Conectar cuenta real":"Sincronizar calendarios"}</div></div></div>);})}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
