import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Add your Supabase/PostgreSQL connection string before starting the app.");
}

const db = new Pool({
  connectionString: databaseUrl,
  ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
});

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

await initDatabase();

if (process.env.SEED_DEMO === "true") {
  await seedDatabase();
  await seedBlocksFromFlats();
}
await seedAdminUser();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: publicErrorMessage(error) });
  }
});

server.listen(port, () => {
  console.log(`Chinab Apartment Society app running at http://localhost:${port}`);
  console.log("Database: PostgreSQL");
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, app: "Chinab Apartment Society" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, await bootstrapPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req);
    required(body, ["role"]);

    if (body.role === "admin") {
      required(body, ["username", "password"]);
      const admin = await one(
        "SELECT username, name FROM admin_users WHERE username = $1 AND password = $2",
        [String(body.username).trim().toLowerCase(), String(body.password)],
      );

      if (!admin) {
        sendJson(res, 401, { error: "Invalid admin username or password" });
        return;
      }

      sendJson(res, 200, { ok: true, role: "admin", admin });
      return;
    }

    if (body.role === "resident") {
      required(body, ["flatId", "mobile", "pin"]);
      const flat = await one(
        "SELECT id, owner, mobile FROM flats WHERE id = $1",
        [String(body.flatId).trim().toUpperCase()],
      );

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
    await run(
      `
        INSERT INTO complaints (flat_id, category, text, status, assigned, created_date)
        VALUES ($1, $2, $3, 'Open', 'Maintenance Team', $4)
      `,
      [String(body.flatId).trim().toUpperCase(), String(body.category), String(body.text), displayDate()],
    );
    sendJson(res, 201, await bootstrapPayload());
    return;
  }

  const complaintStatusMatch = url.pathname.match(/^\/api\/complaints\/(\d+)$/);
  if (req.method === "PATCH" && complaintStatusMatch) {
    const body = await readJson(req);
    required(body, ["status"]);
    await run("UPDATE complaints SET status = $1 WHERE id = $2", [String(body.status), Number(complaintStatusMatch[1])]);
    sendJson(res, 200, await bootstrapPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notices") {
    const body = await readJson(req);
    required(body, ["title", "body", "audience"]);
    await run(
      `
        INSERT INTO notices (title, body, audience, urgent, created_date)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [String(body.title), String(body.body), String(body.audience), Boolean(body.urgent), displayDate()],
    );
    sendJson(res, 201, await bootstrapPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/blocks") {
    const body = await readJson(req);
    required(body, ["code", "name"]);
    await run(
      "INSERT INTO blocks (code, name, created_date) VALUES ($1, $2, $3)",
      [String(body.code).trim().toUpperCase(), String(body.name).trim(), displayDate()],
    );
    sendJson(res, 201, await bootstrapPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/flats") {
    const body = await readJson(req);
    required(body, ["id", "tower", "owner", "mobile", "amount"]);
    const amount = Number(body.amount);
    const pending = Number(body.pending ?? amount);
    await run(
      `
        INSERT INTO flats (id, tower, owner, tenant, mobile, amount, pending, status, occupied)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        String(body.id).trim().toUpperCase(),
        String(body.tower).trim().toUpperCase(),
        String(body.owner).trim(),
        String(body.tenant || "").trim(),
        String(body.mobile).trim(),
        amount,
        pending,
        pending > 0 ? "Pending" : "Paid",
        body.occupied === false ? false : true,
      ],
    );
    sendJson(res, 201, await bootstrapPayload());
    return;
  }

  const flatMatch = url.pathname.match(/^\/api\/flats\/([^/]+)$/);
  if (req.method === "PATCH" && flatMatch) {
    const body = await readJson(req);
    required(body, ["tower", "owner", "mobile", "amount", "pending"]);
    const flatId = decodeURIComponent(flatMatch[1]).trim().toUpperCase();
    const pending = Number(body.pending);
    await run(
      `
        UPDATE flats
        SET tower = $1, owner = $2, tenant = $3, mobile = $4, amount = $5,
            pending = $6, status = $7, occupied = $8
        WHERE id = $9
      `,
      [
        String(body.tower).trim().toUpperCase(),
        String(body.owner).trim(),
        String(body.tenant || "").trim(),
        String(body.mobile).trim(),
        Number(body.amount),
        pending,
        pending > 0 ? "Pending" : "Paid",
        Boolean(body.occupied),
        flatId,
      ],
    );
    sendJson(res, 200, await bootstrapPayload());
    return;
  }

  const markPaidMatch = url.pathname.match(/^\/api\/flats\/([^/]+)\/mark-paid$/);
  if (req.method === "POST" && markPaidMatch) {
    const flatId = decodeURIComponent(markPaidMatch[1]).trim().toUpperCase();
    const flat = await one("SELECT id, amount FROM flats WHERE id = $1", [flatId]);
    if (!flat) {
      sendJson(res, 404, { error: "Flat not found" });
      return;
    }

    await transaction(async (client) => {
      await client.query("UPDATE flats SET pending = 0, status = 'Paid' WHERE id = $1", [flatId]);
      await client.query(
        "INSERT INTO payments (flat_id, month, amount, status, paid_date) VALUES ($1, $2, $3, 'Paid', $4)",
        [flatId, currentMonth(), flat.amount, displayDate()],
      );
    });

    sendJson(res, 200, await bootstrapPayload());
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function initDatabase() {
  await run(`
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
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      flat_id TEXT NOT NULL,
      mobile TEXT NOT NULL,
      otp TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT false,
      created_at BIGINT NOT NULL
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
      occupied BOOLEAN NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      flat_id TEXT NOT NULL REFERENCES flats(id),
      month TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      paid_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      flat_id TEXT NOT NULL REFERENCES flats(id),
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL,
      assigned TEXT NOT NULL,
      created_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      audience TEXT NOT NULL,
      urgent BOOLEAN NOT NULL,
      created_date TEXT NOT NULL
    );
  `);
}

async function bootstrapPayload() {
  const [blocks, flats, payments, complaints, notices] = await Promise.all([
    all("SELECT code, name, created_date FROM blocks ORDER BY code"),
    all("SELECT id, tower, owner, tenant, mobile, amount, pending, status, occupied FROM flats ORDER BY id"),
    all("SELECT id, flat_id, month, amount, status, paid_date FROM payments ORDER BY id DESC"),
    all("SELECT id, flat_id, category, text, status, assigned, created_date FROM complaints ORDER BY id DESC"),
    all("SELECT id, title, body, audience, urgent, created_date FROM notices ORDER BY id DESC"),
  ]);

  return {
    blocks: blocks.map(mapBlock),
    flats: flats.map(mapFlat),
    payments: payments.map(mapPayment),
    complaints: complaints.map(mapComplaint),
    notices: notices.map(mapNotice),
  };
}

async function seedDatabase() {
  const row = await one("SELECT COUNT(*)::int AS count FROM flats");
  if (row.count > 0) return;

  await transaction(async (client) => {
    const towers = ["A", "B", "C", "D", "E"];
    for (let index = 0; index < 850; index += 1) {
      const tower = towers[index % towers.length];
      const floor = String(Math.floor(index / towers.length / 4) + 1).padStart(2, "0");
      const unit = String((index % 4) + 1).padStart(2, "0");
      const flatNo = `${tower}-${floor}${unit}`;
      const paid = index % 5 !== 0;
      const amount = 2500 + (index % 4) * 250;
      await client.query(
        `
          INSERT INTO flats (id, tower, owner, tenant, mobile, amount, pending, status, occupied)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
        `,
        [flatNo, tower, `Resident ${index + 1}`, "", `98765${String(10000 + index).slice(-5)}`, amount, paid ? 0 : amount, paid ? "Paid" : "Pending"],
      );
    }

    await client.query(
      "INSERT INTO payments (flat_id, month, amount, status, paid_date) VALUES ($1, $2, $3, $4, $5)",
      ["A-0101", "May 2026", 2500, "Pending", "Due 10 Jun 2026"],
    );
    await client.query(
      "INSERT INTO complaints (flat_id, category, text, status, assigned, created_date) VALUES ($1, $2, $3, $4, $5, $6)",
      ["A-0101", "Lift", "Lift light flickering near tower A lobby.", "In Progress", "Maintenance Team", "26 May 2026"],
    );
    await client.query(
      "INSERT INTO notices (title, body, audience, urgent, created_date) VALUES ($1, $2, $3, true, $4)",
      ["Water tank cleaning", "Water supply will be unavailable from 10 AM to 1 PM on Sunday.", "All residents", "27 May 2026"],
    );
  });
}

async function seedBlocksFromFlats() {
  const row = await one("SELECT COUNT(*)::int AS count FROM blocks");
  if (row.count > 0) return;

  const towers = await all("SELECT DISTINCT tower FROM flats ORDER BY tower");
  await transaction(async (client) => {
    for (const tower of towers) {
      await client.query(
        "INSERT INTO blocks (code, name, created_date) VALUES ($1, $2, $3)",
        [tower.tower, `Block ${tower.tower}`, displayDate()],
      );
    }
  });
}

async function seedAdminUser() {
  await run(
    `
      INSERT INTO admin_users (username, password, name, created_date)
      VALUES ('admin', 'admin123', 'Society Admin', $1)
      ON CONFLICT (username) DO NOTHING
    `,
    [displayDate()],
  );
}

async function all(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

async function one(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

async function run(sql, params = []) {
  await db.query(sql, params);
}

async function transaction(callback) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await callback(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

function publicErrorMessage(error) {
  if (error.code === "23505") {
    if (String(error.constraint || "").includes("flats")) return "Flat ID already exists. Use a different flat number.";
    if (String(error.constraint || "").includes("blocks")) return "Block code already exists. Use a different block code.";
    return "This record already exists.";
  }

  if (error.code === "23503") return "Related record was not found. Check the flat or block details.";
  return error.message || "Server error";
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

function shouldUseSsl(url) {
  if (process.env.PGSSLMODE === "disable") return false;
  if (process.env.PGSSLMODE === "require") return true;
  return /supabase|render|neon|railway|aiven/i.test(url);
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
