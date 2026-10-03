//! One model catalog shared by the gateway and WorkBuddy configuration writer.
use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{plugin::PluginRegistry, store::Store, Error, Result};

pub const MANAGED_MODEL_PREFIX: &str = "workbuddy-byok:";

#[derive(Clone, Debug)]
pub struct GatewayModel {
    pub public_id: String,
    pub internal_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub vendor: String,
    pub aliases: Vec<String>,
    pub images: bool,
    pub reasoning: bool,
    pub reasoning_efforts: Vec<String>,
    pub context_window_tokens: Option<u64>,
    pub max_output_tokens: Option<u64>,
}

pub async fn list(store: &Store, plugins: &PluginRegistry) -> Result<Vec<GatewayModel>> {
    let mut configured = store.models().await?;
    configured.sort_by_key(|model| (model.sort_order, model.model_hash.clone()));
    let mut models = Vec::new();
    for model in configured {
        let vendor = model
            .group_name
            .clone()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| {
                url::Url::parse(&model.base_url)
                    .ok()
                    .and_then(|url| url.host_str().map(str::to_owned))
                    .unwrap_or_else(|| "API".into())
            });
        models.push(GatewayModel {
            public_id: String::new(),
            internal_id: model.model_hash.clone(),
            display_name: model.display_name.clone(),
            description: (!model.tooltip_data.is_empty()).then(|| model.tooltip_data.clone()),
            aliases: vec![
                model.model_id.clone(),
                model.display_name.clone(),
                format!("{vendor}/{}", model.model_id),
            ],
            vendor,
            images: true,
            reasoning: model.reasoning_effort.is_some()
                || model.anthropic_thinking_effort.is_some()
                || model.thinking_budget_tokens.is_some(),
            reasoning_efforts: Vec::new(),
            context_window_tokens: model.context_window_tokens,
            max_output_tokens: model.max_output_tokens(),
        });
    }
    for model in plugins.configured_models().await {
        models.push(GatewayModel {
            public_id: String::new(),
            internal_id: model.id.clone(),
            display_name: model.display_name.clone(),
            description: model.description.clone(),
            vendor: model.provider_id.clone(),
            aliases: vec![model.model_id.clone(), model.display_name.clone(), model.id],
            images: model.images,
            reasoning: model.reasoning,
            reasoning_efforts: model.reasoning_efforts.clone(),
            context_window_tokens: model.context_window_tokens,
            max_output_tokens: model.max_output_tokens,
        });
    }
    assign_public_ids(&mut models);
    Ok(models)
}

/// WorkBuddy renders custom models as `name:id` unless the two are equal.
/// Keep IDs readable; qualify duplicate names by provider, then by identity.
fn assign_public_ids(models: &mut [GatewayModel]) {
    let mut name_counts = HashMap::new();
    for model in models.iter() {
        *name_counts.entry(model.display_name.as_str()).or_insert(0) += 1;
    }
    let candidates: Vec<String> = models
        .iter()
        .map(|model| {
            if name_counts[model.display_name.as_str()] == 1 {
                model.display_name.clone()
            } else {
                format!("{} ({})", model.display_name, model.vendor)
            }
        })
        .collect();
    let mut counts = HashMap::new();
    for candidate in &candidates {
        *counts.entry(candidate.as_str()).or_insert(0) += 1;
    }
    let mut used: HashSet<String> = candidates
        .iter()
        .filter(|candidate| counts[candidate.as_str()] == 1)
        .cloned()
        .collect();
    // Resolve even collisions with user-chosen display names deterministically.
    let mut indices: Vec<_> = (0..models.len()).collect();
    indices.sort_by(|&left, &right| models[left].internal_id.cmp(&models[right].internal_id));
    for index in indices {
        let candidate = &candidates[index];
        let id = if counts[candidate.as_str()] == 1 {
            candidate.clone()
        } else {
            let digest = Sha256::digest(models[index].internal_id.as_bytes());
            let base = format!("{candidate} [{}]", hex::encode(&digest[..4]));
            let mut id = base.clone();
            let mut suffix = 2;
            while !used.insert(id.clone()) {
                id = format!("{base} {suffix}");
                suffix += 1;
            }
            id
        };
        models[index].public_id = id;
    }
}

pub fn resolve<'a>(models: &'a [GatewayModel], id: &str) -> Result<Option<&'a GatewayModel>> {
    if let Some(model) = models.iter().find(|model| model.public_id == id) {
        return Ok(Some(model));
    }
    let mut matches = models
        .iter()
        .filter(|model| model.aliases.iter().any(|alias| alias == id));
    let matched = matches.next();
    if matches.next().is_some() {
        return Err(Error::Protocol(format!(
            "model '{id}' is ambiguous; use an ID from /v1/models"
        )));
    }
    Ok(matched)
}

pub fn response(models: &[GatewayModel]) -> Value {
    json!({"object": "list", "data": models.iter().map(|model| json!({
        "id": model.public_id, "object": "model", "created": 0,
        "owned_by": model.vendor, "name": model.display_name,
    })).collect::<Vec<_>>()})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(identity: &str, name: &str, vendor: &str) -> GatewayModel {
        GatewayModel {
            public_id: String::new(),
            internal_id: identity.into(),
            display_name: name.into(),
            description: None,
            vendor: vendor.into(),
            aliases: vec![name.into()],
            images: true,
            reasoning: false,
            reasoning_efforts: Vec::new(),
            context_window_tokens: None,
            max_output_tokens: None,
        }
    }

    #[test]
    fn readable_ids_distinguish_providers_and_duplicate_configurations() {
        let mut models = vec![
            model("one", "GPT", "provider-a"),
            model("two", "GPT", "provider-b"),
            model("three", "Claude", "provider-a"),
            model("four", "Claude", "provider-a"),
            model("five", "Gemini", "google"),
            // A display name can collide with a generated provider-qualified ID.
            model("six", "GPT (provider-a)", "provider-c"),
        ];
        assign_public_ids(&mut models);
        assert_eq!(models[1].public_id, "GPT (provider-b)");
        assert_eq!(models[4].public_id, "Gemini");
        assert_eq!(
            models
                .iter()
                .map(|model| &model.public_id)
                .collect::<HashSet<_>>()
                .len(),
            models.len()
        );
        assert!(resolve(&models, "GPT").is_err());
        assert!(resolve(&models, "Claude").is_err());
        for model in &models {
            assert_eq!(
                resolve(&models, &model.public_id)
                    .unwrap()
                    .unwrap()
                    .internal_id,
                model.internal_id
            );
            assert!(!model.public_id.contains(MANAGED_MODEL_PREFIX));
        }
        let before: HashMap<_, _> = models
            .iter()
            .map(|model| (model.internal_id.clone(), model.public_id.clone()))
            .collect();
        models.reverse();
        assign_public_ids(&mut models);
        for model in models {
            assert_eq!(model.public_id, before[&model.internal_id]);
        }
    }
}
