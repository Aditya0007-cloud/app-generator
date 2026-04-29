require("dotenv").config();

const { Pool } = require("pg");

const useSsl = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool
  .query("SELECT 1")
  .then(() => console.log("Database connected"))
  .catch((err) => console.error("DB Error", err.message));

module.exports = pool;
