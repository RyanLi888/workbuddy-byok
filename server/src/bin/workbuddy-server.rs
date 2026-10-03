//! Starts the WorkBuddy BYOK server executable.
use tracing_subscriber::prelude::*;
use workbuddy_server::{App, Config, Result};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "workbuddy_server=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    App::new(Config::from_env()?).await?.serve().await
}
