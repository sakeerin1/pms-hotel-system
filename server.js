// Hotel Local PMS v15 - Actual Room Revenue / Activity Log / Documents / About PMS
// Standalone Node.js only. No npm install required.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1"; // local-only by default
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Bangkok";
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
const IS_VERCEL = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, "backups");
const LEGACY_DB_SOURCE = "hotel-local-pms-v15/data/db.json";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let dbCache = null;

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function localDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function today() { return localDate(); }
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}
function nights(a, b) { return Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000)); }
function overlaps(a1, a2, b1, b2) { return a1 < b2 && a2 > b1; }
function nowIso() { return new Date().toISOString(); }
function baht(n) { return Number(n || 0); }
const SHIFT_NAMES = ["เช้า", "บ่าย", "ดึก"];
function normalizeShiftName(v) {
  const raw = String(v || "").trim();
  if (["morning","am","day","เช้า"].includes(raw.toLowerCase())) return "เช้า";
  if (["afternoon","pm","evening","บ่าย"].includes(raw.toLowerCase())) return "บ่าย";
  if (["night","graveyard","ดึก"].includes(raw.toLowerCase())) return "ดึก";
  return SHIFT_NAMES.includes(raw) ? raw : currentShiftByClock();
}
function currentShiftByClock(d = new Date()) {
  const h = d.getHours();
  if (h >= 7 && h < 15) return "เช้า";
  if (h >= 15 && h < 23) return "บ่าย";
  return "ดึก";
}
function shiftKey(v) { return normalizeShiftName(v); }

function defaultDb() {
  const roomTypes = [
    { id: 1, code: "STD/DBL", name: "Standard Double", description: "ห้องสแตนดาร์ดเตียงเดี่ยว", base_price: 790, max_guests: 2 },
    { id: 2, code: "STD/TWN", name: "Standard Twin", description: "ห้องสแตนดาร์ดเตียงคู่", base_price: 790, max_guests: 2 },
    { id: 3, code: "FAM/TRP", name: "Family Triple", description: "ห้อง 3 คน สำหรับครอบครัว", base_price: 1090, max_guests: 3 },
    { id: 4, code: "VIP/BIZ", name: "VIP Business", description: "ห้อง VIP Business", base_price: 1490, max_guests: 2 }
  ];

  const rooms = [];
  const roomNos = [
    201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,
    301,302,303,304,305,306,307,308,309,310,311,312,313,
    401,402,403,404,405,406,407,408,409,410,411,412
  ];
  roomNos.forEach((no, i) => {
    rooms.push({
      id: i + 1,
      room_no: String(no),
      floor: String(no)[0],
      room_type_id: (i % 4) + 1,
      bed_type_id: (i % 4) + 1,
      housekeeping_status: "VC",
      room_status: "active",
      active: true
    });
  });

  const db = {
    settings: {
      hotel_name: "Sino Hotel Demo",
      hotel_code: "SH",
      phone: "075-332088",
      bank_name: "Demo Bank",
      bank_account: "123-4-56789-0",
      address: "Hotel Address",
      tax_id: "",
      checkin_time: "14:00",
      checkout_time: "12:00",
      currency: "THB",
      company_name: "Kiralux property",
      company_tax_id: "",
      company_address: "Hotel Address",
      company_branch: "สำนักงานใหญ่",
      product_name: "Kiralux property Hotel PMS V13",
      product_by: "sakeerin",
      product_phone: "0881822421",
      hotel_logo_dataurl: "",
      document_template: "classic",
      register_title: "ใบลงทะเบียนเข้าพัก / Registration Card",
      register_terms: "เวลาเช็คอิน 14:00 น. เวลาเช็คเอาท์ 12:00 น. กรุณาแสดงบัตรประชาชนหรือพาสปอร์ตเมื่อเข้าพัก",
      register_footer: "ลงชื่อผู้เข้าพัก ___________________________  วันที่ ____/____/______",
      invoice_title: "ใบแจ้งหนี้ / Invoice",
      invoice_terms: "กรุณาชำระเงินตามยอดที่ระบุในเอกสารฉบับนี้",
      invoice_footer: "ผู้จัดทำ ___________________________  ผู้รับบริการ ___________________________",
      receipt_title: "ใบเสร็จรับเงิน / Receipt",
      receipt_terms: "ได้รับเงินตามรายการข้างต้นไว้ถูกต้องแล้ว",
      receipt_footer: "ผู้รับเงิน ___________________________  ลูกค้า ___________________________",
      auto_backup_enabled: true,
      auto_backup_time: "02:00",
      backup_custom_dir: "",
      backup_warning_hours: 24,
      line_channel_access_token: "",
      line_channel_secret: "",
      line_liff_id: "",
      line_admin_user_id: "",
      line_booking_message: "ขอบคุณที่จองห้องพัก เลขจองของคุณคือ {booking_no}",
      next_booking_no: 1,
      next_receipt_no: 1
    },
    bed_types: [
      { id: 1, code: "DBL", name: "Double Bed", capacity: 2, active: true },
      { id: 2, code: "TWN", name: "Twin Bed", capacity: 2, active: true },
      { id: 3, code: "TRP", name: "Triple Bed", capacity: 3, active: true },
      { id: 4, code: "KING", name: "King Bed", capacity: 2, active: true }
    ],
    room_types: roomTypes,
    rooms,
    bookings: [],
    payments: [],
    refunds: [],
    extra_charges: [],
    cashier_shifts: [],
    shift_settings: { shifts: SHIFT_NAMES },
    activity_logs: [],
    night_audits: [],
    rate_inventory: [],
    promotion_codes: [],
    users: [
      { id: 1, username: "admin", password: "admin123", display_name: "Administrator", role: "admin", active: true },
      { id: 2, username: "manager", password: "manager123", display_name: "Manager", role: "manager", active: true },
      { id: 3, username: "front", password: "front123", display_name: "Front Desk", role: "frontdesk", active: true },
      { id: 4, username: "cashier", password: "cashier123", display_name: "Cashier", role: "cashier", active: true },
      { id: 5, username: "hk", password: "hk123", display_name: "Housekeeping", role: "housekeeping", active: true },
      { id: 6, username: "maint", password: "maint123", display_name: "Maintenance", role: "maintenance", active: true }
    ],
    sessions: [],
    maintenance_tickets: [],
    room_blocks: [],
    customer_profiles: [],
    line_message_logs: [],
    channels: [
      { id: 1, name: "Direct LINE", type: "direct", commission_percent: 0, active: true },
      { id: 2, name: "Walk In", type: "direct", commission_percent: 0, active: true },
      { id: 3, name: "AGODA COLLECT", type: "ota", commission_percent: 18, active: true },
      { id: 4, name: "Booking.com Room Only", type: "ota", commission_percent: 17, active: true },
      { id: 5, name: "Expedia Room+CBF", type: "ota", commission_percent: 18, active: true },
      { id: 6, name: "Trip.com", type: "ota", commission_percent: 15, active: true },
      { id: 7, name: "Corporate", type: "corporate", commission_percent: 0, active: true }
    ]
  };

  seedRateInventory(db);
  seedPromotions(db);
  // Production default starts clean. Demo data can be created during testing, but is not seeded automatically.
  return db;
}

function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}
function supabaseRequestSync(method, requestPath, body) {
  const stateBuffer = new SharedArrayBuffer(4);
  const state = new Int32Array(stateBuffer);
  let message = null;
  let workerError = null;
  const workerCode = `
    const { parentPort, workerData } = require("worker_threads");
    const state = new Int32Array(workerData.stateBuffer);
    (async () => {
      try {
        const res = await fetch(workerData.url, {
          method: workerData.method,
          headers: workerData.headers,
          body: workerData.body
        });
        const text = await res.text();
        parentPort.postMessage({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          text
        });
      } catch (error) {
        parentPort.postMessage({
          ok: false,
          error: error && error.message ? error.message : String(error)
        });
      } finally {
        Atomics.store(state, 0, 1);
        Atomics.notify(state, 0, 1);
      }
    })();
  `;
  const worker = new Worker(workerCode, {
    eval: true,
    workerData: {
      stateBuffer,
      method,
      url: `${SUPABASE_URL}/rest/v1/${requestPath}`,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation,resolution=merge-duplicates"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  });
  worker.on("message", msg => { message = msg; });
  worker.on("error", err => { workerError = err; Atomics.store(state, 0, 1); Atomics.notify(state, 0, 1); });
  Atomics.wait(state, 0, 0);
  worker.terminate();
  if (workerError) throw workerError;
  if (!message) throw new Error("supabase_request_no_response");
  if (!message.ok) {
    const detail = message.error || message.text || `${message.status || ""} ${message.statusText || ""}`.trim();
    throw new Error(`supabase_request_failed:${detail}`);
  }
  if (!message.text) return null;
  try { return JSON.parse(message.text); } catch { return message.text; }
}
function normalizeDb(db) {
  db.settings ||= {};
  db.settings.address ||= "";
  db.settings.tax_id ||= "";
  db.settings.checkin_time ||= "14:00";
  db.settings.checkout_time ||= "12:00";
  db.settings.currency ||= "THB";
  db.settings.company_name ||= db.settings.hotel_name || "Kiralux property";
  db.settings.company_tax_id ||= db.settings.tax_id || "";
  db.settings.company_address ||= db.settings.address || "";
  db.settings.company_branch ||= "สำนักงานใหญ่";
  db.settings.product_name ||= "Kiralux property Hotel PMS V13";
  db.settings.product_by ||= "sakeerin";
  db.settings.product_phone ||= "0881822421";
  db.settings.hotel_logo_dataurl ||= "";
  db.settings.document_template ||= "classic";
  db.settings.register_title ||= "ใบลงทะเบียนเข้าพัก / Registration Card";
  db.settings.register_terms ||= "เวลาเช็คอิน 14:00 น. เวลาเช็คเอาท์ 12:00 น. กรุณาแสดงบัตรประชาชนหรือพาสปอร์ตเมื่อเข้าพัก";
  db.settings.register_footer ||= "ลงชื่อผู้เข้าพัก ___________________________  วันที่ ____/____/______";
  db.settings.invoice_title ||= "ใบแจ้งหนี้ / Invoice";
  db.settings.invoice_terms ||= "กรุณาชำระเงินตามยอดที่ระบุในเอกสารฉบับนี้";
  db.settings.invoice_footer ||= "ผู้จัดทำ ___________________________  ผู้รับบริการ ___________________________";
  db.settings.receipt_title ||= "ใบเสร็จรับเงิน / Receipt";
  db.settings.receipt_terms ||= "ได้รับเงินตามรายการข้างต้นไว้ถูกต้องแล้ว";
  db.settings.receipt_footer ||= "ผู้รับเงิน ___________________________  ลูกค้า ___________________________";
  if (db.settings.auto_backup_enabled === undefined) db.settings.auto_backup_enabled = true;
  db.settings.auto_backup_time ||= "02:00";
  db.settings.backup_custom_dir ||= "";
  db.settings.backup_warning_hours ||= 24;
  db.bed_types ||= [
    { id: 1, code: "DBL", name: "Double Bed", capacity: 2, active: true },
    { id: 2, code: "TWN", name: "Twin Bed", capacity: 2, active: true },
    { id: 3, code: "TRP", name: "Triple Bed", capacity: 3, active: true },
    { id: 4, code: "KING", name: "King Bed", capacity: 2, active: true }
  ];
  db.room_types ||= [];
  db.rooms ||= [];
  db.rooms.forEach(r => { if (!r.bed_type_id) r.bed_type_id = r.room_type_id || 1; });
  db.bookings ||= [];
  db.payments ||= [];
  db.refunds ||= [];
  db.extra_charges ||= [];
  db.shift_settings ||= { shifts: SHIFT_NAMES };
  db.cashier_shifts ||= [];
  db.payments.forEach(p => { if (!p.shift_name) p.shift_name = currentShiftByClock(new Date(p.created_at || nowIso())); });
  db.refunds.forEach(r => { if (!r.shift_name) r.shift_name = currentShiftByClock(new Date(r.created_at || nowIso())); });
  db.cashier_shifts.forEach(sh => { if (!sh.shift_name) sh.shift_name = "เช้า"; });
  db.housekeeping_notes ||= [];
  db.rate_inventory ||= [];
  db.promotion_codes ||= [];
  db.users ||= [
    { id: 1, username: "admin", password: "admin123", display_name: "Administrator", role: "admin", active: true }
  ];
  db.users.forEach(u => {
    if (u.password && !u.password_hash) migrateUserPassword(u, u.password);
  });
  db.sessions ||= [];
  db.maintenance_tickets ||= [];
  db.room_blocks ||= [];
  db.room_moves ||= [];
  db.maintenance_tickets.forEach(t => {
    t.work_order_no ||= t.ticket_no;
    t.reported_by ||= t.created_by || "";
    t.block_start_date ||= t.start_date || t.created_at?.slice(0,10) || today();
    t.block_end_date ||= t.end_date || t.block_start_date;
  });
  db.room_blocks.forEach(b => { b.status ||= "active"; b.start_date ||= b.block_start_date || today(); b.end_date ||= b.block_end_date || b.start_date; });
  refreshRoomBlockStatuses(db);
  db.customer_profiles ||= [];
  db.line_message_logs ||= [];
  db.channels ||= [
    { id: 1, name: "Direct LINE", type: "direct", commission_percent: 0, active: true },
    { id: 2, name: "Walk In", type: "direct", commission_percent: 0, active: true },
    { id: 3, name: "AGODA COLLECT", type: "ota", commission_percent: 18, active: true },
    { id: 4, name: "Booking.com Room Only", type: "ota", commission_percent: 17, active: true }
  ];
  db.activity_logs ||= [];
  db.night_audits ||= [];
  return db;
}
function readDb() {
  if (USE_SUPABASE) {
    if (dbCache) return cloneDb(dbCache);
    const rows = supabaseRequestSync("GET", "legacy_db_import?id=eq.current-db&select=payload", undefined) || [];
    if (Array.isArray(rows) && rows[0] && rows[0].payload) {
      dbCache = normalizeDb(rows[0].payload);
      return cloneDb(dbCache);
    }
  }
  if (!fs.existsSync(DB_FILE)) {
    const db = normalizeDb(defaultDb());
    writeDb(db);
    return cloneDb(db);
  }
  const db = normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  if (USE_SUPABASE) dbCache = cloneDb(db);
  return cloneDb(db);
}

function writeDb(db) {
  const normalized = normalizeDb(db);
  dbCache = cloneDb(normalized);
  if (USE_SUPABASE) {
    supabaseRequestSync("POST", "legacy_db_import?on_conflict=id", [{
      id: "current-db",
      source: LEGACY_DB_SOURCE,
      payload: normalized,
      created_at: nowIso()
    }]);
  }
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(normalized, null, 2), "utf8");
  } catch (error) {
    if (!USE_SUPABASE) throw error;
  }
}

function log(db, action, detail) {
  db.activity_logs.unshift({ at: nowIso(), action, detail });
  db.activity_logs = db.activity_logs.slice(0, 250);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}
function currentUser(req, db) {
  const sid = parseCookies(req).pms_session;
  if (!sid) return null;
  const session = (db.sessions || []).find(s => s.id === sid && s.active !== false);
  if (!session) return null;
  if (sessionExpired(session)) return null;
  const user = (db.users || []).find(u => u.id === session.user_id && u.active !== false);
  return user ? { id:user.id, username:user.username, display_name:user.display_name, role:user.role } : null;
}
function makeSessionId() {
  return "S" + crypto.randomBytes(24).toString("base64url");
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !String(stored).startsWith("pbkdf2_sha256$")) return false;
  const [, rounds, salt, hash] = String(stored).split("$");
  const test = crypto.pbkdf2Sync(String(password || ""), salt, Number(rounds || 120000), 32, "sha256").toString("base64url");
  if (!hash || hash.length !== test.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(test));
}
function passwordMatches(user, password) {
  if (user.password_hash && verifyPassword(password, user.password_hash)) return true;
  return user.password && user.password === password;
}
function migrateUserPassword(user, password) {
  if (!user.password_hash) user.password_hash = hashPassword(password);
  if (user.password) delete user.password;
}
function sessionExpired(session) {
  if (!session?.created_at || !SESSION_TTL_HOURS) return false;
  return Date.now() - new Date(session.created_at).getTime() > SESSION_TTL_HOURS * 3600000;
}
function roleAllowed(role, allowed) {
  if (!allowed || allowed.length === 0) return true;
  if (role === "admin") return true;
  return allowed.includes(role);
}

