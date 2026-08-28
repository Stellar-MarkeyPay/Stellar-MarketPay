"use strict";

const { runWarehouseQualityChecks } = require("./warehouseQuality");
const sourcePool = require("../pool");
const warehousePool = require("./warehousePool");

const OVERLAP_MINUTES = 10;

async function getWatermark(sourceTable) {
  const result = await warehousePool.query(
    `
    SELECT last_updated_at
    FROM analytics.etl_watermark
    WHERE source_table = $1
    `,
    [sourceTable]
  );

  return result.rows[0]?.last_updated_at || "1970-01-01T00:00:00Z";
}

async function setWatermark(sourceTable, timestamp) {
  await warehousePool.query(
    `
    INSERT INTO analytics.etl_watermark
      (source_table, last_updated_at, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (source_table)
    DO UPDATE SET
      last_updated_at = EXCLUDED.last_updated_at,
      updated_at = NOW()
    `,
    [sourceTable, timestamp]
  );
}

async function loadDateDimension(minDate, maxDate) {
  await warehousePool.query(
    `
    INSERT INTO analytics.dim_date (
      date_key,
      full_date,
      year,
      quarter,
      month,
      month_name,
      week_of_year,
      day_of_month,
      day_of_week,
      is_weekend
    )
    SELECT
      TO_CHAR(d, 'YYYYMMDD')::INTEGER,
      d::DATE,
      EXTRACT(YEAR FROM d)::INTEGER,
      EXTRACT(QUARTER FROM d)::INTEGER,
      EXTRACT(MONTH FROM d)::INTEGER,
      TO_CHAR(d, 'Month'),
      EXTRACT(WEEK FROM d)::INTEGER,
      EXTRACT(DAY FROM d)::INTEGER,
      EXTRACT(ISODOW FROM d)::INTEGER,
      EXTRACT(ISODOW FROM d)::INTEGER IN (6, 7)
    FROM generate_series(
      $1::DATE,
      $2::DATE,
      INTERVAL '1 day'
    ) d
    ON CONFLICT (date_key) DO NOTHING
    `,
    [minDate, maxDate]
  );
}

async function loadDimensions() {
  const profiles = await sourcePool.query(`
    SELECT
      public_key,
      role,
      rating,
      created_at,
      updated_at
    FROM profiles
  `);

  for (const p of profiles.rows) {
    await warehousePool.query(
      `
      INSERT INTO analytics.dim_user (
        public_key,
        role,
        rating,
        source_created_at,
        effective_from,
        effective_to,
        is_current
      )
      VALUES ($1, $2, $3, $4, $5, NULL, TRUE)
      ON CONFLICT (public_key, effective_from)
      DO UPDATE SET
        role = EXCLUDED.role,
        rating = EXCLUDED.rating
      `,
      [
        p.public_key,
        p.role,
        p.rating,
        p.created_at,
        p.updated_at || p.created_at,
      ]
    );
  }

  const categories = await sourcePool.query(`
    SELECT DISTINCT category
    FROM jobs
    WHERE category IS NOT NULL
      AND category <> ''
  `);

  for (const c of categories.rows) {
    await warehousePool.query(
      `
      INSERT INTO analytics.dim_category (category_name)
      VALUES ($1)
      ON CONFLICT (category_name) DO NOTHING
      `,
      [c.category]
    );
  }

  const statuses = await sourcePool.query(`
    SELECT DISTINCT status
    FROM jobs
    WHERE status IS NOT NULL
  `);

  for (const s of statuses.rows) {
    await warehousePool.query(
      `
      INSERT INTO analytics.dim_status (
        entity_type,
        status_code,
        status_description
      )
      VALUES ('job', $1, $1)
      ON CONFLICT (entity_type, status_code) DO NOTHING
      `,
      [s.status]
    );
  }
}

