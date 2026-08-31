-- Migration V19 Rollback: Multi-Region Active-Active PostgreSQL

DROP FUNCTION IF EXISTS get_crdt_pn_value(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS register_crdt_pn_delta(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS assert_valid_fencing_lease(TEXT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS acquire_fencing_lease(TEXT, TEXT, TEXT, INTEGER);

DROP TABLE IF EXISTS replication_heartbeats CASCADE;
DROP TABLE IF EXISTS crdt_pn_counters CASCADE;
DROP TABLE IF EXISTS replication_conflicts CASCADE;
DROP TABLE IF EXISTS region_fencing_leases CASCADE;
DROP TABLE IF EXISTS replication_table_policies CASCADE;
DROP TABLE IF EXISTS replication_nodes CASCADE;
