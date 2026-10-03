//! Exercise automatic synchronization against an isolated WorkBuddy file and database.
use std::{path::Path, time::Duration};

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use workbuddy_server::{model::ModelConfigInput, store::ExternalApiSettings, App, Config};

async fn wait_for_models(path: &Path, expected: usize) -> Value {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if let Ok(bytes) = tokio::fs::read(path).await {
                if let Ok(config) = serde_json::from_slice::<Value>(&bytes) {
                    if config
                        .as_array()
                        .is_some_and(|models| models.len() == expected)
                    {
                        return config;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("automatic sync did not update the model file")
}

#[tokio::test]
async fn automatic_sync_tracks_changes_recovers_and_uses_the_active_listener() {
    // This test binary contains one test; overrides never reach the real user files.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workbuddy/models.json");
    std::env::set_var("WORKBUDDY_DATA_DIR", directory.path());
    std::env::set_var("WORKBUDDY_MODELS_PATH", &path);
    let mut config = Config::from_env().unwrap();
    config.listen_addr = "127.0.0.1:0".parse().unwrap();
    config.use_persisted_ports = false;
    config.console = None;
    let app = App::new(config.clone()).await.unwrap();
    let store = app.store();
    let input: ModelConfigInput = serde_json::from_value(json!({
        "display_name": "First", "type": "openai", "base_url": "https://example.com/v1",
        "api_key": "upstream", "tooltip_data": "test", "model_id": "first",
        "openai_endpoint": "/v1/chat/completions"
    }))
    .unwrap();
    let first = store.create_model(&input).await.unwrap();
    let listener = app.bind().await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let shutdown = CancellationToken::new();
    let running = tokio::spawn(app.serve_on(listener, shutdown.clone()));
    let client = reqwest::Client::new();
    let status_url = format!("http://127.0.0.1:{port}/__byok-api__/api/workbuddy/status");
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        store.external_api_settings().await.unwrap(),
        ExternalApiSettings::default()
    );
    assert!(!path.parent().unwrap().exists());

    // A fresh installation needs no pre-existing WorkBuddy directory, file, or gateway key.
    store
        .set_external_api_settings(ExternalApiSettings {
            enabled: true,
            api_key: String::new(),
        })
        .await
        .unwrap();
    let initialized = wait_for_models(&path, 1).await;
    assert_eq!(initialized[0]["id"], "First");
    assert_eq!(
        initialized[0]["url"],
        format!("http://127.0.0.1:{port}/v1/chat/completions")
    );
    assert_eq!(initialized[0]["apiKey"], "");
    assert_eq!(initialized[0]["useCustomProtocol"], true);
    assert_eq!(initialized[0]["supportsToolCall"], true);
    assert!(!initialized.to_string().contains("upstream"));
    assert!(!path.with_extension("json.bak").exists());
    let response = client
        .get(format!("http://127.0.0.1:{port}/v1/models"))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let catalog: Value = response.json().await.unwrap();
    assert_eq!(catalog["data"][0]["id"], initialized[0]["id"]);

    let personal = json!({"id": "personal", "custom": {"keep": true}});
    tokio::fs::write(&path, json!([personal.clone()]).to_string())
        .await
        .unwrap();

    store
        .set_external_api_settings(ExternalApiSettings {
            enabled: true,
            api_key: "local".into(),
        })
        .await
        .unwrap();
    let saved = wait_for_models(&path, 2).await;
    assert_eq!(saved[0], personal);
    assert_eq!(
        saved[1]["url"],
        format!("http://127.0.0.1:{port}/v1/chat/completions")
    );
    assert_eq!(saved[1]["apiKey"], "local");
    assert_eq!(saved[1]["id"], "First");
    assert_eq!(saved[1]["name"], "First");
    assert_eq!(saved[1]["description"], "test");
    assert_eq!(saved[1]["tags"][1], "badge:EXAMPLE.COM:#2980B9");

    let mut second_input = input.clone();
    second_input.model_id = "second".into();
    let second = store.create_model(&second_input).await.unwrap();
    wait_for_models(&path, 3).await;
    store.delete_model(&first.model_hash).await.unwrap();
    let saved = wait_for_models(&path, 2).await;
    assert_eq!(saved[1]["id"], second.display_name);

    // Malformed user files remain intact, expose an error, and recover automatically.
    tokio::fs::write(&path, "broken").await.unwrap();
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let status: Value = client
                .get(&status_url)
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            if status["sync_error"].is_string() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), "broken");
    tokio::fs::write(&path, json!([personal.clone()]).to_string())
        .await
        .unwrap();
    wait_for_models(&path, 2).await;
    let status: Value = client
        .get(&status_url)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(status["sync_error"].is_null());

    // Editing the credential updates existing entries, and removing the last model clears them.
    store
        .set_external_api_settings(ExternalApiSettings {
            enabled: true,
            api_key: "changed".into(),
        })
        .await
        .unwrap();
    store.delete_model(&second.model_hash).await.unwrap();
    assert_eq!(wait_for_models(&path, 1).await[0], personal);
    store.create_model(&input).await.unwrap();
    assert_eq!(wait_for_models(&path, 2).await[1]["apiKey"], "changed");
    shutdown.cancel();
    running.await.unwrap().unwrap();

    // A new server lifecycle automatically replaces the previous listener address.
    let app = App::new(config).await.unwrap();
    let listener = app.bind().await.unwrap();
    let next_port = listener.local_addr().unwrap().port();
    let shutdown = CancellationToken::new();
    let running = tokio::spawn(app.serve_on(listener, shutdown.clone()));
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let saved = wait_for_models(&path, 2).await;
            if saved[1]["url"] == format!("http://127.0.0.1:{next_port}/v1/chat/completions") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    shutdown.cancel();
    running.await.unwrap().unwrap();
}
