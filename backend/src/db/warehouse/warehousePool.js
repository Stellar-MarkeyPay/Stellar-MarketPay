"use strict";

const { Pool } = require("pg");

const warehousePool = new Pool({
  host: process.env.WAREHOUSE_DB_HOST || "localhost",
  port: Number(process.env.WAREHOUSE_DB_PORT || 5433),
  database: process.env.WAREHOUSE_DB_NAME || "stellarwork",
  user: process.env.WAREHOUSE_DB_USER || "stellarwork",
  password: process.env.WAREHOUSE_DB_PASSWORD || process.env.PGPASSWORD,
  max: 5,
});

module.exports = warehousePool;