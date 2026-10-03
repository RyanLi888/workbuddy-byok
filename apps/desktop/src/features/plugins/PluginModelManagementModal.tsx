import { useState } from "react";
import { pluginText, type PluginProviderDescriptor } from "../../shared/api";
import { useI18n } from "../../i18n/store";
import { Button } from "../../shared/ui/Button";
import { Modal } from "../../shared/ui/Modal";
import { Switch } from "../../shared/ui/Switch";
import styles from "./PluginResourcePanels.module.scss";

export function PluginModelManagementModal({ provider, busy, error, onClose, onSubmit }: {
  provider: PluginProviderDescriptor;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (enabledByModel: Record<string, boolean>) => void;
}) {
  const { locale } = useI18n();
  const [enabledByModel, setEnabledByModel] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(provider.models.map((model) => [model.id, model.enabled])));
  const setAll = (enabled: boolean) => {
    setEnabledByModel(Object.fromEntries(provider.models.map((model) => [model.id, enabled])));
  };

  return <Modal
    fullHeight
    open
    title={t("{name} 模型管理", { name: pluginText(provider.displayName, locale) })}
    busy={busy}
    banner={error ? <span className={styles.error} role="alert">{error}</span> : undefined}
    onClose={onClose}
    onSubmit={() => onSubmit(enabledByModel)}
    submitLabel={t("确定")}
  >
    <div className={styles.modelToolbar}>
      <Button size="small" disabled={busy || provider.models.length === 0} onClick={() => setAll(true)}>{t("全选")}</Button>
      <Button size="small" disabled={busy || provider.models.length === 0} onClick={() => setAll(false)}>{t("全不选")}</Button>
    </div>
    <div className={styles.modelTableWrap}>
      <table className={styles.modelTable}>
        <thead><tr><th scope="col">{t("模型名称")}</th><th scope="col">{t("启用")}</th></tr></thead>
        <tbody>
          {provider.models.map((model) => <tr key={model.id}>
            <td><div className={styles.modelName}>
              <strong>{model.displayName}</strong>
              {model.description && <span>{model.description}</span>}
            </div></td>
            <td><Switch
              checked={enabledByModel[model.id] ?? model.enabled}
              disabled={busy}
              label={t("启用 {model}", { model: model.displayName })}
              onChange={(enabled) => setEnabledByModel((current) => ({ ...current, [model.id]: enabled }))}
            /></td>
          </tr>)}
        </tbody>
      </table>
      {provider.models.length === 0 && <span className={styles.empty}>{t("尚未同步模型")}</span>}
    </div>
  </Modal>;
}
