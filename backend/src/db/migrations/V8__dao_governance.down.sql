-- rollback: destructive. This deletes DAO proposals, votes, and arbitrator records.
DROP TABLE IF EXISTS dao_votes CASCADE;
DROP TABLE IF EXISTS dao_arbitrators CASCADE;
DROP TABLE IF EXISTS dao_proposals CASCADE;
