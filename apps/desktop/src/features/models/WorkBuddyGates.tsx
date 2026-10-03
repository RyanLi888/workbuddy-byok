import { createContext, useContext, type ReactNode } from "react";
import { useAppStore } from "../../shared/store/appStore";
import controls from "../../shared/ui/Controls.module.scss";
import styles from "./WorkBuddySettings.module.scss";

const ModelsReady = createContext(false);

export function WorkBuddyModelProvider({ children }: { children: ReactNode }) {
  const { models, plugins } = useAppStore();
  const hasConfiguredPlugin = plugins.some((plugin) => plugin.providers.some((provider) => provider.configured));
  return <ModelsReady.Provider value={models.length > 0 || hasConfiguredPlugin}>{children}</ModelsReady.Provider>;
}

export function WorkBuddyModelGate({ busy, onAdd, children }: { busy: boolean; onAdd: () => void; children: ReactNode }) {
  const ready = useContext(ModelsReady);
  if (ready) return children;
  return <div className={styles.gate}>
    <strong>{t("还没有可供使用的模型")}</strong>
    <span>{t("添加自定义模型配置，或在「插件配置」中登录 Codex / Gemini 账号后即可使用。")}</span>
    <div className={styles.gateActions}>
      <button className={controls.primary} disabled={busy} onClick={onAdd}>{t("添加模型")}</button>
    </div>
  </div>;
}
