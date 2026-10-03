//! Assembles server dependencies and starts the application services.
use std::{future::IntoFuture, net::SocketAddr, time::Duration};

use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::{
    api,
    config::{Config, ConsoleSource},
    control,
    plugin::{PluginRegistry, PluginRuntime},
    provider::ProviderRouter,
    store::Store,
    Result,
};

pub struct App {
    config: Config,
    router: axum::Router,
    store: Store,
    control: control::ControlService,
}

impl App {
    pub async fn new(mut config: Config) -> Result<Self> {
        let store = Store::connect(&config.database_url).await?;
        if config.use_persisted_ports {
            config
                .listen_addr
                .set_port(store.port_settings().await?.service_port);
        }
        let plugin_runtime = PluginRuntime::managed()?;
        let plugins = PluginRegistry::managed(
            store.clone(),
            plugin_runtime.clone(),
            config.app_version.clone(),
        )?;
        let clients = crate::network::NetworkClients::new(store.clone());
        let provider = std::sync::Arc::new(ProviderRouter::new(
            store.clone(),
            plugins.clone(),
            clients.clone(),
            config.provider_request_timeout,
            config.provider_stream_idle_timeout,
        ));
        let byok = api::byok::router(
            store.clone(),
            plugins.clone(),
            provider.clone(),
            Some(api::byok::NativeForwarder::new(
                store.clone(),
                clients.clone(),
                config.provider_request_timeout,
                config.provider_stream_idle_timeout,
            )),
        );
        let control = control::ControlService::new(
            store.clone(),
            provider,
            plugin_runtime,
            plugins,
            clients.clone(),
        )?;
        let mut router = byok.route(
            "/__byok-api__/healthz",
            axum::routing::get(|| async { "ok" }),
        );
        router = match &config.console {
            Some(ConsoleSource::Directory(directory)) => {
                router.merge(control::web_router(control.clone(), directory))
            }
            Some(ConsoleSource::Proxy(target)) => {
                router.merge(control::proxy_web_router(control.clone(), target.clone()))
            }
            None => router.merge(control::api_router(control.clone())),
        };
        Ok(Self {
            router,
            store,
            control,
            config,
        })
    }

    pub fn merge_router(mut self, router: axum::Router) -> Self {
        self.router = self.router.merge(router);
        self
    }

    pub async fn bind(&self) -> Result<TcpListener> {
        let requested = self.config.listen_addr;
        let listener = bind_service_listener(requested).await?;
        self.control.set_gateway_addr(listener.local_addr()?);
        if self.config.use_persisted_ports {
            self.store
                .set_service_port(listener.local_addr()?.port())
                .await?;
        }
        Ok(listener)
    }

    pub fn store(&self) -> Store {
        self.store.clone()
    }

    pub async fn serve(self) -> Result<()> {
        let listener = self.bind().await?;
        let shutdown = CancellationToken::new();
        let signal_shutdown = shutdown.clone();
        let running = self.serve_on(listener, shutdown);
        tokio::pin!(running);
        tokio::select! {
            result = &mut running => result,
            () = shutdown_signal() => {
                tracing::info!("shutdown signal received; cancelling active runs");
                signal_shutdown.cancel();
                running.await
            }
        }
    }

    pub async fn serve_on(self, listener: TcpListener, shutdown: CancellationToken) -> Result<()> {
        let address = listener.local_addr()?;
        self.control.set_gateway_addr(address);
        tracing::info!(%address, "WorkBuddy gateway listening");
        let mut background = tokio::task::JoinSet::new();
        let sync_control = self.control.clone();
        let sync_shutdown = shutdown.clone();
        background.spawn(async move {
            sync_control.auto_sync_workbuddy(sync_shutdown).await;
        });
        let graceful = shutdown.clone();
        let server = axum::serve(listener, self.router)
            .with_graceful_shutdown(async move {
                graceful.cancelled().await;
            })
            .into_future();
        tokio::pin!(server);

        tokio::select! {
            result = &mut server => {
                result?
            },
            () = shutdown.cancelled() => {
                match tokio::time::timeout(Duration::from_secs(10), &mut server).await {
                    Ok(result) => result?,
                    Err(_) => tracing::warn!("graceful shutdown timed out; forcing server close"),
                }
            }
        }
        Ok(())
    }
}

async fn bind_service_listener(requested: SocketAddr) -> Result<TcpListener> {
    Ok(TcpListener::bind(requested).await?)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