function pathMatch(pathname, pattern) {
  return typeof pattern === "string" ? pathname === pattern : pattern.test(pathname);
}
function isPublicApi(method, pathname) {
  return pathname === "/api/login" || pathname === "/api/logout" || pathname === "/api/me" || pathname.startsWith("/api/public/") || pathname === "/line/webhook";
}
function canAccessApi(user, method, pathname) {
  if (!user) return false;
  if (["admin", "manager"].includes(user.role)) return true;

  const commonGet = [
    "/api/settings", "/api/room-types", "/api/rooms", "/api/dashboard", "/api/today-operation", "/api/availability",
    "/api/roomplan", "/api/occ-calendar", "/api/available-rooms", "/api/channels", "/api/line-preview", "/api/quote"
  ];
  if (method === "GET" && commonGet.some(x => pathMatch(pathname, x))) return true;

  if (user.role === "frontdesk") {
    if (method === "GET" && ["/api/guest-list", "/api/crm/customers", "/api/crm/customer", "/api/invoice/booking", "/api/export/guest-list.csv"].includes(pathname)) return true;
    if (method === "GET" && /^\/api\/bookings\/\d+$/.test(pathname)) return true;
    if (method === "POST" && (pathname === "/api/bookings" || pathname === "/api/crm/line-message")) return true;
    if (method === "POST" && pathname === "/api/rooms/block-sale") return true;
    if (method === "POST" && /^\/api\/bookings\/\d+\/extras$/.test(pathname)) return true;
    if (method === "PATCH" && (/^\/api\/bookings\/\d+(\/status)?$/.test(pathname) || /^\/api\/crm\/customers\/.+/.test(pathname))) return true;
    return false;
  }
  if (user.role === "cashier") {
    if (method === "GET" && ["/api/guest-list", "/api/payments", "/api/invoice/booking", "/api/export/guest-list.csv", "/api/export/daily-report.xls", "/api/export/monthly-report.xls"].includes(pathname)) return true;
    if (method === "GET" && /^\/api\/bookings\/\d+$/.test(pathname)) return true;
    if (method === "POST" && (/^\/api\/bookings\/\d+\/(payments|refunds|extras)$/.test(pathname) || pathname === "/api/cashier/close-shift")) return true;
    if (method === "PATCH" && /^\/api\/bookings\/\d+\/status$/.test(pathname)) return true;
    return false;
  }
  if (user.role === "housekeeping") {
    if (method === "GET" && pathname === "/api/housekeeping") return true;
    if (method === "POST" && pathname === "/api/housekeeping/notes") return true;
    if (method === "PATCH" && (/^\/api\/housekeeping\/notes\/\d+\/status$/.test(pathname) || /^\/api\/rooms\/[^/]+\/housekeeping$/.test(pathname))) return true;
    return false;
  }
  if (user.role === "maintenance") {
    if (method === "GET" && (pathname === "/api/maintenance" || pathname === "/api/maintenance/summary" || pathname === "/api/maintenance/room-history" || /^\/api\/maintenance\/\d+$/.test(pathname))) return true;
    if (method === "POST" && pathname === "/api/maintenance") return true;
    if (method === "POST" && pathname === "/api/rooms/block-sale") return true;
    if (method === "PATCH" && /^\/api\/maintenance\/\d+$/.test(pathname)) return true;
    return false;
  }
  return false;
}
function backupSafeName(file) {
  const f = path.basename(String(file || ""));
  if (!f.endsWith(".json") || f.includes("..") || f.includes("/") || f.includes("\\")) return "";
  return f;
}
function isAuditClosed(db, date) {
  return (db.night_audits || []).some(a => a.date === date && a.status === "closed");
}
function touchesClosedAudit(db, checkin, checkout) {
  return (db.night_audits || []).some(a => a.status === "closed" && overlaps(checkin, checkout, a.date, addDays(a.date, 1)));
}
function bookingTouchesClosedAudit(db, b, data = {}) {
  const oldCheckin = b.checkin, oldCheckout = b.checkout;
  const newCheckin = data.checkin || b.checkin, newCheckout = data.checkout || b.checkout;
  return touchesClosedAudit(db, oldCheckin, oldCheckout) || touchesClosedAudit(db, newCheckin, newCheckout);
}
function publicBookingPayload(data) {
  return {
    room_type_id: Number(data.room_type_id || 0),
    checkin: data.checkin,
    checkout: data.checkout,
    guest_name: data.guest_name,
    phone: data.phone,
    guests: Number(data.guests || 1),
    adults: Number(data.adults || data.guests || 1),
    children: Number(data.children || 0),
    note: data.note || "Public LINE booking",
    agent: "Direct LINE",
    nationality: data.nationality || "Thai",
    promo_code: data.promo_code || "",
    paid_amount: Number(data.paid_amount || 0),
    payment_method: data.payment_method || "Transfer",
    slip_base64: data.slip_base64 || "",
    status: "pending"
  };
}

function safeMkdir(dir) {
  if (!dir) return false;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return fs.existsSync(dir);
}
function effectiveBackupDir(db) {
  const custom = String(db?.settings?.backup_custom_dir || "").trim();
  return custom ? path.resolve(custom) : BACKUP_DIR;
}
function backupDirWritable(dir) {
  try {
    safeMkdir(dir);
    const test = path.join(dir, `.pms-write-test-${Date.now()}.tmp`);
    fs.writeFileSync(test, "ok", "utf8");
    fs.unlinkSync(test);
    return true;
  } catch (e) { return false; }
}
function autoBackup(db, reason="manual") {
  const dir = effectiveBackupDir(db);
  safeMkdir(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backup-${stamp}-${reason}.json`;
  const full = path.join(dir, file);
  fs.writeFileSync(full, JSON.stringify(db, null, 2), "utf8");
  return { file, path: full, backup_dir: dir, created_at: nowIso(), size: fs.statSync(full).size };
}
function listBackups(dbArg=null) {
  const db = dbArg || (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, "utf8")) : { settings:{} });
  const dirs = Array.from(new Set([effectiveBackupDir(db), BACKUP_DIR].filter(Boolean)));
  const rows = [];
  dirs.forEach(dir => {
    try {
      safeMkdir(dir);
      fs.readdirSync(dir).filter(f => f.endsWith(".json")).forEach(f => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        rows.push({ file:f, size:st.size, modified_at:st.mtime.toISOString(), backup_dir:dir, full_path:full });
      });
    } catch(e) {}
  });
  const seen = new Set();
  return rows.sort((a,b)=>String(b.modified_at).localeCompare(String(a.modified_at))).filter(r => {
    const k = r.full_path;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}
function findBackupFile(db, file) {
  const clean = backupSafeName(file);
  if (!clean) return "";
  const dirs = Array.from(new Set([effectiveBackupDir(db), BACKUP_DIR].filter(Boolean)));
  for (const dir of dirs) {
    const full = path.join(dir, clean);
    if (fs.existsSync(full)) return full;
  }
  return "";
}
function backupStatus(db) {
  const dir = effectiveBackupDir(db);
  const writable = backupDirWritable(dir);
  const rows = listBackups(db);
  const last = rows[0] || null;
  const hours = last ? (Date.now() - new Date(last.modified_at).getTime()) / 3600000 : Infinity;
  const warnHours = Number(db.settings.backup_warning_hours || 24);
  const warning = !last ? "ยังไม่พบไฟล์ Backup" : (hours > warnHours ? `Backup ล่าสุดเกิน ${warnHours} ชั่วโมงแล้ว` : "");
  return {
    backup_dir: dir,
    writable,
    auto_backup_enabled: db.settings.auto_backup_enabled !== false,
    auto_backup_time: db.settings.auto_backup_time || "02:00",
    backup_warning_hours: warnHours,
    last_backup: last,
    hours_since_last_backup: Number(isFinite(hours) ? hours.toFixed(2) : 999999),
    warning: !writable ? "โฟลเดอร์ Backup เขียนไฟล์ไม่ได้ / ไม่พบไดรฟ์สำรอง" : warning,
    backups_count: rows.length
  };
}

function onlineReadiness(db) {
  const users = db.users || [];
  const defaultPasswords = {
    admin: "admin123",
    manager: "manager123",
    front: "front123",
    cashier: "cashier123",
    hk: "hk123",
    maint: "maint123"
  };
  const weakUsers = users.filter(u => {
    if (u.password) return true;
    const guess = defaultPasswords[u.username];
    return guess ? verifyPassword(guess, u.password_hash) : false;
  }).map(u => u.username);
  const backup = backupStatus(db);
  const checks = [
    { key:"timezone", label:"Timezone set to Asia/Bangkok", ok:APP_TIME_ZONE === "Asia/Bangkok", detail:APP_TIME_ZONE },
    { key:"session_ttl", label:"Session expiry configured", ok:SESSION_TTL_HOURS > 0 && SESSION_TTL_HOURS <= 24, detail:`${SESSION_TTL_HOURS} hours` },
    { key:"passwords", label:"No default/plain-text passwords", ok:weakUsers.length === 0, detail:weakUsers.length ? weakUsers.join(", ") : "ok" },
    { key:"backup", label:"Backup directory writable", ok:backup.writable, detail:backup.backup_dir },
    { key:"recent_backup", label:"Recent backup exists", ok:backup.hours_since_last_backup <= Number(db.settings.backup_warning_hours || 24), detail:`${backup.hours_since_last_backup} hours ago` },
    { key:"rooms", label:"Active rooms configured", ok:(db.rooms || []).filter(r => r.active !== false).length > 0, detail:`${(db.rooms || []).filter(r => r.active !== false).length} rooms` },
    { key:"supabase_url", label:"SUPABASE_URL configured", ok:!!process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes("your-project-ref"), detail:process.env.SUPABASE_URL ? "configured" : "missing" },
    { key:"supabase_key", label:"Service role key configured server-side", ok:!!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY.includes("replace-with"), detail:process.env.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "missing" }
  ];
  const ready = checks.every(c => c.ok);
  return {
    ready,
    generated_at: nowIso(),
    app_time_zone: APP_TIME_ZONE,
    session_ttl_hours: SESSION_TTL_HOURS,
    checks,
    counts: {
      rooms:(db.rooms || []).length,
      bookings:(db.bookings || []).length,
      payments:(db.payments || []).length,
      users:users.length,
      backups:backup.backups_count
    },
    backup
  };
}
function sqlString(v) {
  return `'${String(v ?? "").replace(/'/g, "''")}'`;
}
function exportSupabaseSeed(db) {
  const outDir = path.join(ROOT, "supabase");
  safeMkdir(outDir);
  const file = "legacy-db-import.sql";
  const full = path.join(outDir, file);
  const sql = [
    "-- Hotel Local PMS legacy JSON import",
    `-- Generated at ${nowIso()}`,
    "create table if not exists legacy_db_import (",
    "  id text primary key,",
    "  source text not null,",
    "  payload jsonb not null,",
    "  created_at timestamptz not null default now()",
    ");",
    "",
    "insert into legacy_db_import (id, source, payload, created_at) values (",
    `  'current-db',`,
    `  ${sqlString("hotel-local-pms-v15/data/db.json")},`,
    `  ${sqlString(JSON.stringify(db))}::jsonb,`,
    "  now()",
    ") on conflict (id) do update set payload=excluded.payload, created_at=now();",
    "",
    "-- Next step: transform payload->'rooms', payload->'bookings', etc. into the relational tables in schema.sql.",
    ""
  ].join("\n");
  fs.writeFileSync(full, sql, "utf8");
  return { ok:true, file, path:full, size:fs.statSync(full).size, created_at:nowIso() };
}
function customerProfile(db, phone) {
  db.customer_profiles ||= [];
  let p = db.customer_profiles.find(x => String(x.phone) === String(phone));
  if (!p) {
    p = {
      phone:String(phone),
      note:"",
      member_level:"Normal",
      blacklist:false,
      watchlist:false,
      discount_percent:0,
      preferences:"",
      allergy_note:"",
      line_user_id:"",
      updated_at:nowIso()
    };
    db.customer_profiles.push(p);
  }
  p.member_level ||= "Normal";
  p.preferences ||= "";
  p.note ||= "";
  p.allergy_note ||= "";
  p.line_user_id ||= "";
  p.discount_percent = Number(p.discount_percent || 0);
  return p;
}

function customerCrmSummary(db, phone) {
  const key = String(phone || "");
  const bookings = (db.bookings || []).filter(b => String(b.phone || "") === key).sort((a,b)=>String(b.checkin).localeCompare(String(a.checkin)));
  const payments = (db.payments || []).filter(p => p.status !== "void" && bookings.some(b => b.id === p.booking_id));
  const refunds = (db.refunds || []).filter(r => r.status !== "void" && bookings.some(b => b.id === r.booking_id));
  const extra = (db.extra_charges || []).filter(x => x.status !== "void" && bookings.some(b => b.id === x.booking_id));
  const profile = customerProfile(db, key);
  return {
    phone:key,
    guest_name: bookings[0]?.guest_name || "",
    visits: bookings.length,
    revenue: bookings.reduce((s,b)=>s+baht(b.total_amount),0),
    paid_total: payments.reduce((s,p)=>s+baht(p.amount),0),
    refund_total: refunds.reduce((s,r)=>s+baht(r.amount),0),
    extra_total: extra.reduce((s,x)=>s+baht(x.amount),0),
    last_stay: bookings.reduce((last,b)=>!last || b.checkout > last ? b.checkout : last, ""),
    profile,
    bookings: bookings.map(b => enrichBooking(db, b)),
    payments,
    refunds,
    line_messages: (db.line_message_logs || []).filter(m => String(m.phone || "") === key).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,20)
  };
}

function normalizePaymentMethod(method) {
  const m = String(method || "Other").trim();
  if (/cash/i.test(m) || m === "เงินสด") return "Cash";
  if (/transfer|bank/i.test(m) || m === "โอน") return "Transfer";
  if (/qr|promptpay/i.test(m)) return "QR";
  if (/credit|card|visa|master/i.test(m) || m === "บัตรเครดิต") return "Credit Card";
  return m || "Other";
}
function paymentCategoryName(k) {
  return ({room:"ค่าห้อง",deposit:"มัดจำ",extra_bed:"ค่าเตียงเสริม",damage:"ค่าเสียหาย",mini_bar:"มินิบาร์",other:"อื่น ๆ"}[k] || k || "ค่าห้อง");
}
function standardMoneyBuckets() {
  return { "Cash":0, "Transfer":0, "QR":0, "Credit Card":0, "Other":0 };
}
function safeResetOperationalData(db, userName="admin") {
  db.bookings = [];
  db.payments = [];
  db.refunds = [];
  db.extra_charges = [];
  db.cashier_shifts = [];
  db.night_audits = [];
  db.housekeeping_notes = [];
  db.maintenance_tickets = [];
  db.room_blocks = [];
  db.customer_profiles = [];
  db.line_message_logs = [];
  // keep current login sessions so admin can continue after reset
  db.settings.next_booking_no = 1;
  db.settings.next_receipt_no = 1;
  (db.rooms || []).forEach(r => {
    r.housekeeping_status = "VC";
    r.room_status = "active";
    r.manual_block_sale = false;
    delete r.unblocked_at;
  });
  db.activity_logs = [{ at: nowIso(), action:"SAFE_RESET_OPERATIONAL_DATA", detail:`Clear bookings/payments/guests/revenue/maintenance before go-live by ${userName}` }];
  return db;
}


function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function genBookingNo(db) {
  const y = new Date().getFullYear();
  const n = db.settings.next_booking_no || 1;
  db.settings.next_booking_no = n + 1;
  return `BK${y}-${String(n).padStart(5, "0")}`;
}

function genReceiptNo(db) {
  const y = new Date().getFullYear();
  const n = db.settings.next_receipt_no || 1;
  db.settings.next_receipt_no = n + 1;
  return `RC${y}-${String(n).padStart(5, "0")}`;
}

function bookingStatusCode(b, day = today()) {
  if (b.status === "cancelled") return "CXL";
  if (b.status === "checked_out") return "CO";
  if (b.status === "checked_in") return "INH";
  if (b.status === "confirmed") return "CFM";
  if (b.status === "pending") return "RSV";
  return "RSV";
}

