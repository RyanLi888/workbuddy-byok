//! Accounting and cleanup for provider call statistics.
use super::Store;
use crate::Result;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct StatisticsStorage {
    pub call_count: i64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StatisticsStorageScope {
    #[default]
    Details,
    All,
}

impl Store {
    pub async fn statistics_storage(&self) -> Result<StatisticsStorage> {
        Ok(StatisticsStorage {
            call_count: sqlx::query_scalar("SELECT COUNT(*) FROM llm_calls")
                .fetch_one(&self.pool)
                .await?,
        })
    }
    pub async fn clear_statistics_storage(&self) -> Result<StatisticsStorage> {
        self.clear_call_storage(false).await
    }
    pub async fn clear_all_statistics_storage(&self) -> Result<StatisticsStorage> {
        self.clear_call_storage(true).await
    }
    async fn clear_call_storage(&self, all: bool) -> Result<StatisticsStorage> {
        let _write = self.writes.lock().await;
        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM llm_call_requests")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM llm_call_response_chunks")
            .execute(&mut *transaction)
            .await?;
        if all {
            sqlx::query("DELETE FROM llm_calls")
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        self.statistics_storage().await
    }
}
