import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const fallbackMessages = {
  data: "Data",
  submit: "Submit",
  save: "Save changes",
  cancel: "Cancel",
  edit: "Edit",
  delete: "Delete",
  login: "Log in",
  signup: "Sign up",
  logout: "Log out",
  importCsv: "Import CSV",
  notifications: "Notifications",
  empty: "No records yet",
  editedBy: "Edited by",
  editorName: "Editor",
};

function normalizeConfig(config) {
  const fields = Array.isArray(config.fields) && config.fields.length
    ? config.fields
    : [{ name: "title", label: "Title", type: "text", required: true }];

  return {
    appName: config.appName || "Config App",
    apiBase: import.meta.env.VITE_API_BASE || config.apiBase || "http://localhost:5001",
    entity: config.entity || "items",
    fields: fields.filter((field) => field && field.name).map((field) => ({
      name: field.name,
      label: field.label || field.name,
      type: field.type || "text",
      required: Boolean(field.required),
      placeholder: field.placeholder || "",
      options: Array.isArray(field.options) ? field.options : [],
    })),
    auth: config.auth || { enabled: true },
    features: config.features || {},
    localization: config.localization || {},
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function DynamicField({ field, value, onChange }) {
  const id = `field-${field.name}`;
  const common = {
    id,
    name: field.name,
    required: field.required,
    value: value ?? "",
    onChange: (event) => onChange(field.name, event.target.value),
  };

  let input;

  if (field.type === "textarea") {
    input = <textarea {...common} placeholder={field.placeholder} />;
  } else if (field.type === "select") {
    input = (
      <select {...common}>
        <option value="" />
        {field.options.map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    );
  } else if (field.type === "checkbox" || field.type === "boolean") {
    input = (
      <input
        id={id}
        name={field.name}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(field.name, event.target.checked)}
      />
    );
  } else {
    const supported = ["text", "email", "password", "number", "date"];
    input = (
      <input
        {...common}
        type={supported.includes(field.type) ? field.type : "text"}
        placeholder={field.placeholder}
      />
    );
  }

  return (
    <label htmlFor={id}>
      {field.label}
      {input}
    </label>
  );
}

function AuthView({ config, t, status, statusType, loading, authMode, setAuthMode, onSubmit }) {
  const fields = Array.isArray(config.auth.fields) && config.auth.fields.length
    ? config.auth.fields
    : [
        { name: "email", label: "Email", type: "email", required: true },
        { name: "password", label: "Password", type: "password", required: true },
      ];
  const [form, setForm] = useState({});

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  return (
    <main className="auth-wrap">
      <section className="auth-panel">
        <h1>{config.auth.title || config.appName}</h1>
        <p className="muted">{config.appName}</p>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(form);
          }}
        >
          {fields.map((field) => (
            <DynamicField key={field.name} field={field} value={form[field.name] || ""} onChange={updateField} />
          ))}
          <button type="submit" disabled={loading}>
            {loading ? "Loading..." : t(authMode === "login" ? "login" : "signup")}
          </button>
        </form>
        <p className={`status ${statusType}`}>{status}</p>
        <button
          type="button"
          className="secondary"
          onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}
        >
          {t(authMode === "login" ? "signup" : "login")}
        </button>
      </section>
    </main>
  );
}