function roomType(db, id) { return db.room_types.find(x => x.id === Number(id)); }
function bedType(db, id) { return (db.bed_types || []).find(x => x.id === Number(id)); }
function roomObj(db, no) { return db.rooms.find(x => x.room_no === String(no)); }
function addRoomMove(db, booking, fromRoom, toRoom, user, reason = "") {
  db.room_moves ||= [];
  const from = String(fromRoom || "");
  const to = String(toRoom || "");
  if (!booking || !from || !to || from === to) return null;
  const move = {
    id: db.room_moves.length ? Math.max(...db.room_moves.map(x => x.id || 0)) + 1 : 1,
    booking_id: booking.id,
    booking_no: booking.booking_no,
    guest_name: booking.guest_name || "",
    from_room_no: from,
    to_room_no: to,
    reason: reason || "",
    moved_by: user?.display_name || user?.username || "",
    moved_at: nowIso()
  };
  db.room_moves.unshift(move);
  return move;
}
function syncRoomStatuses(db, date = today()) {
  const activeRoomNos = new Set((db.bookings || [])
    .filter(b => !["cancelled","checked_out"].includes(b.status) && b.checkin <= date && b.checkout > date)
    .map(b => String(b.room_no)));
  let changed = 0;
  (db.rooms || []).forEach(r => {
    if (!r.active) return;
    if (activeRoomNos.has(String(r.room_no))) {
      if (r.housekeeping_status !== "OCC") { r.housekeeping_status = "OCC"; changed++; }
      if (["OOO","OOS"].includes(r.room_status)) return;
      r.room_status = "active";
      return;
    }
    if (r.housekeeping_status === "OCC") {
      r.housekeeping_status = "VD";
      changed++;
    }
  });
  return changed;
}
function blockEndExclusive(block) {
  const end = block.end_date || block.block_end_date || block.start_date || block.block_start_date || today();
  return addDays(end, 1);
}
function isActiveBlock(block) {
  return block && block.status !== "cancelled" && block.active !== false && block.block_sale !== false;
}
function ticketBlocksRange(ticket) {
  const start = ticket.block_start_date || ticket.start_date || ticket.created_at?.slice(0,10) || today();
  const end = ticket.block_end_date || ticket.end_date || start;
  return { start_date:start, end_date:end };
}
function roomBlocksForRange(db, roomNo, checkin=today(), checkout=addDays(today(),1)) {
  const room = String(roomNo || "");
  const blocks = [];
  (db.room_blocks || []).forEach(b => {
    if (!isActiveBlock(b) || String(b.room_no || "") !== room) return;
    const start = b.start_date || today();
    const endEx = blockEndExclusive(b);
    if (overlaps(start, endEx, checkin, checkout)) blocks.push({ ...b, start_date:start, end_date:b.end_date || start, end_exclusive:endEx });
  });
  (db.maintenance_tickets || []).forEach(t => {
    if (String(t.room_no || "") !== room || ["Done","Cancelled"].includes(t.status) || t.block_sale === false) return;
    const range = ticketBlocksRange(t);
    const endEx = blockEndExclusive(range);
    if (!overlaps(range.start_date, endEx, checkin, checkout)) return;
    const hasLinkedBlock = (db.room_blocks || []).some(b => b.ticket_id === t.id && isActiveBlock(b) && overlaps(b.start_date, blockEndExclusive(b), checkin, checkout));
    if (!hasLinkedBlock) blocks.push({ id:`MT-${t.id}`, ticket_id:t.id, ticket_no:t.ticket_no, room_no:room, start_date:range.start_date, end_date:range.end_date, end_exclusive:endEx, reason:t.title || "Maintenance", source:"maintenance", status:"active", block_sale:true });
  });
  return blocks;
}
function hasOpenRoomBlock(db, roomNo, checkin=today(), checkout=addDays(today(),1)) {
  return roomBlocksForRange(db, roomNo, checkin, checkout).length > 0;
}
function isRoomSellable(db, r, checkin=today(), checkout=addDays(today(),1)) {
  if (!r || !r.active) return false;
  const hasBlock = hasOpenRoomBlock(db, r.room_no, checkin, checkout);
  if (hasBlock) return false;
  if (["OOO","OOS"].includes(r.room_status) || ["OOO","OOS"].includes(r.housekeeping_status)) {
    // ถ้า OOO มาจากระบบ Block Sale ชั่วคราว ให้ขายได้เมื่อช่วงวันที่ที่ถามไม่ชนช่วงปิดขาย
    if (r.manual_block_sale) return true;
    return false;
  }
  return true;
}
function refreshRoomBlockStatuses(db) {
  db.rooms ||= [];
  const dayStart = today(), dayEnd = addDays(dayStart, 1);
  db.rooms.forEach(r => {
    const blockedToday = hasOpenRoomBlock(db, r.room_no, dayStart, dayEnd);
    if (blockedToday) {
      r.manual_block_sale = true;
      r.room_status = "OOO";
      r.housekeeping_status = "OOO";
    } else if (r.manual_block_sale && ["OOO","OOS"].includes(r.room_status)) {
      r.manual_block_sale = false;
      r.room_status = "active";
      r.housekeeping_status = "VD";
      r.unblocked_at = nowIso();
    }
  });
}
function createRoomBlock(db, data) {
  db.room_blocks ||= [];
  const start = data.start_date || data.block_start_date || today();
  const end = data.end_date || data.block_end_date || start;
  const block = {
    id: db.room_blocks.length ? Math.max(...db.room_blocks.map(x=>Number(x.id)||0))+1 : 1,
    block_no: `BL${new Date().getFullYear()}-${String((db.room_blocks.length||0)+1).padStart(5,"0")}`,
    room_no: String(data.room_no || ""),
    start_date: start,
    end_date: end,
    reason: data.reason || data.title || "Block Sale / Mark room OOO",
    source: data.source || "roomplan",
    ticket_id: data.ticket_id || null,
    status: "active",
    block_sale: true,
    created_by: data.created_by || "",
    created_at: nowIso(),
    cancelled_at: ""
  };
  if (!block.room_no) return null;
  db.room_blocks.unshift(block);
  return block;
}
function cancelRoomBlocks(db, filterFn) {
  let count = 0;
  (db.room_blocks || []).forEach(b => {
    if (b.status !== "cancelled" && filterFn(b)) { b.status = "cancelled"; b.cancelled_at = nowIso(); count++; }
  });
  return count;
}
function totalPaid(db, bookingId) {
  return db.payments.filter(p => p.booking_id === Number(bookingId) && p.status !== "void").reduce((s, p) => s + baht(p.amount), 0);
}
function bookingExtras(db, bookingId) {
  return (db.extra_charges || []).filter(x => x.booking_id === Number(bookingId) && x.status !== "void");
}
function totalExtras(db, bookingId) {
  return bookingExtras(db, bookingId).reduce((s, x) => s + baht(x.amount), 0);
}
function recalcBookingExtraAmount(db, b) {
  b.extra_amount = Number(totalExtras(db, b.id).toFixed(2));
  return b.extra_amount;
}
function balance(db, b) { return baht(b.total_amount) - totalPaid(db, b.id); }
function extraTypeName(type) {
  return ({extra_bed:"ค่าเตียงเสริม", mini_bar:"มินิบาร์", damage:"ค่าเสียหาย", other:"อื่น ๆ"}[type] || type || "อื่น ๆ");
}

function roomBookings(db, roomNo, checkin, checkout, excludeId = null) {
  return db.bookings.filter(b =>
    b.id !== excludeId &&
    b.room_no === String(roomNo) &&
    !["cancelled", "checked_out"].includes(b.status) &&
    overlaps(b.checkin, b.checkout, checkin, checkout)
  );
}

function findFreeRoom(db, roomTypeId, checkin, checkout, excludeId = null) {
  return db.rooms.find(r =>
    isRoomSellable(db, r, checkin, checkout) &&
    r.room_type_id === Number(roomTypeId) &&
    roomBookings(db, r.room_no, checkin, checkout, excludeId).length === 0
  )?.room_no || "";
}


function seedRateInventory(db) {
  db.rate_inventory ||= [];
  if (db.rate_inventory.length > 0) return;
  const start = addDays(today(), -20);
  for (let i = 0; i < 120; i++) {
    const date = addDays(start, i);
    const dow = new Date(date).getDay();
    db.room_types.forEach(rt => {
      const weekend = dow === 5 || dow === 6;
      const highSeason = date.slice(5) >= "11-01" || date.slice(5) <= "04-30";
      let price = rt.base_price;
      if (weekend) price += 100;
      if (highSeason) price += 150;
      db.rate_inventory.push({
        id: db.rate_inventory.length + 1,
        date,
        room_type_id: rt.id,
        price,
        rate_plan: highSeason ? "High Season" : (weekend ? "Weekend" : "Weekday"),
        stop_sale: false,
        min_night: highSeason ? 2 : 1,
        direct_discount: 0,
        line_inventory: null,
        close_low_stock: 1,
        updated_at: nowIso()
      });
    });
  }
}

function seedPromotions(db) {
  db.promotion_codes ||= [];
  if (db.promotion_codes.length > 0) return;
  db.promotion_codes.push(
    { id: 1, code: "LINE100", name: "Direct LINE Discount", type: "amount", value: 100, active: true, start_date: today(), end_date: addDays(today(), 90), min_night: 1, note: "ส่วนลดจองตรงผ่าน LINE" },
    { id: 2, code: "DIRECT10", name: "Direct Booking 10%", type: "percent", value: 10, active: true, start_date: today(), end_date: addDays(today(), 90), min_night: 2, note: "พัก 2 คืนลด 10%" }
  );
}

function getRateRow(db, date, roomTypeId) {
  db.rate_inventory ||= [];
  let row = db.rate_inventory.find(r => r.date === date && Number(r.room_type_id) === Number(roomTypeId));
  if (!row) {
    const rt = roomType(db, roomTypeId);
    row = {
      id: db.rate_inventory.length ? Math.max(...db.rate_inventory.map(x=>x.id || 0)) + 1 : 1,
      date,
      room_type_id: Number(roomTypeId),
      price: rt?.base_price || 0,
      rate_plan: "Weekday",
      stop_sale: false,
      min_night: 1,
      direct_discount: 0,
      line_inventory: null,
      close_low_stock: 1,
      updated_at: nowIso()
    };
    db.rate_inventory.push(row);
  }
  return row;
}

function bestRateForStay(db, roomTypeId, checkin, checkout) {
  const n = nights(checkin, checkout);
  let total = 0;
  let stopSale = false;
  let minNight = 1;
  for (let i = 0; i < n; i++) {
    const d = addDays(checkin, i);
    const rr = getRateRow(db, d, roomTypeId);
    total += baht(rr.price);
    if (rr.stop_sale) stopSale = true;
    minNight = Math.max(minNight, Number(rr.min_night || 1));
  }
  return { total, avg: n ? total / n : total, stop_sale: stopSale, min_night: minNight };
}


function promoDiscount(db, code, grossTotal, checkin, checkout) {
  const promoCode = String(code || "").trim().toUpperCase();
  if (!promoCode) return { code:"", discount:0, final_total:Number(grossTotal || 0), promo:null, reason:"" };
  const n = nights(checkin, checkout);
  const promo = (db.promotion_codes || []).find(p => String(p.code).toUpperCase() === promoCode && p.active !== false);
  if (!promo) return { code:promoCode, discount:0, final_total:Number(grossTotal || 0), promo:null, reason:"promo_not_found" };
  if (promo.start_date && checkin < promo.start_date) return { code:promoCode, discount:0, final_total:Number(grossTotal || 0), promo, reason:"promo_not_started" };
  if (promo.end_date && checkin > promo.end_date) return { code:promoCode, discount:0, final_total:Number(grossTotal || 0), promo, reason:"promo_expired" };
  if (n < Number(promo.min_night || 1)) return { code:promoCode, discount:0, final_total:Number(grossTotal || 0), promo, reason:"promo_min_night_" + promo.min_night };
  let discount = promo.type === "percent" ? (Number(grossTotal || 0) * Number(promo.value || 0) / 100) : Number(promo.value || 0);
  discount = Math.max(0, Math.min(Number(grossTotal || 0), Number(discount.toFixed(2))));
  return { code:promoCode, discount, final_total:Number((Number(grossTotal || 0) - discount).toFixed(2)), promo, reason:"" };
}
function quoteStay(db, roomTypeId, checkin, checkout, promoCode="") {
  const rt = roomType(db, roomTypeId);
  if (!rt) return null;
  const rate = bestRateForStay(db, rt.id, checkin, checkout);
  const promo = promoDiscount(db, promoCode, rate.total, checkin, checkout);
  return {
    room_type: rt,
    checkin, checkout,
    nights: nights(checkin, checkout),
    gross_total: Number(rate.total.toFixed(2)),
    avg_rate: Number(rate.avg.toFixed(2)),
    stop_sale: rate.stop_sale,
    min_night: rate.min_night,
    promo_code: promo.code,
    promo_reason: promo.reason,
    discount_amount: promo.discount,
    final_total: promo.final_total
  };
}

