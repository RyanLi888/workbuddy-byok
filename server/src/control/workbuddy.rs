use axum::{extract::State, Json};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::{control::ControlService, Result};

impl ControlService {
    /// Reconcile the shared catalog, including plugin/account changes, for this server lifecycle.
    pub(crate) async fn auto_sync_workbuddy(&self, shutdown: CancellationToken) {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_error = None;
        loop {
            tokio::select! {
                () = shutdown.cancelled() => return,
                _ = interval.tick() => {}
            }
            let result = match self.external_api_settings().await {
                Ok(settings) if settings.enabled => self.sync_to_workbuddy().await.map(|_| ()),
                Ok(_) => {
                    *self.workbuddy_sync_error.write() = None;
                    Ok(())
                }
                Err(error) => {
                    *self.workbuddy_sync_error.write() = Some(error.to_string());
                    Err(error)
                }
            };
            let error = result.err().map(|error| error.to_string());
            if error != last_error {
                if let Some(error) = &error {
                    tracing::warn!(%error, "automatic WorkBuddy model sync failed; will retry");
                }
                last_error = error.clone();
            }
        }
    }
}

pub async fn status(State(service): State<ControlService>) -> Result<Json<Value>> {
    Ok(Json(service.gateway_status().await?))
}

pub async fn sync_models(State(service): State<ControlService>) -> Result<Json<Value>> {
    let (synced_count, path) = service.sync_to_workbuddy().await?;
    Ok(Json(json!({
        "success": true,
        "syncedCount": synced_count,
        "path": path,
    })))
}