async function loadJobs() {
  const watermark = await getWatermark("jobs");

  const result = await sourcePool.query(
    `
    SELECT *
    FROM jobs
    WHERE updated_at >= $1::timestamptz - INTERVAL '${OVERLAP_MINUTES} minutes'
    ORDER BY updated_at, id
    `,
    [watermark]
  );

  if (!result.rows.length) {
    return { table: "jobs", loaded: 0 };
  }

  let maxUpdatedAt = watermark;

  for (const j of result.rows) {
    const createdDate = new Date(j.created_at);
    const updatedDate = j.updated_at
      ? new Date(j.updated_at)
      : createdDate;

    await loadDateDimension(
      createdDate.toISOString().slice(0, 10),
      updatedDate.toISOString().slice(0, 10)
    );

    const client = await warehousePool.query(
      `SELECT user_key FROM analytics.dim_user WHERE public_key = $1 AND is_current = TRUE`,
      [j.client_address]
    );

    const freelancer = j.freelancer_address
      ? await warehousePool.query(
          `SELECT user_key FROM analytics.dim_user WHERE public_key = $1 AND is_current = TRUE`,
          [j.freelancer_address]
        )
      : { rows: [] };

    const category = await warehousePool.query(
      `SELECT category_key FROM analytics.dim_category WHERE category_name = $1`,
      [j.category]
    );

    const status = await warehousePool.query(
      `
      SELECT status_key
      FROM analytics.dim_status
      WHERE entity_type = 'job'
        AND status_code = $1
      `,
      [j.status]
    );

    const createdDateKey =
      Number(
        createdDate.toISOString().slice(0, 10).replaceAll("-", "")
      );

    const hiredDateKey = j.hired_at
      ? Number(
          new Date(j.hired_at)
            .toISOString()
            .slice(0, 10)
            .replaceAll("-", "")
        )
      : null;

    await warehousePool.query(
      `
      INSERT INTO analytics.fact_job (
        job_id,
        client_key,
        freelancer_key,
        category_key,
        status_key,
        created_date_key,
        hired_date_key,
        budget_amount,
        applicant_count,
        view_count,
        time_to_hire_hours,
        source_created_at,
        source_updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
      ON CONFLICT (job_id)
      DO UPDATE SET
        client_key = EXCLUDED.client_key,
        freelancer_key = EXCLUDED.freelancer_key,
        category_key = EXCLUDED.category_key,
        status_key = EXCLUDED.status_key,
        created_date_key = EXCLUDED.created_date_key,
        hired_date_key = EXCLUDED.hired_date_key,
        budget_amount = EXCLUDED.budget_amount,
        applicant_count = EXCLUDED.applicant_count,
        view_count = EXCLUDED.view_count,
        time_to_hire_hours = EXCLUDED.time_to_hire_hours,
        source_updated_at = EXCLUDED.source_updated_at
      `,
      [
        j.id,
        client.rows[0]?.user_key || null,
        freelancer.rows[0]?.user_key || null,
        category.rows[0]?.category_key || null,
        status.rows[0]?.status_key || null,
        createdDateKey,
        hiredDateKey,
        j.budget,
        j.applicant_count || 0,
        j.view_count || 0,
        j.hired_at
          ? (new Date(j.hired_at) - createdDate) / 3600000
          : null,
        j.created_at,
        j.updated_at,
      ]
    );

    if (new Date(updatedDate) > new Date(maxUpdatedAt)) {
      maxUpdatedAt = updatedDate.toISOString();
    }
  }

  await setWatermark("jobs", maxUpdatedAt);

  return {
    table: "jobs",
    loaded: result.rows.length,
  };
}

