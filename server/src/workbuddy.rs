//! Writes the WorkBuddy custom model file without replacing user-owned models.
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use crate::{
    catalog::{GatewayModel, MANAGED_MODEL_PREFIX},
    Error, Result,
};

pub fn models_path() -> Result<PathBuf> {
    // Explicit override supports installations using a different configuration directory.
    if let Some(path) = std::env::var_os("WORKBUDDY_MODELS_PATH") {
        return Ok(PathBuf::from(path));
    }
    Ok(dirs::home_dir()
        .ok_or_else(|| Error::Config("cannot resolve user home directory".into()))?
        .join(".workbuddy")
        .join("models.json"))
}

fn merge(
    mut config: Value,
    models: &[GatewayModel],
    endpoint: &str,
    api_key: &str,
) -> Result<Value> {
    let entries = config.as_array_mut().ok_or_else(|| {
        Error::Config("WorkBuddy models.json must contain an array of custom models".into())
    })?;
    // WorkBuddy owns the selected default; BYOK owns the model's capabilities.
    let defaults: std::collections::HashMap<String, String> = entries
        .iter()
        .filter_map(|entry| {
            let tag = entry.get("tags")?.as_array()?.iter().find_map(|tag| {
                tag.as_str()
                    .filter(|tag| tag.starts_with(MANAGED_MODEL_PREFIX))
            })?;
            let effort = entry.pointer("/reasoning/defaultEffort")?.as_str()?;
            Some((tag.to_owned(), effort.to_owned()))
        })
        .collect();
    entries.retain(|entry| {
        let old_managed_id = entry
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id.starts_with(MANAGED_MODEL_PREFIX));
        let managed_tag = entry
            .get("tags")
            .and_then(Value::as_array)
            .is_some_and(|tags| {
                tags.iter().any(|tag| {
                    tag.as_str()
                        .is_some_and(|tag| tag.starts_with(MANAGED_MODEL_PREFIX))
                })
            });
        !(old_managed_id || managed_tag)
    });
    for model in models {
        if entries
            .iter()
            .any(|entry| entry.get("id").and_then(Value::as_str) == Some(&model.public_id))
        {
            return Err(Error::Config(format!(
                "WorkBuddy model ID '{}' conflicts with a personal model; change the BYOK display name",
                model.public_id
            )));
        }
        let mut entry = json!({
            "id": model.public_id, "name": model.public_id, "vendor": model.vendor,
            "tags": [format!("{MANAGED_MODEL_PREFIX}{}", model.internal_id),
                format!("badge:{}:#2980B9", model.vendor.to_uppercase())],
            "url": endpoint, "apiKey": api_key, "supportsToolCall": true,
            "supportsImages": model.images, "supportsReasoning": model.reasoning,
            "useCustomProtocol": true,
        });
        if !model.reasoning_efforts.is_empty() {
            entry["reasoning"] = json!({
                "supportedEfforts": model.reasoning_efforts.iter().filter(|effort| effort.as_str() != "none").collect::<Vec<_>>(),
                "canDisableThinking": model.reasoning_efforts.iter().any(|effort| effort == "none"),
            });
            if let Some(effort) =
                defaults.get(&format!("{MANAGED_MODEL_PREFIX}{}", model.internal_id))
            {
                if model.reasoning_efforts.contains(effort) {
                    entry["reasoning"]["defaultEffort"] = json!(effort);
                }
            }
        }
        if let Some(description) = &model.description {
            entry["description"] = json!(description);
        }
        if let Some(tokens) = model.context_window_tokens {
            entry["maxInputTokens"] = json!(tokens);
        }
        if let Some(tokens) = model.max_output_tokens {
            entry["maxOutputTokens"] = json!(tokens);
        }
        entries.push(entry);
    }
    Ok(config)
}

