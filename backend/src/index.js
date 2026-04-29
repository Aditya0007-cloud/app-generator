require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5001;
const CONFIG_PATHS = [
  process.env.APP_CONFIG_PATH ? path.resolve(process.env.APP_CONFIG_PATH) : null,
  path.join(__dirname, "../../frontend/config.json"),
  path.join(__dirname, "../config.json"),
].filter(Boolean);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function sanitizeIdentifier(value, fallback) {
  const cleaned = String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return /^[a-z_][a-z0-9_]*$/.test(cleaned) ? cleaned : fallback;
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function readConfig() {
  const fallback = {
    appName: "Config App",
    entity: "items",
    fields: [{ name: "title", type: "text", required: true }],
    auth: { enabled: true },
  };

  for (const configPath of CONFIG_PATHS) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      return { ...fallback, ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(`Could not read config at ${configPath}:`, err.message);
      }
    }
  }

  console.warn("Using fallback config: no config file found");
  return fallback;
}

function normalizeConfig() {
  const raw = readConfig();
  const fields = Array.isArray(raw.fields)
    ? raw.fields
        .filter((field) => field && field.name)
        .map((field) => ({
          name: String(field.name),
          label: field.label || String(field.name),
          type: field.type || "text",
          required: Boolean(field.required),
          options: Array.isArray(field.options) ? field.options : [],
          column: sanitizeIdentifier(field.name, "field"),
        }))
    : [];

  return {
    ...raw,
    entity: sanitizeIdentifier(raw.entity, "items"),
    fields: fields.length ? fields : [{ name: "title", label: "Title", type: "text", required: true, column: "title" }],
  };
}

function dynamicTableName() {
  return sanitizeIdentifier(normalizeConfig().entity, "items");
}

function fieldSqlType(field) {
  if (field.type === "checkbox" || field.type === "boolean") {
    return "BOOLEAN DEFAULT false";
  }

  return "TEXT";
}

async function ensureSchema() {
  const config = normalizeConfig();
  const table = quoteIdentifier(config.entity);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);

  for (const field of config.fields) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(field.column)} ${fieldSqlType(field)}`);
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS ${config.entity}_owner_id_idx ON ${table} (owner_id)`);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const passwordHash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return { salt, passwordHash };
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createSession(userId) {
  const token = createToken();
  await pool.query(
    "INSERT INTO app_sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
    [token, userId]
  );
  return token;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const result = await pool.query(
      `SELECT app_users.id, app_users.email
       FROM app_sessions
       JOIN app_users ON app_users.id = app_sessions.user_id
       WHERE app_sessions.token = $1 AND app_sessions.expires_at > NOW()`,
      [token]
    );

    if (!result.rowCount) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    req.user = result.rows[0];
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

function isCurrentEntity(entity) {
  return sanitizeIdentifier(entity, "") === dynamicTableName();
}

function validatePayload(payload, partial = false) {
  const config = normalizeConfig();
  const errors = [];
  const values = {};

  for (const field of config.fields) {
    const value = payload[field.name] ?? payload[field.column];
    const isEmpty = value === undefined || value === null || String(value).trim() === "";

    if (!partial && field.required && isEmpty) {
      errors.push(`${field.label} is required`);
      continue;
    }

    if (isEmpty) {
      values[field.column] = field.type === "checkbox" || field.type === "boolean" ? false : null;
      continue;
    }

    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
      errors.push(`${field.label} must be a valid email`);
    }

    if (field.type === "number" && Number.isNaN(Number(value))) {
      errors.push(`${field.label} must be a number`);
    }

    if ((field.type === "checkbox" || field.type === "boolean")) {
      values[field.column] = value === true || value === "true" || value === "1" || value === "yes";
    } else {
      values[field.column] = String(value).trim();
    }
  }

  return { errors, values };
}

