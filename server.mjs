import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(__dirname, "data");
const dbPath = join(dataDir, "chinab-society.db");
const port = Number(process.env.PORT || 4173);

mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otp_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flat_id TEXT NOT NULL,
    mobile TEXT NOT NULL,
    otp TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS flats (
    id TEXT PRIMARY KEY,
    tower TEXT NOT NULL,
    owner TEXT NOT NULL,
    tenant TEXT NOT NULL DEFAULT '',
    mobile TEXT NOT NULL,
    amount INTEGER NOT NULL,
    pending INTEGER NOT NULL,
    status TEXT NOT NULL,
    occupied INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flat_id TEXT NOT NULL,
    month TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    paid_date TEXT NOT NULL,
    FOREIGN KEY (flat_id) REFERENCES flats(id)
  );

  CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flat_id TEXT NOT NULL,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned TEXT NOT NULL,
    created_date TEXT NOT NULL,
    FOREIGN KEY (flat_id) REFERENCES flats(id)
  );

  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    audience TEXT NOT NULL,
    urgent INTEGER NOT NULL,
    created_date TEXT NOT NULL
  );
`);

if (process.env.SEED_DEMO === "true") {
  seedDatabase();
  seedBlocksFromFlats();
}
seedAdminUser();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`Chinab Apartment Society app running at http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, app: "Chinab Apartment Society" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, bootstrapPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req);
    required(body, ["role"]);

    if (body.role === "admin") {
      required(body, ["username", "password"]);
      const admin = db.prepare("SELECT username, name FROM admin_users WHERE username = ? AND password = ?")
        .get(String(body.username).trim().toLowerCase(), String(body.password));
      if (!admin) {
        sendJson(res, 401, { error: "Invalid admin username or password" });
        return;
      }
      sendJson(res, 200, { ok: true, role: "admin", admin });
      return;
    }

    if (body.role === "resident") {
      required(body, ["flatId", "mobile", "pin"]);
      const flat = db.prepare("SELECT id, owner, mobile FROM flats WHERE id = ?").get(String(body.flatId).trim().toUpperCase());
      if (!flat || normalizeMobile(flat.mobile) !== normalizeMobile(body.mobile)) {
        sendJson(res, 401, { error: "Flat number or mobile number is incorrect" });
        return;
      }
      if (String(body.pin).trim() !== residentDefaultPin(flat.mobile)) {
        sendJson(res, 401, { error: "Invalid PIN. Default PIN is the last 4 digits of the registered mobile number." });
        return;
      }
      sendJson(res, 200, { ok: true, role: "resident", flatId: flat.id, owner: flat.owner });
      return;
    }

    sendJson(res, 400, { error: "Invalid login role" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/complaints") {
    const body = await readJson(req);
    required(body, ["flatId", "category", "text"]);
    db.prepare(`
      INSERT INTO complaints (flat_id, category, text, status, assigned, created_date)
      VALUES (?, ?, ?, 'Open', 'Maintenance Team', ?)
    `).run(String(body.flatId).trim().toUpperCase(), String(body.category), String(body.text), displayDate());
    sendJson(res, 201, bootstrapPayload());
    return;
  }

  const complaintStatusMatch = url.pathname.match(/^\/api\/complaints\/(\d+)$/);
  if (req.method === "PATCH" && complaintStatusMatch) {
    const body = await readJson(req);
    required(body, ["status"]);
    db.prepare("UPDATE complaints SET status = ? WHERE id = ?").run(String(body.status), Number(complaintStatusMatch[1]));
    sendJson(res, 200, bootstrapPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notices") {
    const body = await readJson(req);
    required(body, ["title", "body", "audience"]);
    db.prepare(`
      INSERT INTO notices (title, body, audience, urgent, created_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(body.title), String(body.body), String(body.audience), body.urgent ? 1 : 0, displayDate());
    sendJson(res, 201, bootstrapPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/blocks") {
    const body = await readJson(req);
    required(body, ["code", "name"]);
    db.prepare("INSERT INTO blocks (code, name, created_date) VALUES (?, ?, ?)")
      .run(String(body.code).trim().toUpperCase(), String(body.name).trim(), displayDate());
    sendJson(res, 201, bootstrapPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/flats") {
    const body = await readJson(req);
    required(body, ["id", "tower", "owner", "mobile", "amount"]);
    const amount = Number(body.amount);
    const pending = Number(body.pending ?? amount);
    db.prepare(`
      INSERT INTO flats (id, tower, owner, tenant, mobile, amount, pending, status, occupied)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(body.id).trim().toUpperCase(),
      String(body.tower).trim().toUpperCase(),
      String(body.owner).trim(),
      String(body.tenant || "").trim(),
      String(body.mobile).trim(),
      amount,
      pending,
      pending > 0 ? "Pending" : "Paid",
      body.occupied === false ? 0 : 1,
    );
    sendJson(res, 201, bootstrapPayload());
    return;
  }

  const flatMatch = url.pathname.match(/^\/api\/flats\/([^/]+)$/);
  if (req.method === "PATCH" && flatMatch) {
    const body = await readJson(req);
    required(body, ["tower", "owner", "mobile", "amount", "pending"]);
    const flatId = decodeURIComponent(flatMatch[1]).trim().toUpperCase();
    const pending = Number(body.pending);
    db.prepare(`
      UPDATE flats
      SET tower = ?, owner = ?, tenant = ?, mobile = ?, amount = ?, pending = ?, status = ?, occupied = ?
      WHERE id = ?
    `).run(
      String(body.tower).trim().toUpperCase(),
      String(body.owner).trim(),
      String(body.tenant || "").trim(),
      String(body.mobile).trim(),
      Number(body.amount),
      pending,
      pending > 0 ? "Pending" : "Paid",
      body.occupied ? 1 : 0,
      flatId,
    );
    sendJson(res, 200, bootstrapPayload());
    return;
  }

  const markPaidMatch = url.pathname.match(/^\/api\/flats\/([^/]+)\/mark-paid$/);
  if (req.method === "POST" && markPaidMatch) {
    const flatId = decodeURIComponent(markPaidMatch[1]).trim().toUpperCase();
    const flat = db.prepare("SELECT id, amount FROM flats WHERE id = ?").get(flatId);
    if (!flat) {
      sendJson(res, 404, { error: "Flat not found" });
      return;
    }
    db.prepare("UPDATE flats SET pending = 0, status = 'Paid' WHERE id = ?").run(flatId);
    db.prepare("INSERT INTO payments (flat_id, month, amount, status, paid_date) VALUES (?, ?, ?, 'Paid', ?)")
      .run(flatId, currentMonth(), flat.amount, displayDate());
    sendJson(res, 200, bootstrapPayload());
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function bootstrapPayload() {
  return {
    blocks: db.prepare("SELECT code, name, created_date FROM blocks ORDER BY code").all().map(mapBlock),
    flats: db.prepare("SELECT id, tower, owner, tenant, mobile, amount, pending, status, occupied FROM flats ORDER BY id").all().map(mapFlat),
    payments: db.prepare("SELECT id, flat_id, month, amount, status, paid_date FROM payments ORDER BY id DESC").all().map(mapPayment),
    complaints: db.prepare("SELECT id, flat_id, category, text, status, assigned, created_date FROM complaints ORDER BY id DESC").all().map(mapComplaint),
    notices: db.prepare("SELECT id, title, body, audience, urgent, created_date FROM notices ORDER BY id DESC").all().map(mapNotice),
  };
}

function seedDatabase() {
  const flatCount = db.prepare("SELECT COUNT(*) AS count FROM flats").get().count;
  if (flatCount > 0) return;

  const insertFlat = db.prepare(`
    INSERT INTO flats (id, tower, owner, tenant, mobile, amount, pending, status, occupied)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPayment = db.prepare("INSERT INTO payments (flat_id, month, amount, status, paid_date) VALUES (?, ?, ?, ?, ?)");
  const insertComplaint = db.prepare("INSERT INTO complaints (flat_id, category, text, status, assigned, created_date) VALUES (?, ?, ?, ?, ?, ?)");
  const insertNotice = db.prepare("INSERT INTO notices (title, body, audience, urgent, created_date) VALUES (?, ?, ?, ?, ?)");

  db.exec("BEGIN");
  try {
    const towers = ["A", "B", "C", "D", "E"];
    for (let index = 0; index < 850; index += 1) {
      const tower = towers[index % towers.length];
      const floor = String(Math.floor(index / towers.length / 4) + 1).padStart(2, "0");
      const unit = String((index % 4) + 1).padStart(2, "0");
      const flatNo = `${tower}-${floor}${unit}`;
      const paid = index % 5 !== 0;
      const amount = 2500 + (index % 4) * 250;
      insertFlat.run(flatNo, tower, `Resident ${index + 1}`, "", `98765${String(10000 + index).slice(-5)}`, amount, paid ? 0 : amount, paid ? "Paid" : "Pending", 1);
    }

    insertPayment.run("A-0101", "May 2026", 2500, "Pending", "Due 10 Jun 2026");
    insertComplaint.run("A-0101", "Lift", "Lift light flickering near tower A lobby.", "In Progress", "Maintenance Team", "26 May 2026");
    insertNotice.run("Water tank cleaning", "Water supply will be unavailable from 10 AM to 1 PM on Sunday.", "All residents", 1, "27 May 2026");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function seedBlocksFromFlats() {
  const blockCount = db.prepare("SELECT COUNT(*) AS count FROM blocks").get().count;
  if (blockCount > 0) return;
  const towers = db.prepare("SELECT DISTINCT tower FROM flats ORDER BY tower").all();
  const insertBlock = db.prepare("INSERT INTO blocks (code, name, created_date) VALUES (?, ?, ?)");
  for (const tower of towers) insertBlock.run(tower.tower, `Block ${tower.tower}`, displayDate());
}

function seedAdminUser() {
  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM admin_users").get().count;
  if (adminCount > 0) return;
  db.prepare("INSERT INTO admin_users (username, password, name, created_date) VALUES (?, ?, ?, ?)")
    .run("admin", "admin123", "Society Admin", displayDate());
}

function serveStatic(res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(join(__dirname, cleanPath));
  if (!filePath.startsWith(resolve(__dirname))) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(filePath));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolveBody(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function required(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      throw new Error(`Missing field: ${field}`);
    }
  }
}

function displayDate() {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());
}

function currentMonth() {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date());
}

function normalizeMobile(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function residentDefaultPin(mobile) {
  return normalizeMobile(mobile).slice(-4);
}

function mapFlat(row) {
  return {
    id: row.id,
    tower: row.tower,
    owner: row.owner,
    tenant: row.tenant,
    mobile: row.mobile,
    amount: row.amount,
    pending: row.pending,
    status: row.status,
    occupied: Boolean(row.occupied),
  };
}

function mapBlock(row) {
  return { code: row.code, name: row.name, date: row.created_date };
}

function mapPayment(row) {
  return { id: row.id, flatId: row.flat_id, month: row.month, amount: row.amount, status: row.status, date: row.paid_date };
}

function mapComplaint(row) {
  return { id: row.id, flatId: row.flat_id, category: row.category, text: row.text, status: row.status, assigned: row.assigned, date: row.created_date };
}

function mapNotice(row) {
  return { id: row.id, title: row.title, body: row.body, audience: row.audience, urgent: Boolean(row.urgent), date: row.created_date };
}
