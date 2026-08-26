import React, { memo, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Info, Warning, Check, Copy, X } from "@phosphor-icons/react";
import useCopyText from "@/hooks/useCopyText";
import UserIcon from "../../../../UserIcon";
import Actions from "./Actions";
import renderMarkdown from "@/utils/chat/markdown";
import { userFromStorage } from "@/utils/request";
import Citations from "../Citation";
import { v4 } from "uuid";
import DOMPurify from "@/utils/chat/purify";
import { EditMessageForm, useEditMessage } from "./Actions/EditMessage";
import { useWatchDeleteMessage } from "./Actions/DeleteMessage";
import TTSMessage from "./Actions/TTSButton";
import {
  THOUGHT_REGEX_CLOSE,
  THOUGHT_REGEX_COMPLETE,
  THOUGHT_REGEX_OPEN,
  ThoughtChainComponent,
} from "../ThoughtContainer";
import paths from "@/utils/paths";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { chatQueryRefusalResponse } from "@/utils/chat";

const HistoricalMessage = ({
  uuid = v4(),
  message,
  role,
  workspace,
  sources = [],
  attachments = [],
  error = false,
  feedbackScore = null,
  chatId = null,
  isLastMessage = false,
  regenerateMessage,
  saveEditedMessage,
  forkThread,
  metrics = {},
  alignmentCls = "",
}) => {
  const { t } = useTranslation();
  const { isEditing } = useEditMessage({ chatId, role });
  const { isDeleted, completeDelete, onEndAnimation } = useWatchDeleteMessage({
    chatId,
    role,
  });
  const adjustTextArea = (event) => {
    const element = event.target;
    element.style.height = "auto";
    element.style.height = element.scrollHeight + "px";
  };

  const isRefusalMessage =
    role === "assistant" && message === chatQueryRefusalResponse(workspace);

  if (!!error) {
    return (
      <div
        key={uuid}
        className={`flex justify-center items-end w-full bg-theme-bg-chat`}
      >
        <div className="py-8 px-4 w-full flex gap-x-5 md:max-w-[80%] flex-col">
          <div className={`flex gap-x-5 ${alignmentCls}`}>
            <ProfileImage role={role} workspace={workspace} />
            <div className="p-2 rounded-lg bg-red-50 text-red-500">
              <span className="inline-block">
                <Warning className="h-4 w-4 mb-1 inline-block" /> Could not
                respond to message.
              </span>
              <p className="text-xs font-mono mt-2 border-l-2 border-red-300 pl-2 bg-red-200 p-2 rounded-sm">
                {error}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (completeDelete) return null;

  return (
    <div
      key={uuid}
      onAnimationEnd={onEndAnimation}
      className={`${
        isDeleted ? "animate-remove" : ""
      } flex justify-center items-end w-full group bg-theme-bg-chat`}
    >
      <div className="py-8 px-4 w-full flex gap-x-5 md:max-w-[80%] flex-col">
        <div className={`flex gap-x-5 ${alignmentCls}`}>
          <div className="flex flex-col items-center">
            <ProfileImage role={role} workspace={workspace} />
            <div className="mt-1 -mb-10">
              {role === "assistant" && (
                <TTSMessage
                  slug={workspace?.slug}
                  chatId={chatId}
                  message={message}
                />
              )}
            </div>
          </div>
          {isEditing ? (
            <EditMessageForm
              role={role}
              chatId={chatId}
              message={message}
              attachments={attachments}
              adjustTextArea={adjustTextArea}
              saveChanges={saveEditedMessage}
            />
          ) : (
            <div className="break-words">
              <RenderChatContent
                role={role}
                message={message}
                expanded={isLastMessage}
              />
              {isRefusalMessage && (
                <Link
                  data-tooltip-id="query-refusal-info"
                  data-tooltip-content={`${t("chat.refusal.tooltip-description")}`}
                  className="!no-underline group !flex w-fit"
                  to={paths.chatModes()}
                  target="_blank"
                >
                  <div className="flex flex-row items-center gap-x-1 group-hover:opacity-100 opacity-60 w-fit">
                    <Info className="text-theme-text-secondary" />
                    <p className="!m-0 !p-0 text-theme-text-secondary !no-underline text-xs cursor-pointer">
                      {t("chat.refusal.tooltip-title")}
                    </p>
                  </div>
                </Link>
              )}
              <ChatAttachments attachments={attachments} />
            </div>
          )}
        </div>
        <div className="flex gap-x-5 ml-14">
          <Actions
            message={message}
            feedbackScore={feedbackScore}
            chatId={chatId}
            slug={workspace?.slug}
            isLastMessage={isLastMessage}
            regenerateMessage={regenerateMessage}
            isEditing={isEditing}
            role={role}
            forkThread={forkThread}
            metrics={metrics}
            alignmentCls={alignmentCls}
          />
        </div>
        {role === "assistant" && (
          <TranslationMetaBar metrics={metrics} />
        )}
        {role === "assistant" && <Citations sources={sources} />}
      </div>
    </div>
  );
};

function ProfileImage({ role, workspace }) {
  if (role === "assistant" && workspace.pfpUrl) {
    return (
      <div className="relative w-[35px] h-[35px] rounded-full flex-shrink-0 overflow-hidden">
        <img
          src={workspace.pfpUrl}
          alt="Workspace profile picture"
          className="absolute top-0 left-0 w-full h-full object-cover rounded-full bg-white"
        />
      </div>
    );
  }

  return (
    <UserIcon
      user={{
        uid: role === "user" ? userFromStorage()?.username : workspace.slug,
      }}
      role={role}
    />
  );
}

export default memo(
  HistoricalMessage,
  // Skip re-render the historical message:
  // if the content is the exact same AND (not streaming)
  // the lastMessage status is the same (regen icon)
  // and the chatID matches between renders. (feedback icons)
  // metrics 也需参与比较：finalizeResponseStream 时 metrics.translationMeta 才到位，
  // 否则元信息条不会从空 → 有内容刷新出来。
  (prevProps, nextProps) => {
    return (
      prevProps.message === nextProps.message &&
      prevProps.isLastMessage === nextProps.isLastMessage &&
      prevProps.chatId === nextProps.chatId &&
      prevProps.metrics === nextProps.metrics
    );
  }
);

function ChatAttachments({ attachments = [] }) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((item) => (
        <img
          key={item.name}
          src={item.contentString}
          className="max-w-[300px] rounded-md"
        />
      ))}
    </div>
  );
}

