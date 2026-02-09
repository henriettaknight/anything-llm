import { useTranslation } from "react-i18next";
import { useState } from "react";

export default function HybridSearchAlpha({ workspace, setHasChanges }) {
  const { t } = useTranslation();
  const isPgVector = workspace?.vectorDB === "pgvector";
  const defaultValue = Number(workspace?.vectorSearchHybridAlpha ?? 0.5);
  const [currentValue, setCurrentValue] = useState(defaultValue);
  if (!isPgVector) return null;
  return (
    <div>
      <div className="flex flex-col">
        <label htmlFor="name" className="block input-label">
          {t("vector-workspace.hybridAlpha.title")}
        </label>
        <p className="text-white text-opacity-60 text-xs font-medium py-1.5">
          {t("vector-workspace.hybridAlpha.description")}
        </p>
      </div>
      <div className="mt-2 flex items-center gap-x-3">
        <input
          name="vectorSearchHybridAlpha"
          type="range"
          min={0}
          max={1}
          step={0.05}
          defaultValue={defaultValue}
          className="flex-1 accent-primary-button"
          onChange={(event) => {
            setCurrentValue(Number(event.target.value));
            setHasChanges(true);
          }}
        />
        <input
          type="text"
          value={currentValue.toFixed(2)}
          readOnly
          className="border-none bg-theme-settings-input-bg text-white text-sm rounded-lg focus:outline-none outline-none block w-20 p-2.5 text-center"
        />
      </div>
      <div className="flex items-center justify-between text-xs text-white/60 mt-2">
        <span>0 = keyword</span>
        <span>1 = semantic</span>
      </div>
    </div>
  );
}
