import { useTranslation } from "react-i18next";

export default function HybridSearchToggle({ workspace, setHasChanges }) {
  const { t } = useTranslation();
  const isPgVector = workspace?.vectorDB === "pgvector";
  const isEnabled = Boolean(workspace?.vectorSearchHybridEnabled);
  if (!isPgVector) return null;
  return (
    <div>
      <div className="flex flex-col">
        <label htmlFor="name" className="block input-label">
          {t("vector-workspace.hybridToggle.title")}
        </label>
        <p className="text-white text-opacity-60 text-xs font-medium py-1.5">
          {t("vector-workspace.hybridToggle.description")}
        </p>
      </div>
      <select
        name="vectorSearchHybridEnabled"
        defaultValue={isEnabled ? "enabled" : "disabled"}
        className="border-none bg-theme-settings-input-bg text-white text-sm mt-2 rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
        onChange={() => setHasChanges(true)}
        required={true}
      >
        <option value="disabled">
          {t("vector-workspace.hybridToggle.disable")}
        </option>
        <option value="enabled">
          {t("vector-workspace.hybridToggle.enable")}
        </option>
      </select>
    </div>
  );
}
