function q(id){return document.getElementById(id)}
function esc(v){return String(v ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}
function attr(v){return esc(v).replace(/`/g,"&#96;")}
function money(n){return "฿"+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function dateOnly(d=new Date()){const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,10)}
function today(){return dateOnly()}
function addDays(d,n){let x=new Date(d+"T00:00:00");x.setDate(x.getDate()+n);return dateOnly(x)}
const SHIFT_OPTIONS=["เช้า","บ่าย","ดึก"];
function clockShift(){const h=new Date().getHours(); if(h>=7&&h<15)return "เช้า"; if(h>=15&&h<23)return "บ่าย"; return "ดึก"}
function currentShift(){return localStorage.getItem("pms_current_shift")||clockShift()}
function setCurrentShift(v){if(!SHIFT_OPTIONS.includes(v))v=clockShift(); localStorage.setItem("pms_current_shift",v); syncShiftControls()}
function syncShiftControls(){document.querySelectorAll("[data-shift-select]").forEach(el=>{if(el.value!==currentShift())el.value=currentShift()}); const label=document.getElementById("currentShiftLabel"); if(label)label.textContent=currentShift()}
function shiftOptionsHtml(selected=currentShift(),includeAll=false){return (includeAll?`<option value="">ทุกกะ</option>`:"")+SHIFT_OPTIONS.map(x=>`<option value="${x}" ${x===selected?"selected":""}>${x}</option>`).join("")}
async function api(url,opt){
  let r=await fetch(url,opt);
  let ct=r.headers.get("content-type")||"";
  let d=ct.includes("json")?await r.json():await r.text();
  if(!r.ok){
    if(r.status===401 && !location.pathname.endsWith("/login.html") && !location.pathname.endsWith("/public-booking.html")){
      location.href="/public/login.html?next="+encodeURIComponent(location.pathname+location.search);
    }
    throw new Error(d.error||d||"error");
  }
  return d;
}

const PAGE_TITLES={
  dashboard:"Dashboard",
  todayop:"Today Operation",
  guest:"Guest Information",
  roomavail:"Room Availability",
  roomplan:"Room Plan",
  floorplan:"Floor Plan",
  frontdesk:"Front Desk",
  cashier:"Front Cashier",
  invoice:"Invoice / Billing",
  booking:"New Booking",
  occ:"Occupancy Calendar",
  hk:"Housekeeping",
  maintenance:"Maintenance",
  reports:"Reports",
  nightaudit:"Night Audit",
  linebookings:"LINE Booking Approval",
  publicbooking:"Public Booking Page",
  bookingdetail:"Booking Detail",
  setup:"Setup",
  users:"User Setup",
  channels:"Channel / OTA Mapping",
  line:"LINE Setup",
  backup:"Backup / Restore",
  activity:"Activity Log",
  online:"Online Readiness",
  about:"About PMS",
  crm:"Guest CRM / Guest History",
  login:"Login"
};
let __activePage="";

function menuGroup(label,items){
  return `<div class="classic-menu-item" tabindex="0"><span>${label}</span><div class="classic-dropdown">${items.map(i=>`<a data-page="${i.page}" href="${i.href}">${i.label}</a>`).join("")}</div></div>`
}
function tool(page,href,icon,label){return `<a class="classic-tool" data-page="${page}" href="${href}"><span class="tool-icon">${icon}</span><span class="tool-label">${label}</span></a>`}
function nav(){
  const groups=[
    ["Reservation",[
      {page:"dashboard",href:"/public/dashboard.html",label:"Dashboard"},
      {page:"todayop",href:"/public/today-operation.html",label:"Today Operation"},
      {page:"booking",href:"/public/new-booking.html",label:"New Booking"},
      {page:"roomavail",href:"/public/room-avail.html",label:"Room Availability"},
      {page:"occ",href:"/public/occ-calendar.html",label:"Occ Calendar"}
    ]],
    ["Reception",[
      {page:"guest",href:"/public/guest-info.html",label:"Guest Info"},
      {page:"frontdesk",href:"/public/front-desk.html",label:"Front Desk"},
      {page:"roomplan",href:"/public/roomplan.html",label:"Room Plan"},
      {page:"floorplan",href:"/public/floor-plan.html",label:"Floor Plan"}
    ]],
    ["Front Cashier",[
      {page:"cashier",href:"/public/front-cashier.html",label:"Front Cashier"},
      {page:"invoice",href:"/public/invoice.html",label:"Invoice"}
    ]],
    ["Night Audit",[
      {page:"todayop",href:"/public/today-operation.html",label:"Today Operation"},
      {page:"nightaudit",href:"/public/night-audit.html",label:"Night Audit / Close Day"},
      {page:"reports",href:"/public/reports.html",label:"Reports"},
      {page:"backup",href:"/public/backup.html",label:"Backup / Restore"}
    ]],
    ["Housekeeping",[
      {page:"hk",href:"/public/housekeeping.html",label:"Housekeeping"},
      {page:"maintenance",href:"/public/maintenance.html",label:"Maintenance"}
    ]],
    ["Operator",[
      {page:"line",href:"/public/line-setup.html",label:"LINE Setup"},
      {page:"linebookings",href:"/public/line-bookings.html",label:"LINE Booking Approval"},
      {page:"publicbooking",href:"/public/public-booking.html",label:"Public Booking Page"},
      {page:"channels",href:"/public/channels.html",label:"Channel Mapping"}
    ]],
    ["Guest History",[
      {page:"crm",href:"/public/crm.html",label:"Guest CRM"},
      {page:"guest",href:"/public/guest-info.html",label:"Guest Information"}
    ]],
    ["Tools",[
      {page:"setup",href:"/public/setup.html#hotel",label:"เปลี่ยนชื่อโรงแรม / โลโก้"},
      {page:"setup",href:"/public/setup.html#documents",label:"แก้ไขใบรีจิสเตอร์ / อินวอย / ใบเสร็จ"},
      {page:"users",href:"/public/users.html",label:"Users"},
      {page:"backup",href:"/public/backup.html",label:"Backup"},
      {page:"activity",href:"/public/activity-log.html",label:"Activity Log"},
      {page:"online",href:"/public/online-readiness.html",label:"Online Readiness"}
    ]],
    ["Help",[
      {page:"login",href:"/public/login.html",label:"Login / User"},
      {page:"about",href:"/public/about.html",label:"About PMS"}
    ]]
  ];
  const toolbar=[
    tool("todayop","/public/today-operation.html","🖥️","Today"),
    tool("guest","/public/guest-info.html","👥","Guest Info"),
    tool("roomavail","/public/room-avail.html","🏨","Room Avail"),
    tool("roomplan","/public/roomplan.html","🧩","Room Plan"),
    tool("floorplan","/public/floor-plan.html","🏢","Floor Plan"),
    tool("frontdesk","/public/front-desk.html","💼","Check Out"),
    tool("crm","/public/crm.html","🗂️","History"),
    tool("cashier","/public/front-cashier.html","🧾","Posting"),
    tool("dashboard","/public/dashboard.html","📈","Room Recap"),
    tool("booking","/public/new-booking.html","💬","Enquiry"),
    tool("reports","/public/reports.html","📋","Report"),
    tool("activity","/public/activity-log.html","🧾","Log"),
    tool("online","/public/online-readiness.html","☁️","Online"),
    tool("nightaudit","/public/night-audit.html","🌙","Audit"),
    `<a class="classic-tool" data-logout="1" href="#"><span class="tool-icon">🚪</span><span class="tool-label">Sign Out</span></a>`,
    `<a class="classic-tool exit-tool" href="/public/login.html"><span class="tool-icon">✖</span><span class="tool-label">Exit</span></a>`
  ].join("");
  return `<div class="legacy-shell">
    <div class="classic-menubar">${groups.map(g=>menuGroup(g[0],g[1])).join("")}</div>
    <div class="classic-ribbon">
      <div class="ribbon-left">
        <div class="app-caption"><span class="app-logo">▣</span><span id="hotelName">Hotel LINE Booking PMS</span> <b>[<span id="pageCaption">${PAGE_TITLES[__activePage]||"Guest Information"}</span>]</b></div>
        <div class="classic-toolbar">${toolbar}</div>
      </div>
      <div class="current-shift"><span>Current Shift: <b id="currentShiftLabel"></b></span><select id="navShiftSelect" data-shift-select title="เลือกกะทำงาน"><option>เช้า</option><option>บ่าย</option><option>ดึก</option></select><a href="/public/front-cashier.html" title="ไปหน้า Front Cashier"><span class="shift-square"></span></a></div>
    </div>
    <div class="classic-tabbar">
      <a class="classic-tab tab-individual" href="/public/guest-info.html"><span>👤</span> Guest Information</a>
      <a class="classic-tab tab-group" href="/public/crm.html"><span>👥</span> Guest CRM / ประวัติลูกค้า</a>
    </div>
  </div>`
}
function initNav(){
  if(!document.body || document.querySelector(".legacy-shell")) return;
  document.body.insertAdjacentHTML("afterbegin",nav());
  refreshNavState();
  hydrateNav();
}
function refreshNavState(){
  document.querySelectorAll(".classic-toolbar a,.classic-dropdown a").forEach(a=>{
    a.classList.toggle("active", !!__activePage && a.dataset.page===__activePage);
  });
  const cap=q("pageCaption"); if(cap) cap.textContent=PAGE_TITLES[__activePage]||"Hotel PMS";
  document.querySelectorAll(".classic-tab").forEach(a=>a.classList.remove("active"));
  const tabbar=document.querySelector(".classic-tabbar");
  if(tabbar) tabbar.style.display = (__activePage==="guest") ? "flex" : "none";
  const groupPages=[];
  const groupTab=document.querySelector(".tab-group"), indTab=document.querySelector(".tab-individual");
  if(groupPages.includes(__activePage)){ if(groupTab) groupTab.classList.add("active"); }
  else { if(indTab) indTab.classList.add("active"); }
  syncShiftControls();
}
function active(page){__activePage=page;refreshNavState()}
async function hydrateNav(){
  try{
    const s=await api("/api/settings");
    if(s && s.hotel_name && q("hotelName")) q("hotelName").textContent=s.hotel_name;
    syncShiftControls();
  }catch(e){syncShiftControls()}
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",initNav); else initNav();
document.addEventListener("change",e=>{
  const el=e.target.closest("[data-shift-select]");
  if(!el) return;
  setCurrentShift(el.value);
});
document.addEventListener("click",async e=>{
  const a=e.target.closest("[data-logout]");
  if(!a) return;
  e.preventDefault();
  try{await api("/api/logout",{method:"POST"});}catch(err){}
  location.href="/public/login.html";
});

async function patchStatus(id,status,force=false){await api(`/api/bookings/${id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,force})}); location.reload()}
function fileToBase64(file){return new Promise(resolve=>{if(!file)return resolve("");const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file)})}