const RenderChatContent = memo(
  ({ role, message, expanded = false }) => {
    // If the message is not from the assistant, we can render it directly
    // as normal since the user cannot think (lol)
    if (role !== "assistant")
      return (
        <span
          className="flex flex-col gap-y-1"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(renderMarkdown(message)),
          }}
        />
      );
    let thoughtChain = null;
    let msgToRender = message;
    if (!message) return null;

    // If the message is a perfect thought chain, we can render it directly
    // Complete == open and close tags match perfectly.
    if (message.match(THOUGHT_REGEX_COMPLETE)) {
      thoughtChain = message.match(THOUGHT_REGEX_COMPLETE)?.[0];
      msgToRender = message.replace(THOUGHT_REGEX_COMPLETE, "");
    }

    // If the message is a thought chain but not a complete thought chain (matching opening tags but not closing tags),
    // we can render it as a thought chain if we can at least find a closing tag
    // This can occur when the assistant starts with <thinking> and then <response>'s later.
    if (
      message.match(THOUGHT_REGEX_OPEN) &&
      message.match(THOUGHT_REGEX_CLOSE)
    ) {
      const closingTag = message.match(THOUGHT_REGEX_CLOSE)?.[0];
      const splitMessage = message.split(closingTag);
      thoughtChain = splitMessage[0] + closingTag;
      msgToRender = splitMessage[1];
    }

    return (
      <>
        {thoughtChain && (
          <ThoughtChainComponent content={thoughtChain} expanded={expanded} />
        )}
        <span
          className="flex flex-col gap-y-1"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(renderMarkdown(msgToRender)),
          }}
        />
      </>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.role === nextProps.role &&
      prevProps.message === nextProps.message &&
      prevProps.expanded === nextProps.expanded
    );
  }
);

