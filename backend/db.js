const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");

const DB_PATH = path.join(__dirname, "data", "helpcenter.db");

function openDb() {
  return new sqlite3.Database(DB_PATH);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function ensureSchema(db) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS Patient (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT UNIQUE,
      branch TEXT,
      status TEXT,
      no_show_count INTEGER DEFAULT 0,
      created_at TEXT
    );
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS Professional (
      id TEXT PRIMARY KEY,
      name TEXT,
      branch TEXT,
      availability_rules TEXT,
      skills TEXT
    );
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS ServiceCatalog (
      service_key TEXT PRIMARY KEY,
      category TEXT,
      objective TEXT,
      technology_key TEXT,
      zone TEXT,
      area TEXT,
      duration_min INTEGER,
      requires_eval INTEGER,
      default_min_pack_sessions INTEGER,
      default_min_interval_days INTEGER,
      allowed_professional_ids TEXT,
      is_public INTEGER,
      description_public TEXT
    );
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS PackProduct (
      id TEXT PRIMARY KEY,
      service_key TEXT,
      pack_sessions_total INTEGER,
      price INTEGER,
      benefit_label TEXT,
      session_valid_days INTEGER,
      deposit_required INTEGER,
      deposit_amount INTEGER,
      payment_methods TEXT,
      branch TEXT
    );
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS TreatmentActive (
      id TEXT PRIMARY KEY,
      patient_id TEXT,
      service_key TEXT,
      pack_sessions_total INTEGER,
      sessions_remaining INTEGER,
      session_valid_days INTEGER,
      min_interval_days INTEGER,
      status TEXT,
      created_at TEXT
    );
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS SessionLedger (
      id TEXT PRIMARY KEY,
      treatment_active_id TEXT,
      turnito_booking_id TEXT,
      status TEXT,
      scheduled_at TEXT,
      completed_at TEXT,
      expires_at TEXT
    );
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS CheckoutOrder (
      id TEXT PRIMARY KEY,
      patient_id TEXT,
      product_id TEXT,
      status TEXT,
      payment_method TEXT,
      created_at TEXT,
      paid_at TEXT
    );
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS AuthCode (
      phone TEXT PRIMARY KEY,
      code TEXT,
      expires_at TEXT
    );
  `
  );
}

function nowIso() {
  return new Date().toISOString();
}

async function seedIfEmpty(db) {
  const existing = await get(db, "SELECT COUNT(*) as cnt FROM ServiceCatalog");
  if (existing && existing.cnt > 0) return;

  const professionals = [
    {
      id: "pro_ofelia",
      name: "Ofelia",
      branch: "resistencia",
      availability_rules: "Semanal",
      skills: [
        "depilacion_vectus",
        "depilacion_soprano",
        "mesoterapia_corporal",
        "mesoterapia_facial",
        "mesoterapia_capilar",
        "limpieza_profunda",
        "powershape_corporal",
        "cavistar",
        "crio_tratamiento"
      ]
    },
    {
      id: "pro_magali",
      name: "Magali",
      branch: "resistencia",
      availability_rules: "Semanal",
      skills: [
        "depilacion_vectus",
        "depilacion_soprano",
        "powershape_corporal",
        "powershape_facial",
        "cavistar",
        "crio_tratamiento"
      ]
    },
    {
      id: "pro_camila",
      name: "Camila",
      branch: "resistencia",
      availability_rules: "Semanal",
      skills: [
        "depilacion_vectus",
        "depilacion_soprano",
        "mesoterapia_corporal",
        "mesoterapia_facial",
        "mesoterapia_capilar",
        "limpieza_profunda",
        "powershape_corporal",
        "powershape_facial",
        "cavistar",
        "crio_tratamiento"
      ]
    },
    {
      id: "pro_eugenia",
      name: "Dra. Eugenia",
      branch: "resistencia",
      availability_rules: "Lunes y sábados alternos",
      skills: [
        "prp",
        "mesoterapia_corporal",
        "mesoterapia_facial",
        "mesoterapia_capilar",
        "ultherapy",
        "limpieza_profunda",
        "consulta_medica",
        "crio_evaluacion"
      ]
    }
  ];

  for (const pro of professionals) {
    await run(
      db,
      `INSERT INTO Professional (id, name, branch, availability_rules, skills) VALUES (?, ?, ?, ?, ?)`,
      [
        pro.id,
        pro.name,
        pro.branch,
        pro.availability_rules,
        JSON.stringify(pro.skills)
      ]
    );
  }

  const services = [
    {
      service_key: "depilacion_vectus",
      category: "depilacion",
      objective: "depilacion",
      technology_key: "Vectus",
      zone: null,
      area: null,
      duration_min: 20,
      requires_eval: 0,
      default_min_pack_sessions: 6,
      default_min_interval_days: 30,
      allowed_professional_ids: ["pro_ofelia", "pro_magali", "pro_camila"],
      is_public: 1,
      description_public:
        "Depilación definitiva con tecnología Vectus para resultados duraderos."
    },
    {
      service_key: "depilacion_soprano",
      category: "depilacion",
      objective: "depilacion",
      technology_key: "Soprano",
      zone: null,
      area: null,
      duration_min: 20,
      requires_eval: 0,
      default_min_pack_sessions: 8,
      default_min_interval_days: 30,
      allowed_professional_ids: ["pro_ofelia", "pro_magali", "pro_camila"],
      is_public: 1,
      description_public:
        "Depilación definitiva con tecnología Soprano, ideal para pieles sensibles."
    },
    {
      service_key: "powershape_corporal",
      category: "corporal",
      objective: "modelado",
      technology_key: "PowerShape",
      zone: "corporal",
      area: null,
      duration_min: 40,
      requires_eval: 0,
      default_min_pack_sessions: 3,
      default_min_interval_days: 7,
      allowed_professional_ids: ["pro_ofelia", "pro_magali", "pro_camila"],
      is_public: 1,
      description_public:
        "Programa PowerShape corporal para modelado y reducción."
    },
    {
      service_key: "powershape_facial",
      category: "facial",
      objective: "rejuvenecimiento",
      technology_key: "PowerShape",
      zone: "facial",
      area: null,
      duration_min: 30,
      requires_eval: 0,
      default_min_pack_sessions: 3,
      default_min_interval_days: 7,
      allowed_professional_ids: ["pro_magali", "pro_camila"],
      is_public: 1,
      description_public: "PowerShape facial para tensado y firmeza."
    },
    {
      service_key: "mesoterapia_corporal",
      category: "corporal",
      objective: "celulitis",
      technology_key: "Mesoterapia",
      zone: "corporal",
      area: null,
      duration_min: 30,
      requires_eval: 0,
      default_min_pack_sessions: 3,
      default_min_interval_days: 7,
      allowed_professional_ids: [
        "pro_ofelia",
        "pro_camila",
        "pro_eugenia"
      ],
      is_public: 1,
      description_public: "Mesoterapia corporal para celulitis y tonicidad."
    },
    {
      service_key: "mesoterapia_facial",
      category: "facial",
      objective: "rejuvenecimiento",
      technology_key: "Mesoterapia",
      zone: "facial",
      area: null,
      duration_min: 30,
      requires_eval: 0,
      default_min_pack_sessions: 3,
      default_min_interval_days: 7,
      allowed_professional_ids: [
        "pro_ofelia",
        "pro_camila",
        "pro_eugenia"
      ],
      is_public: 1,
      description_public: "Mesoterapia facial para hidratación profunda."
    },
    {
      service_key: "mesoterapia_capilar",
      category: "capilar",
      objective: "capilar",
      technology_key: "Mesoterapia",
      zone: "capilar",
      area: null,
      duration_min: 30,
      requires_eval: 0,
      default_min_pack_sessions: 3,
      default_min_interval_days: 7,
      allowed_professional_ids: [
        "pro_ofelia",
        "pro_camila",
        "pro_eugenia"
      ],
      is_public: 1,
      description_public: "Mesoterapia capilar para fortalecer el cabello."
    },
    {
      service_key: "limpieza_profunda",
      category: "facial",
      objective: "limpieza",
      technology_key: "Limpieza",
      zone: "facial",
      area: null,
      duration_min: 50,
      requires_eval: 0,
      default_min_pack_sessions: 1,
      default_min_interval_days: 30,
      allowed_professional_ids: [
        "pro_ofelia",
        "pro_camila",
        "pro_eugenia"
      ],
      is_public: 1,
      description_public: "Limpieza facial profunda."
    },
    {
      service_key: "cavistar",
      category: "corporal",
      objective: "reduccion",
      technology_key: "Cavistar",
      zone: "corporal",
      area: null,
      duration_min: 40,
      requires_eval: 0,
      default_min_pack_sessions: 3,
      default_min_interval_days: 7,
      allowed_professional_ids: ["pro_ofelia", "pro_magali", "pro_camila"],
      is_public: 1,
      description_public: "Cavitación y reducción sin cirugía."
    },
    {
      service_key: "crio_evaluacion",
      category: "medica",
      objective: "evaluacion",
      technology_key: "Criolipolisis",
      zone: null,
      area: null,
      duration_min: 30,
      requires_eval: 1,
      default_min_pack_sessions: 1,
      default_min_interval_days: 30,
      allowed_professional_ids: ["pro_eugenia"],
      is_public: 1,
      description_public: "Evaluación médica para Criolipólisis."
    },
    {
      service_key: "crio_tratamiento",
      category: "corporal",
      objective: "reduccion",
      technology_key: "Criolipolisis",
      zone: "corporal",
      area: null,
      duration_min: 60,
      requires_eval: 1,
      default_min_pack_sessions: 1,
      default_min_interval_days: 30,
      allowed_professional_ids: ["pro_ofelia", "pro_magali", "pro_camila"],
      is_public: 0,
      description_public: "Criolipólisis (requiere evaluación previa)."
    },
    {
      service_key: "prp",
      category: "medica",
      objective: "medica",
      technology_key: "PRP",
      zone: null,
      area: null,
      duration_min: 45,
      requires_eval: 1,
      default_min_pack_sessions: 1,
      default_min_interval_days: 30,
      allowed_professional_ids: ["pro_eugenia"],
      is_public: 1,
      description_public: "PRP (requiere evaluación médica)."
    },
    {
      service_key: "ultherapy",
      category: "medica",
      objective: "rejuvenecimiento",
      technology_key: "Ultherapy",
      zone: null,
      area: null,
      duration_min: 60,
      requires_eval: 1,
      default_min_pack_sessions: 1,
      default_min_interval_days: 180,
      allowed_professional_ids: ["pro_eugenia"],
      is_public: 1,
      description_public: "Ultherapy (requiere evaluación médica)."
    },
    {
      service_key: "consulta_medica",
      category: "medica",
      objective: "consulta",
      technology_key: "Consulta",
      zone: null,
      area: null,
      duration_min: 20,
      requires_eval: 0,
      default_min_pack_sessions: 1,
      default_min_interval_days: 1,
      allowed_professional_ids: ["pro_eugenia"],
      is_public: 1,
      description_public: "Consulta médica con Dra. Eugenia."
    }
  ];

  for (const svc of services) {
    await run(
      db,
      `INSERT INTO ServiceCatalog (
        service_key, category, objective, technology_key, zone, area, duration_min,
        requires_eval, default_min_pack_sessions, default_min_interval_days,
        allowed_professional_ids, is_public, description_public
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        svc.service_key,
        svc.category,
        svc.objective,
        svc.technology_key,
        svc.zone,
        svc.area,
        svc.duration_min,
        svc.requires_eval,
        svc.default_min_pack_sessions,
        svc.default_min_interval_days,
        JSON.stringify(svc.allowed_professional_ids),
        svc.is_public,
        svc.description_public
      ]
    );
  }

  const products = [
    {
      id: "pack_vectus_6",
      service_key: "depilacion_vectus",
      pack_sessions_total: 6,
      price: 180000,
      benefit_label: "Pack 6 sesiones",
      session_valid_days: 30,
      deposit_required: 1,
      deposit_amount: 15000,
      payment_methods: ["transferencia", "efectivo"],
      branch: "resistencia"
    },
    {
      id: "pack_soprano_8",
      service_key: "depilacion_soprano",
      pack_sessions_total: 8,
      price: 220000,
      benefit_label: "Pack 8 sesiones",
      session_valid_days: 30,
      deposit_required: 1,
      deposit_amount: 15000,
      payment_methods: ["transferencia", "efectivo"],
      branch: "resistencia"
    },
    {
      id: "pack_powershape_3x4",
      service_key: "powershape_corporal",
      pack_sessions_total: 4,
      price: 160000,
      benefit_label: "Programa 3x4",
      session_valid_days: 30,
      deposit_required: 1,
      deposit_amount: 12000,
      payment_methods: ["transferencia", "efectivo"],
      branch: "resistencia"
    },
    {
      id: "pack_mesoterapia_3",
      service_key: "mesoterapia_corporal",
      pack_sessions_total: 3,
      price: 90000,
      benefit_label: "Pack 3 sesiones",
      session_valid_days: 30,
      deposit_required: 1,
      deposit_amount: 12000,
      payment_methods: ["transferencia", "efectivo"],
      branch: "resistencia"
    },
    {
      id: "pack_mesoterapia_capilar_3",
      service_key: "mesoterapia_capilar",
      pack_sessions_total: 3,
      price: 110000,
      benefit_label: "Pack 3 sesiones",
      session_valid_days: 30,
      deposit_required: 1,
      deposit_amount: 12000,
      payment_methods: ["transferencia", "efectivo"],
      branch: "resistencia"
    }
  ];

  for (const prod of products) {
    await run(
      db,
      `INSERT INTO PackProduct (
        id, service_key, pack_sessions_total, price, benefit_label,
        session_valid_days, deposit_required, deposit_amount, payment_methods, branch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prod.id,
        prod.service_key,
        prod.pack_sessions_total,
        prod.price,
        prod.benefit_label,
        prod.session_valid_days,
        prod.deposit_required,
        prod.deposit_amount,
        JSON.stringify(prod.payment_methods),
        prod.branch
      ]
    );
  }

  const demoPatientId = "pat_demo";
  await run(
    db,
    `INSERT INTO Patient (id, name, phone, branch, status, no_show_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [demoPatientId, "Paciente Demo", "+543624000000", "resistencia", "active", 0, nowIso()]
  );

  const demoTreatmentId = "ta_demo_vectus";
  await run(
    db,
    `INSERT INTO TreatmentActive (
      id, patient_id, service_key, pack_sessions_total, sessions_remaining,
      session_valid_days, min_interval_days, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      demoTreatmentId,
      demoPatientId,
      "depilacion_vectus",
      6,
      4,
      30,
      30,
      "active",
      nowIso()
    ]
  );
}

function newId(prefix) {
  return `${prefix}_${uuidv4()}`;
}

module.exports = {
  openDb,
  ensureSchema,
  seedIfEmpty,
  run,
  get,
  all,
  nowIso,
  newId
};
