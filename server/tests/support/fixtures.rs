//! Provides isolated stores and canonical message fixtures for tests.
#![allow(dead_code)]

use std::sync::OnceLock;

use workbuddy_server::{
    model::{CanonicalMessage, Origin, Role},
    store::Store,
};

pub async fn temp_store() -> (tempfile::TempDir, Store) {
    // Managed plugins use process-level paths. Initialize them once before any
    // test constructs a runtime, so parallel tests never read a user's accounts.
    static DATA_DIRECTORY: OnceLock<tempfile::TempDir> = OnceLock::new();
    DATA_DIRECTORY.get_or_init(|| {
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("WORKBUDDY_DATA_DIR", directory.path());
        std::env::set_var(
            "WORKBUDDY_MODELS_PATH",
            directory.path().join("models.json"),
        );
        directory
    });
    let directory = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}", directory.path().join("test.db").display());
    let store = Store::connect(&url).await.unwrap();
    (directory, store)
}

pub fn user(id: &str, text: &str) -> CanonicalMessage {
    CanonicalMessage::text(id, Role::User, Origin::User, text)
}