async function loadApplications() {
  const watermark = await getWatermark("applications");

  const result = await sourcePool.query(
    `
    SELECT *
    FROM applications
    WHERE created_at >= $1::timestamptz - INTERVAL '${OVERLAP_MINUTES} minutes'
    ORDER BY created_at, id
    `,
    [watermark]
  );

  let loaded = 0;
  let maxCreatedAt = watermark;

  for (const a of result.rows) {
    const job = await warehousePool.query(
      `SELECT job_key FROM analytics.fact_job WHERE job_id = $1`,
      [a.job_id]
    );

    if (!job.rows[0]) {
      continue;
    }

    const freelancer = await warehousePool.query(
      `
      SELECT user_key
      FROM analytics.dim_user
      WHERE public_key = $1
        AND is_current = TRUE
      `,
      [a.freelancer_address]
    );

    const createdDateKey =
      Number(
        new Date(a.created_at)
          .toISOString()
          .slice(0, 10)
          .replaceAll("-", "")
      );

    const acceptedDateKey = a.accepted_at
      ? Number(
          new Date(a.accepted_at)
            .toISOString()
            .slice(0, 10)
            .replaceAll("-", "")
        )
      : null;

    await loadDateDimension(
      new Date(a.created_at).toISOString().slice(0, 10),
      a.accepted_at
        ? new Date(a.accepted_at).toISOString().slice(0, 10)
        : new Date(a.created_at).toISOString().slice(0, 10)
    );

    const status = await warehousePool.query(
      `
      INSERT INTO analytics.dim_status (
        entity_type,
        status_code,
        status_description
      )
      VALUES ('application', $1, $1)
      ON CONFLICT (entity_type, status_code)
      DO UPDATE SET status_description = EXCLUDED.status_description
      RETURNING status_key
      `,
      [a.status]
    );

    await warehousePool.query(
      `
      INSERT INTO analytics.fact_application (
        application_id,
        job_key,
        freelancer_key,
        created_date_key,
        accepted_date_key,
        status_key,
        bid_amount,
        created_at,
        accepted_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (application_id)
      DO UPDATE SET
        freelancer_key = EXCLUDED.freelancer_key,
        accepted_date_key = EXCLUDED.accepted_date_key,
        status_key = EXCLUDED.status_key,
        bid_amount = EXCLUDED.bid_amount,
        accepted_at = EXCLUDED.accepted_at
      `,
      [
        a.id,
        job.rows[0].job_key,
        freelancer.rows[0]?.user_key || null,
        createdDateKey,
        acceptedDateKey,
        status.rows[0].status_key,
        a.bid_amount,
        a.created_at,
        a.accepted_at,
      ]
    );

    loaded++;

    if (new Date(a.created_at) > new Date(maxCreatedAt)) {
      maxCreatedAt = new Date(a.created_at).toISOString();
    }
  }

  await setWatermark("applications", maxCreatedAt);

  return {
    table: "applications",
    loaded,
  };
}

async function loadEscrows() {
  const watermark = await getWatermark("escrows");

  const result = await sourcePool.query(
    `
    SELECT *
    FROM escrows
    WHERE updated_at >= $1::timestamptz - INTERVAL '${OVERLAP_MINUTES} minutes'
    ORDER BY updated_at, id
    `,
    [watermark]
  );

  let loaded = 0;
  let maxUpdatedAt = watermark;

  for (const e of result.rows) {
    const job = await warehousePool.query(
      `SELECT job_key FROM analytics.fact_job WHERE job_id = $1`,
      [e.job_id]
    );

    if (!job.rows[0]) {
      continue;
    }

    const createdDateKey =
      Number(
        new Date(e.created_at)
          .toISOString()
          .slice(0, 10)
          .replaceAll("-", "")
      );

    const releasedDateKey = e.released_at
      ? Number(
          new Date(e.released_at)
            .toISOString()
            .slice(0, 10)
            .replaceAll("-", "")
        )
      : null;

    await loadDateDimension(
      new Date(e.created_at).toISOString().slice(0, 10),
      e.released_at
        ? new Date(e.released_at).toISOString().slice(0, 10)
        : new Date(e.created_at).toISOString().slice(0, 10)
    );

    const status = await warehousePool.query(
      `
      INSERT INTO analytics.dim_status (
        entity_type,
        status_code,
        status_description
      )
      VALUES ('escrow', $1, $1)
      ON CONFLICT (entity_type, status_code)
      DO UPDATE SET status_description = EXCLUDED.status_description
      RETURNING status_key
      `,
      [e.status]
    );

    await warehousePool.query(
      `
      INSERT INTO analytics.fact_escrow (
        escrow_id,
        job_key,
        created_date_key,
        released_date_key,
        status_key,
        amount_xlm,
        created_at,
        released_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (escrow_id)
      DO UPDATE SET
        released_date_key = EXCLUDED.released_date_key,
        status_key = EXCLUDED.status_key,
        amount_xlm = EXCLUDED.amount_xlm,
        released_at = EXCLUDED.released_at,
        updated_at = EXCLUDED.updated_at
      `,
      [
        e.id,
        job.rows[0].job_key,
        createdDateKey,
        releasedDateKey,
        status.rows[0].status_key,
        e.amount_xlm,
        e.created_at,
        e.released_at,
        e.updated_at,
      ]
    );

    loaded++;

    if (new Date(e.updated_at) > new Date(maxUpdatedAt)) {
      maxUpdatedAt = new Date(e.updated_at).toISOString();
    }
  }

  await setWatermark("escrows", maxUpdatedAt);

  return {
    table: "escrows",
    loaded,
  };
}