function RecordForm({ config, t, editRecord, loading, onSubmit, onCancel }) {
  const initialForm = useMemo(() => {
    const values = {};
    config.fields.forEach((field) => {
      values[field.name] = editRecord?.[field.name] ?? "";
    });
    return values;
  }, [config.fields, editRecord]);
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
    >
      {config.fields.map((field) => (
        <DynamicField key={field.name} field={field} value={form[field.name]} onChange={updateField} />
      ))}
      <div className="form-actions">
        <button type="submit" disabled={loading}>
          {loading ? "Loading..." : editRecord ? t("save") : t("submit")}
        </button>
        {editRecord ? (
          <button type="button" className="secondary" onClick={onCancel}>
            {t("cancel")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function CsvImport({ config, t, onImport }) {
  const [file, setFile] = useState(null);

  if (config.features.csvImport === false) return null;

  return (
    <div className="form-grid import-panel">
      <h3>{t("importCsv")}</h3>
      <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files[0])} />
      <div className="import-actions">
        <button type="button" className="secondary" onClick={() => onImport(file)}>
          {t("importCsv")}
        </button>
      </div>
    </div>
  );
}

function Notifications({ config, t, notifications }) {
  if (config.features.notifications === false) return null;

  return (
    <div className="notifications">
      <h3>{t("notifications")}</h3>
      {notifications.length ? notifications.map((notice) => (
        <div key={notice.id} className="notice">{notice.message}</div>
      )) : <div className="notice">{t("empty")}</div>}
    </div>
  );
}

function RecordsTable({ config, t, records, onEdit, onDelete, showEditor }) {
  if (!records.length) {
    return <div className="empty">{t("empty")}</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {config.fields.map((field) => <th key={field.name}>{field.label}</th>)}
            {showEditor ? <th>{t("editedBy")}</th> : null}
            <th />
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              {config.fields.map((field) => <td key={field.name}>{record[field.name] ?? ""}</td>)}
              {showEditor ? <td className="muted">{record.updated_by || record.created_by || "Guest"}</td> : null}
              <td>
                <div className="row-actions">
                  <button type="button" className="secondary" onClick={() => onEdit(record.id)}>
                    {t("edit")}
                  </button>
                  <button type="button" className="danger" onClick={() => onDelete(record.id)}>
                    {t("delete")}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AppView({
  config,
  locale,
  setLocale,
  t,
  user,
  records,
  notifications,
  editId,
  loading,
  status,
  statusType,
  onLogout,
  onSubmitRecord,
  onCancelEdit,
  onEdit,
  onDelete,
  onImport,
  authEnabled,
  editorName,
  onEditorNameChange,
}) {
  const locales = config.localization.supportedLocales || [];
  const editRecord = records.find((record) => String(record.id) === String(editId));

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>{config.appName}</h1>
        <div className="topbar-actions">
          {config.features.localization !== false && locales.length ? (
            <select value={locale} onChange={(event) => setLocale(event.target.value)}>
              {locales.map((item) => <option key={item.code} value={item.code}>{item.label || item.code}</option>)}
            </select>
          ) : null}
          {authEnabled ? (
            <>
              <span className="muted">{user?.email}</span>
              <button type="button" className="secondary" onClick={onLogout}>{t("logout")}</button>
            </>
          ) : (
            <label className="editor-control">
              {t("editorName")}
              <input
                type="text"
                value={editorName}
                maxLength="80"
                placeholder="Your name"
                onChange={(event) => onEditorNameChange(event.target.value)}
              />
            </label>
          )}
        </div>
      </header>

      <main className="grid">
        <section className="panel">
          <h2>{editRecord ? t("save") : t("submit")}</h2>
          <RecordForm
            config={config}
            t={t}
            editRecord={editRecord}
            loading={loading}
            onSubmit={onSubmitRecord}
            onCancel={onCancelEdit}
          />
          <CsvImport config={config} t={t} onImport={onImport} />
          <p className={`status ${statusType}`}>{loading ? "Loading..." : status}</p>
          <Notifications config={config} t={t} notifications={notifications} />
        </section>

        <section className="panel">
          <h2>{t("data")}</h2>
          <RecordsTable
            config={config}
            t={t}
            records={records}
            onEdit={onEdit}
            onDelete={onDelete}
            showEditor={!authEnabled}
          />
        </section>
      </main>
    </div>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [records, setRecords] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [token, setToken] = useState(() => localStorage.getItem("app_token") || "");
  const [user, setUser] = useState(null);
  const [editId, setEditId] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("");
  const [toast, setToast] = useState("");
  const [locale, setLocaleState] = useState(() => localStorage.getItem("app_locale") || "en");
  const [editorName, setEditorNameState] = useState(() => localStorage.getItem("app_editor_name") || "");
  const configSignatureRef = useRef("");
  const localeRef = useRef(locale);

  const t = useMemo(() => {
    return (key) => {
      const messages = config?.localization?.messages || {};
      return messages[locale]?.[key] || messages.en?.[key] || fallbackMessages[key] || key;
    };
  }, [config, locale]);

  function showToast(message) {
    setToast(message);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(""), 2400);
  }

  function setLocale(value) {
    setLocaleState(value);
    localStorage.setItem("app_locale", value);
  }

  function setEditorName(value) {
    setEditorNameState(value);
    localStorage.setItem("app_editor_name", value);
  }

  function showStatus(message, type = "") {
    setStatus(message);
    setStatusType(type);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (config?.auth?.enabled === false) headers["X-Editor-Name"] = editorName.trim() || "Guest";
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";

    const response = await fetch(`${config.apiBase}${path}`, {
      ...options,
      headers,
      body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(data.error || data.detail || "Request failed");
    }

    return data;
  }

  async function refreshAll(activeToken = token) {
    const headers = activeToken ? { Authorization: `Bearer ${activeToken}` } : {};
    const parse = async (response) => {
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.error || data.detail || "Request failed");
      return data;
    };

    const [recordData, notificationData, meData] = await Promise.all([
      fetch(`${config.apiBase}/api/${config.entity}`, { headers }).then(parse),
      config.features.notifications === false
        ? Promise.resolve([])
        : fetch(`${config.apiBase}/api/notifications`, { headers }).then(parse),
      fetch(`${config.apiBase}/auth/me`, { headers }).then(parse),
    ]);

    setRecords(recordData);
    setNotifications(notificationData);
    setUser(meData.user);
  }

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      try {
        const response = await fetch(`/config.json?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load config.json");
        const loaded = normalizeConfig(await response.json());
        const supported = loaded.localization.supportedLocales || [];
        const defaultLocale = loaded.localization.defaultLocale || "en";
        const signature = JSON.stringify(loaded);

        if (!mounted) return;

        if (supported.length && !supported.some((item) => item.code === localeRef.current)) {
          setLocale(defaultLocale);
        }

        if (signature !== configSignatureRef.current) {
          configSignatureRef.current = signature;
          document.title = loaded.appName;
          setConfig(loaded);
        }
      } catch (err) {
        if (mounted) setConfigError(err.message);
      }
    }

    loadConfig();
    const timer = window.setInterval(loadConfig, 2000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!config) return;

    const authRequired = config.auth.enabled !== false;
    if (authRequired && !token) return;

    refreshAll(token).catch((err) => {
      setToken("");
      localStorage.removeItem("app_token");
      showStatus(err.message, "error");
    });
  }, [config, token]);

  async function submitAuth(form) {
    setLoading(true);
    showStatus("");

    try {
      const response = await fetch(`${config.apiBase}/auth/${authMode === "login" ? "login" : "signup"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Authentication failed");

      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("app_token", data.token);
      await refreshAll(data.token);
      showToast(t(authMode === "login" ? "login" : "signup"));
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (err) {
      console.warn(err.message);
    }

    setToken("");
    setUser(null);
    setRecords([]);
    setNotifications([]);
    localStorage.removeItem("app_token");
  }

  async function submitRecord(form) {
    const path = `/api/${config.entity}${editId ? `/${editId}` : ""}`;
    const method = editId ? "PUT" : "POST";
    setLoading(true);
    showStatus("");

    try {
      await api(path, { method, body: form });
      setEditId(null);
      await refreshAll();
      const message = method === "POST" ? "Created" : "Updated";
      showStatus(message, "success");
      showToast(message);
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function deleteRecord(id) {
    if (!window.confirm("Delete this record?")) return;
    setLoading(true);
    showStatus("");

    try {
      await api(`/api/${config.entity}/${id}`, { method: "DELETE" });
      await refreshAll();
      showStatus("Deleted", "success");
      showToast("Deleted");
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function importCsv(file) {
    if (!file) {
      showStatus("Choose a CSV file", "error");
      return;
    }

    setLoading(true);
    showStatus("");

    try {
      const rows = parseCsv(await file.text());
      const headers = rows.shift() || [];
      const importedRecords = rows.map((row) => {
        const record = {};
        headers.forEach((header, index) => {
          const field = config.fields.find((item) => item.name === header || item.label === header);
          if (field) record[field.name] = row[index] || "";
        });
        return record;
      });
      const result = await api(`/api/${config.entity}/import`, {
        method: "POST",
        body: { records: importedRecords },
      });

      await refreshAll();
      showStatus(`Imported ${result.imported.length}; ${result.errors.length} failed`, result.errors.length ? "error" : "success");
      showToast(`Imported ${result.imported.length}`);
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  if (configError) {
    return (
      <main className="auth-wrap">
        <section className="auth-panel">
          <h1>Configuration error</h1>
          <p className="status error">{configError}</p>
        </section>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="auth-wrap">
        <section className="auth-panel">
          <h1>Loading</h1>
          <p className="status">Reading configuration...</p>
        </section>
      </main>
    );
  }

  const authRequired = config.auth.enabled !== false;

  return (
    <>
      {authRequired && !token ? (
        <AuthView
          config={config}
          t={t}
          status={status}
          statusType={statusType}
          loading={loading}
          authMode={authMode}
          setAuthMode={(mode) => {
            setAuthMode(mode);
            showStatus("");
          }}
          onSubmit={submitAuth}
        />
      ) : (
        <AppView
          config={config}
          locale={locale}
          setLocale={setLocale}
          t={t}
          user={user}
          records={records}
          notifications={notifications}
          editId={editId}
          loading={loading}
          status={status}
          statusType={statusType}
          onLogout={logout}
          onSubmitRecord={submitRecord}
          onCancelEdit={() => setEditId(null)}
          onEdit={(id) => {
            setEditId(id);
            showStatus("");
          }}
          onDelete={deleteRecord}
          onImport={importCsv}
          authEnabled={authRequired}
          editorName={editorName}
          onEditorNameChange={setEditorName}
        />
      )}
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