pub async fn sync(
    path: &Path,
    models: &[GatewayModel],
    endpoint: &str,
    api_key: &str,
) -> Result<usize> {
    let original = match tokio::fs::read(path).await {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let config = match &original {
        Some(bytes) if !bytes.iter().all(u8::is_ascii_whitespace) => serde_json::from_slice(bytes)
            .map_err(|error| {
                Error::Config(format!("cannot parse WorkBuddy models.json: {error}"))
            })?,
        _ => json!([]),
    };
    let previous = config.clone();
    let config = merge(config, models, endpoint, api_key)?;
    // The background reconciler must not rewrite the file or its backup when unchanged.
    if config == previous && original.is_some() {
        return Ok(models.len());
    }
    let parent = path
        .parent()
        .ok_or_else(|| Error::Config("model file requires a parent directory".into()))?;
    tokio::fs::create_dir_all(parent).await?;
    let temporary = parent.join(format!(".models-{}.tmp", uuid::Uuid::new_v4()));
    let result = async {
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary).await?;
        file.write_all(&serde_json::to_vec_pretty(&config)?).await?;
        file.sync_all().await?;
        drop(file);
        let current = match tokio::fs::read(path).await {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        if current != original {
            return Err(Error::Config(
                "WorkBuddy model configuration changed during sync; retry".into(),
            ));
        }
        if let Some(bytes) = &original {
            let mut backup_options = tokio::fs::OpenOptions::new();
            backup_options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            backup_options.mode(0o600);
            let mut backup = backup_options.open(path.with_extension("json.bak")).await?;
            backup.write_all(bytes).await?;
            backup.sync_all().await?;
        }
        tokio::fs::rename(&temporary, path).await?;
        Ok(models.len())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str) -> GatewayModel {
        GatewayModel {
            public_id: id.into(),
            internal_id: id.into(),
            display_name: id.into(),
            description: Some("A model note".into()),
            vendor: "test".into(),
            aliases: vec![],
            images: false,
            reasoning: false,
            reasoning_efforts: Vec::new(),
            context_window_tokens: None,
            max_output_tokens: Some(100),
        }
    }

    #[test]
    fn sync_removes_old_ids_and_tagged_models_but_preserves_personal_entries() {
        let personal = json!({"id": "personal", "tags": ["custom", "badge:Mine:#123456"], "custom": {"keep": true}});
        let config = json!([
            personal,
            {"id": "workbuddy-byok:api:obsolete", "name": "Old"},
            {"id": "deleted model", "tags": ["workbuddy-byok:obsolete"]},
        ]);
        let saved = merge(config, &[model("GPT")], "local", "key").unwrap();
        assert_eq!(saved.as_array().unwrap().len(), 2);
        assert_eq!(saved[0], personal);
        assert_eq!(saved[1]["id"], "GPT");
        assert_eq!(saved[1]["name"], "GPT");
        assert_eq!(
            saved[1]["tags"],
            json!(["workbuddy-byok:GPT", "badge:TEST:#2980B9"])
        );
    }

    #[test]
    fn sync_publishes_strengths_and_preserves_workbuddy_default_across_renames() {
        let mut model = model("New name");
        model.internal_id = "stable-id".into();
        model.reasoning = true;
        model.reasoning_efforts = vec!["none".into(), "low".into(), "high".into()];
        let config = json!([{
            "id": "Old name", "tags": ["workbuddy-byok:stable-id"],
            "reasoning": {"defaultEffort": "high"}
        }]);
        let saved = merge(config, std::slice::from_ref(&model), "local", "key").unwrap();
        assert_eq!(saved[0]["id"], "New name");
        assert_eq!(
            saved[0]["reasoning"],
            json!({
                "supportedEfforts": ["low", "high"], "canDisableThinking": true,
                "defaultEffort": "high"
            })
        );
        assert_eq!(
            merge(saved.clone(), std::slice::from_ref(&model), "local", "key").unwrap(),
            saved
        );

        model.reasoning_efforts = vec!["low".into()];
        let saved = merge(saved, &[model], "local", "key").unwrap();
        assert_eq!(
            saved[0]["reasoning"],
            json!({
                "supportedEfforts": ["low"], "canDisableThinking": false
            })
        );
    }

    #[test]
    fn sync_does_not_choose_a_default_strength_for_workbuddy() {
        let mut model = model("GPT");
        model.reasoning = true;
        model.reasoning_efforts = vec!["low".into(), "high".into()];
        let saved = merge(json!([]), &[model], "local", "key").unwrap();
        assert_eq!(
            saved[0]["reasoning"],
            json!({
                "supportedEfforts": ["low", "high"], "canDisableThinking": false
            })
        );
    }

    #[tokio::test]
    async fn personal_id_conflict_leaves_configuration_and_backup_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models.json");
        let original = json!([{"id": "GPT", "name": "Personal", "url": "private"}]).to_string();
        tokio::fs::write(&path, &original).await.unwrap();
        tokio::fs::write(path.with_extension("json.bak"), "previous backup")
            .await
            .unwrap();
        assert!(sync(&path, &[model("GPT")], "local", "").await.is_err());
        assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), original);
        assert_eq!(
            tokio::fs::read_to_string(path.with_extension("json.bak"))
                .await
                .unwrap(),
            "previous backup"
        );
    }

    #[tokio::test]
    async fn sync_preserves_user_config_updates_port_and_removes_obsolete_models() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models.json");
        let original = json!([{ "id": "personal", "apiKey": "keep", "custom": { "keep": true } }]);
        tokio::fs::write(&path, original.to_string()).await.unwrap();
        sync(
            &path,
            &[model("api:a"), model("plugin:b")],
            "http://127.0.0.1:3721/v1/chat/completions",
            "local",
        )
        .await
        .unwrap();
        sync(
            &path,
            &[model("plugin:b")],
            "http://127.0.0.1:4000/v1/chat/completions",
            "changed",
        )
        .await
        .unwrap();
        let saved: Value = serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        assert_eq!(saved.as_array().unwrap().len(), 2);
        assert_eq!(saved[0], original[0]);
        assert_eq!(saved[1]["url"], "http://127.0.0.1:4000/v1/chat/completions");
        assert!(path.with_extension("json.bak").exists());
    }

    #[tokio::test]
    async fn malformed_configuration_is_never_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models.json");
        for original in [
            "broken",
            "{}",
            "null",
            "{\"models\":{}}",
            "{\"availableModels\":false}",
        ] {
            tokio::fs::write(&path, original).await.unwrap();
            assert!(sync(&path, &[model("api:a")], "local", "").await.is_err());
            assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), original);
        }
    }

    #[tokio::test]
    async fn empty_file_is_initialized_with_the_native_array_format() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models.json");
        tokio::fs::write(&path, " \n").await.unwrap();
        sync(&path, &[model("api:a")], "local", "").await.unwrap();
        let saved: Value = serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        assert!(saved.is_array());
        assert_eq!(saved[0]["id"], "api:a");
        assert_eq!(saved[0]["name"], saved[0]["id"]);
        assert_eq!(saved[0]["description"], "A model note");
        assert_eq!(
            saved[0]["tags"],
            json!(["workbuddy-byok:api:a", "badge:TEST:#2980B9"])
        );
        assert_eq!(
            tokio::fs::read_to_string(path.with_extension("json.bak"))
                .await
                .unwrap(),
            " \n"
        );
    }

    #[tokio::test]
    async fn unchanged_sync_keeps_file_format_and_previous_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models.json");
        sync(&path, &[model("api:a")], "local", "").await.unwrap();
        let compact = serde_json::from_slice::<Value>(&tokio::fs::read(&path).await.unwrap())
            .unwrap()
            .to_string();
        tokio::fs::write(&path, &compact).await.unwrap();
        tokio::fs::write(path.with_extension("json.bak"), "previous backup")
            .await
            .unwrap();
        sync(&path, &[model("api:a")], "local", "").await.unwrap();
        assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), compact);
        assert_eq!(
            tokio::fs::read_to_string(path.with_extension("json.bak"))
                .await
                .unwrap(),
            "previous backup"
        );
    }
}
