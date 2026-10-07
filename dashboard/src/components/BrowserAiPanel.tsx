import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Tooltip, Tag, Spin } from "antd";
import { message as antMessage } from "@/utils/antdMessage";

import { Bot, X, Square, Play, Loader2, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OctopAgent } from "../context/AgentContext";
import AgentSelector from "../components/AgentSelector";
import { useAgentThreadChat } from "../hooks/useAgentThreadChat";
import { browserApi } from "../api/modules/browser";
import { request } from "../api/request";
import MessageList from "../pages/Chat/components/MessageList";
import * as chatStore from "../pages/Chat/hooks/chatStore";
import chatStyles from "../pages/Chat/index.module.less";
import styles from "./BrowserAiPanel.module.less";

export interface BrowserAiTabContext {
  id: number | string;
  url: string;
  title: string;
  active: boolean;
}

interface BrowserAiPanelProps {
  activeAgent: OctopAgent | null;
  tabs: BrowserAiTabContext[];
  currentUrl: string;
  profileId?: string | null;
  onClose: () => void;
  layout?: "right" | "bottom";
  /** Skill recording state from parent (RemoteBrowserPage) */
  browserRecording?: boolean;
  browserRecordingId?: string | null;
  browserLastRecordingId?: string | null;
  setBrowserRecording?: (v: boolean) => void;
  setBrowserRecordingId?: (v: string | null) => void;
  setBrowserLastRecordingId?: (v: string | null) => void;
  /** Skill name (task objective) — used as the trigger keyword */
  skillName?: string;
  /** Callback in parent to persist the skill name when user sets it in chat */
  onSkillNameSet?: (name: string) => void;
  /** Whether a browser session is currently active */
  browserSessionActive?: boolean;
  /** Whether a browser session is currently being started */
  browserStarting?: boolean;
  /** Callback to start a browser session */
  onStartBrowser?: () => void;
}

// Keywords that trigger "stop recording and generate skill"
const END_KEYWORDS = ["End", "end", "stop recording", "End recording"];

// Keywords that trigger "confirm and apply skill"
const CONFIRM_KEYWORDS = ["Confirm", "confirm", "ok", "Confirm application", "apply"];

type RecordingPhase =
  | "idle"
  | "awaitObjective"
  | "awaitDescription"
  | "recording";

