const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const {
  openDb,
  ensureSchema,
  seedIfEmpty,
  run,
  get,
  all,
  nowIso,
  newId
} = require("./db");

const PORT = process.env.PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const TURNITO_BASE_URL =
  process.env.TURNITO_BASE_URL || "https://turnito.app/c/helpcenter";

const app = express();
app.use(cors());
app.use(express.json());

let db;

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "missing_token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

function parseJsonList(value) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function buildTurnitoUrl({
  patientId,
  treatmentActiveId,
  serviceKey,
  professionalId,
  type
}) {
  const params = new URLSearchParams({
    patient_id: patientId,
    treatment_active_id: treatmentActiveId || "",
    service_key: serviceKey,
    professional_id: professionalId || "",
    type: type || "session"
  });
  return `${TURNITO_BASE_URL}?${params.toString()}`;
}

async function getPatientByPhone(phone) {
  return get(db, "SELECT * FROM Patient WHERE phone = ?", [phone]);
}

async function getPatientById(id) {
  return get(db, "SELECT * FROM Patient WHERE id = ?", [id]);
}

async function getServiceByKey(serviceKey) {
  return get(db, "SELECT * FROM ServiceCatalog WHERE service_key = ?", [
    serviceKey
  ]);
}

async function getProfessionalsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return all(
    db,
    `SELECT * FROM Professional WHERE id IN (${placeholders})`,
    ids
  );
}

async function getLastCompletedAt(treatmentActiveId) {
  const row = await get(
    db,
    `
    SELECT completed_at FROM SessionLedger
    WHERE treatment_active_id = ? AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 1
  `,
    [treatmentActiveId]
  );
  return row ? row.completed_at : null;
}

