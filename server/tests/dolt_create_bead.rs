//! Integration tests for the transactional bead creation path.
//!
//! These talk to a real Dolt server on 127.0.0.1:3307 (the address
//! `DoltManager::new()` uses) and create, then drop, a scratch database. That
//! is destructive enough that they never run by accident: set
//! `BEADS_DOLT_TEST=1` to enable them. Without the variable — CI included —
//! each test returns immediately.
//!
//! To run them locally, start a throwaway server in an empty directory:
//!
//! ```text
//! dolt init && dolt sql-server --host 127.0.0.1 --port 3307 --user root
//! BEADS_DOLT_TEST=1 cargo test --test dolt_create_bead -- --test-threads=1
//! ```

use beads_server::dolt::DoltManager;
use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool};

const TEST_DB: &str = "beads_txn_probe";

fn enabled() -> bool {
    std::env::var("BEADS_DOLT_TEST").is_ok_and(|v| v == "1")
}

async fn probe_pool() -> Pool {
    let opts: Opts = OptsBuilder::default()
        .ip_or_hostname("127.0.0.1")
        .tcp_port(3307)
        .user(Some("root"))
        .into();
    Pool::new(opts)
}

/// Recreates the scratch database with a bd-1.1.x-shaped schema.
///
/// `dependency_extra_column` adds a NOT NULL column with no default to
/// `dependencies`, which makes the parent-link insert fail — that is how the
/// rollback path gets exercised.
async fn reset_schema(pool: &Pool, dependency_extra_column: bool) {
    let mut conn = pool.get_conn().await.expect("connect to probe server");

    conn.query_drop(format!("DROP DATABASE IF EXISTS `{}`", TEST_DB)).await.unwrap();
    conn.query_drop(format!("CREATE DATABASE `{}`", TEST_DB)).await.unwrap();
    conn.query_drop(format!("USE `{}`", TEST_DB)).await.unwrap();

    conn.query_drop(
        "CREATE TABLE issues (
            id varchar(64) PRIMARY KEY,
            title varchar(500) NOT NULL,
            description longtext,
            status varchar(32) NOT NULL,
            priority int NOT NULL,
            issue_type varchar(32) NOT NULL,
            owner varchar(128) NOT NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            created_by varchar(128) NOT NULL
        )",
    ).await.unwrap();

    let extra = if dependency_extra_column {
        ", must_be_supplied varchar(32) NOT NULL"
    } else {
        ""
    };
    conn.query_drop(format!(
        "CREATE TABLE dependencies (
            id char(36) PRIMARY KEY,
            issue_id varchar(64) NOT NULL,
            depends_on_issue_id varchar(64) NOT NULL,
            type varchar(32) NOT NULL,
            created_by varchar(128) NOT NULL{}
        )",
        extra
    )).await.unwrap();

    conn.query_drop("CALL DOLT_COMMIT('-Am', 'probe: schema')").await.unwrap();
}

/// Counts rows in `table` whose `key_column` holds `id`.
async fn count(pool: &Pool, table: &str, key_column: &str, id: &str) -> u64 {
    let mut conn = pool.get_conn().await.unwrap();
    conn.exec_first(
        format!(
            "SELECT COUNT(*) FROM `{}`.{} WHERE `{}` = :id",
            TEST_DB, table, key_column
        ),
        mysql_async::params! { "id" => id },
    ).await.unwrap().unwrap_or(0)
}

async fn drop_test_db(pool: &Pool) {
    let mut conn = pool.get_conn().await.unwrap();
    conn.query_drop(format!("DROP DATABASE IF EXISTS `{}`", TEST_DB)).await.unwrap();
}

#[tokio::test]
async fn test_create_bead_writes_issue_and_parent_link() {
    if !enabled() {
        println!("BEADS_DOLT_TEST is not set to 1, skipping");
        return;
    }
    let pool = probe_pool().await;
    reset_schema(&pool, false).await;

    let dolt = DoltManager::new();
    dolt.create_bead(TEST_DB, "probe-parent", "Parent", None, "epic", 1, None)
        .await
        .expect("parent create");
    dolt.create_bead(TEST_DB, "probe-child", "Child", Some("d"), "task", 2, Some("probe-parent"))
        .await
        .expect("child create");

    assert_eq!(count(&pool, "issues", "id", "probe-child").await, 1, "issue row missing");
    assert_eq!(count(&pool, "dependencies", "issue_id", "probe-child").await, 1, "parent link missing");

    drop_test_db(&pool).await;
}

#[tokio::test]
async fn test_failed_parent_link_leaves_no_orphan_issue() {
    if !enabled() {
        println!("BEADS_DOLT_TEST is not set to 1, skipping");
        return;
    }
    let pool = probe_pool().await;
    // `dependencies` now has a required column the insert does not fill, so the
    // second write fails and the first one has to be rolled back with it.
    reset_schema(&pool, true).await;

    let dolt = DoltManager::new();
    dolt.create_bead(TEST_DB, "probe-parent", "Parent", None, "epic", 1, None)
        .await
        .expect("parent create");

    let result = dolt
        .create_bead(TEST_DB, "probe-orphan", "Orphan", None, "task", 2, Some("probe-parent"))
        .await;
    assert!(result.is_err(), "expected the parent link to fail");

    assert_eq!(
        count(&pool, "issues", "id", "probe-orphan").await,
        0,
        "issue row survived a failed parent link — that is the orphan this test guards against"
    );

    drop_test_db(&pool).await;
}