export default function BrowserAiPanel({
  activeAgent,
  tabs,
  currentUrl,
  profileId,
  onClose,
  layout = "right",
  browserRecording = false,
  browserRecordingId = null,
  browserLastRecordingId = null,
  setBrowserRecording,
  setBrowserRecordingId,
  setBrowserLastRecordingId,
  skillName = "",
  onSkillNameSet,
}: BrowserAiPanelProps) {
  const { t } = useTranslation();
  const panelClassName = `${styles.panel}${
    layout === "bottom" ? ` ${styles.panelBottom}` : ""
  }`;
  const [inputValue, setInputValue] = useState("");
  const [browserReplayBusy, setBrowserReplayBusy] = useState(false);
  const [pendingSkillContent, setPendingSkillContent] = useState<string | null>(
    null,
  );
  const [pendingSkillName, setPendingSkillName] = useState<string | null>(null);
  const [, setPendingSkillRecordingId] = useState<string | null>(null);
  const workflowBusyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imeComposingRef = useRef(false);

  // Recording workflow phase
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");

  // Saved skill names for keyword-trigger replay
  const [savedSkillNames, setSavedSkillNames] = useState<string[]>([]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.active), [tabs]);
  const agentId = activeAgent?.agent_id ?? null;

  // Load saved skill names from API on mount / agent change
  useEffect(() => {
    if (!agentId) {
      setSavedSkillNames([]);
      return;
    }
    void (async () => {
      try {
        const skills = await request<{ slug: string; name: string }[]>(
          `/agents/${agentId}/skills`,
        );
        if (Array.isArray(skills)) {
          setSavedSkillNames(skills.map((s) => s.slug ?? s.name));
        }
      } catch {
        // Non-critical
      }
    })();
  }, [agentId]);

  const {
    threadId,
    booting,
    bootError,
    messages,
    isStreaming,
    send,
    cancelStream,
  } = useAgentThreadChat(agentId);

  // When browserRecording transitions, sync phase
  useEffect(() => {
    if (browserRecording && recordingPhase === "idle") {
      setRecordingPhase("awaitObjective");
    }
    if (!browserRecording && recordingPhase !== "idle") {
      setRecordingPhase("idle");
    }
  }, [browserRecording, recordingPhase]);

  // --- Skill recording workflow ---
  const isEndRecordingCommand = useCallback(
    (text: string): boolean => {
      const normalized = text.trim().toLowerCase();
      return (
        browserRecording &&
        recordingPhase === "recording" &&
        END_KEYWORDS.some((kw) => normalized === kw.toLowerCase())
      );
    },
    [browserRecording, recordingPhase],
  );

  const isConfirmSkillCommand = useCallback(
    (text: string): boolean => {
      const normalized = text.trim().toLowerCase();
      return (
        !!pendingSkillContent &&
        CONFIRM_KEYWORDS.some((kw) => normalized === kw.toLowerCase())
      );
    },
    [pendingSkillContent],
  );

  const isSkillTriggerCommand = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      return (
        !browserRecording &&
        !pendingSkillContent &&
        savedSkillNames.some(
          (name) => name.toLowerCase() === trimmed.toLowerCase(),
        )
      );
    },
    [browserRecording, pendingSkillContent, savedSkillNames],
  );

  const handleObjectiveInput = useCallback(
    (text: string) => {
      const objective = text.trim();
      if (!objective) return;
      setInputValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setPendingSkillName(objective);
      if (onSkillNameSet) onSkillNameSet(objective);
      setRecordingPhase("awaitDescription");
      chatStore.appendPushMessage(
        `✅ Mission objectives have been set:**${objective}**\n\n` +
          "Next please describe what you wantAIThe specific actions the assistant performs in the browser.\n\n" +
          `For example:"Open Google and Bing to search for today’s weather".\n\n` +
          'After the description is completeAIThe operation will be performed automatically; enter after the operation is completed"End"To stop recording.',
      );
    },
    [onSkillNameSet],
  );

  const handleDescriptionInput = useCallback(
    (text: string) => {
      const description = text.trim();
      setInputValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setRecordingPhase("recording");
      send(description);
    },
    [send],
  );

  const handleEndRecording = useCallback(async () => {
    if (workflowBusyRef.current) return;
    workflowBusyRef.current = true;
    try {
      const effectiveSkillName =
        skillName || pendingSkillName || "browser-skill";
      const data = await browserApi.stopAndGenerateSkill({
        recordingId: browserRecordingId,
        name: effectiveSkillName,
        generateSteps: true,
      });
      const recordingId = data.recordingId ?? browserRecordingId;
      if (setBrowserRecording) setBrowserRecording(false);
      if (setBrowserRecordingId) setBrowserRecordingId(null);
      if (recordingId && setBrowserLastRecordingId)
        setBrowserLastRecordingId(recordingId);

      if (data.skillContent) {
        setPendingSkillContent(data.skillContent);
        setPendingSkillName(effectiveSkillName);
        setPendingSkillRecordingId(recordingId ?? null);

        const previewLines = data.skillContent.split("\n").slice(0, 20);
        const previewText = previewLines.join("\n");
        const truncationNotice =
          data.skillContent.split("\n").length > 20
            ? `\n\n... (Total ${
                data.skillContent.split("\n").length
              } lines total — the full content is saved after confirmation)`
            : "";
        chatStore.appendPushMessage(
          `✅ Recording is complete! Generated ${data.steps ?? 0} Playback steps.\n\n` +
            `📝 **Skill "${effectiveSkillName}" script preview:**\n\n${previewText}${truncationNotice}\n\n` +
            'Reply "Confirm" to apply this skill.\n\n' +
            `Once applied, just type **"${effectiveSkillName}"** to replay the same operation in one click.`,
        );
      } else {
        chatStore.appendPushMessage(
          `✅ Recording is complete! Generated ${data.steps ?? 0} Playback steps.\n\n` +
            `⚠️ Skill script generation failed, please try again later.`,
        );
      }
      antMessage.success(`Recording completed, generated ${data.steps ?? 0} Playback steps`);
    } catch (err) {
      antMessage.error(err instanceof Error ? err.message : "Failed to stop recording");
    } finally {
      workflowBusyRef.current = false;
    }
  }, [
    browserRecordingId,
    skillName,
    pendingSkillName,
    setBrowserRecording,
    setBrowserRecordingId,
    setBrowserLastRecordingId,
  ]);

  const handleConfirmSkill = useCallback(async () => {
    if (
      !pendingSkillContent ||
      !pendingSkillName ||
      !agentId ||
      workflowBusyRef.current
    )
      return;
    workflowBusyRef.current = true;
    try {
      const result = await request<{
        slug: string;
        name: string;
        enabled: boolean;
      }>(`/agents/${agentId}/skills`, {
        method: "POST",
        body: JSON.stringify({
          name: pendingSkillName,
          content: pendingSkillContent,
        }),
      });
      const finalName = result.slug || result.name || pendingSkillName;
      setPendingSkillContent(null);
      setPendingSkillName(null);
      setPendingSkillRecordingId(null);
      setSavedSkillNames((prev) =>
        prev.includes(finalName) ? prev : [...prev, finalName],
      );
      chatStore.appendPushMessage(
        `🎉 Skill **"${finalName}"** applied successfully!\n\n` +
          `Then just type **"${finalName}"** to replay the same browser operation in one click.`,
      );
      antMessage.success(`Skills "${finalName}" Successfully applied`);
    } catch (err) {
      antMessage.error(err instanceof Error ? err.message : "Apply skill failed");
    } finally {
      workflowBusyRef.current = false;
    }
  }, [pendingSkillContent, pendingSkillName, agentId]);

  const handleSkillReplay = useCallback(
    async (skillKeyword: string) => {
      if (workflowBusyRef.current) return;
      workflowBusyRef.current = true;
      setBrowserReplayBusy(true);
      try {
        const skillDetail = await request<{ body: string; raw: string }>(
          `/agents/${agentId}/skills/${encodeURIComponent(skillKeyword)}`,
        );
        const rawContent = skillDetail.raw || skillDetail.body || "";
        const recordingIdMatch = rawContent.match(
          /recording[_\s-]*id[:\s]*`?([a-zA-Z0-9_-]+)`?/i,
        );
        const recordingId = recordingIdMatch?.[1] ?? browserLastRecordingId;
        if (!recordingId) {
          chatStore.appendPushMessage(
            `⚠️ Unable to find skill “${skillKeyword}” recording, playback failed.`,
          );
          antMessage.error("Recording not found");
          return;
        }
        const data = await browserApi.replayRecording({
          recordingId,
          profile: `${profileId || "default"}-replay`,
        });
        if (data.status === "passed") {
          antMessage.success(
            t("browser.recordReplay.replayPassed", "Replay finished"),
          );
          chatStore.appendPushMessage(
            `🎬 Browser skill "${skillKeyword}" replay completed!`,
          );
        } else {
          const globalError = data.error || "";
          const failedSteps = (data.steps || [])
            .filter((s) => s.status === "failed")
            .map((s) => `Steps ${s.id} (${s.kind}): ${s.error || "Execution failed"}`);
          const detailMsg =
            globalError ||
            (failedSteps.length > 0 ? failedSteps.join("\n") : "") ||
            t("browser.recordReplay.replayFailed", "Replay failed");
          antMessage.error(detailMsg);
          chatStore.appendPushMessage(
            `⚠️ Skill "${skillKeyword}" playback failed:\n${detailMsg}`,
          );
        }
      } catch (err) {
        antMessage.error(err instanceof Error ? err.message : "Playback failed");
        chatStore.appendPushMessage(
          `⚠️ Skill playback error:${err instanceof Error ? err.message : "Unknown error"}`,
        );
      } finally {
        workflowBusyRef.current = false;
        setBrowserReplayBusy(false);
      }
    },
    [agentId, browserLastRecordingId, profileId, t],
  );

  const handleReplay = useCallback(async () => {
    if (!browserLastRecordingId || browserRecording || browserReplayBusy)
      return;
    setBrowserReplayBusy(true);
    try {
      const data = await browserApi.replayRecording({
        recordingId: browserLastRecordingId!,
        profile: `${profileId || "default"}-replay`,
      });
      if (data.status === "passed") {
        antMessage.success(t("browser.recordReplay.replayPassed", "Replay finished"));
        chatStore.appendPushMessage("🔄 Skill playback completed! All steps have been executed successfully.");
      } else {
        antMessage.error(
          data.error || t("browser.recordReplay.replayFailed", "Replay failed"),
        );
        chatStore.appendPushMessage(
          `⚠️ Skill playback failed:${data.error || "Unknown error"}`,
        );
      }
    } catch (err) {
      antMessage.error(err instanceof Error ? err.message : "Playback failed");
    } finally {
      setBrowserReplayBusy(false);
    }
  }, [
    browserLastRecordingId,
    browserRecording,
    browserReplayBusy,
    profileId,
    t,
  ]);

  // --- Intercept user messages based on recording phase ---
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isStreaming || !activeAgent) return;
    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    if (recordingPhase === "awaitObjective") {
      void handleObjectiveInput(text);
      return;
    }
    if (recordingPhase === "awaitDescription") {
      void handleDescriptionInput(text);
      return;
    }
    if (isEndRecordingCommand(text)) {
      void handleEndRecording();
      return;
    }
    if (isConfirmSkillCommand(text)) {
      void handleConfirmSkill();
      return;
    }
    if (isSkillTriggerCommand(text)) {
      chatStore.appendPushMessage(`🔄 Using skills “${text}” for playback...`);
      void handleSkillReplay(text);
      return;
    }
    send(text);
  }, [
    activeAgent,
    inputValue,
    isStreaming,
    send,
    recordingPhase,
    isEndRecordingCommand,
    isConfirmSkillCommand,
    isSkillTriggerCommand,
    handleObjectiveInput,
    handleDescriptionInput,
    handleEndRecording,
    handleConfirmSkill,
    handleSkillReplay,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      if (
        imeComposingRef.current ||
        e.nativeEvent.isComposing ||
        e.keyCode === 229
      )
        return;
      e.preventDefault();
      handleSend();
    },
    [handleSend],
  );

  const handleTextareaInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    },
    [],
  );

  // When recording is active and agent stream just finished, append reminder
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (
      wasStreaming &&
      !isStreaming &&
      browserRecording &&
      recordingPhase === "recording" &&
      messages.length > 0 &&
      !workflowBusyRef.current
    ) {
      chatStore.appendPushMessage(
        '💡 Recording is still in progress. If the operation is complete, enter"End"This will stop recording and generate the skill script.',
      );
    }
  }, [isStreaming, browserRecording, recordingPhase, messages.length]);

  const inputDisabled =
    isStreaming || booting || !threadId || browserReplayBusy;

  // Dynamic placeholder
  const placeholder = useMemo(() => {
    if (recordingPhase === "awaitObjective") {
      return t(
        "remoteBrowser.ai.objectivePlaceholder",
        "Please enter the task goal (will be used as skill name and trigger keyword)",
      );
    }
    if (recordingPhase === "awaitDescription") {
      return t(
        "remoteBrowser.ai.descriptionPlaceholder",
        "Please describe what you wantAIActions performed in the browser...",
      );
    }
    if (browserRecording) {
      return t(
        "remoteBrowser.ai.recordingPlaceholder",
        'Recording in progress...Input"End"Stop recording',
      );
    }
    if (pendingSkillContent) {
      return t(
        "remoteBrowser.ai.confirmPlaceholder",
        'Input"Confirm"Apply the skill, or continue the conversation',
      );
    }
    if (savedSkillNames.length > 0) {
      return t(
        "remoteBrowser.ai.placeholderWithSkills",
        `Enter the skill name to trigger replay, or continue the conversation`,
      );
    }
    return t(
      "remoteBrowser.ai.inputPlaceholder",
      "Ask about the current page or let AI Continue using the browser...",
    );
  }, [
    recordingPhase,
    browserRecording,
    pendingSkillContent,
    savedSkillNames,
    t,
  ]);

  // No agent → show empty state
  if (!activeAgent) {
    return (
      <div className={panelClassName}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Bot size={14} />
            <span>{t("remoteBrowser.ai.title", "AI Assistant")}</span>
          </div>
          <Tooltip title={t("common.close", "Close")}>
            <Button
              type="text"
              size="small"
              icon={<X size={14} />}
              onClick={onClose}
            />
          </Tooltip>
        </div>
        <div className={styles.emptyState}>
          <Bot size={30} color="var(--fn-text-quaternary, #9ca3af)" />
          <div className={styles.emptyTitle}>
            {t("remoteBrowser.ai.noAgentTitle", "Please select an Agent")}
          </div>
          <div className={styles.emptyDesc}>
            {t(
              "remoteBrowser.ai.noAgentDesc",
              "The assistant on the right side of the browser will reuse the current Agent Conversational ability.",
            )}
          </div>
          <div className={styles.emptyAgentPicker}>
            <AgentSelector variant="select" showLabel={false} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={panelClassName}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Bot size={14} />
          <span>{t("remoteBrowser.ai.title", "AI Assistant")}</span>
          {browserRecording && recordingPhase !== "idle" && (
            <Tag color="red" className={styles.recordingTag}>
              ● REC{" "}
              {skillName && recordingPhase === "recording"
                ? `— ${skillName}`
                : ""}
            </Tag>
          )}
        </div>
        <div className={styles.headerActions}>
          <Tooltip title={t("common.close", "Close")}>
            <Button
              type="text"
              size="small"
              icon={<X size={14} />}
              onClick={onClose}
            />
          </Tooltip>
        </div>
      </div>

      <div className={styles.contextSection}>
        <div className={styles.expertSelectRow}>
          <span className={styles.contextLabel}>
            {t("remoteBrowser.ai.expert", "Expert")}
          </span>
          <AgentSelector variant="select" showLabel={false} />
        </div>
        <div className={styles.contextGrid}>
          <span className={styles.contextLabel}>
            {t("remoteBrowser.ai.profile", "Profile")}
          </span>
          <span className={styles.contextValue}>{profileId || "default"}</span>
          <span className={styles.contextLabel}>
            {t("remoteBrowser.ai.currentUrl", "Current page")}
          </span>
          <span
            className={styles.contextValue}
            title={currentUrl || activeTab?.url}
          >
            {currentUrl || activeTab?.url || "about:blank"}
          </span>
        </div>
      </div>

      <div className={`${styles.messages} ${chatStyles.messageListWrapper}`}>
        {booting ? (
          <div className={styles.messagesLoading}>
            <Spin size="small" />
          </div>
        ) : bootError ? (
          <div className={styles.messagesError}>{bootError}</div>
        ) : (
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            sessionKey={threadId ?? undefined}
          />
        )}
      </div>

      <div className={styles.sendBar}>
        {/* Recording action buttons before the send row */}
        {browserRecording && recordingPhase === "recording" && (
          <Tooltip title={t("browser.recordReplay.stop", "Stop browser recording")}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
              onClick={handleEndRecording}
            >
              <Square size={14} />
            </button>
          </Tooltip>
        )}
        {!browserRecording && browserLastRecordingId && !browserReplayBusy && (
          <Tooltip
            title={t("browser.recordReplay.replay", "Replay last browser recording")}
          >
            <button
              type="button"
              className={styles.actionBtn}
              disabled={isStreaming}
              onClick={handleReplay}
            >
              <Play size={14} />
            </button>
          </Tooltip>
        )}
        {browserReplayBusy && <Loader2 size={14} className={styles.spinIcon} />}
        <div className={styles.sendRow}>
          <textarea
            ref={textareaRef}
            className={styles.sendTextarea}
            value={inputValue}
            onCompositionStart={() => {
              imeComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              imeComposingRef.current = false;
            }}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={inputDisabled}
          />
          <button
            type="button"
            className={styles.sendBtn}
            disabled={
              isStreaming
                ? booting || !threadId
                : !inputValue.trim() || inputDisabled
            }
            onClick={isStreaming ? cancelStream : handleSend}
            title={
              isStreaming
                ? t("chat.stop", "Stop")
                : t("terminal.ai.send", "Send")
            }
          >
            {isStreaming ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