async function loadJobViews() {
  const watermark = await getWatermark("job_views");

  const result = await sourcePool.query(
    `
    SELECT *
    FROM job_views
    WHERE viewed_at >= $1::timestamptz - INTERVAL '${OVERLAP_MINUTES} minutes'
    ORDER BY viewed_at, id
    `,
    [watermark]
  );

  let loaded = 0;
  let maxViewedAt = watermark;

  for (const v of result.rows) {
    const job = await warehousePool.query(
      `SELECT job_key FROM analytics.fact_job WHERE job_id = $1`,
      [v.job_id]
    );

    if (!job.rows[0]) {
      continue;
    }

    const dateKey =
      Number(
        new Date(v.viewed_at)
          .toISOString()
          .slice(0, 10)
          .replaceAll("-", "")
      );

    await loadDateDimension(
      new Date(v.viewed_at).toISOString().slice(0, 10),
      new Date(v.viewed_at).toISOString().slice(0, 10)
    );

    await warehousePool.query(
      `
      INSERT INTO analytics.fact_job_view (
        job_view_id,
        job_key,
        viewed_date_key,
        ip_hash,
        viewed_at
      )
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (job_view_id)
      DO UPDATE SET
        job_key = EXCLUDED.job_key,
        viewed_date_key = EXCLUDED.viewed_date_key,
        ip_hash = EXCLUDED.ip_hash,
        viewed_at = EXCLUDED.viewed_at
      `,
      [
        v.id,
        job.rows[0].job_key,
        dateKey,
        v.ip_hash,
        v.viewed_at,
      ]
    );

    if (new Date(v.viewed_at) > new Date(maxViewedAt)) {
      maxViewedAt = new Date(v.viewed_at).toISOString();
    }
  }

  await setWatermark("job_views", maxViewedAt);

  return {
    table: "job_views",
    loaded: result.rows.length,
  };
}



async function createDailyJobSnapshot() {
  await warehousePool.query(`
    INSERT INTO analytics.snapshot_job_daily (
      snapshot_date,
      job_id,
      status,
      applicant_count,
      view_count,
      budget,
      escrow_status,
      captured_at
    )
    SELECT
      CURRENT_DATE,
      fj.job_id,
      ds.status_code,
      fj.applicant_count,
      fj.view_count,
      fj.budget_amount,
      es.status_code,
      NOW()
    FROM analytics.fact_job fj
    LEFT JOIN analytics.dim_status ds
      ON ds.status_key = fj.status_key
    LEFT JOIN analytics.fact_escrow fe
      ON fe.job_key = fj.job_key
    LEFT JOIN analytics.dim_status es
      ON es.status_key = fe.status_key
    ON CONFLICT (snapshot_date, job_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      applicant_count = EXCLUDED.applicant_count,
      view_count = EXCLUDED.view_count,
      budget = EXCLUDED.budget,
      escrow_status = EXCLUDED.escrow_status,
      captured_at = EXCLUDED.captured_at
  `);

  const { rows } = await warehousePool.query(`
    SELECT COUNT(*)::int AS count
    FROM analytics.snapshot_job_daily
    WHERE snapshot_date = CURRENT_DATE
  `);

  return {
    snapshotDate: new Date().toISOString().slice(0, 10),
    rows: rows[0].count,
  };
}



async function runWarehouseLoad() {
  const client = await warehousePool.connect();

  try {
    await client.query("BEGIN");

    await loadDimensions();

    const jobs = await loadJobs();
    const applications = await loadApplications();
    const escrows = await loadEscrows();
    const jobViews = await loadJobViews();

    const quality = await runWarehouseQualityChecks();

    const snapshot = await createDailyJobSnapshot();

    await client.query("COMMIT");

    

    return {
      success: true,
      jobs,
      applications,
      escrows,
      jobViews,
      quality,
      snapshot,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Warehouse ETL failed:", error);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  runWarehouseLoad,
};