function addDays(dateIso, days) {
  const date = new Date(dateIso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function addHours(dateIso, hours) {
  const date = new Date(dateIso);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

async function getLedgerByBookingId(bookingId) {
  return get(
    db,
    "SELECT * FROM SessionLedger WHERE turnito_booking_id = ?",
    [bookingId]
  );
}

async function updateTreatmentRemaining(treatmentId, delta) {
  const treatment = await get(
    db,
    "SELECT * FROM TreatmentActive WHERE id = ?",
    [treatmentId]
  );
  if (!treatment) return null;
  const nextRemaining = Math.max(0, treatment.sessions_remaining + delta);
  const nextStatus = nextRemaining === 0 ? "finished" : treatment.status;
  await run(
    db,
    `UPDATE TreatmentActive SET sessions_remaining = ?, status = ? WHERE id = ?`,
    [nextRemaining, nextStatus, treatmentId]
  );
  return { ...treatment, sessions_remaining: nextRemaining, status: nextStatus };
}

async function recordNoShow(patientId) {
  const patient = await getPatientById(patientId);
  if (!patient) return null;
  const nextCount = (patient.no_show_count || 0) + 1;
  const status = nextCount >= 2 ? "blocked" : patient.status;
  await run(
    db,
    `UPDATE Patient SET no_show_count = ?, status = ? WHERE id = ?`,
    [nextCount, status, patientId]
  );
  return { ...patient, no_show_count: nextCount, status };
}

function isLateCancellation(service, scheduledAt, cancelledAt) {
  if (!service || !scheduledAt) return false;
  const scheduled = new Date(scheduledAt).getTime();
  const cancelled = new Date(cancelledAt || nowIso()).getTime();
  const hoursDiff = (scheduled - cancelled) / (1000 * 60 * 60);
  if (service.category === "depilacion") {
    return hoursDiff < 12;
  }
  if (service.category === "medica" || service.requires_eval) {
    return hoursDiff < 24;
  }
  return false;
}

async function upsertLedger({
  treatmentActiveId,
  bookingId,
  status,
  scheduledAt,
  completedAt,
  expiresAt
}) {
  const existing = await getLedgerByBookingId(bookingId);
  if (!existing) {
    const id = newId("ledger");
    await run(
      db,
      `INSERT INTO SessionLedger (
        id, treatment_active_id, turnito_booking_id, status, scheduled_at, completed_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        treatmentActiveId,
        bookingId,
        status,
        scheduledAt,
        completedAt,
        expiresAt
      ]
    );
    return { id, status };
  }
  await run(
    db,
    `UPDATE SessionLedger
     SET status = COALESCE(?, status),
         scheduled_at = COALESCE(?, scheduled_at),
         completed_at = COALESCE(?, completed_at),
         expires_at = COALESCE(?, expires_at)
     WHERE turnito_booking_id = ?`,
    [status, scheduledAt, completedAt, expiresAt, bookingId]
  );
  return { id: existing.id, status: status || existing.status };
}

async function expireScheduledSessions() {
  const now = nowIso();
  const expiring = await all(
    db,
    `SELECT * FROM SessionLedger WHERE status = 'scheduled' AND expires_at IS NOT NULL AND expires_at <= ?`,
    [now]
  );
  for (const entry of expiring) {
    await run(
      db,
      `UPDATE SessionLedger SET status = 'expired' WHERE id = ?`,
      [entry.id]
    );
    if (entry.treatment_active_id) {
      await updateTreatmentRemaining(entry.treatment_active_id, -1);
    }
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/start", async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: "missing_phone" });
  const code = "123456";
  const expiresAt = addDays(nowIso(), 1);
  await run(
    db,
    `INSERT INTO AuthCode (phone, code, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at`,
    [phone, code, expiresAt]
  );
  res.json({ ok: true, code });
});

app.post("/api/auth/verify", async (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) {
    return res.status(400).json({ error: "missing_phone_or_code" });
  }
  const record = await get(
    db,
    "SELECT * FROM AuthCode WHERE phone = ?",
    [phone]
  );
  if (!record || record.code !== code) {
    return res.status(400).json({ error: "invalid_code" });
  }
  let patient = await getPatientByPhone(phone);
  if (!patient) {
    const patientId = newId("pat");
    await run(
      db,
      `INSERT INTO Patient (id, name, phone, branch, status, no_show_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [patientId, "Paciente", phone, "resistencia", "active", 0, nowIso()]
    );
    patient = await getPatientById(patientId);
  }
  const token = signToken({
    patient_id: patient.id,
    phone: patient.phone
  });
  res.json({ token, patient });
});

app.get("/api/catalog", async (req, res) => {
  const branch = (req.query.branch || "resistencia").toLowerCase();
  const services = await all(
    db,
    "SELECT * FROM ServiceCatalog WHERE is_public = 1"
  );
  const professionals = await all(
    db,
    "SELECT * FROM Professional WHERE branch = ?",
    [branch]
  );
  const profMap = new Map();
  professionals.forEach((pro) => {
    profMap.set(pro.id, {
      id: pro.id,
      name: pro.name,
      branch: pro.branch,
      availability_rules: pro.availability_rules,
      skills: parseJsonList(pro.skills)
    });
  });
  const mapped = services.map((svc) => ({
    ...svc,
    requires_eval: Boolean(svc.requires_eval),
    allowed_professional_ids: parseJsonList(svc.allowed_professional_ids),
    allowed_professionals: parseJsonList(svc.allowed_professional_ids)
      .map((id) => profMap.get(id))
      .filter(Boolean)
  }));
  res.json({
    branch,
    services: mapped
  });
});

app.get("/api/products", async (req, res) => {
  const branch = (req.query.branch || "resistencia").toLowerCase();
  const products = await all(
    db,
    "SELECT * FROM PackProduct WHERE branch = ?",
    [branch]
  );
  const services = await all(db, "SELECT * FROM ServiceCatalog");
  const serviceMap = new Map();
  services.forEach((svc) => serviceMap.set(svc.service_key, svc));
  const mapped = products.map((prod) => ({
    ...prod,
    payment_methods: parseJsonList(prod.payment_methods),
    deposit_required: Boolean(prod.deposit_required),
    service: serviceMap.get(prod.service_key) || null
  }));
  res.json({ branch, products: mapped });
});

app.get("/api/me/treatments", authMiddleware, async (req, res) => {
  const patientId = req.user.patient_id;
  const patient = await getPatientById(patientId);
  if (!patient) return res.status(404).json({ error: "patient_not_found" });
  const treatments = await all(
    db,
    `SELECT * FROM TreatmentActive WHERE patient_id = ?`,
    [patientId]
  );
  const services = await all(db, "SELECT * FROM ServiceCatalog");
  const serviceMap = new Map();
  services.forEach((svc) => serviceMap.set(svc.service_key, svc));
  const result = [];
  for (const treatment of treatments) {
    const service = serviceMap.get(treatment.service_key);
    const allowedIds = service ? parseJsonList(service.allowed_professional_ids) : [];
    const allowedProfessionals = await getProfessionalsByIds(allowedIds);
    const serviceData = service
      ? {
          ...service,
          requires_eval: Boolean(service.requires_eval),
          allowed_professional_ids: allowedIds,
          allowed_professionals: allowedProfessionals.map((pro) => ({
            id: pro.id,
            name: pro.name,
            branch: pro.branch,
            availability_rules: pro.availability_rules,
            skills: parseJsonList(pro.skills)
          }))
        }
      : null;
    const lastCompletedAt = await getLastCompletedAt(treatment.id);
    const nextAllowedAt = lastCompletedAt
      ? addDays(lastCompletedAt, treatment.min_interval_days)
      : null;
    const reasons = [];
    if (patient.status === "blocked") reasons.push("blocked");
    if (treatment.status !== "active") reasons.push("treatment_inactive");
    if (treatment.sessions_remaining <= 0) reasons.push("no_sessions");
    if (service && service.requires_eval) reasons.push("requires_eval");
    const canSchedule =
      reasons.length === 0 &&
      (!nextAllowedAt || new Date(nextAllowedAt) <= new Date());
    result.push({
      ...treatment,
      service: serviceData,
      last_completed_at: lastCompletedAt,
      next_allowed_at: nextAllowedAt,
      can_schedule: canSchedule,
      reasons_blocking: canSchedule ? [] : reasons
    });
  }
  res.json({ patient, treatments: result });
});

app.post("/api/checkout/create", authMiddleware, async (req, res) => {
  const { product_id, payment_method } = req.body || {};
  if (!product_id || !payment_method) {
    return res.status(400).json({ error: "missing_product_or_payment" });
  }
  const product = await get(db, "SELECT * FROM PackProduct WHERE id = ?", [
    product_id
  ]);
  if (!product) return res.status(404).json({ error: "product_not_found" });
  const orderId = newId("order");
  await run(
    db,
    `INSERT INTO CheckoutOrder (id, patient_id, product_id, status, payment_method, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      req.user.patient_id,
      product_id,
      "pending",
      payment_method,
      nowIso()
    ]
  );
  res.json({ order_id: orderId, status: "pending" });
});

app.post("/api/checkout/confirm", async (req, res) => {
  const { order_id } = req.body || {};
  if (!order_id) return res.status(400).json({ error: "missing_order" });
  const order = await get(db, "SELECT * FROM CheckoutOrder WHERE id = ?", [
    order_id
  ]);
  if (!order) return res.status(404).json({ error: "order_not_found" });
  if (order.status === "paid") {
    return res.json({ ok: true, treatment_active_id: null });
  }
  const product = await get(db, "SELECT * FROM PackProduct WHERE id = ?", [
    order.product_id
  ]);
  const service = await getServiceByKey(product.service_key);
  const treatmentId = newId("ta");
  await run(
    db,
    `UPDATE CheckoutOrder SET status = 'paid', paid_at = ? WHERE id = ?`,
    [nowIso(), order_id]
  );
  await run(
    db,
    `INSERT INTO TreatmentActive (
      id, patient_id, service_key, pack_sessions_total, sessions_remaining,
      session_valid_days, min_interval_days, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      treatmentId,
      order.patient_id,
      product.service_key,
      product.pack_sessions_total,
      product.pack_sessions_total,
      product.session_valid_days,
      service ? service.default_min_interval_days : 7,
      "active",
      nowIso()
    ]
  );
  res.json({ ok: true, treatment_active_id: treatmentId });
});

app.post("/api/turnito/link", authMiddleware, async (req, res) => {
  const { treatment_active_id, professional_id, deposit_confirmed } =
    req.body || {};
  if (!treatment_active_id) {
    return res.status(400).json({ error: "missing_treatment_active" });
  }
  if (!deposit_confirmed) {
    return res.status(400).json({ error: "deposit_required" });
  }
  const patient = await getPatientById(req.user.patient_id);
  if (!patient) return res.status(404).json({ error: "patient_not_found" });
  if (patient.status === "blocked") {
    return res.status(403).json({ error: "patient_blocked" });
  }
  const treatment = await get(
    db,
    "SELECT * FROM TreatmentActive WHERE id = ?",
    [treatment_active_id]
  );
  if (!treatment || treatment.patient_id !== patient.id) {
    return res.status(404).json({ error: "treatment_not_found" });
  }
  if (treatment.status !== "active") {
    return res.status(403).json({ error: "treatment_inactive" });
  }
  if (treatment.sessions_remaining <= 0) {
    return res.status(403).json({ error: "no_sessions" });
  }
  const service = await getServiceByKey(treatment.service_key);
  if (service && service.requires_eval) {
    return res.status(403).json({ error: "requires_eval" });
  }
  const lastCompletedAt = await getLastCompletedAt(treatment.id);
  if (lastCompletedAt) {
    const nextAllowedAt = addDays(
      lastCompletedAt,
      treatment.min_interval_days || 0
    );
    if (new Date(nextAllowedAt) > new Date()) {
      return res.status(403).json({
        error: "min_interval_blocked",
        next_allowed_at: nextAllowedAt
      });
    }
  }
  const url = buildTurnitoUrl({
    patientId: patient.id,
    treatmentActiveId: treatment.id,
    serviceKey: treatment.service_key,
    professionalId: professional_id,
    type: "session"
  });
  res.json({ url });
});

app.post("/api/turnito/link-eval", authMiddleware, async (req, res) => {
  const { service_key } = req.body || {};
  if (!service_key) return res.status(400).json({ error: "missing_service" });
  const service = await getServiceByKey(service_key);
  if (!service || !service.requires_eval) {
    return res.status(400).json({ error: "service_not_eval" });
  }
  const patient = await getPatientById(req.user.patient_id);
  if (!patient) return res.status(404).json({ error: "patient_not_found" });
  if (patient.status === "blocked") {
    return res.status(403).json({ error: "patient_blocked" });
  }
  const url = buildTurnitoUrl({
    patientId: patient.id,
    treatmentActiveId: "",
    serviceKey: service_key,
    professionalId: "pro_eugenia",
    type: "evaluation"
  });
  res.json({ url });
});

app.get("/api/admin/patients", async (req, res) => {
  const query = (req.query.query || "").trim();
  if (!query) return res.json({ patients: [] });
  const like = `%${query}%`;
  const patients = await all(
    db,
    `SELECT * FROM Patient WHERE name LIKE ? OR phone LIKE ?`,
    [like, like]
  );
  res.json({ patients });
});

app.post("/api/admin/orders/confirm", async (req, res) => {
  const { order_id } = req.body || {};
  if (!order_id) return res.status(400).json({ error: "missing_order" });
  const result = await get(
    db,
    "SELECT * FROM CheckoutOrder WHERE id = ?",
    [order_id]
  );
  if (!result) return res.status(404).json({ error: "order_not_found" });
  const response = await fetchOrderConfirm(order_id);
  res.json(response);
});

async function fetchOrderConfirm(orderId) {
  const order = await get(
    db,
    "SELECT * FROM CheckoutOrder WHERE id = ?",
    [orderId]
  );
  if (!order) return { error: "order_not_found" };
  const product = await get(db, "SELECT * FROM PackProduct WHERE id = ?", [
    order.product_id
  ]);
  const service = await getServiceByKey(product.service_key);
  if (order.status !== "paid") {
    await run(
      db,
      `UPDATE CheckoutOrder SET status = 'paid', paid_at = ? WHERE id = ?`,
      [nowIso(), orderId]
    );
    const treatmentId = newId("ta");
    await run(
      db,
      `INSERT INTO TreatmentActive (
        id, patient_id, service_key, pack_sessions_total, sessions_remaining,
        session_valid_days, min_interval_days, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        treatmentId,
        order.patient_id,
        product.service_key,
        product.pack_sessions_total,
        product.pack_sessions_total,
        product.session_valid_days,
        service ? service.default_min_interval_days : 7,
        "active",
        nowIso()
      ]
    );
    return { ok: true, treatment_active_id: treatmentId };
  }
  return { ok: true, treatment_active_id: null };
}

app.post("/api/admin/patients/unblock", async (req, res) => {
  const { patient_id } = req.body || {};
  if (!patient_id) return res.status(400).json({ error: "missing_patient" });
  await run(
    db,
    `UPDATE Patient SET status = 'active', no_show_count = 0 WHERE id = ?`,
    [patient_id]
  );
  res.json({ ok: true });
});

app.post("/api/admin/treatments/create-manual", async (req, res) => {
  const { patient_id, service_key, sessions_total } = req.body || {};
  if (!patient_id || !service_key || !sessions_total) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const service = await getServiceByKey(service_key);
  if (!service) return res.status(404).json({ error: "service_not_found" });
  const treatmentId = newId("ta");
  await run(
    db,
    `INSERT INTO TreatmentActive (
      id, patient_id, service_key, pack_sessions_total, sessions_remaining,
      session_valid_days, min_interval_days, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      treatmentId,
      patient_id,
      service_key,
      sessions_total,
      sessions_total,
      30,
      service.default_min_interval_days,
      "active",
      nowIso()
    ]
  );
  res.json({ ok: true, treatment_active_id: treatmentId });
});

app.post("/api/webhooks/turnito", async (req, res) => {
  const payload = req.body || {};
  const event =
    payload.event ||
    payload.type ||
    payload.status ||
    (payload.booking && payload.booking.status) ||
    "";
  const booking = payload.booking || payload;
  const bookingId =
    booking.turnito_booking_id ||
    booking.booking_id ||
    booking.id ||
    booking.uuid;
  const treatmentActiveId =
    booking.treatment_active_id ||
    (booking.metadata && booking.metadata.treatment_active_id) ||
    booking.treatmentActiveId ||
    null;
  const scheduledAt = booking.scheduled_at || booking.scheduledAt || null;
  const completedAt = booking.completed_at || booking.completedAt || null;
  if (!bookingId) return res.json({ ok: true, ignored: true });

  if (event === "booking_created" || event === "scheduled") {
    const expiresAt = scheduledAt ? addDays(scheduledAt, 30) : null;
    await upsertLedger({
      treatmentActiveId,
      bookingId,
      status: "scheduled",
      scheduledAt,
      expiresAt
    });
    return res.json({ ok: true });
  }

  if (event === "booking_completed" || event === "completed") {
    await upsertLedger({
      treatmentActiveId,
      bookingId,
      status: "completed",
      completedAt: completedAt || nowIso()
    });
    if (treatmentActiveId) {
      await updateTreatmentRemaining(treatmentActiveId, -1);
    }
    return res.json({ ok: true });
  }

  if (event === "no_show") {
    await upsertLedger({
      treatmentActiveId,
      bookingId,
      status: "no_show",
      completedAt: completedAt || nowIso()
    });
    if (treatmentActiveId) {
      const treatment = await updateTreatmentRemaining(treatmentActiveId, -1);
      if (treatment) {
        await recordNoShow(treatment.patient_id);
      }
    }
    return res.json({ ok: true });
  }

  if (event === "booking_cancelled" || event === "cancelled") {
    const ledger = await getLedgerByBookingId(bookingId);
    const cancelScheduledAt = scheduledAt || (ledger ? ledger.scheduled_at : null);
    const treatment = treatmentActiveId
      ? await get(
          db,
          "SELECT * FROM TreatmentActive WHERE id = ?",
          [treatmentActiveId]
        )
      : null;
    const service = treatment ? await getServiceByKey(treatment.service_key) : null;
    const late = isLateCancellation(service, cancelScheduledAt, booking.cancelled_at);
    await upsertLedger({
      treatmentActiveId,
      bookingId,
      status: "cancelled"
    });
    if (late && treatmentActiveId) {
      await updateTreatmentRemaining(treatmentActiveId, -1);
    }
    return res.json({ ok: true, late });
  }

  res.json({ ok: true, ignored: true });
});

async function init() {
  db = openDb();
  await ensureSchema(db);
  await seedIfEmpty(db);
  setInterval(expireScheduledSessions, 6 * 60 * 60 * 1000);
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
