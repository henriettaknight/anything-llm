import { useState } from "react";
import { Tooltip } from "react-tooltip";
import { Cpu, Check, CircleNotch } from "@phosphor-icons/react";
import { useParams } from "react-router-dom";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";

const TRANSLATION_MODELS = [
  {
    id: "ollama-gemma4-31b",
    label: "Gemma4-31B",
    description: "苏州 · 192.168.6.101 · Ollama",
    chatProvider: "ollama",
    chatModel: "gemma4-31b",
  },
  {
    id: "vllm-gemma4-26b",
    label: "Gemma4-26B",
    description: "美国 · 98.153.121.36 · vLLM",
    chatProvider: "generic-openai",
    chatModel: "gemma4-26b",
  },
  {
    id: "deepseek-flash",
    label: "DeepSeek v4-flash",
    description: "deepseek-v4-flash · API",
    chatProvider: "deepseek",
    chatModel: "deepseek-v4-flash",
  },
];

const DEFAULT_MODEL_ID = "ollama-gemma4-31b";
const TOOLTIP_ID = "translation-model-selector";

export default function TranslationModelSelector({ workspace }) {
  const { slug } = useParams();
  const [saving, setSaving] = useState(false);
  const [localOverride, setLocalOverride] = useState(null);

  // 优先使用本地覆盖值（刚切换后的即时更新），否则用父组件传入的 workspace
  const ws = localOverride || workspace;
  const currentProvider = ws?.chatProvider;
  const currentModel = ws?.chatModel;
  const selectedId =
    TRANSLATION_MODELS.find(
      (m) => m.chatProvider === currentProvider && m.chatModel === currentModel
    )?.id || DEFAULT_MODEL_ID;

  async function handleSelect(model) {
    if (saving || model.id === selectedId) return;
    setSaving(true);
    try {
      const { workspace: updated, message } = await Workspace.updateTranslationModel(slug, {
        chatProvider: model.chatProvider,
        chatModel: model.chatModel,
      });
      if (message) {
        showToast(`切换失败: ${message}`, "error");
      } else {
        // 即时更新本地状态，让 UI 立刻反映新选中的模型
        setLocalOverride(updated);
        showToast(`已切换到 ${model.label}`, "success");
      }
    } catch (e) {
      showToast(`切换失败: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  const selectedModel = TRANSLATION_MODELS.find(
    (m) => m.id === selectedId
  );

  return (
    <>
      <button
        type="button"
        data-tooltip-id={TOOLTIP_ID}
        data-tooltip-place="top-start"
        className="flex items-center gap-x-1.5 p-1.5 rounded-lg hover:bg-theme-action-menu-item-hover text-theme-text-secondary text-sm font-medium"
      >
        <Cpu className="w-4 h-4" />
        <span className="hidden md:inline">
          {selectedModel?.label || "选择模型"}
        </span>
      </button>

      <Tooltip
        id={TOOLTIP_ID}
        place="top-start"
        delayShow={200}
        className="!bg-theme-bg-primary !border !border-theme-border !rounded-lg !shadow-lg"
        style={{ width: "320px", maxWidth: "320px" }}
        clickable
      >
        <div className="flex flex-col gap-1 p-1">
          <div className="text-xs text-theme-text-secondary font-medium px-2 py-1">
            选择翻译模型
          </div>
          {TRANSLATION_MODELS.map((model) => (
            <button
              key={model.id}
              type="button"
              disabled={saving}
              onClick={() => handleSelect(model)}
              className={`flex items-center gap-3 w-full text-left px-2 py-2 rounded-lg transition-colors hover:bg-theme-action-menu-item-hover ${
                selectedId === model.id
                  ? "bg-theme-action-menu-item-hover"
                  : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-theme-text-primary font-medium">
                  {model.label}
                </div>
                <div className="text-[10px] text-theme-text-secondary truncate">
                  {model.description}
                </div>
              </div>
              {saving && selectedId === model.id ? (
                <CircleNotch className="w-4 h-4 text-theme-text-secondary animate-spin shrink-0" />
              ) : (
                selectedId === model.id && (
                  <Check className="w-4 h-4 text-green-400 shrink-0" />
                )
              )}
            </button>
          ))}
        </div>
      </Tooltip>
    </>
  );
}