/**
 * 翻译元信息条：在 assistant 消息下方展示术语库、命中数、检索数。
 * 仅在 metrics.translationMeta 存在时渲染（翻译 workspace 才有）。
 * 普通对话 metrics 为空对象，不渲染。
 *
 * 交互（按用户最新需求）：
 *   - 悬浮在"命中术语 N 条"上 → 右侧固定面板打开，并切到"命中"tab
 *   - 悬浮在"检索片段 N 段"上 → 右侧固定面板打开，并切到"检索"tab
 *   - 面板显示后需手动点关闭按钮才关闭（不随鼠标离开关闭）
 *   - 面板右上角：复制按钮 + 关闭按钮
 *   - 面板内有两个 tab：命中 / 检索
 */
function TranslationMetaBar({ metrics = {} }) {
  const meta = metrics?.translationMeta;
  if (!meta) return null;

  // 兼容旧格式（glossaryName/glossaryId 单值）和新格式（glossaryNames/glossaryIds 数组）
  const glossaryNames = (() => {
    if (Array.isArray(meta.glossaryNames) && meta.glossaryNames.length > 0) {
      return meta.glossaryNames.join("、");
    }
    if (Array.isArray(meta.glossaryIds) && meta.glossaryIds.length > 0) {
      return meta.glossaryIds.join("、");
    }
    return meta.glossaryName || meta.glossaryId || "-";
  })();
  const hitCount = meta.hitCount ?? 0;
  const retrievalCount = meta.retrievalCount ?? 0;
  const terms = Array.isArray(meta.terms) ? meta.terms : [];
  const chunks = Array.isArray(meta.chunks) ? meta.chunks : [];
  const allTerms = Array.isArray(meta.allTerms) ? meta.allTerms : [];

  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("hits"); // 'hits' | 'chunks'

  const openPanel = (tab) => {
    setActiveTab(tab);
    setPanelOpen(true);
  };

  return (
    <>
      <div className="ml-14 mt-2 px-3 py-2 rounded-md bg-theme-bg-chat-input border border-theme-border text-xs text-theme-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          术语库：
          <span className="text-theme-text-primary">{glossaryNames}</span>
        </span>
        <button
          type="button"
          onMouseEnter={() => openPanel("hits")}
          onClick={() => openPanel("hits")}
          className="underline decoration-dotted underline-offset-2 hover:text-theme-text-primary"
        >
          命中术语：<span className="text-theme-text-primary">{hitCount}</span> 条
        </button>
        <button
          type="button"
          onMouseEnter={() => openPanel("chunks")}
          onClick={() => openPanel("chunks")}
          className="underline decoration-dotted underline-offset-2 hover:text-theme-text-primary"
        >
          检索片段：<span className="text-theme-text-primary">{retrievalCount}</span> 段
        </button>
      </div>

      {panelOpen && (
        <TranslationMetaPanel
          terms={terms}
          chunks={chunks}
          hitCount={hitCount}
          retrievalCount={retrievalCount}
          allTerms={allTerms}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  );
}

/**
 * 右侧固定面板：通过 React Portal 渲染到 body，绝对定位右侧。
 * 不随鼠标离开关闭，必须点关闭按钮。
 */
function TranslationMetaPanel({
  terms,
  chunks,
  hitCount,
  retrievalCount,
  allTerms,
  activeTab,
  setActiveTab,
  onClose,
}) {
  const termsText = terms
    .map((t) => `${t.zh || ""} → ${t.en || ""}`)
    .filter((line) => line.trim() !== "→")
    .join("\n");
  const chunksText = chunks
    .map((c, i) => `[片段${i + 1}]\n${c.content || ""}`)
    .join("\n\n");

  const isHits = activeTab === "hits";
  const copyContent = isHits ? termsText : chunksText;
  const copyEmpty = isHits ? terms.length === 0 : chunks.length === 0;

  return ReactDOM.createPortal(
    <div
      className="fixed top-0 right-0 bottom-0 z-[1000] w-[420px] max-w-[90vw] bg-theme-bg-secondary border-l border-theme-border shadow-2xl flex flex-col"
      role="dialog"
      aria-label="翻译元信息"
    >
      {/* 头部：tab + 复制 + 关闭 */}
      <div className="flex items-center justify-between border-b border-theme-border px-3 py-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("hits")}
            className={`px-3 py-1 text-xs rounded-md border ${
              isHits
                ? "bg-theme-action-bg text-white border-theme-action-bg"
                : "bg-transparent text-theme-text-secondary border-theme-border hover:text-theme-text-primary"
            }`}
          >
            命中（{hitCount}）
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chunks")}
            className={`px-3 py-1 text-xs rounded-md border ${
              !isHits
                ? "bg-theme-action-bg text-white border-theme-action-bg"
                : "bg-transparent text-theme-text-secondary border-theme-border hover:text-theme-text-primary"
            }`}
          >
            检索（{retrievalCount}）
          </button>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={copyContent} disabled={copyEmpty} />
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text-primary p-1"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {isHits ? (
          terms.length === 0 ? (
            <div className="text-theme-text-secondary">未命中术语</div>
          ) : (
            <ul className="space-y-2">
              {terms.map((t, i) => (
                <li
                  key={i}
                  className="flex gap-2 items-center px-2 py-1 rounded hover:bg-theme-bg-chat-input"
                >
                  <span className="text-theme-text-primary">{t.zh}</span>
                  <span className="text-theme-text-secondary">→</span>
                  <span className="text-theme-text-primary">{t.en}</span>
                </li>
              ))}
            </ul>
          )
        ) : chunks.length === 0 ? (
          <div className="text-theme-text-secondary">未检索到片段</div>
        ) : (
          <div className="space-y-3">
            {chunks.map((c, i) => (
              <div key={i} className="border border-theme-border rounded p-2">
                <div className="text-theme-text-secondary mb-1">
                  片段 {i + 1}
                </div>
                <div className="text-theme-text-primary whitespace-pre-wrap break-words">
                  <ChunkHighlight text={c.content} terms={allTerms} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * 按 chunk 结构化字段渲染：只对 "- 中文词条:" 行里的值做术语高亮，
 * 其他字段行（英文译法、可接受变体、禁用译法、适用范围、类别、说明等）
 * 原样输出，避免把"适用范围: 修仙"里的"修仙"误标红。
 */
function ChunkHighlight({ text, terms = [] }) {
  if (!text) return null;

  const termSet = [
    ...new Set(
      (terms || [])
        .map((t) => (typeof t === "string" ? t : t?.zh))
        .filter(Boolean)
    ),
  ];
  // 按长度降序，避免短词先匹配破坏长词
  termSet.sort((a, b) => b.length - a.length);

  const lines = text.split(/\r?\n/);
  return (
    <>
      {lines.map((line, i) => {
        const m = line.match(/^- \s*中文词条\s*:\s*(.*)$/);
        if (m && termSet.length > 0) {
          const value = m[1];
          const escaped = termSet.map((t) =>
            t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          );
          const regex = new RegExp(`(${escaped.join("|")})`, "g");
          const parts = value.split(regex).filter((p) => p !== "");
          return (
            <div key={i}>
              <span className="text-theme-text-secondary">- 中文词条: </span>
              {parts.map((part, j) =>
                termSet.includes(part) ? (
                  <span
                    key={j}
                    className="text-red-500 font-semibold bg-red-50 dark:bg-red-900/30 px-0.5 rounded"
                  >
                    {part}
                  </span>
                ) : (
                  <span key={j} className="text-theme-text-primary">
                    {part}
                  </span>
                )
              )}
            </div>
          );
        }
        return (
          <div key={i} className="text-theme-text-primary">
            {line}
          </div>
        );
      })}
    </>
  );
}

function CopyButton({ text, disabled }) {
  const { copied, copyText } = useCopyText();
  return (
    <button
      type="button"
      onClick={() => copyText(text)}
      disabled={disabled}
      className="text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-xs"
      aria-label="复制"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? "已复制" : "复制"}</span>
    </button>
  );
}
