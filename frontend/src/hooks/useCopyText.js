import { useState } from "react";

export default function useCopyText(delay = 2500) {
  const [copied, setCopied] = useState(false);
  const copyText = async (content) => {
    if (!content) return false;

    const attemptClipboardCopy = async () => {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        return true;
      }

      if (typeof document === "undefined") return false;

      const textArea = document.createElement("textarea");
      textArea.value = content;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.top = "-9999px";
      document.body.appendChild(textArea);

      const selection = document.getSelection?.();
      const selectedRange =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      textArea.select();
      textArea.setSelectionRange?.(0, textArea.value.length);

      let success = false;
      try {
        success = document.execCommand("copy");
      } catch (error) {
        success = false;
      }

      document.body.removeChild(textArea);

      if (selectedRange && selection) {
        selection.removeAllRanges();
        selection.addRange(selectedRange);
      }

      return success;
    };

    try {
      const success = await attemptClipboardCopy();

      if (!success) {
        throw new Error("Copy command was unsuccessful");
      }

      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, delay);

      return true;
    } catch (error) {
      console.error("Failed to copy text:", error);
      setCopied(false);
      return false;
    }
  };

  return { copyText, copied };
}