function rateInventoryMonth(db, month) {
  db.rate_inventory ||= [];
  const [y,m] = month.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  const days = [];
  for (let day = 1; day <= dim; day++) {
    const date = `${y}-${String(m).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    days.push({
      date,
      day,
      room_types: db.room_types.map(rt => {
        const rr = getRateRow(db, date, rt.id);
        return { ...rr, room_type_name: rt.name, room_type_code: rt.code };
      })
    });
  }
  return { month, room_types: db.room_types, days, promotions: db.promotion_codes || [] };
}


function bookingRoomCharge(db, b) {
  // Room Revenue must come from the actual amount charged on the booking,
  // not from the master room-type base rate. Extras are kept separate.
  const extras = totalExtras(db, b.id);
  let roomCharge;
  if (b.room_charge_amount !== undefined) roomCharge = baht(b.room_charge_amount);
  else if (b.total_amount !== undefined) roomCharge = baht(b.total_amount) - extras;
  else roomCharge = baht(b.gross_amount || 0) - baht(b.discount_amount || 0);
  return Number(Math.max(0, roomCharge).toFixed(2));
}
function bookingRoomRevenueForDate(db, b, date) {
  if (!(b.checkin <= date && b.checkout > date)) return 0;
  const n = nights(b.checkin, b.checkout);
  return Number((bookingRoomCharge(db, b) / n).toFixed(2));
}
function reportPaymentBreakdown(db, payments, refunds) {
  const rows = payments.map(p => {
    const b = db.bookings.find(x => x.id === p.booking_id) || {};
    return { type:"Payment", at:p.created_at, receipt_no:p.receipt_no||"", booking_no:b.booking_no||"", room_no:b.room_no||"", guest_name:b.guest_name||"", method:normalizePaymentMethod(p.method), category:p.category||"room", category_name:paymentCategoryName(p.category||"room"), shift_name:normalizeShiftName(p.shift_name||currentShiftByClock(new Date(p.created_at||nowIso()))), amount:baht(p.amount), user:p.created_by||p.cashier||"", note:p.note||"" };
  }).concat(refunds.map(r => {
    const b = db.bookings.find(x => x.id === r.booking_id) || {};
    return { type:"Refund", at:r.created_at, receipt_no:r.refund_no||"", booking_no:b.booking_no||"", room_no:b.room_no||"", guest_name:b.guest_name||"", method:normalizePaymentMethod(r.method), category:"refund", category_name:"Refund", shift_name:normalizeShiftName(r.shift_name||currentShiftByClock(new Date(r.created_at||nowIso()))), amount:-baht(r.amount), user:r.created_by||r.cashier||"", note:r.note||"" };
  }));
  return rows.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
}

function reportsDaily(db, date) {
  const totalRooms = db.rooms.filter(r => r.active).length;
  const activeBookings = db.bookings.filter(b => b.status !== "cancelled" && b.checkin <= date && b.checkout > date);
  const arrivals = db.bookings.filter(b => b.status !== "cancelled" && b.checkin === date);
  const departures = db.bookings.filter(b => b.status !== "cancelled" && b.checkout === date);
  const payments = db.payments.filter(p => p.status !== "void" && p.created_at.slice(0,10) === date);
  const refunds = (db.refunds || []).filter(r => r.status !== "void" && r.created_at.slice(0,10) === date);
  const roomRevenueRows = activeBookings.map(b => ({
    booking_no:b.booking_no, room_no:b.room_no, guest_name:b.guest_name,
    total_room_charge:bookingRoomCharge(db,b), nights:nights(b.checkin,b.checkout),
    daily_room_revenue:bookingRoomRevenueForDate(db,b,date), agent:b.agent||""
  }));
  const roomRevenue = Number(roomRevenueRows.reduce((s,r)=>s+baht(r.daily_room_revenue),0).toFixed(2));
  const payTotal = payments.reduce((s,p)=>s+baht(p.amount),0);
  const refundTotal = refunds.reduce((s,r)=>s+baht(r.amount),0);
  const source = {};
  activeBookings.forEach(b => source[b.agent || "Unknown"] = (source[b.agent || "Unknown"] || 0) + 1);
  const hk = {};
  db.rooms.forEach(r => hk[r.housekeeping_status] = (hk[r.housekeeping_status] || 0) + 1);
  const ooo = db.rooms.filter(r => ["OOO","OOS"].includes(r.housekeeping_status) || ["OOO","OOS"].includes(r.room_status) || hasOpenRoomBlock(db, r.room_no, date, addDays(date,1)));
  return {
    date,
    total_rooms: totalRooms,
    occupied_rooms: activeBookings.length,
    occupancy: totalRooms ? Number((activeBookings.length/totalRooms*100).toFixed(2)) : 0,
    arrivals: arrivals.length,
    departures: departures.length,
    room_revenue: roomRevenue,
    adr: activeBookings.length ? Number((roomRevenue/activeBookings.length).toFixed(2)) : 0,
    revpar: totalRooms ? Number((roomRevenue/totalRooms).toFixed(2)) : 0,
    payment_total: payTotal,
    refund_total: refundTotal,
    net_payment: payTotal - refundTotal,
    booking_source: source,
    room_revenue_rows: roomRevenueRows,
    payment_breakdown: reportPaymentBreakdown(db, payments, refunds),
    housekeeping: hk,
    out_of_order_rooms: ooo.map(r => r.room_no),
    arrivals_list: arrivals,
    departures_list: departures
  };
}

function reportsMonthly(db, month) {
  const [y,m] = month.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= dim; d++) {
    const date = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    days.push(reportsDaily(db, date));
  }
  const totalRooms = db.rooms.filter(r=>r.active).length;
  const roomNights = days.reduce((s,d)=>s+d.occupied_rooms,0);
  const roomRevenue = days.reduce((s,d)=>s+d.room_revenue,0);
  const payments = days.reduce((s,d)=>s+d.payment_total,0);
  const refunds = days.reduce((s,d)=>s+d.refund_total,0);
  const source = {};
  days.forEach(d => Object.entries(d.booking_source).forEach(([k,v]) => source[k]=(source[k]||0)+v));
  return {
    month,
    days,
    total_rooms: totalRooms,
    room_nights: roomNights,
    occupancy: totalRooms ? Number((roomNights/(totalRooms*dim)*100).toFixed(2)) : 0,
    room_revenue: roomRevenue,
    adr: roomNights ? Number((roomRevenue/roomNights).toFixed(2)) : 0,
    revpar: totalRooms ? Number((roomRevenue/(totalRooms*dim)).toFixed(2)) : 0,
    payment_total: payments,
    refund_total: refunds,
    net_payment: payments - refunds,
    booking_source: source
  };
}

function htmlExcelTable(title, rows) {
  const table = `<!doctype html><html><head><meta charset="utf-8"></head><body><h2>${title}</h2><table border="1">${rows}</table></body></html>`;
  return "\ufeff" + table;
}

function seedDemo(db) {
  const names = ["นาย สมชาย ใจดี", "นางสาว พิชญา สุทธิศิริกุล", "MR. Alex Leong", "MS. Isabele Solves", "MR. Gary Hanrahan", "นางสาว อนิสกาวีย์ อินทังงา", "นาย วีรวัชร พร้องพิบูลย์", "MR. Chris Murphy", "นายกฤษดา ศิริยามันต์", "นางเรวดี ศิริยามันต์"];
  const agents = ["Direct LINE", "Walk In", "Member Guest", "AGODA COLLECT", "Booking.com Room Only", "Expedia Room+CBF"];
  const nat = ["Thai", "Thai", "Thai", "Others", "IRISH", "Chinese"];
  const t = today();
  let id = 1;

  for (let i = -8; i <= 35; i += 2) {
    const checkin = addDays(t, i);
    const stay = pick([1,1,2,2,3]);
    const checkout = addDays(checkin, stay);
    const rt = pick(db.room_types);
    const roomNo = findFreeRoom(db, rt.id, checkin, checkout);
    if (!roomNo) continue;
    let status = "confirmed";
    if (t >= checkin && t < checkout) status = pick(["checked_in", "confirmed"]);
    if (t >= checkout) status = "checked_out";
    const total = rt.base_price * stay;
    const b = {
      id: id++,
      booking_no: `DEMO-${String(id).padStart(4, "0")}`,
      room_type_id: rt.id,
      room_no: roomNo,
      checkin, checkout,
      guest_name: pick(names),
      phone: "08" + String(10000000 + Math.floor(Math.random() * 89999999)),
      guests: rt.max_guests,
      adults: rt.max_guests,
      children: Math.random() < 0.2 ? 1 : 0,
      gross_amount: total,
      discount_amount: 0,
      extra_amount: 0,
      total_amount: total,
      status,
      note: pick(["", "ลูกค้าประจำ", "ขอเตียงเสริม", "เช็คอินดึก"]),
      agent: pick(agents),
      nationality: pick(nat),
      company: pick(["", "", "Kiralux Property", "บริษัท ตัวอย่าง จำกัด"]),
      voucher_no: String(100000 + Math.floor(Math.random() * 900000)),
      created_at: nowIso(),
      updated_at: ""
    };
    db.bookings.push(b);
    if (Math.random() < 0.65) {
      db.payments.push({
        id: db.payments.length + 1,
        receipt_no: genReceiptNo(db),
        booking_id: b.id,
        amount: total,
        method: pick(["Cash", "Transfer", "QR"]),
        note: "Demo payment",
        status: "active",
        created_at: nowIso()
      });
    }
  }
}


function enrichBooking(db, b) {
  const rt = roomType(db, b.room_type_id);
  const paid = totalPaid(db, b.id);
  const extras = totalExtras(db, b.id);
  return { ...b, room_type_name: rt?.name || "", room_type_code: rt?.code || "", extra_amount: extras, paid_amount: paid, balance: baht(b.total_amount) - paid, payment_status: paymentStatus(db, b), status_code: bookingStatusCode(b) };
}
function todayOperation(db, date = today()) {
  syncRoomStatuses(db, date);
  const rooms = db.rooms.filter(r => r.active);
  const active = db.bookings.filter(b => !["cancelled","checked_out"].includes(b.status) && b.checkin <= date && b.checkout > date);
  const arrivals = db.bookings.filter(b => b.status !== "cancelled" && b.checkin === date);
  const departures = db.bookings.filter(b => b.status !== "cancelled" && b.checkout === date);
  const dirty = rooms.filter(r => ["VD","DIRTY"].includes(r.housekeeping_status));
  const ooo = rooms.filter(r => ["OOO","OOS"].includes(r.housekeeping_status) || ["OOO","OOS"].includes(r.room_status) || hasOpenRoomBlock(db, r.room_no, date, addDays(date,1)));
  const occRooms = new Set(active.map(b => String(b.room_no)));
  const vacant = rooms.filter(r => !occRooms.has(String(r.room_no)) && isRoomSellable(db, r, date, addDays(date,1)));
  const payments = paymentReport(db, new URLSearchParams({ date, from:date, to:date }));
  return {
    date,
    summary: {
      total_rooms: rooms.length,
      inhouse: active.length,
      vacant: vacant.length,
      arrivals: arrivals.length,
      departures: departures.length,
      dirty: dirty.length,
      ooo: ooo.length,
      payment_total: payments.total,
      refund_total: payments.refund_total,
      net_payment: payments.net_total,
      open_balance: db.bookings.filter(b => !["cancelled","checked_out"].includes(b.status) && balance(db,b) > 0).length
    },
    arrivals: arrivals.map(b => enrichBooking(db,b)),
    departures: departures.map(b => enrichBooking(db,b)),
    inhouse: active.map(b => enrichBooking(db,b)),
    dirty_rooms: dirty,
    ooo_rooms: ooo,
    vacant_rooms: vacant,
    payments
  };
}
function nightAuditReport(db, date = today()) {
  const daily = reportsDaily(db, date);
  const op = todayOperation(db, date);
  const outstanding = db.bookings.filter(b => b.status !== "cancelled" && b.checkin <= date && b.checkout >= date && balance(db,b) > 0).map(b => enrichBooking(db,b));
  const alreadyClosed = (db.night_audits || []).find(a => a.date === date && a.status === "closed");
  return { date, closed: !!alreadyClosed, audit: alreadyClosed || null, daily, operation: op.summary, outstanding };
}

function dashboard(db) {
  const d = today();
  const totalRooms = db.rooms.filter(r => r.active).length;
  const inhouse = db.bookings.filter(b => !["cancelled","checked_out"].includes(b.status) && b.checkin <= d && b.checkout > d);
  const arrivals = db.bookings.filter(b => b.status !== "cancelled" && b.checkin === d);
  const departures = db.bookings.filter(b => b.status !== "cancelled" && b.checkout === d);
  const todayPayments = db.payments.filter(p => p.status !== "void" && p.created_at.slice(0,10) === d).reduce((s,p)=>s+baht(p.amount),0);
  const monthPayments = db.payments.filter(p => p.status !== "void" && p.created_at.slice(0,7) === d.slice(0,7)).reduce((s,p)=>s+baht(p.amount),0);
  const next14 = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(d, i);
    const rooms = db.bookings.filter(b => !["cancelled","checked_out"].includes(b.status) && b.checkin <= day && b.checkout > day).length;
    return { date: day, rooms, occupancy: totalRooms ? Number((rooms / totalRooms * 100).toFixed(2)) : 0 };
  });
  return {
    total_rooms: totalRooms,
    inhouse: inhouse.length,
    vacant: totalRooms - inhouse.length,
    arrivals: arrivals.length,
    departures: departures.length,
    occupancy: totalRooms ? Number((inhouse.length / totalRooms * 100).toFixed(2)) : 0,
    today_payments: todayPayments,
    month_payments: monthPayments,
    next14,
    recent: db.bookings.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0, 12)
  };
}

function availability(db, checkin, checkout) {
  const n = nights(checkin, checkout);
  return db.room_types.map(rt => {
    const rooms = db.rooms.filter(r => isRoomSellable(db, r, checkin, checkout) && r.room_type_id === rt.id);
    const booked = rooms.filter(r => roomBookings(db, r.room_no, checkin, checkout).length > 0).length;
    const rawAvailable = rooms.length - booked;
    const rate = bestRateForStay(db, rt.id, checkin, checkout);
    const firstRate = getRateRow(db, checkin, rt.id);
    let saleAvailable = rawAvailable;
    if (firstRate.line_inventory !== null && firstRate.line_inventory !== "" && firstRate.line_inventory !== undefined) {
      saleAvailable = Math.min(saleAvailable, Number(firstRate.line_inventory));
    }
    if (rate.stop_sale || n < rate.min_night) saleAvailable = 0;
    if (Number(firstRate.close_low_stock || 0) > 0 && rawAvailable <= Number(firstRate.close_low_stock)) saleAvailable = 0;
    return {
      ...rt,
      total_rooms: rooms.length,
      booked,
      raw_available: rawAvailable,
      available: Math.max(0, saleAvailable),
      price: Number(rate.avg.toFixed(2)),
      total_stay_price: Number(rate.total.toFixed(2)),
      stop_sale: rate.stop_sale,
      min_night: rate.min_night,
      direct_discount: Number(firstRate.direct_discount || 0),
      rate_plan: firstRate.rate_plan || "Weekday",
      line_inventory: firstRate.line_inventory,
      close_low_stock: firstRate.close_low_stock
    };
  });
}

function roomPlan(db, from, days) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  return {
    dates,
    rooms: db.rooms.slice().sort((a,b)=>Number(a.room_no)-Number(b.room_no)).map(r => {
      const rt = roomType(db, r.room_type_id);
      const bookings = db.bookings.filter(b => b.room_no === r.room_no && b.status !== "cancelled").map(b => ({
        id: b.id,
        guest_name: b.guest_name,
        short_name: String(b.guest_name).replace(/^นาย |^นางสาว |^นาง |^MR\. |^MS\. /i, "").slice(0, 12),
        checkin: b.checkin,
        checkout: b.checkout,
        code: bookingStatusCode(b)
      }));
      const blocks = roomBlocksForRange(db, r.room_no, from, addDays(from, days));
      const currentBlocks = roomBlocksForRange(db, r.room_no, today(), addDays(today(), 1));
      const blocked = currentBlocks.length > 0 || r.room_status === "OOS" || r.housekeeping_status === "OOS";
      return { ...r, blocked, blocks, block_reason: currentBlocks[0]?.reason || r.block_reason || "", room_type_code: rt?.code || "", room_type_name: rt?.name || "",
        bed_type_code: bedType(db, r.bed_type_id)?.code || "",
        bed_type_name: bedType(db, r.bed_type_id)?.name || "", bookings };
    })
  };
}

function occCalendar(db, month) {
  const [y,m] = month.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  const totalRooms = db.rooms.filter(r=>r.active).length;
  let revenue = 0, roomNights = 0;
  const days = [];
  for (let day = 1; day <= dim; day++) {
    const date = `${y}-${String(m).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const active = db.bookings.filter(b => !["cancelled","checked_out"].includes(b.status) && b.checkin <= date && b.checkout > date);
    const rooms = active.length;
    const rev = active.reduce((s,b)=>s+(roomType(db,b.room_type_id)?.base_price||0),0);
    revenue += rev; roomNights += rooms;
    days.push({
      date, day, rooms, revenue: rev,
      occupancy: totalRooms ? Number((rooms/totalRooms*100).toFixed(2)) : 0,
      avr: rooms ? Number((rev/rooms).toFixed(2)) : 0,
      revpar: totalRooms ? Number((rev/totalRooms).toFixed(2)) : 0
    });
  }
  return {
    month,
    month_label: month,
    days,
    summary: {
      occupancy: totalRooms ? Number((roomNights/(totalRooms*dim)*100).toFixed(2)) : 0,
      room_nights: roomNights,
      revenue,
      avr: roomNights ? Number((revenue/roomNights).toFixed(2)) : 0,
      revpar: totalRooms ? Number((revenue/(totalRooms*dim)).toFixed(2)) : 0
    }
  };
}

function guestRows(db, params) {
  let rows = db.bookings.map(b => {
    const rt = roomType(db, b.room_type_id);
    const paid = totalPaid(db, b.id);
    return {
      id: b.id,
      booking_no: b.booking_no,
      room_no: b.room_no,
      status_code: bookingStatusCode(b),
      status: b.status,
      guest_name: b.guest_name,
      phone: b.phone,
      arrival: b.checkin,
      departure: b.checkout,
      nights: nights(b.checkin, b.checkout),
      room_type: rt?.name || "",
      agent: b.agent || "",
      nationality: b.nationality || "",
      company: b.company || "",
      voucher_no: b.voucher_no || "",
      pax: `${b.adults || b.guests || 1}/${b.children || 0}`,
      gross_amount: b.gross_amount || b.total_amount,
      extra_amount: totalExtras(db, b.id),
      total_amount: b.total_amount,
      paid_amount: paid,
      balance: b.total_amount - paid,
      payment_status: paymentStatus(db, b),
      note: b.note || ""
    };
  });
  const q = String(params.get("q") || "").toLowerCase().trim();
  const status = String(params.get("status") || "");
  const from = String(params.get("from") || "");
  const to = String(params.get("to") || "");
  if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  if (status) rows = rows.filter(r => r.status_code === status);
  if (from) rows = rows.filter(r => r.departure >= from);
  if (to) rows = rows.filter(r => r.arrival <= to);
  rows.sort((a,b)=>String(a.arrival).localeCompare(String(b.arrival)));
  return rows;
}

function paymentReport(db, params = new URLSearchParams()) {
  const date = params.get("date") || today();
  const from = params.get("from") || date;
  const to = params.get("to") || date;
  const selectedShift = params.get("shift") ? normalizeShiftName(params.get("shift")) : "";

  const payments = db.payments
    .filter(p => p.status !== "void")
    .filter(p => p.created_at.slice(0,10) >= from && p.created_at.slice(0,10) <= to)
    .filter(p => !selectedShift || normalizeShiftName(p.shift_name || currentShiftByClock(new Date(p.created_at || nowIso()))) === selectedShift)
    .map(p => {
      const b = db.bookings.find(x => x.id === p.booking_id);
      return { ...p, shift_name: normalizeShiftName(p.shift_name || currentShiftByClock(new Date(p.created_at || nowIso()))), booking_no: b?.booking_no || "", guest_name: b?.guest_name || "", room_no: b?.room_no || "" };
    })
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));

  const refunds = (db.refunds || [])
    .filter(r => r.status !== "void")
    .filter(r => r.created_at.slice(0,10) >= from && r.created_at.slice(0,10) <= to)
    .filter(r => !selectedShift || normalizeShiftName(r.shift_name || currentShiftByClock(new Date(r.created_at || nowIso()))) === selectedShift)
    .map(r => {
      const b = db.bookings.find(x => x.id === r.booking_id);
      return { ...r, shift_name: normalizeShiftName(r.shift_name || currentShiftByClock(new Date(r.created_at || nowIso()))), booking_no: b?.booking_no || "", guest_name: b?.guest_name || "", room_no: b?.room_no || "" };
    })
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));

  const byMethod = standardMoneyBuckets();
  const byCategory = { room:0, deposit:0, extra_bed:0, mini_bar:0, damage:0, other:0 };
  const refundByMethod = standardMoneyBuckets();
  const byShift = {};
  SHIFT_NAMES.forEach(sh => byShift[sh] = { payment:0, refund:0, net:0, by_method:standardMoneyBuckets(), by_category:{ room:0, deposit:0, extra_bed:0, mini_bar:0, damage:0, other:0 }, refund_by_method:standardMoneyBuckets(), payments_count:0, refunds_count:0 });
  payments.forEach(p => {
    const method = normalizePaymentMethod(p.method);
    const cat = p.category || "room";
    const shift = normalizeShiftName(p.shift_name || currentShiftByClock(new Date(p.created_at || nowIso())));
    const amount = baht(p.amount);
    byMethod[method] = (byMethod[method] || 0) + amount;
    byCategory[cat] = (byCategory[cat] || 0) + amount;
    byShift[shift] ||= { payment:0, refund:0, net:0, by_method:standardMoneyBuckets(), by_category:{ room:0, deposit:0, extra_bed:0, mini_bar:0, damage:0, other:0 }, refund_by_method:standardMoneyBuckets(), payments_count:0, refunds_count:0 };
    byShift[shift].payment += amount;
    byShift[shift].net += amount;
    byShift[shift].payments_count += 1;
    byShift[shift].by_method[method] = (byShift[shift].by_method[method] || 0) + amount;
    byShift[shift].by_category[cat] = (byShift[shift].by_category[cat] || 0) + amount;
    p.method = method;
  });
  refunds.forEach(r => {
    const method = normalizePaymentMethod(r.method);
    const shift = normalizeShiftName(r.shift_name || currentShiftByClock(new Date(r.created_at || nowIso())));
    const amount = baht(r.amount);
    refundByMethod[method] = (refundByMethod[method] || 0) + amount;
    byShift[shift] ||= { payment:0, refund:0, net:0, by_method:standardMoneyBuckets(), by_category:{ room:0, deposit:0, extra_bed:0, mini_bar:0, damage:0, other:0 }, refund_by_method:standardMoneyBuckets(), payments_count:0, refunds_count:0 };
    byShift[shift].refund += amount;
    byShift[shift].net -= amount;
    byShift[shift].refunds_count += 1;
    byShift[shift].refund_by_method[method] = (byShift[shift].refund_by_method[method] || 0) + amount;
    r.method = method;
  });

  const paymentTotal = payments.reduce((s,p)=>s+baht(p.amount),0);
  const refundTotal = refunds.reduce((s,r)=>s+baht(r.amount),0);
  const advancePayments = payments.filter(p => {
    const b = db.bookings.find(x => x.id === p.booking_id);
    return b && b.checkin > p.created_at.slice(0,10);
  }).reduce((s,p)=>s+baht(p.amount),0);
  const oldBalancePayments = payments.filter(p => {
    const b = db.bookings.find(x => x.id === p.booking_id);
    return b && b.checkout < p.created_at.slice(0,10);
  }).reduce((s,p)=>s+baht(p.amount),0);

  return {
    date, from, to, shift_name: selectedShift,
    payments,
    refunds,
    by_method: byMethod,
    by_category: byCategory,
    refund_by_method: refundByMethod,
    by_shift: byShift,
    advance_payment_total: advancePayments,
    old_balance_payment_total: oldBalancePayments,
    total: paymentTotal,
    refund_total: refundTotal,
    net_total: paymentTotal - refundTotal,
    shifts: (db.cashier_shifts || []).filter(s => s.date >= from && s.date <= to).filter(s => !selectedShift || normalizeShiftName(s.shift_name) === selectedShift).sort((a,b)=>String(b.closed_at).localeCompare(String(a.closed_at)))
  };
}

