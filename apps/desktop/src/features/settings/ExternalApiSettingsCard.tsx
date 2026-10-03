import { useEffect, useState } from "react";
import { api, type ExternalApiSettings } from "../../shared/api";
import { Button } from "../../shared/ui/Button";
import { FormField, SecretTextInput } from "../../shared/ui/FormControls";
import { Switch } from "../../shared/ui/Switch";
import { TitledCard } from "../../shared/ui/TitledCard";
import { useMessage } from "../../shared/ui/message";
import styles from "./ExternalApiSettingsCard.module.scss";
import { appStore, useAppStore } from "../../shared/store/appStore";

export function ExternalApiSettingsCard() {
  const { gateway } = useAppStore();
  const message = useMessage();
  const [saved, setSaved] = useState<ExternalApiSettings | null>(null);
  const [draft, setDraft] = useState<ExternalApiSettings>({ enabled: false, api_key: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void appStore.refreshGateway();
    const timer = window.setInterval(() => void appStore.refreshGateway(), 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void api.externalApiSettings().then((settings) => {
      setSaved(settings);
      setDraft(settings);
    }).catch((cause: unknown) => message(cause instanceof Error ? cause.message : String(cause)));
  }, [message]);

  const save = async () => {
    try {
      setSaving(true);
      const settings = await api.setExternalApiSettings(draft);
      setSaved(settings);
      setDraft(settings);
      await appStore.refresh();
      message(t("外部 API 设置已保存"));
    } catch (cause) {
      message(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const address = gateway.base_url ?? "-";
  const changed = saved && (saved.enabled !== draft.enabled || saved.api_key !== draft.api_key);

  return <TitledCard title={t("WorkBuddy API 网关")} action={<Button size="small" variant="primary" disabled={!changed || saving} onClick={() => void save()}>
    {saving ? t("保存中…") : t("保存")}
  </Button>}>
    <div className={styles.content}>
      <div className={styles.row}>
        <div className={styles.description}>
          <strong>{t("开启外部 API 网关")}</strong>
          <small>{t("开启后自动同步模型配置到 WorkBuddy；增删、编辑和插件模型变更会在约 2 秒内更新。「一键同步」可用于手动补同步。")}</small>
        </div>
        <Switch label={t("开启外部 API 网关")} checked={draft.enabled} disabled={!saved || saving}
          onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
      </div>
      {gateway.sync_error && <small role="alert">{t("自动同步失败：{error}", { error: gateway.sync_error })}</small>}
      <FormField label={t("API 密钥")} hint={t("留空表示允许免密调用；若填写，所有外部请求须携带此密钥。")}>
        <SecretTextInput value={draft.api_key} autoComplete="off" placeholder={t("留空表示免密")} disabled={!saved || saving}
          onChange={(event) => setDraft((current) => ({ ...current, api_key: event.target.value }))} />
      </FormField>
      <div className={styles.address}>
        <strong>{t("WorkBuddy 填写的接口地址 (Base URL)")}</strong>
        <code>{address}</code>
      </div>
    </div>
  </TitledCard>;
}