function rowToEntity(row) {
  const config = normalizeConfig();
  const item = {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  for (const field of config.fields) {
    item[field.name] = row[field.column];
  }

  return item;
}

async function addNotification(userId, type, message) {
  await pool.query(
    "INSERT INTO app_notifications (user_id, type, message) VALUES ($1, $2, $3)",
    [userId, type, message]
  );
}

async function insertRecord(values, userId) {
  const config = normalizeConfig();
  const table = quoteIdentifier(config.entity);
  const fields = config.fields;
  const columns = ["owner_id", ...fields.map((field) => field.column)];
  const params = [userId, ...fields.map((field) => values[field.column])];
  const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
  const returning = fields.map((field) => quoteIdentifier(field.column)).join(", ");

  const result = await pool.query(
    `INSERT INTO ${table} (${columns.map(quoteIdentifier).join(", ")})
     VALUES (${placeholders})
     RETURNING id, created_at, updated_at${returning ? `, ${returning}` : ""}`,
    params
  );

  return rowToEntity(result.rows[0]);
}

app.get("/", (req, res) => {
  const config = normalizeConfig();
  res.json({
    message: "Config-driven backend is running",
    entity: config.entity,
    endpoints: [`/api/${config.entity}`, "/auth/signup", "/auth/login"],
  });
});

app.get("/config", (req, res) => {
  res.json(normalizeConfig());
});

app.get("/test-db", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.post("/auth/signup", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const { salt, passwordHash } = hashPassword(password);
    const userResult = await pool.query(
      "INSERT INTO app_users (email, password_hash, salt) VALUES ($1, $2, $3) RETURNING id, email",
      [email, passwordHash, salt]
    );
    const token = await createSession(userResult.rows[0].id);
    await addNotification(userResult.rows[0].id, "auth", "Account created");

    res.status(201).json({ token, user: userResult.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account already exists for this email" });
    }
    next(err);
  }
});

app.post("/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const userResult = await pool.query("SELECT * FROM app_users WHERE email = $1", [email]);

    if (!userResult.rowCount) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = userResult.rows[0];
    const { passwordHash } = hashPassword(password, user.salt);

    if (passwordHash !== user.password_hash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = await createSession(user.id);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

app.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post("/auth/logout", requireAuth, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM app_sessions WHERE token = $1", [req.token]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get("/api/notifications", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, type, message, created_at FROM app_notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 10",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/:entity", requireAuth, async (req, res, next) => {
  if (!isCurrentEntity(req.params.entity)) {
    return res.status(404).json({ error: "Unknown entity" });
  }

  try {
    const config = normalizeConfig();
    const table = quoteIdentifier(config.entity);
    const columns = config.fields.map((field) => quoteIdentifier(field.column)).join(", ");
    const result = await pool.query(
      `SELECT id, created_at, updated_at${columns ? `, ${columns}` : ""}
       FROM ${table}
       WHERE owner_id = $1
       ORDER BY id DESC`,
      [req.user.id]
    );
    res.json(result.rows.map(rowToEntity));
  } catch (err) {
    next(err);
  }
});

app.post("/api/:entity", requireAuth, async (req, res, next) => {
  if (!isCurrentEntity(req.params.entity)) {
    return res.status(404).json({ error: "Unknown entity" });
  }

  const { errors, values } = validatePayload(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(", ") });
  }

  try {
    const item = await insertRecord(values, req.user.id);
    await addNotification(req.user.id, "create", "Record created");
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

app.post("/api/:entity/import", requireAuth, async (req, res, next) => {
  if (!isCurrentEntity(req.params.entity)) {
    return res.status(404).json({ error: "Unknown entity" });
  }

  const records = Array.isArray(req.body.records) ? req.body.records : [];
  const imported = [];
  const errors = [];

  try {
    for (const [index, record] of records.entries()) {
      const validation = validatePayload(record);
      if (validation.errors.length) {
        errors.push({ row: index + 1, error: validation.errors.join(", ") });
        continue;
      }
      imported.push(await insertRecord(validation.values, req.user.id));
    }

    await addNotification(req.user.id, "import", `Imported ${imported.length} record(s)`);
    res.json({ imported, errors });
  } catch (err) {
    next(err);
  }
});

app.put("/api/:entity/:id", requireAuth, async (req, res, next) => {
  if (!isCurrentEntity(req.params.entity)) {
    return res.status(404).json({ error: "Unknown entity" });
  }

  const { errors, values } = validatePayload(req.body, true);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(", ") });
  }

  try {
    const config = normalizeConfig();
    const table = quoteIdentifier(config.entity);
    const fields = config.fields;
    const assignments = fields.map((field, index) => `${quoteIdentifier(field.column)} = $${index + 1}`).join(", ");
    const params = [...fields.map((field) => values[field.column]), req.params.id, req.user.id];
    const returning = fields.map((field) => quoteIdentifier(field.column)).join(", ");
    const result = await pool.query(
      `UPDATE ${table}
       SET ${assignments}, updated_at = NOW()
       WHERE id = $${fields.length + 1} AND owner_id = $${fields.length + 2}
       RETURNING id, created_at, updated_at${returning ? `, ${returning}` : ""}`,
      params
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Record not found" });
    }

    await addNotification(req.user.id, "update", "Record updated");
    res.json(rowToEntity(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

app.delete("/api/:entity/:id", requireAuth, async (req, res, next) => {
  if (!isCurrentEntity(req.params.entity)) {
    return res.status(404).json({ error: "Unknown entity" });
  }

  try {
    const table = quoteIdentifier(dynamicTableName());
    const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 AND owner_id = $2`, [
      req.params.id,
      req.user.id,
    ]);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Record not found" });
    }

    await addNotification(req.user.id, "delete", "Record deleted");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error", detail: err.message });
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize schema", err);
    process.exit(1);
  });
