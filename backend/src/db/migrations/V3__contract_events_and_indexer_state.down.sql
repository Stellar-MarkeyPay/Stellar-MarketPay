-- rollback: destructive. This deletes indexed contract-event history and state.
DROP TABLE IF EXISTS contract_events;
DROP TABLE IF EXISTS indexer_state;
