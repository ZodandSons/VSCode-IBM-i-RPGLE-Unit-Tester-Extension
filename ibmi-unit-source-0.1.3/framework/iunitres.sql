-- IBM i Unit results table. {LIB} is replaced with the configured library.
-- One row per executed test; the extension reads rows by RUNID.
CREATE OR REPLACE TABLE {LIB}.IUNITRES (
  RUNID        CHAR(26)      NOT NULL,
  TESTLIB      VARCHAR(10)   NOT NULL,
  TESTOBJ      VARCHAR(10)   NOT NULL,
  TESTNAME     VARCHAR(128)  NOT NULL,
  SEQ          INTEGER       NOT NULL,
  STATUS       VARCHAR(10)   NOT NULL,
  ASSERTS      INTEGER       NOT NULL,
  MESSAGE      VARCHAR(1024) NOT NULL,
  STARTED      TIMESTAMP     NOT NULL,
  DURATION_MS  BIGINT        NOT NULL
) ON REPLACE PRESERVE ROWS
