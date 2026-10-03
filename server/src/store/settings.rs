//! Persists application settings.
use serde::{Deserialize, Serialize};

use crate::Result;

use super::{now_ms, Store};

const PORT_SETTINGS_KEY: &str = "network_ports";
const PROXY_SETTINGS_KEY: &str = "outbound_proxy";
const DESKTOP_SETTINGS_KEY: &str = "desktop_lifecycle";
const PRICING_SETTINGS_KEY: &str = "token_pricing";
const EXTERNAL_API_SETTINGS_KEY: &str = "external_api";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct PortSettings {
    pub service_port: u16,
}

impl Default for PortSettings {
    fn default() -> Self {
        Self { service_port: 3721 }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct ExternalApiSettings {
    pub enabled: bool,
    pub api_key: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct TokenPricingSettings {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_read_per_million: f64,
    pub cache_write_per_million: f64,
}

impl Default for TokenPricingSettings {
    fn default() -> Self {
        Self {
            input_per_million: 5.0,
            output_per_million: 25.0,
            cache_read_per_million: 0.5,
            cache_write_per_million: 6.25,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    #[default]
    Default,
    Custom,
}

impl ProxyMode {
    pub fn is_custom(self) -> bool {
        self == Self::Custom
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct DesktopSettings {
    #[serde(default)]
    pub silent_start: bool,
    #[serde(default = "default_true")]
    pub show_dock_icon: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            silent_start: false,
            show_dock_icon: true,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct ProxySettingsInput {
    pub mode: ProxyMode,
    pub address: String,
    pub auth_enabled: bool,
    pub username: String,
    pub password: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ProxySettings {
    pub mode: ProxyMode,
    pub address: String,
    pub auth_enabled: bool,
    pub username: String,
    pub has_password: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ProxySettingsSecret {
    pub mode: ProxyMode,
    pub address: String,
    pub auth_enabled: bool,
    pub username: String,
    pub password: String,
}

impl Store {
    pub async fn external_api_settings(&self) -> Result<ExternalApiSettings> {
        let value = sqlx::query_scalar::<_, String>(
            "SELECT value_json FROM service_settings WHERE setting_key = ?",
        )
        .bind(EXTERNAL_API_SETTINGS_KEY)
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .unwrap_or_else(|| Ok(ExternalApiSettings::default()))
    }

    pub async fn set_external_api_settings(
        &self,
        mut settings: ExternalApiSettings,
    ) -> Result<ExternalApiSettings> {
        settings.api_key = settings.api_key.trim().to_owned();
        let value_json = serde_json::to_string(&settings)?;
        let _write = self.writes.lock().await;
        sqlx::query("INSERT INTO service_settings(setting_key, value_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms")
            .bind(EXTERNAL_API_SETTINGS_KEY)
            .bind(value_json)
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        Ok(settings)
    }

    pub(crate) async fn proxy_settings_secret(&self) -> Result<ProxySettingsSecret> {
        let value = sqlx::query_scalar::<_, String>(
            "SELECT value_json FROM service_settings WHERE setting_key = ?",
        )
        .bind(PROXY_SETTINGS_KEY)
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .unwrap_or_else(|| Ok(ProxySettingsSecret::default()))
    }

    pub async fn proxy_settings(&self) -> Result<ProxySettings> {
        let settings = self.proxy_settings_secret().await?;
        Ok(ProxySettings {
            mode: settings.mode,
            address: settings.address,
            auth_enabled: settings.auth_enabled,
            username: settings.username,
            has_password: !settings.password.is_empty(),
        })
    }

    pub async fn set_proxy_settings(&self, input: ProxySettingsInput) -> Result<ProxySettings> {
        let existing = self.proxy_settings_secret().await?;
        let address = input.address.trim().to_owned();
        if input.mode.is_custom() {
            let parsed = url::Url::parse(&address)
                .map_err(|error| crate::Error::Config(format!("invalid proxy address: {error}")))?;
            if !matches!(parsed.scheme(), "http" | "https" | "socks5" | "socks5h") {
                return Err(crate::Error::Config(
                    "proxy address must use http, https, socks5, or socks5h".into(),
                ));
            }
            reqwest::Proxy::all(&address)?;
        }
        let password = if input.auth_enabled {
            input
                .password
                .filter(|password| !password.is_empty())
                .unwrap_or(existing.password)
        } else {
            String::new()
        };
        let settings = ProxySettingsSecret {
            mode: input.mode,
            address,
            auth_enabled: input.auth_enabled,
            username: input.username.trim().to_owned(),
            password,
        };
        let value_json = serde_json::to_string(&settings)?;
        let _write = self.writes.lock().await;
        sqlx::query("INSERT INTO service_settings(setting_key, value_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms")
            .bind(PROXY_SETTINGS_KEY)
            .bind(value_json)
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        self.proxy_settings().await
    }

    pub async fn port_settings(&self) -> Result<PortSettings> {
        let value = sqlx::query_scalar::<_, String>(
            "SELECT value_json FROM service_settings WHERE setting_key = ?",
        )
        .bind(PORT_SETTINGS_KEY)
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .unwrap_or_else(|| Ok(PortSettings::default()))
    }

    pub async fn set_port_settings(&self, settings: PortSettings) -> Result<()> {
        if settings.service_port == 0 {
            return Err(crate::Error::Config(
                "service port must be between 1 and 65535".into(),
            ));
        }
        let value_json = serde_json::to_string(&settings)?;
        let _write = self.writes.lock().await;
        sqlx::query(
            "INSERT INTO service_settings(setting_key, value_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(PORT_SETTINGS_KEY)
        .bind(value_json)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_service_port(&self, port: u16) -> Result<()> {
        let mut settings = self.port_settings().await?;
        settings.service_port = port;
        self.set_port_settings(settings).await
    }

    pub async fn desktop_settings(&self) -> Result<DesktopSettings> {
        let value = sqlx::query_scalar::<_, String>(
            "SELECT value_json FROM service_settings WHERE setting_key = ?",
        )
        .bind(DESKTOP_SETTINGS_KEY)
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .unwrap_or_else(|| Ok(DesktopSettings::default()))
    }

    pub async fn set_desktop_settings(&self, settings: DesktopSettings) -> Result<()> {
        let value_json = serde_json::to_string(&settings)?;
        let _write = self.writes.lock().await;
        sqlx::query(
            "INSERT INTO service_settings(setting_key, value_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(DESKTOP_SETTINGS_KEY)
        .bind(value_json)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn pricing_settings(&self) -> Result<TokenPricingSettings> {
        let value = sqlx::query_scalar::<_, String>(
            "SELECT value_json FROM service_settings WHERE setting_key = ?",
        )
        .bind(PRICING_SETTINGS_KEY)
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .unwrap_or_else(|| Ok(TokenPricingSettings::default()))
    }

    pub async fn set_pricing_settings(
        &self,
        settings: TokenPricingSettings,
    ) -> Result<TokenPricingSettings> {
        let value_json = serde_json::to_string(&settings)?;
        let _write = self.writes.lock().await;
        sqlx::query(
            "INSERT INTO service_settings(setting_key, value_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(PRICING_SETTINGS_KEY)
        .bind(value_json)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ExternalApiSettings, ProxyMode, ProxySettingsInput, Store, TokenPricingSettings,
        PROXY_SETTINGS_KEY,
    };

    #[test]
    fn default_proxy_mode_uses_the_default_wire_value() {
        assert_eq!(ProxyMode::default(), ProxyMode::Default);
        assert_eq!(
            serde_json::to_string(&ProxyMode::default()).unwrap(),
            "\"default\""
        );
        assert_eq!(
            serde_json::from_str::<ProxyMode>("\"default\"").unwrap(),
            ProxyMode::Default
        );
        assert!(serde_json::from_str::<ProxyMode>("\"system\"").is_err());
    }

    #[tokio::test]
    async fn invalid_proxy_settings_return_an_error() {
        let directory = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}", directory.path().join("test.db").display());
        let store = Store::connect(&url).await.unwrap();
        sqlx::query(
            "INSERT INTO service_settings(setting_key, value_json, updated_at_ms) VALUES (?, ?, 0)",
        )
        .bind(PROXY_SETTINGS_KEY)
        .bind("invalid JSON")
        .execute(store.pool())
        .await
        .unwrap();

        assert!(store.proxy_settings().await.is_err());
    }

    #[tokio::test]
    async fn custom_proxy_settings_persist() {
        let directory = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}", directory.path().join("test.db").display());
        let store = Store::connect(&url).await.unwrap();
        let saved = store
            .set_proxy_settings(ProxySettingsInput {
                mode: ProxyMode::Custom,
                address: "http://127.0.0.1:7890".into(),
                auth_enabled: false,
                username: String::new(),
                password: None,
            })
            .await
            .unwrap();
        assert_eq!(saved.mode, ProxyMode::Custom);
        assert_eq!(saved.address, "http://127.0.0.1:7890");
        assert_eq!(store.proxy_settings().await.unwrap(), saved);
    }

    #[tokio::test]
    async fn token_pricing_settings_persists_and_reads_back() {
        let directory = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}", directory.path().join("test.db").display());
        let store = Store::connect(&url).await.unwrap();

        assert_eq!(
            store.pricing_settings().await.unwrap(),
            TokenPricingSettings::default()
        );

        let custom = TokenPricingSettings {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cache_read_per_million: 0.3,
            cache_write_per_million: 3.75,
        };
        let saved = store.set_pricing_settings(custom).await.unwrap();
        assert_eq!(saved, custom);

        assert_eq!(store.pricing_settings().await.unwrap(), custom);
    }

    #[tokio::test]
    async fn external_api_defaults_off_and_persists_its_switch() {
        let directory = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}", directory.path().join("test.db").display());
        let store = Store::connect(&url).await.unwrap();

        assert_eq!(
            store.external_api_settings().await.unwrap(),
            ExternalApiSettings::default()
        );
        assert!(!store.external_api_settings().await.unwrap().enabled);
        assert!(store
            .set_external_api_settings(ExternalApiSettings {
                enabled: true,
                api_key: String::new(),
            })
            .await
            .is_ok());
        let settings = ExternalApiSettings {
            enabled: true,
            api_key: "local-test-key".into(),
        };
        assert_eq!(
            store
                .set_external_api_settings(settings.clone())
                .await
                .unwrap(),
            settings
        );
        assert_eq!(
            Store::connect(&url)
                .await
                .unwrap()
                .external_api_settings()
                .await
                .unwrap(),
            settings
        );
    }
}