function paymentStatus(db, booking) {
  const paid = totalPaid(db, booking.id);
  const total = baht(booking.total_amount);
  if (paid <= 0) return "unpaid";
  if (paid < total) return "partial";
  return "paid";
}

function housekeepingData(db) {
  const d = today();
  const departures = db.bookings.filter(b => b.status !== "cancelled" && b.checkout === d);
  const arrivals = db.bookings.filter(b => b.status !== "cancelled" && b.checkin === d);
  const inhouse = db.bookings.filter(b => !["cancelled","checked_out"].includes(b.status) && b.checkin <= d && b.checkout > d);

  const rows = db.rooms
    .slice()
    .sort((a,b)=>Number(a.room_no)-Number(b.room_no))
    .map(r => {
      const rt = roomType(db, r.room_type_id);
      const dep = departures.find(b => b.room_no === r.room_no);
      const arr = arrivals.find(b => b.room_no === r.room_no);
      const occ = inhouse.find(b => b.room_no === r.room_no);
      const notes = (db.housekeeping_notes || []).filter(n => n.room_no === r.room_no).slice(0, 5);
      let priority = "normal";
      if (arr) priority = "urgent";
      if (dep) priority = "checkout";
      if (r.housekeeping_status === "OOO" || r.housekeeping_status === "OOS") priority = "blocked";
      return {
        ...r,
        room_type_code: rt?.code || "",
        room_type_name: rt?.name || "",
        departure_guest: dep?.guest_name || "",
        arrival_guest: arr?.guest_name || "",
        occupied_guest: occ?.guest_name || "",
        is_departure_today: !!dep,
        is_arrival_today: !!arr,
        is_occupied: !!occ,
        is_vip: !!(arr && String(arr.note || "").toLowerCase().includes("vip")),
        priority,
        notes
      };
    });

  const summary = {};
  rows.forEach(r => summary[r.housekeeping_status] = (summary[r.housekeeping_status] || 0) + 1);

  return { date: d, summary, rows };
}


