const APP_NAME = "Chinab Apartment Society";
const categories = ["Plumbing", "Electricity", "Lift", "Cleaning", "Security", "Parking", "Other"];
const app = document.querySelector("#app");

let state = {
  loading: true,
  error: "",
  loginError: "",
  loginRole: "resident",
  loginFlatId: "",
  loginMobile: "",
  loginPin: "",
  loggedIn: false,
  role: "resident",
  currentFlatId: "",
  activeTab: "dashboard",
  blocks: [],
  flats: [],
  payments: [],
  complaints: [],
  notices: [],
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    let parsedError = "";
    try {
      const parsed = JSON.parse(text);
      parsedError = parsed.error || "";
    } catch {
      parsedError = "";
    }
    throw new Error(parsedError || text || `Request failed: ${response.status}`);
  }

  return response.json();
}

async function loadData() {
  try {
    const data = await api("/api/bootstrap");
    state = {
      ...state,
      ...data,
      loading: false,
      currentFlatId: state.currentFlatId || data.flats[0]?.id || "",
      loginFlatId: state.loginFlatId || data.flats[0]?.id || "",
    };
  } catch {
    state = { ...state, loading: false, error: "Database server is not running. Start it with: npm start" };
  }
  render();
}

function setState(next) {
  state = { ...state, ...next };
  render();
}

function render() {
  if (state.loading) {
    app.innerHTML = `<main class="login"><section class="login-panel"><h1>${APP_NAME}</h1><p class="helper">Loading database...</p></section></main>`;
    return;
  }

  if (state.error) {
    app.innerHTML = `<main class="login"><section class="login-panel"><h1>${APP_NAME}</h1><p>${state.error}</p></section></main>`;
    return;
  }

  if (!state.loggedIn) {
    renderLogin();
    return;
  }

  const tabs = state.role === "admin"
    ? ["dashboard", "masters", "flats", "billing", "complaints", "notices", "reports"]
    : ["home", "maintenance", "complaints", "notices", "profile"];

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">CA</div>
          <div>
            <h1>${APP_NAME}</h1>
            <p>Database driven app</p>
          </div>
        </div>
        <div class="session-role">${state.role === "admin" ? "Admin" : "Resident"}</div>
        <nav class="nav">
          ${tabs.map((tab) => `
            <button class="${tab === state.activeTab ? "active" : ""}" data-tab="${tab}">
              <span>${tabIcon(tab)}</span><span>${title(tab)}</span>
            </button>
          `).join("")}
        </nav>
        <p class="helper">Records are saved in SQLite on the server.</p>
        <div class="logout"><button class="btn" data-logout="true">Logout</button></div>
      </aside>
      <main class="main">
        ${state.role === "admin" ? renderAdmin() : renderResident()}
      </main>
    </div>
  `;
  bindEvents();
}

function renderLogin() {
  app.innerHTML = `
    <main class="login">
      <section class="login-panel">
        <div class="brand">
          <div class="brand-mark">CA</div>
          <div>
            <h1>${APP_NAME}</h1>
            <p>Resident and admin maintenance portal</p>
          </div>
        </div>
        <form class="form" id="loginForm">
          <div class="field">
            <label for="role">Login as</label>
            <select id="role" name="role">
              <option value="resident" ${state.loginRole === "resident" ? "selected" : ""}>Resident</option>
              <option value="admin" ${state.loginRole === "admin" ? "selected" : ""}>Admin</option>
            </select>
          </div>
          ${state.loginRole === "admin" ? renderAdminLogin() : renderResidentLogin()}
          ${state.loginError ? `<p class="error-text">${escapeHtml(state.loginError)}</p>` : ""}
          <button class="btn primary" type="submit">${state.loginRole === "admin" ? "Continue" : "Login"}</button>
        </form>
        <p class="helper">Resident default PIN is the last 4 digits of the registered mobile. Admin username: admin, password: admin123</p>
      </section>
    </main>
  `;
  bindEvents();
}

function renderResidentLogin() {
  return `
    <div class="field">
      <label for="flatId">Flat</label>
      <select id="flatId" name="flatId">
        ${state.flats.map((flat) => `<option value="${flat.id}" ${flat.id === state.loginFlatId ? "selected" : ""}>${flat.id} - ${escapeHtml(flat.owner)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="mobile">Mobile</label>
      <input id="mobile" name="mobile" value="${escapeAttribute(state.loginMobile)}" required autocomplete="tel" />
    </div>
    <div class="field">
      <label for="pin">PIN</label>
      <input id="pin" name="pin" value="${escapeAttribute(state.loginPin)}" required inputmode="numeric" maxlength="4" placeholder="Last 4 digits of mobile" />
    </div>
  `;
}

function renderAdminLogin() {
  return `
    <div class="field"><label for="username">Username</label><input id="username" name="username" required value="admin" /></div>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required value="admin123" /></div>
  `;
}

function renderAdmin() {
  const content = {
    dashboard: renderDashboard(),
    masters: renderMasters(),
    flats: renderFlats(),
    billing: renderBilling(),
    complaints: renderAdminComplaints(),
    notices: renderAdminNotices(),
    reports: renderReports(),
  }[state.activeTab] || renderDashboard();

  return `
    <div class="topbar">
      <div><h2>${title(state.activeTab)}</h2><p>Manage society records and resident requests.</p></div>
      <button class="btn" data-refresh="true">Refresh</button>
    </div>
    ${content}
  `;
}

function renderResident() {
  const flat = currentFlat();
  const content = {
    home: renderResidentHome(flat),
    maintenance: renderResidentMaintenance(flat),
    complaints: renderResidentComplaints(flat),
    notices: renderNoticesList(),
    profile: renderProfile(flat),
  }[state.activeTab] || renderResidentHome(flat);

  return `
    <div class="topbar">
      <div><h2>${title(state.activeTab)}</h2><p>${flat.id || ""} ${flat.owner ? `- ${escapeHtml(flat.owner)}` : ""}</p></div>
      <span class="locked-flat">${flat.id || "No flat"}</span>
    </div>
    ${content}
  `;
}

function renderDashboard() {
  const paid = state.flats.filter((flat) => flat.status === "Paid").length;
  const pending = state.flats.filter((flat) => flat.pending > 0);
  return `
    <section class="grid four">
      ${metric("Total Flats", state.flats.length, "Database records")}
      ${metric("Paid Flats", paid, "Current status")}
      ${metric("Pending Dues", currency(pending.reduce((sum, flat) => sum + flat.pending, 0)), `${pending.length} flats`)}
      ${metric("Open Complaints", state.complaints.filter((item) => item.status !== "Resolved").length, "Needs action")}
    </section>
    <div class="grid two" style="margin-top:16px">
      <div class="card"><div class="section-title"><h3>Recent Complaints</h3></div><div class="list">${state.complaints.slice(0, 5).map((item) => row(`${item.flatId} - ${item.category}`, item.text, item.status)).join("") || empty("No complaints")}</div></div>
      <div class="card"><div class="section-title"><h3>Notices</h3></div><div class="list">${renderNoticesRows() || empty("No notices")}</div></div>
    </div>
  `;
}

function renderMasters() {
  return `
    <section class="grid two">
      <div class="card">
        <div class="section-title"><h3>Add Block</h3></div>
        <form class="form" id="blockForm">
          <div class="field"><label>Code</label><input name="code" required placeholder="A" /></div>
          <div class="field"><label>Name</label><input name="name" required placeholder="Block A" /></div>
          <button class="btn primary" type="submit">Create Block</button>
        </form>
      </div>
      <div class="card">
        <div class="section-title"><h3>Blocks</h3></div>
        <div class="list">${state.blocks.map((block) => row(block.code, block.name, block.date)).join("") || empty("No blocks")}</div>
      </div>
    </section>
  `;
}

function renderFlats() {
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="section-title"><h3>Add Flat</h3></div>
      <form class="form" id="flatForm">
        <div class="grid four">
          <div class="field"><label>Flat ID</label><input name="id" required placeholder="A-0101" /></div>
          <div class="field"><label>Block</label><input name="tower" required placeholder="A" /></div>
          <div class="field"><label>Owner</label><input name="owner" required /></div>
          <div class="field"><label>Mobile</label><input name="mobile" required /></div>
        </div>
        <div class="grid four">
          <div class="field"><label>Tenant</label><input name="tenant" /></div>
          <div class="field"><label>Monthly Amount</label><input name="amount" type="number" required value="2500" /></div>
          <div class="field"><label>Pending</label><input name="pending" type="number" value="2500" /></div>
          <label class="field"><span>Occupied</span><input name="occupied" type="checkbox" checked /></label>
        </div>
        <button class="btn primary" type="submit">Create Flat</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Flat</th><th>Block</th><th>Owner</th><th>Tenant</th><th>Mobile</th><th>Monthly</th><th>Pending</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${state.flats.slice(0, 120).map((flat) => `
            <tr>
              <td>${flat.id}</td><td>${flat.tower}</td><td>${escapeHtml(flat.owner)}</td><td>${escapeHtml(flat.tenant || "-")}</td>
              <td>${escapeHtml(flat.mobile)}</td><td>${currency(flat.amount)}</td><td>${currency(flat.pending)}</td>
              <td><span class="pill ${statusClass(flat.status)}">${flat.status}</span></td>
              <td><button class="btn" data-mark-paid="${flat.id}">Paid</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <p class="helper">Showing first 120 flats. Total records: ${state.flats.length}</p>
  `;
}

function renderBilling() {
  const pending = state.flats.filter((flat) => flat.pending > 0);
  return `
    <section class="grid three">
      ${metric("Defaulters", pending.length, "Current month")}
      ${metric("Pending Amount", currency(pending.reduce((sum, flat) => sum + flat.pending, 0)), "Manual follow-up")}
      ${metric("Bill Amount", currency(state.flats.reduce((sum, flat) => sum + flat.amount, 0)), "Full monthly demand")}
    </section>
  `;
}

function renderAdminComplaints() {
  return `
    <div class="card">
      <div class="section-title"><h3>Complaint Queue</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Flat</th><th>Category</th><th>Description</th><th>Assigned</th><th>Status</th></tr></thead>
          <tbody>
            ${state.complaints.map((item) => `
              <tr>
                <td>${item.flatId}</td><td>${item.category}</td><td>${escapeHtml(item.text)}</td><td>${item.assigned}</td>
                <td><select class="btn" data-complaint-status="${item.id}">${["Open", "In Progress", "Resolved"].map((status) => `<option ${item.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAdminNotices() {
  return `
    <section class="grid two">
      <div class="card">
        <div class="section-title"><h3>Create Notice</h3></div>
        <form class="form" id="noticeForm">
          <div class="field"><label>Title</label><input name="title" required /></div>
          <div class="field"><label>Audience</label><input name="audience" required value="All residents" /></div>
          <div class="field"><label>Message</label><textarea name="body" required></textarea></div>
          <label><input type="checkbox" name="urgent" /> Mark urgent</label>
          <button class="btn primary" type="submit">Publish Notice</button>
        </form>
      </div>
      <div class="card"><div class="section-title"><h3>Published Notices</h3></div><div class="list">${renderNoticesRows() || empty("No notices")}</div></div>
    </section>
  `;
}

function renderReports() {
  const paid = state.flats.filter((flat) => flat.status === "Paid");
  const pending = state.flats.filter((flat) => flat.status === "Pending");
  return `
    <section class="grid three">
      ${metric("Collection Rate", `${state.flats.length ? Math.round((paid.length / state.flats.length) * 100) : 0}%`, `${paid.length} of ${state.flats.length} flats`)}
      ${metric("Pending Dues", currency(pending.reduce((sum, flat) => sum + flat.pending, 0)), `${pending.length} flats`)}
      ${metric("Resolved Complaints", state.complaints.filter((item) => item.status === "Resolved").length, `${state.complaints.length} total complaints`)}
    </section>
  `;
}

function renderResidentHome(flat) {
  return `
    <section class="grid three">
      ${metric("Maintenance", currency(flat.amount || 0), "Monthly bill")}
      ${metric("Pending", currency(flat.pending || 0), flat.status || "Status")}
      ${metric("Complaints", state.complaints.filter((item) => item.flatId === flat.id).length, "Your requests")}
    </section>
  `;
}

function renderResidentMaintenance(flat) {
  const payments = state.payments.filter((item) => item.flatId === flat.id);
  return `<div class="card"><div class="section-title"><h3>Payment History</h3></div><div class="list">${payments.map((item) => row(item.month, `${currency(item.amount)} - ${item.date}`, item.status)).join("") || empty("No payments")}</div></div>`;
}

function renderResidentComplaints(flat) {
  return `
    <section class="grid two">
      <div class="card">
        <div class="section-title"><h3>New Complaint</h3></div>
        <form class="form" id="complaintForm">
          <input type="hidden" name="flatId" value="${flat.id}" />
          <div class="field"><label>Category</label><select name="category">${categories.map((item) => `<option>${item}</option>`).join("")}</select></div>
          <div class="field"><label>Details</label><textarea name="text" required></textarea></div>
          <button class="btn primary" type="submit">Submit Complaint</button>
        </form>
      </div>
      <div class="card"><div class="section-title"><h3>Your Complaints</h3></div><div class="list">${state.complaints.filter((item) => item.flatId === flat.id).map((item) => row(item.category, item.text, item.status)).join("") || empty("No complaints")}</div></div>
    </section>
  `;
}

function renderNoticesList() {
  return `<div class="card"><div class="section-title"><h3>Society Notices</h3></div><div class="list">${renderNoticesRows() || empty("No notices")}</div></div>`;
}

function renderProfile(flat) {
  return `<div class="card"><div class="section-title"><h3>Profile</h3></div><div class="list">${row("Owner", flat.owner || "-", flat.id || "-")}${row("Mobile", flat.mobile || "-", flat.occupied ? "Occupied" : "Vacant")}</div></div>`;
}

function bindEvents() {
  document.querySelector("#role")?.addEventListener("change", (event) => setState({ loginRole: event.target.value, loginError: "" }));
  document.querySelector("#flatId")?.addEventListener("change", (event) => setState({ loginFlatId: event.target.value, loginError: "" }));
  document.querySelector("#mobile")?.addEventListener("input", (event) => {
    state = { ...state, loginMobile: event.target.value, loginError: "" };
  });
  document.querySelector("#pin")?.addEventListener("input", (event) => {
    state = { ...state, loginPin: event.target.value.replace(/\D/g, "").slice(0, 4), loginError: "" };
    event.target.value = state.loginPin;
  });
  document.querySelector("[data-refresh]")?.addEventListener("click", loadData);
  document.querySelector("[data-logout]")?.addEventListener("click", () => setState({ loggedIn: false }));
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setState({ activeTab: button.dataset.tab })));

  document.querySelector("#loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const loginFlatId = data.get("flatId");
    const loginMobile = data.get("mobile");
    const loginPin = data.get("pin");
    try {
      if (data.get("role") === "admin") {
        await api("/api/login", { method: "POST", body: JSON.stringify({ role: "admin", username: data.get("username"), password: data.get("password") }) });
        setState({ loggedIn: true, role: "admin", activeTab: "dashboard", loginError: "" });
        return;
      }

      const result = await api("/api/login", { method: "POST", body: JSON.stringify({ role: "resident", flatId: loginFlatId, mobile: loginMobile, pin: loginPin }) });
      setState({ loggedIn: true, role: "resident", activeTab: "home", currentFlatId: result.flatId, loginFlatId, loginMobile, loginPin, loginError: "" });
    } catch (error) {
      setState({ loginFlatId, loginMobile, loginPin, loginError: error.message });
    }
  });

  bindForm("#blockForm", "/api/blocks", (data) => ({ code: data.get("code"), name: data.get("name") }));
  bindForm("#flatForm", "/api/flats", (data) => ({
    id: data.get("id"),
    tower: data.get("tower"),
    owner: data.get("owner"),
    tenant: data.get("tenant"),
    mobile: data.get("mobile"),
    amount: Number(data.get("amount")),
    pending: Number(data.get("pending") || data.get("amount")),
    occupied: data.get("occupied") === "on",
  }));
  bindForm("#complaintForm", "/api/complaints", (data) => ({ flatId: data.get("flatId"), category: data.get("category"), text: data.get("text") }));
  bindForm("#noticeForm", "/api/notices", (data) => ({ title: data.get("title"), body: data.get("body"), audience: data.get("audience"), urgent: data.get("urgent") === "on" }));

  document.querySelectorAll("[data-mark-paid]").forEach((button) => {
    button.addEventListener("click", async () => update(`/api/flats/${encodeURIComponent(button.dataset.markPaid)}/mark-paid`, "POST"));
  });
  document.querySelectorAll("[data-complaint-status]").forEach((select) => {
    select.addEventListener("change", async () => update(`/api/complaints/${select.dataset.complaintStatus}`, "PATCH", { status: select.value }));
  });
}

function bindForm(selector, path, mapper) {
  document.querySelector(selector)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = mapper(new FormData(event.currentTarget));
    await update(path, "POST", payload);
    event.currentTarget.reset();
  });
}

async function update(path, method, body = {}) {
  try {
    const data = await api(path, { method, body: JSON.stringify(body) });
    setState({ ...data, loginError: "" });
  } catch (error) {
    setState({ loginError: error.message });
  }
}

function currentFlat() {
  return state.flats.find((flat) => flat.id === state.currentFlatId) || state.flats[0] || {};
}

function renderNoticesRows() {
  return state.notices.map((item) => row(item.title, `${item.body} - ${item.audience} - ${item.date}`, item.urgent ? "Urgent" : "Info")).join("");
}

function metric(label, value, note) {
  return `<div class="card metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
}

function row(titleText, detail, badge) {
  return `<div class="row"><div><h4>${escapeHtml(titleText)}</h4><p>${escapeHtml(detail)}</p></div><span class="pill ${statusClass(badge)}">${escapeHtml(badge)}</span></div>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function currency(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN")}`;
}

function title(tab) {
  return tab.replace(/\b\w/g, (char) => char.toUpperCase());
}

function tabIcon(tab) {
  return ({ dashboard: "D", masters: "M", flats: "F", billing: "Rs", complaints: "!", notices: "i", reports: "R", home: "H", maintenance: "Rs", profile: "P" })[tab] || "?";
}

function statusClass(status) {
  return String(status || "").toLowerCase().replace("in ", "").replaceAll(" ", "-");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

loadData();