function saveSlip(base64) {
  if (!base64 || !base64.startsWith("data:image")) return "";
  const m = base64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return "";
  const ext = m[1].includes("png") ? "png" : m[1].includes("webp") ? "webp" : "jpg";
  const file = `${Date.now()}-slip.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], "base64"));
  return `/uploads/${file}`;
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function sendText(res, text, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let out = "";
    req.on("data", c => { out += c; if (out.length > limit) reject(new Error("Request too large")); });
    req.on("end", () => resolve(out || "{}"));
    req.on("error", reject);
  });
}
function serve(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(PUBLIC, "dashboard.html") : path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) return sendText(res, "Forbidden", 403);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendText(res, "Not found", 404);
  const ext = path.extname(filePath).toLowerCase();
  const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const requestHandler = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "POST" && pathname === "/api/login") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      const user = (db.users || []).find(u => u.username === data.username && u.active !== false && passwordMatches(u, data.password));
      if (!user) return sendJson(res, { error:"invalid_username_or_password" }, 401);
      migrateUserPassword(user, data.password);
      const sid = makeSessionId();
      db.sessions ||= [];
      db.sessions.forEach(s => { if (sessionExpired(s)) s.active = false; });
      db.sessions.push({ id:sid, user_id:user.id, created_at:nowIso(), active:true });
      log(db, "LOGIN", user.username);
      writeDb(db);
      const secure = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? "; Secure" : "";
      res.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Set-Cookie":`pms_session=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(SESSION_TTL_HOURS * 3600)}${secure}` });
      return res.end(JSON.stringify({ ok:true, user:{ id:user.id, username:user.username, display_name:user.display_name, role:user.role } }));
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      const db = readDb();
      const sid = parseCookies(req).pms_session;
      const s = (db.sessions || []).find(x => x.id === sid);
      if (s) s.active = false;
      writeDb(db);
      res.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Set-Cookie":"pms_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
      return res.end(JSON.stringify({ ok:true }));
    }

    if (req.method === "GET" && pathname === "/api/me") {
      const db = readDb();
      const user = currentUser(req, db);
      return sendJson(res, { user, authenticated: !!user });
    }

    if (pathname.startsWith("/api/") && !isPublicApi(req.method, pathname)) {
      const authDb = readDb();
      const authUser = currentUser(req, authDb);
      if (!authUser) return sendJson(res, { error:"login_required" }, 401);
      if (!canAccessApi(authUser, req.method, pathname)) return sendJson(res, { error:"permission_denied", role:authUser.role }, 403);
      req.currentUser = authUser;
    }

    if (req.method === "GET" && pathname === "/api/public/availability") {
      const db = readDb();
      return sendJson(res, availability(db, url.searchParams.get("checkin") || today(), url.searchParams.get("checkout") || addDays(today(), 1)));
    }

    if (req.method === "GET" && pathname === "/api/public/quote") {
      const db = readDb();
      const quote = quoteStay(db, Number(url.searchParams.get("room_type_id") || 0), url.searchParams.get("checkin") || today(), url.searchParams.get("checkout") || addDays(today(), 1), url.searchParams.get("promo_code") || "");
      if (!quote) return sendJson(res, { error:"room_type_not_found" }, 404);
      return sendJson(res, quote);
    }

    if (req.method === "POST" && pathname === "/api/public/bookings") {
      const db = readDb();
      const data = publicBookingPayload(JSON.parse(await readBody(req)));
      const rt = roomType(db, data.room_type_id);
      if (!rt) return sendJson(res, { error:"room_type_not_found" }, 404);
      if (!data.guest_name || !data.phone || !data.checkin || !data.checkout) return sendJson(res, { error:"missing_required_fields" }, 400);
      const profile = customerProfile(db, data.phone);
      if (profile.blacklist) return sendJson(res, { error:"customer_blacklisted" }, 403);
      const rate = bestRateForStay(db, rt.id, data.checkin, data.checkout);
      if (rate.stop_sale) return sendJson(res, { error:"stop_sale" }, 400);
      if (nights(data.checkin, data.checkout) < rate.min_night) return sendJson(res, { error:"min_night_required_" + rate.min_night }, 400);
      const avail = availability(db, data.checkin, data.checkout).find(x => x.id === rt.id);
      if (!avail || avail.available <= 0) return sendJson(res, { error:"no_room_available" }, 400);
      const roomNo = findFreeRoom(db, rt.id, data.checkin, data.checkout);
      if (!roomNo) return sendJson(res, { error:"no_room_available" }, 400);
      const promo = promoDiscount(db, data.promo_code, rate.total, data.checkin, data.checkout);
      const b = {
        id: db.bookings.length ? Math.max(...db.bookings.map(x=>x.id)) + 1 : 1,
        booking_no: genBookingNo(db), room_type_id: rt.id, room_no: String(roomNo), checkin: data.checkin, checkout: data.checkout,
        guest_name: data.guest_name, phone: data.phone, guests: data.guests, adults: data.adults, children: data.children,
        gross_amount: Number(rate.total.toFixed(2)), promo_code: promo.code, discount_amount: promo.discount, extra_amount: 0, total_amount: promo.final_total,
        status: "pending", note: (profile.watchlist ? "WATCHLIST: " : "") + (data.note || "Public LINE booking"), agent: "Direct LINE", nationality: data.nationality || "Thai",
        company: "", voucher_no: "", slip_path: saveSlip(data.slip_base64 || ""), created_at: nowIso(), updated_at: ""
      };
      db.bookings.push(b);
      if (Number(data.paid_amount || 0) > 0) db.payments.push({ id: db.payments.length ? Math.max(...db.payments.map(x=>x.id))+1 : 1, receipt_no: genReceiptNo(db), booking_id: b.id, amount: Number(data.paid_amount), method: data.payment_method || "Transfer", category:"deposit", note:"Public booking deposit", shift_name: normalizeShiftName(data.shift_name), status:"active", created_at: nowIso() });
      log(db, "PUBLIC_BOOKING", `${b.booking_no} ${b.guest_name}`);
      writeDb(db);
      return sendJson(res, { ok:true, booking_no:b.booking_no, status:b.status, total_amount:b.total_amount, room_type:rt.name });
    }

    if (req.method === "GET" && pathname === "/api/users") {
      const db = readDb();
      return sendJson(res, (db.users || []).map(u => ({ ...u, password:"", password_hash:"" })));
    }

    if (req.method === "POST" && pathname === "/api/users") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      if (!data.username || !data.password) return sendJson(res, { error:"username_password_required" }, 400);
      if ((db.users || []).some(u => u.username === data.username)) return sendJson(res, { error:"username_duplicate" }, 400);
      const u = { id: db.users.length ? Math.max(...db.users.map(x=>x.id||0))+1 : 1, username:data.username, password_hash:hashPassword(data.password), display_name:data.display_name || data.username, role:data.role || "frontdesk", active:data.active !== false };
      db.users.push(u);
      log(db, "USER_CREATE", u.username);
      writeDb(db);
      return sendJson(res, { ...u, password:"", password_hash:"" });
    }

    const userPatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (req.method === "PATCH" && userPatch) {
      const db = readDb();
      const u = (db.users || []).find(x => x.id === Number(userPatch[1]));
      if (!u) return sendJson(res, { error:"user_not_found" }, 404);
      const data = JSON.parse(await readBody(req));
      if (data.password) {
        u.password_hash = hashPassword(data.password);
        delete u.password;
      }
      delete data.password;
      delete data.password_hash;
      Object.assign(u, data);
      log(db, "USER_UPDATE", u.username);
      writeDb(db);
      return sendJson(res, { ...u, password:"", password_hash:"" });
    }

    if (req.method === "GET" && (pathname === "/api/backup" || pathname === "/api/backup/export-db")) {
      const db = readDb();
      const backup = autoBackup(db, pathname === "/api/backup/export-db" ? "export-db" : "download");
      log(db, "BACKUP_DOWNLOAD", backup.file);
      writeDb(db);
      res.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Content-Disposition":`attachment; filename=${backup.file}` });
      return res.end(JSON.stringify(db, null, 2));
    }

    if (req.method === "GET" && pathname === "/api/backup/status") {
      return sendJson(res, backupStatus(readDb()));
    }

    if (req.method === "POST" && pathname === "/api/backup/settings") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      if (data.backup_custom_dir !== undefined) db.settings.backup_custom_dir = String(data.backup_custom_dir || "").trim();
      if (data.auto_backup_enabled !== undefined) db.settings.auto_backup_enabled = data.auto_backup_enabled === true || data.auto_backup_enabled === "true";
      if (data.auto_backup_time !== undefined) db.settings.auto_backup_time = String(data.auto_backup_time || "02:00");
      if (data.backup_warning_hours !== undefined) db.settings.backup_warning_hours = Number(data.backup_warning_hours || 24);
      const status = backupStatus(db);
      log(db, "BACKUP_SETTINGS", status.backup_dir);
      writeDb(db);
      return sendJson(res, status);
    }

    if (req.method === "GET" && pathname === "/api/backups") {
      return sendJson(res, listBackups(readDb()));
    }

    if (req.method === "GET" && pathname === "/api/backup/file") {
      const db = readDb();
      const file = backupSafeName(url.searchParams.get("file"));
      if (!file) return sendJson(res, { error:"invalid_backup_file" }, 400);
      const full = findBackupFile(db, file);
      if (!full) return sendJson(res, { error:"backup_not_found" }, 404);
      res.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Content-Disposition":`attachment; filename=${file}` });
      return fs.createReadStream(full).pipe(res);
    }

    if (req.method === "POST" && pathname === "/api/restore-from-backup") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      const file = backupSafeName(data.file);
      if (!file) return sendJson(res, { error:"invalid_backup_file" }, 400);
      const full = findBackupFile(db, file);
      if (!full) return sendJson(res, { error:"backup_not_found" }, 404);
      if (fs.existsSync(DB_FILE)) autoBackup(JSON.parse(fs.readFileSync(DB_FILE, "utf8")), "before-restore");
      const restored = JSON.parse(fs.readFileSync(full, "utf8"));
      if (!restored || !restored.settings || !restored.rooms) return sendJson(res, { error:"invalid_backup_file" }, 400);
      fs.writeFileSync(DB_FILE, JSON.stringify(restored, null, 2), "utf8");
      return sendJson(res, { ok:true, file });
    }

    if (req.method === "POST" && pathname === "/api/backup/create") {
      const db = readDb();
      const backup = autoBackup(db, "manual");
      log(db, "BACKUP_CREATE", backup.file);
      writeDb(db);
      return sendJson(res, backup);
    }

    if (req.method === "POST" && pathname === "/api/restore") {
      const raw = await readBody(req, 100 * 1024 * 1024);
      const data = JSON.parse(raw);
      const restored = data.settings ? data : data.backup;
      if (!restored || !restored.settings || !restored.rooms) return sendJson(res, { error:"invalid_backup_file" }, 400);
      if (fs.existsSync(DB_FILE)) {
        const current = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        autoBackup(current, "before-restore");
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(restored, null, 2), "utf8");
      return sendJson(res, { ok:true });
    }

    if (req.method === "GET" && pathname === "/api/reset/preview") {
      const db = readDb();
      return sendJson(res, {
        bookings:(db.bookings||[]).length,
        payments:(db.payments||[]).length,
        refunds:(db.refunds||[]).length,
        extra_charges:(db.extra_charges||[]).length,
        maintenance_tickets:(db.maintenance_tickets||[]).length,
        housekeeping_notes:(db.housekeeping_notes||[]).length,
        room_blocks:(db.room_blocks||[]).length,
        customer_profiles:(db.customer_profiles||[]).length,
        cashier_shifts:(db.cashier_shifts||[]).length,
        night_audits:(db.night_audits||[]).length,
        total_revenue:(db.bookings||[]).reduce((s,b)=>s+baht(b.total_amount),0),
        total_payment:(db.payments||[]).filter(p=>p.status!=="void").reduce((s,p)=>s+baht(p.amount),0)
      });
    }

    if (req.method === "POST" && pathname === "/api/reset/operational-data") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      if (String(data.confirm || "") !== "CLEAR DEMO DATA") return sendJson(res, { error:"confirmation_required", required:"CLEAR DEMO DATA" }, 400);
      const backup = autoBackup(db, "before-clear-demo-data");
      safeResetOperationalData(db, req.currentUser?.username || "admin");
      writeDb(db);
      return sendJson(res, { ok:true, backup, message:"ล้างข้อมูลทดลองใช้งานแล้ว เหลือเฉพาะข้อมูลตั้งค่าระบบ ห้อง ราคา ผู้ใช้งาน และข้อมูลโรงแรม" });
    }

    if (req.method === "POST" && pathname === "/api/system/repair-room-status") {
      const db = readDb();
      const date = url.searchParams.get("date") || today();
      const changed = syncRoomStatuses(db, date);
      log(db, "REPAIR_ROOM_STATUS", `${date} changed=${changed}`);
      writeDb(db);
      return sendJson(res, { ok:true, date, changed });
    }

    if (req.method === "GET" && pathname === "/api/system/online-readiness") {
      return sendJson(res, onlineReadiness(readDb()));
    }

    if (req.method === "POST" && pathname === "/api/system/export-supabase-seed") {
      const db = readDb();
      const result = exportSupabaseSeed(db);
      log(db, "EXPORT_SUPABASE_SEED", result.file);
      writeDb(db);
      return sendJson(res, result);
    }
    if (req.method === "GET" && pathname === "/api/settings") return sendJson(res, readDb().settings);

    if (req.method === "PATCH" && pathname === "/api/settings") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      Object.assign(db.settings, data);
      log(db, "SETTINGS_UPDATE", "system settings updated");
      writeDb(db);
      return sendJson(res, db.settings);
    }

    if (req.method === "GET" && pathname === "/api/bed-types") return sendJson(res, readDb().bed_types || []);
    if (req.method === "POST" && pathname === "/api/bed-types") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      const item = {
        id: db.bed_types.length ? Math.max(...db.bed_types.map(x=>x.id || 0)) + 1 : 1,
        code: String(data.code || "").trim().toUpperCase(),
        name: data.name || "",
        capacity: Number(data.capacity || 2),
        active: data.active !== false
      };
      if (!item.code || !item.name) return sendJson(res, { error:"bed_type_required" }, 400);
      db.bed_types.push(item);
      log(db, "BED_TYPE_CREATE", item.code);
      writeDb(db);
      return sendJson(res, item);
    }

    const bedTypePatch = pathname.match(/^\/api\/bed-types\/(\d+)$/);
    if (req.method === "PATCH" && bedTypePatch) {
      const db = readDb();
      const item = db.bed_types.find(x => x.id === Number(bedTypePatch[1]));
      if (!item) return sendJson(res, { error:"bed_type_not_found" }, 404);
      Object.assign(item, JSON.parse(await readBody(req)));
      log(db, "BED_TYPE_UPDATE", item.code);
      writeDb(db);
      return sendJson(res, item);
    }

    if (req.method === "GET" && pathname === "/api/room-types") return sendJson(res, readDb().room_types);
    if (req.method === "POST" && pathname === "/api/room-types") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      const item = {
        id: db.room_types.length ? Math.max(...db.room_types.map(x=>x.id || 0)) + 1 : 1,
        code: String(data.code || "").trim().toUpperCase(),
        name: data.name || "",
        description: data.description || "",
        base_price: Number(data.base_price || 0),
        max_guests: Number(data.max_guests || 2),
        active: data.active !== false
      };
      if (!item.code || !item.name) return sendJson(res, { error:"room_type_required" }, 400);
      db.room_types.push(item);
      seedRateInventory(db);
      log(db, "ROOM_TYPE_CREATE", item.code);
      writeDb(db);
      return sendJson(res, item);
    }

    const roomTypePatch = pathname.match(/^\/api\/room-types\/(\d+)$/);
    if (req.method === "PATCH" && roomTypePatch) {
      const db = readDb();
      const item = db.room_types.find(x => x.id === Number(roomTypePatch[1]));
      if (!item) return sendJson(res, { error:"room_type_not_found" }, 404);
      Object.assign(item, JSON.parse(await readBody(req)));
      log(db, "ROOM_TYPE_UPDATE", item.code);
      writeDb(db);
      return sendJson(res, item);
    }

    if (req.method === "GET" && pathname === "/api/rooms") {
      const db = readDb();
      const rows = db.rooms.map(r => ({ ...r, room_type: roomType(db, r.room_type_id)?.name || "", room_type_code: roomType(db, r.room_type_id)?.code || "", bed_type: bedType(db, r.bed_type_id)?.name || "", bed_type_code: bedType(db, r.bed_type_id)?.code || "" }));
      return sendJson(res, rows);
    }

    if (req.method === "POST" && pathname === "/api/rooms") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      if (!data.room_no) return sendJson(res, { error:"room_no_required" }, 400);
      if (db.rooms.some(r => r.room_no === String(data.room_no))) return sendJson(res, { error:"room_no_duplicate" }, 400);
      const item = {
        id: db.rooms.length ? Math.max(...db.rooms.map(x=>x.id || 0)) + 1 : 1,
        room_no: String(data.room_no),
        floor: String(data.floor || ""),
        room_type_id: Number(data.room_type_id || 1),
        bed_type_id: Number(data.bed_type_id || 1),
        housekeeping_status: data.housekeeping_status || "VC",
        room_status: data.room_status || "active",
        active: data.active !== false
      };
      db.rooms.push(item);
      log(db, "ROOM_CREATE", item.room_no);
      writeDb(db);
      return sendJson(res, item);
    }

    const roomPatchById = pathname.match(/^\/api\/rooms\/id\/(\d+)$/);
    if (req.method === "PATCH" && roomPatchById) {
      const db = readDb();
      const item = db.rooms.find(x => x.id === Number(roomPatchById[1]));
      if (!item) return sendJson(res, { error:"room_not_found" }, 404);
      const data = JSON.parse(await readBody(req));
      if (data.room_no && data.room_no !== item.room_no && db.rooms.some(r => r.room_no === String(data.room_no))) return sendJson(res, { error:"room_no_duplicate" }, 400);
      Object.assign(item, data);
      if (data.room_no !== undefined) item.room_no = String(data.room_no);
      if (data.room_type_id !== undefined) item.room_type_id = Number(data.room_type_id);
      if (data.bed_type_id !== undefined) item.bed_type_id = Number(data.bed_type_id);
      if (data.active !== undefined) item.active = data.active === true || data.active === "true";
      log(db, "ROOM_UPDATE", item.room_no);
      writeDb(db);
      return sendJson(res, item);
    }
    if (req.method === "POST" && pathname === "/api/rooms/block-sale") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      const roomNo = String(data.room_no || "").trim();
      const r = roomObj(db, roomNo);
      if (!r) return sendJson(res, { error:"room_not_found" }, 404);
      const action = String(data.action || "block");
      if (action === "open") {
        const blockId = Number(data.block_id || 0);
        if (blockId) cancelRoomBlocks(db, b => Number(b.id) === blockId && String(b.room_no) === roomNo && b.source !== "maintenance");
        else cancelRoomBlocks(db, b => String(b.room_no) === roomNo && b.source !== "maintenance");
        refreshRoomBlockStatuses(db);
        const stillOpen = hasOpenRoomBlock(db, roomNo, today(), addDays(today(), 1));
        if (!stillOpen) {
          r.room_status = "active";
          r.housekeeping_status = data.housekeeping_status || "VD";
          r.manual_block_sale = false;
          r.block_reason = "";
          r.blocked_at = "";
          r.unblocked_at = nowIso();
        }
        log(db, "ROOM_OPEN_SALE", `${roomNo} opened from Room Plan`);
        writeDb(db);
        return sendJson(res, { ok:true, room:r, still_blocked:stillOpen });
      }
      const start = data.start_date || today();
      const end = data.end_date || start;
      if (end < start) return sendJson(res, { error:"invalid_block_date_range" }, 400);
      const block = createRoomBlock(db, { room_no:roomNo, start_date:start, end_date:end, reason:data.reason || "Block Sale / Mark room OOO", source:"roomplan", created_by:req.currentUser?.display_name || req.currentUser?.username || "" });
      r.block_reason = block.reason;
      r.blocked_at = nowIso();
      r.unblocked_at = "";
      refreshRoomBlockStatuses(db);
      log(db, "ROOM_BLOCK_SALE", `${roomNo} ${block.start_date}..${block.end_date} ${block.reason}`);
      writeDb(db);
      return sendJson(res, { ok:true, room:r, block });
    }

    if (req.method === "GET" && pathname === "/api/room-blocks") {
      const db = readDb();
      const roomNo = url.searchParams.get("room_no") || "";
      const from = url.searchParams.get("from") || addDays(today(), -30);
      const to = url.searchParams.get("to") || addDays(today(), 90);
      let rows = (db.room_blocks || []).filter(b => b.status !== "cancelled");
      if (roomNo) rows = rows.filter(b => String(b.room_no) === String(roomNo));
      rows = rows.filter(b => overlaps(b.start_date, blockEndExclusive(b), from, addDays(to, 1)));
      return sendJson(res, rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))));
    }

    if (req.method === "GET" && pathname === "/api/available-rooms") {
      const db = readDb();
      const checkin = url.searchParams.get("checkin") || today();
      const checkout = url.searchParams.get("checkout") || addDays(checkin, 1);
      const roomTypeId = Number(url.searchParams.get("room_type_id") || 0);
      const excludeId = Number(url.searchParams.get("exclude_id") || 0) || null;
      const rows = db.rooms
        .filter(r => isRoomSellable(db, r, checkin, checkout))
        .filter(r => !roomTypeId || r.room_type_id === roomTypeId)
        .filter(r => roomBookings(db, r.room_no, checkin, checkout, excludeId).length === 0)
        .map(r => ({ ...r, room_type: roomType(db, r.room_type_id)?.name || "", room_type_code: roomType(db, r.room_type_id)?.code || "", bed_type: bedType(db, r.bed_type_id)?.name || "", bed_type_code: bedType(db, r.bed_type_id)?.code || "" }))
        .sort((a,b)=>Number(a.room_no)-Number(b.room_no));
      return sendJson(res, rows);
    }
    if (req.method === "GET" && pathname === "/api/dashboard") return sendJson(res, dashboard(readDb()));
    if (req.method === "GET" && pathname === "/api/today-operation") return sendJson(res, todayOperation(readDb(), url.searchParams.get("date") || today()));
    if (req.method === "GET" && pathname === "/api/availability") return sendJson(res, availability(readDb(), url.searchParams.get("checkin") || today(), url.searchParams.get("checkout") || addDays(today(), 1)));
    if (req.method === "GET" && pathname === "/api/quote") { const db = readDb(); const quote = quoteStay(db, Number(url.searchParams.get("room_type_id") || 0), url.searchParams.get("checkin") || today(), url.searchParams.get("checkout") || addDays(today(), 1), url.searchParams.get("promo_code") || ""); if (!quote) return sendJson(res, { error:"room_type_not_found" }, 404); return sendJson(res, quote); }
    if (req.method === "GET" && pathname === "/api/roomplan") return sendJson(res, roomPlan(readDb(), url.searchParams.get("from") || today(), Number(url.searchParams.get("days") || 21)));
    if (req.method === "GET" && pathname === "/api/occ-calendar") return sendJson(res, occCalendar(readDb(), url.searchParams.get("month") || today().slice(0,7)));
    if (req.method === "GET" && pathname === "/api/guest-list") return sendJson(res, guestRows(readDb(), url.searchParams));
    if (req.method === "GET" && pathname === "/api/payments") return sendJson(res, paymentReport(readDb(), url.searchParams));
    if (req.method === "GET" && pathname === "/api/activity-logs") return sendJson(res, readDb().activity_logs);

    if (req.method === "GET" && pathname === "/api/channels") return sendJson(res, readDb().channels || []);
    if (req.method === "POST" && pathname === "/api/channels") {
      const db = readDb();
      db.channels ||= [];
      const data = JSON.parse(await readBody(req));
      const c = { id: db.channels.length ? Math.max(...db.channels.map(x=>x.id||0))+1 : 1, name:data.name || "", type:data.type || "direct", commission_percent:Number(data.commission_percent||0), active:data.active !== false };
      if (!c.name) return sendJson(res, { error:"channel_name_required" }, 400);
      db.channels.push(c);
      log(db, "CHANNEL_CREATE", c.name);
      writeDb(db);
      return sendJson(res, c);
    }
    const channelPatch = pathname.match(/^\/api\/channels\/(\d+)$/);
    if (req.method === "PATCH" && channelPatch) {
      const db = readDb();
      const c = (db.channels || []).find(x => x.id === Number(channelPatch[1]));
      if (!c) return sendJson(res, { error:"channel_not_found" }, 404);
      Object.assign(c, JSON.parse(await readBody(req)));
      log(db, "CHANNEL_UPDATE", c.name);
      writeDb(db);
      return sendJson(res, c);
    }

    if (req.method === "GET" && pathname === "/api/maintenance") {
      const db = readDb();
      return sendJson(res, (db.maintenance_tickets || []).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))));
    }

    if (req.method === "GET" && pathname === "/api/maintenance/summary") {
      const db = readDb();
      const rows = db.maintenance_tickets || [];
      const by_status = {};
      const by_priority = {};
      const cost_open = rows.filter(t=>!["Done","Cancelled"].includes(t.status)).reduce((s,t)=>s+baht(t.cost),0);
      const cost_done = rows.filter(t=>t.status==="Done").reduce((s,t)=>s+baht(t.cost),0);
      rows.forEach(t => { by_status[t.status || "New"] = (by_status[t.status || "New"] || 0) + 1; by_priority[t.priority || "normal"] = (by_priority[t.priority || "normal"] || 0) + 1; });
      return sendJson(res, { total:rows.length, open:rows.filter(t=>!["Done","Cancelled"].includes(t.status)).length, by_status, by_priority, cost_open, cost_done });
    }

    if (req.method === "GET" && pathname === "/api/maintenance/room-history") {
      const db = readDb();
      const roomNo = String(url.searchParams.get("room_no") || "").trim();
      if (!roomNo) return sendJson(res, { error:"room_no_required" }, 400);
      const tickets = (db.maintenance_tickets || []).filter(t => String(t.room_no || "") === roomNo).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
      const notes = (db.housekeeping_notes || []).filter(n => String(n.room_no || "") === roomNo).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,50);
      const cost_total = tickets.reduce((s,t)=>s+baht(t.cost),0);
      return sendJson(res, { room_no:roomNo, room: roomObj(db, roomNo), tickets, notes, total_tickets:tickets.length, cost_total });
    }

    const maintGetOne = pathname.match(/^\/api\/maintenance\/(\d+)$/);
    if (req.method === "GET" && maintGetOne) {
      const db = readDb();
      const t = (db.maintenance_tickets || []).find(x => x.id === Number(maintGetOne[1]));
      if (!t) return sendJson(res, { error:"ticket_not_found" }, 404);
      const blocks = (db.room_blocks || []).filter(b => b.ticket_id === t.id && b.status !== "cancelled");
      return sendJson(res, { ...t, blocks, room: t.room_no ? roomObj(db, t.room_no) : null, settings:db.settings });
    }

    if (req.method === "POST" && pathname === "/api/maintenance") {
      const db = readDb();
      db.maintenance_tickets ||= [];
      const data = JSON.parse(await readBody(req));
      const seq = db.maintenance_tickets.length ? Math.max(...db.maintenance_tickets.map(x=>x.id||0))+1 : 1;
      const t = {
        id: seq,
        ticket_no: `MT${new Date().getFullYear()}-${String((db.maintenance_tickets.length||0)+1).padStart(5,"0")}`,
        work_order_no: `WO${new Date().getFullYear()}-${String((db.maintenance_tickets.length||0)+1).padStart(5,"0")}`,
        location_type: data.location_type || "room",
        room_no: data.room_no || "",
        area: data.area || "",
        title: data.title || "",
        detail: data.detail || "",
        priority: data.priority || "normal",
        status: data.status || "New",
        reported_by: data.reported_by || data.created_by || req.currentUser?.display_name || req.currentUser?.username || "",
        assigned_to: data.assigned_to || "",
        due_date: data.due_date || "",
        start_date: data.start_date || "",
        finished_at: "",
        solution: data.solution || "",
        cost: Number(data.cost || 0),
        block_sale: data.block_sale !== false && data.block_sale !== "false",
        block_start_date: data.block_start_date || data.start_date || today(),
        block_end_date: data.block_end_date || data.end_date || data.block_start_date || data.start_date || today(),
        photo_before: saveSlip(data.photo_before_base64 || ""),
        photo_after: saveSlip(data.photo_after_base64 || ""),
        created_at: nowIso(),
        updated_at: ""
      };
      if (t.block_end_date < t.block_start_date) return sendJson(res, { error:"invalid_block_date_range" }, 400);
      db.maintenance_tickets.unshift(t);
      let block = null;
      if (t.room_no && (data.mark_ooo || t.block_sale)) {
        block = createRoomBlock(db, { room_no:t.room_no, start_date:t.block_start_date, end_date:t.block_end_date, reason:t.title || "Maintenance", source:"maintenance", ticket_id:t.id, created_by:t.reported_by });
        refreshRoomBlockStatuses(db);
      }
      log(db, "MAINTENANCE_CREATE", `${t.ticket_no} ${t.room_no} ${t.title}`);
      writeDb(db);
      return sendJson(res, { ...t, block });
    }

    const maintPatch = pathname.match(/^\/api\/maintenance\/(\d+)$/);
    if (req.method === "PATCH" && maintPatch) {
      const db = readDb();
      const t = (db.maintenance_tickets || []).find(x => x.id === Number(maintPatch[1]));
      if (!t) return sendJson(res, { error:"ticket_not_found" }, 404);
      const data = JSON.parse(await readBody(req));
      if (data.status === "Done" && t.status !== "Done") data.finished_at = nowIso();
      Object.assign(t, data, { updated_at: nowIso() });
      if (data.photo_after_base64) t.photo_after = saveSlip(data.photo_after_base64);
      if (["Done","Cancelled"].includes(t.status) && t.room_no) {
        cancelRoomBlocks(db, b => b.ticket_id === t.id || (b.source === "maintenance" && String(b.room_no) === String(t.room_no) && String(b.reason || "") === String(t.title || "")));
      } else if (t.room_no && t.block_sale !== false) {
        const exists = (db.room_blocks || []).some(b => b.ticket_id === t.id && b.status !== "cancelled");
        if (!exists) createRoomBlock(db, { room_no:t.room_no, start_date:t.block_start_date || today(), end_date:t.block_end_date || t.block_start_date || today(), reason:t.title || "Maintenance", source:"maintenance", ticket_id:t.id, created_by:t.reported_by || "" });
      }
      refreshRoomBlockStatuses(db);
      log(db, "MAINTENANCE_UPDATE", `${t.ticket_no} ${t.status}`);
      writeDb(db);
      return sendJson(res, t);
    }

    if (req.method === "GET" && pathname === "/api/crm/customers") {
      const db = readDb();
      const phones = new Set((db.bookings || []).map(b => String(b.phone || "unknown")));
      (db.customer_profiles || []).forEach(p => phones.add(String(p.phone || "unknown")));
      const rows = Array.from(phones).map(phone => customerCrmSummary(db, phone)).map(c => ({
        phone:c.phone,
        guest_name:c.guest_name,
        visits:c.visits,
        revenue:c.revenue,
        paid_total:c.paid_total,
        refund_total:c.refund_total,
        extra_total:c.extra_total,
        last_stay:c.last_stay,
        profile:c.profile,
        bookings:c.bookings.map(b=>b.booking_no)
      })).sort((a,b)=>String(b.last_stay).localeCompare(String(a.last_stay)));
      writeDb(db);
      return sendJson(res, rows);
    }

    if (req.method === "GET" && pathname === "/api/crm/customer") {
      const db = readDb();
      const phone = String(url.searchParams.get("phone") || "").trim();
      if (!phone) return sendJson(res, { error:"phone_required" }, 400);
      const summary = customerCrmSummary(db, phone);
      writeDb(db);
      return sendJson(res, summary);
    }

    if (req.method === "POST" && pathname === "/api/crm/line-message") {
      const db = readDb();
      db.line_message_logs ||= [];
      const data = JSON.parse(await readBody(req));
      const phone = String(data.phone || "").trim();
      const message = String(data.message || "").trim();
      if (!phone || !message) return sendJson(res, { error:"phone_message_required" }, 400);
      const profile = customerProfile(db, phone);
      if (data.line_user_id !== undefined) profile.line_user_id = String(data.line_user_id || "");
      const row = {
        id: db.line_message_logs.length ? Math.max(...db.line_message_logs.map(x=>x.id||0))+1 : 1,
        phone,
        line_user_id: profile.line_user_id || "",
        message,
        status: profile.line_user_id && db.settings.line_channel_access_token ? "queued" : "draft_only",
        note: profile.line_user_id && db.settings.line_channel_access_token ? "พร้อมต่อยอดส่งผ่าน LINE Messaging API" : "ยังไม่ได้ตั้งค่า LINE User ID / Channel Access Token ระบบจึงบันทึกเป็นข้อความร่าง",
        created_by: req.currentUser?.display_name || req.currentUser?.username || "",
        created_at: nowIso()
      };
      db.line_message_logs.unshift(row);
      log(db, "CRM_LINE_MESSAGE", `${phone} ${row.status}`);
      writeDb(db);
      return sendJson(res, row);
    }

    const crmPatch = pathname.match(/^\/api\/crm\/customers\/(.+)$/);
    if (req.method === "PATCH" && crmPatch) {
      const db = readDb();
      const phone = decodeURIComponent(crmPatch[1]);
      const p = customerProfile(db, phone);
      Object.assign(p, JSON.parse(await readBody(req)), { updated_at: nowIso() });
      log(db, "CRM_UPDATE", phone);
      writeDb(db);
      return sendJson(res, p);
    }

    if (req.method === "GET" && pathname === "/api/invoice/booking") {
      const db = readDb();
      const id = Number(url.searchParams.get("booking_id"));
      const b = db.bookings.find(x=>x.id===id);
      if (!b) return sendJson(res, { error:"booking_not_found" }, 404);
      const rt = roomType(db, b.room_type_id);
      const paid = totalPaid(db, b.id);
      const payments = db.payments.filter(p=>p.booking_id===b.id && p.status !== "void");
      const refunds = (db.refunds || []).filter(r=>r.booking_id===b.id && r.status !== "void");
      const extras = bookingExtras(db, b.id);
      const refundAmount = refunds.reduce((s,r)=>s+baht(r.amount),0);
      return sendJson(res, { booking:b, room_type:rt, settings:db.settings, paid_amount:paid, refund_amount:refundAmount, balance:baht(b.total_amount)-paid+refundAmount, payments, refunds, extras, room_charge_amount:bookingRoomCharge(db,b) });
    }

    if (req.method === "GET" && pathname === "/api/line-preview") {
      const db = readDb();
      const bookingNo = url.searchParams.get("booking_no") || "BK2026-00001";
      const text = (db.settings.line_booking_message || "ขอบคุณที่จองห้องพัก เลขจองของคุณคือ {booking_no}").replaceAll("{booking_no}", bookingNo);
      return sendJson(res, { message:text, liff_id:db.settings.line_liff_id || "", webhook_url:"/line/webhook" });
    }

    if (req.method === "POST" && pathname === "/line/webhook") {
      return sendJson(res, { ok:true, note:"LINE webhook placeholder. Deploy to HTTPS before real LINE use." });
    }



    if (req.method === "GET" && pathname === "/api/rate-inventory") {
      const db = readDb();
      const month = url.searchParams.get("month") || today().slice(0,7);
      const data = rateInventoryMonth(db, month);
      writeDb(db);
      return sendJson(res, data);
    }

    if (req.method === "PATCH" && pathname === "/api/rate-inventory") {
      const db = readDb();
      const data = JSON.parse(await readBody(req));
      const dates = data.dates || [data.date];
      const roomTypeIds = data.room_type_ids || (data.room_type_id ? [data.room_type_id] : db.room_types.map(rt=>rt.id));
      dates.forEach(date => {
        roomTypeIds.forEach(roomTypeId => {
          const row = getRateRow(db, date, Number(roomTypeId));
          ["price","rate_plan","stop_sale","min_night","direct_discount","line_inventory","close_low_stock"].forEach(k => {
            if (data[k] !== undefined) row[k] = data[k];
          });
          row.updated_at = nowIso();
        });
      });
      log(db, "RATE_INVENTORY", `update ${dates.length} date(s) ${roomTypeIds.length} room type(s)`);
      writeDb(db);
      return sendJson(res, { ok:true });
    }

    if (req.method === "GET" && pathname === "/api/promotion-codes") {
      return sendJson(res, readDb().promotion_codes || []);
    }

    if (req.method === "POST" && pathname === "/api/promotion-codes") {
      const db = readDb();
      db.promotion_codes ||= [];
      const data = JSON.parse(await readBody(req));
      const promo = {
        id: db.promotion_codes.length ? Math.max(...db.promotion_codes.map(x=>x.id || 0)) + 1 : 1,
        code: String(data.code || "").trim().toUpperCase(),
        name: data.name || "",
        type: data.type || "amount",
        value: Number(data.value || 0),
        active: data.active !== false,
        start_date: data.start_date || today(),
        end_date: data.end_date || addDays(today(),30),
        min_night: Number(data.min_night || 1),
        note: data.note || ""
      };
      if (!promo.code) return sendJson(res, { error:"code_required" }, 400);
      db.promotion_codes.push(promo);
      log(db, "PROMO_CREATE", promo.code);
      writeDb(db);
      return sendJson(res, promo);
    }

    if (req.method === "GET" && pathname === "/api/reports/daily") {
      const db = readDb();
      return sendJson(res, reportsDaily(db, url.searchParams.get("date") || today()));
    }

    if (req.method === "GET" && pathname === "/api/reports/monthly") {
      const db = readDb();
      return sendJson(res, reportsMonthly(db, url.searchParams.get("month") || today().slice(0,7)));
    }

    if (req.method === "GET" && pathname === "/api/night-audit") {
      const db = readDb();
      return sendJson(res, nightAuditReport(db, url.searchParams.get("date") || today()));
    }

    if (req.method === "POST" && pathname === "/api/night-audit/close") {
      const db = readDb();
      db.night_audits ||= [];
      const data = JSON.parse(await readBody(req));
      const date = data.date || today();
      if (isAuditClosed(db, date)) return sendJson(res, { error:"date_already_closed" }, 400);
      const report = nightAuditReport(db, date);
      if ((report.outstanding || []).length && data.force !== true) return sendJson(res, { error:"outstanding_balance_exists", outstanding:report.outstanding.length }, 409);
      const audit = { id: db.night_audits.length ? Math.max(...db.night_audits.map(x=>x.id||0))+1 : 1, date, status:"closed", closed_by:data.closed_by || req.currentUser?.display_name || req.currentUser?.username || "", note:data.note || "", snapshot:report, closed_at:nowIso() };
      db.night_audits.unshift(audit);
      log(db, "NIGHT_AUDIT_CLOSE", `${date} by ${audit.closed_by}`);
      autoBackup(db, "night-audit-" + date);
      writeDb(db);
      return sendJson(res, audit);
    }

    if (req.method === "GET" && pathname === "/api/export/daily-report.xls") {
      const db = readDb();
      const d = reportsDaily(db, url.searchParams.get("date") || today());
      const roomRows = (d.room_revenue_rows||[]).map(r=>`<tr><td>${r.booking_no}</td><td>${r.room_no}</td><td>${r.guest_name}</td><td>${r.total_room_charge}</td><td>${r.nights}</td><td>${r.daily_room_revenue}</td></tr>`).join("");
      const paymentRows = (d.payment_breakdown||[]).map(r=>`<tr><td>${r.at}</td><td>${r.type}</td><td>${r.booking_no}</td><td>${r.room_no}</td><td>${r.guest_name}</td><td>${r.method}</td><td>${r.shift_name}</td><td>${r.category_name}</td><td>${r.amount}</td></tr>`).join("");
      const rows = `
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Date</td><td>${d.date}</td></tr>
        <tr><td>Total Rooms</td><td>${d.total_rooms}</td></tr>
        <tr><td>Occupied Rooms</td><td>${d.occupied_rooms}</td></tr>
        <tr><td>Occupancy</td><td>${d.occupancy}%</td></tr>
        <tr><td>Arrivals</td><td>${d.arrivals}</td></tr>
        <tr><td>Departures</td><td>${d.departures}</td></tr>
        <tr><td>Room Revenue</td><td>${d.room_revenue}</td></tr>
        <tr><td>ADR</td><td>${d.adr}</td></tr>
        <tr><td>RevPAR</td><td>${d.revpar}</td></tr>
        <tr><td>Payment Total</td><td>${d.payment_total}</td></tr>
        <tr><td>Refund</td><td>${d.refund_total}</td></tr>
        <tr><td>Net Payment</td><td>${d.net_payment}</td></tr>
        <tr><td colspan="9"></td></tr>
        <tr><th colspan="6">Room Revenue Detail - Actual booking room price allocated per night</th></tr>
        <tr><th>Booking</th><th>Room</th><th>Guest</th><th>Total Room Charge</th><th>Nights</th><th>Daily Room Revenue</th></tr>${roomRows}
        <tr><td colspan="9"></td></tr>
        <tr><th colspan="9">Payment Breakdown</th></tr>
        <tr><th>Date/Time</th><th>Type</th><th>Booking</th><th>Room</th><th>Guest</th><th>Method</th><th>Shift</th><th>Category</th><th>Amount</th></tr>${paymentRows}
      `;
      res.writeHead(200, { "Content-Type":"application/vnd.ms-excel; charset=utf-8", "Content-Disposition":`attachment; filename=daily-report-${d.date}.xls` });
      return res.end(htmlExcelTable("Daily Report", rows));
    }

    if (req.method === "GET" && pathname === "/api/export/monthly-report.xls") {
      const db = readDb();
      const m = reportsMonthly(db, url.searchParams.get("month") || today().slice(0,7));
      const rows = `
        <tr><th>Date</th><th>Occ %</th><th>Room Nights</th><th>Room Revenue</th><th>ADR</th><th>RevPAR</th><th>Payment</th><th>Refund</th><th>Net</th></tr>
        ${m.days.map(d=>`<tr><td>${d.date}</td><td>${d.occupancy}</td><td>${d.occupied_rooms}</td><td>${d.room_revenue}</td><td>${d.adr}</td><td>${d.revpar}</td><td>${d.payment_total}</td><td>${d.refund_total}</td><td>${d.net_payment}</td></tr>`).join("")}
        <tr><th>Total</th><th>${m.occupancy}</th><th>${m.room_nights}</th><th>${m.room_revenue}</th><th>${m.adr}</th><th>${m.revpar}</th><th>${m.payment_total}</th><th>${m.refund_total}</th><th>${m.net_payment}</th></tr>
      `;
      res.writeHead(200, { "Content-Type":"application/vnd.ms-excel; charset=utf-8", "Content-Disposition":`attachment; filename=monthly-report-${m.month}.xls` });
      return res.end(htmlExcelTable("Monthly Report", rows));
    }

    const bookingGet = pathname.match(/^\/api\/bookings\/(\d+)$/);
    if (req.method === "GET" && bookingGet) {
      const db = readDb();
      const b = db.bookings.find(x => x.id === Number(bookingGet[1]));
      if (!b) return sendJson(res, { error: "booking_not_found" }, 404);
      recalcBookingExtraAmount(db, b);
      return sendJson(res, { ...b, paid_amount: totalPaid(db, b.id), balance: balance(db, b), payment_status: paymentStatus(db, b), extras: bookingExtras(db, b.id), payments: db.payments.filter(p => p.booking_id === b.id), refunds: (db.refunds || []).filter(r => r.booking_id === b.id), room_moves: (db.room_moves || []).filter(m => m.booking_id === b.id) });
    }

    if (req.method === "POST" && pathname === "/api/bookings") {
      const data = JSON.parse(await readBody(req));
      const db = readDb();
      const rt = roomType(db, data.room_type_id);
      if (!rt) return sendJson(res, { error: "room_type_not_found" }, 404);
      if (!data.guest_name || !data.phone || !data.checkin || !data.checkout) return sendJson(res, { error: "missing_required_fields" }, 400);
      if (touchesClosedAudit(db, data.checkin, data.checkout)) return sendJson(res, { error:"night_audit_closed_for_stay_date" }, 409);
      const profile = customerProfile(db, data.phone);
      if (profile.blacklist && data.override_blacklist !== true) return sendJson(res, { error:"customer_blacklisted" }, 403);
      const rate = bestRateForStay(db, rt.id, data.checkin, data.checkout);
      if (rate.stop_sale) return sendJson(res, { error: "stop_sale" }, 400);
      if (nights(data.checkin, data.checkout) < rate.min_night) return sendJson(res, { error: "min_night_required_" + rate.min_night }, 400);
      const quote = quoteStay(db, rt.id, data.checkin, data.checkout, data.promo_code || "");
      const roomNo = data.room_no || findFreeRoom(db, rt.id, data.checkin, data.checkout);
      if (!roomNo) return sendJson(res, { error: "no_room_available" }, 400);
      const selectedRoom = roomObj(db, roomNo);
      if (!isRoomSellable(db, selectedRoom, data.checkin, data.checkout)) return sendJson(res, { error: "room_blocked_or_ooo" }, 400);
      if (roomBookings(db, roomNo, data.checkin, data.checkout).length > 0) return sendJson(res, { error: "room_not_available" }, 400);

      const b = {
        id: db.bookings.length ? Math.max(...db.bookings.map(x=>x.id)) + 1 : 1,
        booking_no: genBookingNo(db),
        room_type_id: rt.id,
        room_no: String(roomNo),
        checkin: data.checkin,
        checkout: data.checkout,
        guest_name: data.guest_name,
        phone: data.phone,
        guests: Number(data.guests || rt.max_guests),
        adults: Number(data.adults || data.guests || rt.max_guests),
        children: Number(data.children || 0),
        gross_amount: Number((data.gross_amount !== undefined ? data.gross_amount : quote.gross_total) || 0),
        promo_code: quote.promo_code || "",
        discount_amount: Number(quote.discount_amount || 0),
        extra_amount: 0,
        total_amount: Number(data.total_amount !== undefined && !data.promo_code ? data.total_amount : quote.final_total),
        status: data.status || "confirmed",
        note: (profile.watchlist ? "WATCHLIST: " : "") + (data.note || ""),
        agent: data.agent || "Direct LINE",
        nationality: data.nationality || "Thai",
        company: data.company || "",
        voucher_no: data.voucher_no || "",
        created_at: nowIso(),
        updated_at: ""
      };
      db.bookings.push(b);
      if (Number(data.paid_amount || 0) > 0) {
        db.payments.push({ id: db.payments.length ? Math.max(...db.payments.map(x=>x.id))+1 : 1, receipt_no: genReceiptNo(db), booking_id: b.id, amount: Number(data.paid_amount), method: data.payment_method || "Transfer", category:"deposit", note: "Initial payment", slip_path: saveSlip(data.slip_base64 || ""), shift_name: normalizeShiftName(data.shift_name), status: "active", created_at: nowIso() });
      }
      log(db, "CREATE_BOOKING", `${b.booking_no} ${b.guest_name}`);
      writeDb(db);
      return sendJson(res, b);
    }

    const bookingPatch = pathname.match(/^\/api\/bookings\/(\d+)$/);
    if (req.method === "PATCH" && bookingPatch) {
      const db = readDb();
      const b = db.bookings.find(x => x.id === Number(bookingPatch[1]));
      if (!b) return sendJson(res, { error: "booking_not_found" }, 404);
      const data = JSON.parse(await readBody(req));
      if (bookingTouchesClosedAudit(db, b, data)) return sendJson(res, { error:"night_audit_closed_for_stay_date" }, 409);
      const oldRoomNo = b.room_no;
      const targetRoom = data.room_no || b.room_no;
      const targetCheckin = data.checkin || b.checkin;
      const targetCheckout = data.checkout || b.checkout;
      if ((data.room_no || data.checkin || data.checkout) && !isRoomSellable(db, roomObj(db, targetRoom), targetCheckin, targetCheckout)) return sendJson(res, { error: "room_blocked_or_ooo" }, 400);
      if ((data.room_no || data.checkin || data.checkout) && roomBookings(db, targetRoom, targetCheckin, targetCheckout, b.id).length) return sendJson(res, { error: "new_room_or_date_not_available" }, 400);
      Object.assign(b, data, { updated_at: nowIso() });
      const moved = data.room_no && String(data.room_no) !== String(oldRoomNo);
      if (moved) addRoomMove(db, b, oldRoomNo, b.room_no, req.currentUser, data.move_reason || data.reason || "");
      if (data.promo_code !== undefined) { const q2 = quoteStay(db, b.room_type_id, b.checkin, b.checkout, data.promo_code || ""); if (q2) { b.gross_amount = q2.gross_total; b.promo_code = q2.promo_code; b.discount_amount = q2.discount_amount; b.total_amount = q2.final_total + totalExtras(db, b.id); } }
      if (data.room_no && String(data.room_no) !== String(oldRoomNo) && b.status === "checked_in") { const oldR = roomObj(db, oldRoomNo); const newR = roomObj(db, b.room_no); if (oldR) oldR.housekeeping_status = "VD"; if (newR) newR.housekeeping_status = "OCC"; }
      if (data.checkin || data.checkout || data.room_type_id) {
        const q2 = quoteStay(db, b.room_type_id, b.checkin, b.checkout, b.promo_code || "");
        if (q2 && data.total_amount === undefined) {
          b.gross_amount = q2.gross_total;
          b.discount_amount = q2.discount_amount;
          b.total_amount = q2.final_total + totalExtras(db, b.id);
        }
      }
      log(db, moved ? "ROOM_MOVE" : "UPDATE_BOOKING", moved ? `${b.booking_no} ${oldRoomNo} -> ${b.room_no}` : b.booking_no);
      writeDb(db);
      return sendJson(res, b);
    }

    const extraPost = pathname.match(/^\/api\/bookings\/(\d+)\/extras$/);
    if (req.method === "POST" && extraPost) {
      const db = readDb();
      db.extra_charges ||= [];
      const bookingId = Number(extraPost[1]);
      const b = db.bookings.find(x => x.id === bookingId);
      if (!b) return sendJson(res, { error:"booking_not_found" }, 404);
      if (bookingTouchesClosedAudit(db, b, {})) return sendJson(res, { error:"night_audit_closed_for_stay_date" }, 409);
      const data = JSON.parse(await readBody(req));
      const qty = Number(data.qty || 1);
      const unitPrice = Number(data.unit_price || data.amount || 0);
      const amount = Number((data.amount !== undefined ? Number(data.amount) : qty * unitPrice).toFixed(2));
      if (amount <= 0) return sendJson(res, { error:"amount_required" }, 400);
      const item = {
        id: db.extra_charges.length ? Math.max(...db.extra_charges.map(x=>x.id||0))+1 : 1,
        booking_id: bookingId,
        type: data.type || "other",
        description: data.description || extraTypeName(data.type || "other"),
        qty,
        unit_price: unitPrice,
        amount,
        status: "active",
        created_by: data.created_by || req.currentUser?.display_name || req.currentUser?.username || "",
        created_at: nowIso()
      };
      db.extra_charges.push(item);
      recalcBookingExtraAmount(db, b);
      b.total_amount = Number((baht(b.total_amount) + amount).toFixed(2));
      b.updated_at = nowIso();
      log(db, "ADD_EXTRA", `${b.booking_no} ${extraTypeName(item.type)} ${amount}`);
      writeDb(db);
      return sendJson(res, { ok:true, extra:item, booking:{ ...b, paid_amount: totalPaid(db, b.id), balance: balance(db, b), extras: bookingExtras(db, b.id) } });
    }

    const statusPatch = pathname.match(/^\/api\/bookings\/(\d+)\/status$/);
    if (req.method === "PATCH" && statusPatch) {
      const db = readDb();
      const b = db.bookings.find(x => x.id === Number(statusPatch[1]));
      if (!b) return sendJson(res, { error: "booking_not_found" }, 404);
      const data = JSON.parse(await readBody(req));
      const allowed = ["pending","confirmed","checked_in","checked_out","cancelled"];
      if (!allowed.includes(data.status)) return sendJson(res, { error: "invalid_status" }, 400);
      if (bookingTouchesClosedAudit(db, b, {})) return sendJson(res, { error:"night_audit_closed_for_stay_date" }, 409);
      if (data.status === "checked_out" && balance(db, b) > 0 && data.force !== true) return sendJson(res, { error:"balance_remaining", balance:balance(db, b) }, 409);
      b.status = data.status;
      b.updated_at = nowIso();
      if (data.status === "checked_in") {
        const r = roomObj(db, b.room_no);
        if (r) { r.housekeeping_status = "OCC"; r.room_status = "active"; }
      }
      if (data.status === "checked_out") {
        const r = roomObj(db, b.room_no);
        if (r) { r.housekeeping_status = "VD"; r.room_status = "active"; }
      }
      log(db, "CHANGE_STATUS", `${b.booking_no} -> ${data.status}`);
      writeDb(db);
      return sendJson(res, b);
    }

    const paymentPost = pathname.match(/^\/api\/bookings\/(\d+)\/payments$/);
    if (req.method === "POST" && paymentPost) {
      const db = readDb();
      const bookingId = Number(paymentPost[1]);
      const b = db.bookings.find(x => x.id === bookingId);
      if (!b) return sendJson(res, { error: "booking_not_found" }, 404);
      if (isAuditClosed(db, today())) return sendJson(res, { error:"night_audit_closed_for_today" }, 409);
      const data = JSON.parse(await readBody(req));
      const amount = Number(data.amount || 0);
      if (amount <= 0) return sendJson(res, { error: "amount_required" }, 400);
      const p = {
        id: db.payments.length ? Math.max(...db.payments.map(x=>x.id))+1 : 1,
        receipt_no: genReceiptNo(db),
        booking_id: bookingId,
        amount,
        method: data.method || "Cash",
        category: data.category || "room",
        note: data.note || "",
        slip_path: saveSlip(data.slip_base64 || ""),
        cashier_name: data.cashier_name || "",
        shift_name: normalizeShiftName(data.shift_name),
        status: "active",
        created_at: nowIso()
      };
      db.payments.push(p);
      log(db, "ADD_PAYMENT", `${p.receipt_no} ${b.booking_no} ${amount} ${p.method} ${p.category}`);
      writeDb(db);
      return sendJson(res, p);
    }

    const refundPost = pathname.match(/^\/api\/bookings\/(\d+)\/refunds$/);
    if (req.method === "POST" && refundPost) {
      const db = readDb();
      db.refunds ||= [];
      const bookingId = Number(refundPost[1]);
      const b = db.bookings.find(x => x.id === bookingId);
      if (!b) return sendJson(res, { error: "booking_not_found" }, 404);
      if (isAuditClosed(db, today())) return sendJson(res, { error:"night_audit_closed_for_today" }, 409);
      const data = JSON.parse(await readBody(req));
      const amount = Number(data.amount || 0);
      if (amount <= 0) return sendJson(res, { error: "amount_required" }, 400);
      const r = {
        id: db.refunds.length ? Math.max(...db.refunds.map(x=>x.id))+1 : 1,
        refund_no: `RF${new Date().getFullYear()}-${String((db.refunds.length || 0) + 1).padStart(5,"0")}`,
        booking_id: bookingId,
        amount,
        method: data.method || "Cash",
        reason: data.reason || "",
        cashier_name: data.cashier_name || "",
        shift_name: normalizeShiftName(data.shift_name),
        status: "active",
        created_at: nowIso()
      };
      db.refunds.push(r);
      log(db, "REFUND", `${r.refund_no} ${b.booking_no} ${amount} ${r.reason}`);
      writeDb(db);
      return sendJson(res, r);
    }

    if (req.method === "POST" && pathname === "/api/cashier/close-shift") {
      const db = readDb();
      db.cashier_shifts ||= [];
      const data = JSON.parse(await readBody(req));
      const date = data.date || today();
      const shiftName = normalizeShiftName(data.shift_name);
      if (db.cashier_shifts.some(s => s.date === date && normalizeShiftName(s.shift_name) === shiftName && s.status !== "void")) return sendJson(res, { error:"shift_already_closed", date, shift_name:shiftName }, 400);
      const report = paymentReport(db, new URLSearchParams({ date, from: date, to: date, shift: shiftName }));
      const openingCash = Number(data.opening_cash || 0);
      const closingCash = Number(data.closing_cash || 0);
      const cashPayments = Number(report.by_method.Cash || 0);
      const cashRefunds = Number(report.refund_by_method.Cash || 0);
      const expectedClosingCash = openingCash + cashPayments - cashRefunds;
      const shift = {
        id: db.cashier_shifts.length ? Math.max(...db.cashier_shifts.map(x=>x.id))+1 : 1,
        date,
        shift_name: shiftName,
        cashier_name: data.cashier_name || "",
        opening_cash: openingCash,
        closing_cash: closingCash,
        expected_closing_cash: expectedClosingCash,
        cash_difference: Number((closingCash - expectedClosingCash).toFixed(2)),
        note: data.note || "",
        total: report.total,
        refund_total: report.refund_total,
        net_total: report.net_total,
        by_method: report.by_method,
        by_category: report.by_category,
        payments_count: report.payments.length,
        refunds_count: report.refunds.length,
        status: "closed",
        closed_at: nowIso()
      };
      db.cashier_shifts.push(shift);
      log(db, "CLOSE_SHIFT", `${shift.date} ${shift.shift_name} ${shift.cashier_name} net ${shift.net_total}`);
      writeDb(db);
      return sendJson(res, shift);
    }

    if (req.method === "GET" && pathname === "/api/housekeeping") {
      return sendJson(res, housekeepingData(readDb()));
    }

    if (req.method === "POST" && pathname === "/api/housekeeping/notes") {
      const db = readDb();
      db.housekeeping_notes ||= [];
      const data = JSON.parse(await readBody(req));
      if (!data.room_no) return sendJson(res, { error: "room_no_required" }, 400);
      const note = {
        id: db.housekeeping_notes.length ? Math.max(...db.housekeeping_notes.map(x=>x.id))+1 : 1,
        room_no: String(data.room_no),
        type: data.type || "note",
        detail: data.detail || "",
        priority: data.priority || "normal",
        photo_before: saveSlip(data.photo_before_base64 || ""),
        photo_after: saveSlip(data.photo_after_base64 || ""),
        status: data.status || "open",
        created_by: data.created_by || "",
        created_at: nowIso()
      };
      db.housekeeping_notes.unshift(note);
      let maintenance_ticket = null;
      if (String(note.type).toLowerCase() === "repair") {
        db.maintenance_tickets ||= [];
        const t = {
          id: db.maintenance_tickets.length ? Math.max(...db.maintenance_tickets.map(x=>x.id||0))+1 : 1,
          ticket_no: `MT${new Date().getFullYear()}-${String((db.maintenance_tickets.length||0)+1).padStart(5,"0")}`,
          work_order_no: `WO${new Date().getFullYear()}-${String((db.maintenance_tickets.length||0)+1).padStart(5,"0")}`,
          location_type:"room",
          room_no: note.room_no,
          area:"",
          title: note.detail.slice(0,80) || "แจ้งซ่อมจาก Housekeeping",
          detail: note.detail,
          priority: note.priority || "normal",
          status:"New",
          reported_by: note.created_by || "housekeeping",
          assigned_to:"",
          due_date:"",
          start_date:"",
          finished_at:"",
          solution:"",
          cost:0,
          block_sale:true,
          block_start_date: today(),
          block_end_date: today(),
          photo_before: note.photo_before,
          photo_after:"",
          source_note_id: note.id,
          created_at:nowIso(),
          updated_at:""
        };
        db.maintenance_tickets.unshift(t);
        createRoomBlock(db, { room_no:t.room_no, start_date:t.block_start_date, end_date:t.block_end_date, reason:t.title, source:"maintenance", ticket_id:t.id, created_by:t.reported_by });
        refreshRoomBlockStatuses(db);
        maintenance_ticket = t;
        log(db, "AUTO_WORK_ORDER", `${t.ticket_no} from HK note room ${t.room_no}`);
      }
      log(db, "HK_NOTE", `${note.room_no} ${note.type} ${note.detail}`);
      writeDb(db);
      return sendJson(res, { ...note, maintenance_ticket });
    }

    const hkNoteStatus = pathname.match(/^\/api\/housekeeping\/notes\/(\d+)\/status$/);
    if (req.method === "PATCH" && hkNoteStatus) {
      const db = readDb();
      const note = (db.housekeeping_notes || []).find(n => n.id === Number(hkNoteStatus[1]));
      if (!note) return sendJson(res, { error: "note_not_found" }, 404);
      const data = JSON.parse(await readBody(req));
      note.status = data.status || note.status;
      note.updated_at = nowIso();
      log(db, "HK_NOTE_STATUS", `${note.room_no} ${note.status}`);
      writeDb(db);
      return sendJson(res, note);
    }

    const roomHk = pathname.match(/^\/api\/rooms\/([^/]+)\/housekeeping$/);
    if (req.method === "PATCH" && roomHk) {
      const db = readDb();
      const r = roomObj(db, roomHk[1]);
      if (!r) return sendJson(res, { error: "room_not_found" }, 404);
      const data = JSON.parse(await readBody(req));
      r.housekeeping_status = data.housekeeping_status || r.housekeeping_status;
      if (r.housekeeping_status === "OOO" || r.housekeeping_status === "OOS") r.room_status = r.housekeeping_status;
      if (["VC","VD","OCC","Inspected"].includes(r.housekeeping_status)) r.room_status = "active";
      log(db, "ROOM_HK", `${r.room_no} -> ${r.housekeeping_status}`);
      writeDb(db);
      return sendJson(res, r);
    }

    if (req.method === "GET" && pathname === "/api/export/guest-list.csv") {
      const rows = guestRows(readDb(), url.searchParams);
      const header = ["BookingNo","Room","Status","GuestName","Phone","Arrival","Departure","Night","Agent","Nationality","Company","Voucher","PAX","Total","Paid","Balance"];
      const csv = [header.join(",")].concat(rows.map(r => [r.booking_no,r.room_no,r.status_code,r.guest_name,r.phone,r.arrival,r.departure,r.nights,r.agent,r.nationality,r.company,r.voucher_no,r.pax,r.total_amount,r.paid_amount,r.balance].map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(","))).join("\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=guest-list.csv" });
      return res.end("\ufeff" + csv);
    }

    serve(req, res, pathname);
  } catch (err) {
    console.error(err);
    sendJson(res, { error: err.message || "server_error" }, 500);
  }
};

const server = http.createServer(requestHandler);

function runDailyAutoBackupCheck() {
  try {
    const db = readDb();
    if (db.settings.auto_backup_enabled === false) return;
    const todayStamp = today();
    const hasTodayBackup = listBackups(db).some(b => b.modified_at.slice(0,10) === todayStamp && b.file.includes("auto"));
    if (!hasTodayBackup) {
      const b = autoBackup(db, "auto");
      log(db, "AUTO_BACKUP", b.file);
      writeDb(db);
    }
  } catch (e) { console.error("Auto backup check error:", e.message); }
}

function runStartupTasks() {
  try {
    const db = readDb();
    const todayStamp = today();
    const repairedRooms = syncRoomStatuses(db, todayStamp);
    if (repairedRooms) log(db, "REPAIR_ROOM_STATUS", `${todayStamp} startup changed=${repairedRooms}`);
    const hasTodayBackup = listBackups(db).some(b => b.modified_at.slice(0,10) === todayStamp && b.file.includes("auto"));
    if (db.settings.auto_backup_enabled !== false && !hasTodayBackup) {
      const b = autoBackup(db, "auto");
      log(db, "AUTO_BACKUP", b.file);
    }
    if (repairedRooms || (db.settings.auto_backup_enabled !== false && !hasTodayBackup)) writeDb(db);
  } catch (e) {
    console.error("Auto backup error:", e.message);
  }
}

function startServer() {
  runStartupTasks();
  setInterval(runDailyAutoBackupCheck, 60 * 60 * 1000);
  server.listen(PORT, HOST, () => {
    console.log("========================================");
    console.log(" Hotel Local PMS v15 is running");
    console.log(` Local only:    http://${HOST}:${PORT}`);
    const baseUrl = `http://localhost:${PORT}`;
    console.log(` Today Ops:     ${baseUrl}/public/today-operation.html`);
    console.log(` Dashboard:     ${baseUrl}/public/dashboard.html`);
    console.log(` Front Desk:    ${baseUrl}/public/front-desk.html`);
    console.log(` Front Cashier: ${baseUrl}/public/front-cashier.html`);
    console.log(` Room Plan:     ${baseUrl}/public/roomplan.html`);
    console.log(` Night Audit:   ${baseUrl}/public/night-audit.html`);
    console.log(` Setup:         ${baseUrl}/public/setup.html`);
    console.log(` Backup:        ${baseUrl}/public/backup.html`);
    console.log("========================================");
  });
}

module.exports = {
  requestHandler,
  runStartupTasks,
  runDailyAutoBackupCheck,
  startServer,
  server
};

if (require.main === module && !IS_VERCEL) {
  startServer();
}

