import { request } from "../request";
import type { ChannelConfig, SingleChannelConfig } from "../types";

/** Channel connection status. */
export interface ChannelStatus {
  status:
    | "connected"
    | "disconnected"
    | "connecting"
    | "not_enabled"
    | "checking";
  reason: string | null;
}

/** Channel credential validation result. */
export interface ChannelCheckResult {
  valid: boolean;
  status:
    | "connected"
    | "disconnected"
    | "connecting"
    | "not_enabled"
    | "checking";
  reason: string | null;
  error_code?: string | null;
}

/** Connection status map for all channels. */
export type ChannelStatusMap = Record<string, ChannelStatus>;

export const channelApi = {
  listChannelTypes: () => request<string[]>("/config/channels/types"),

  listChannels: () => request<ChannelConfig>("/config/channels"),

  updateChannels: (body: ChannelConfig) =>
    request<ChannelConfig>("/config/channels", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getChannelConfig: (channelName: string) =>
    request<SingleChannelConfig>(
      `/config/channels/${encodeURIComponent(channelName)}`,
    ),

  updateChannelConfig: (channelName: string, body: SingleChannelConfig) =>
    request<SingleChannelConfig>(
      `/config/channels/${encodeURIComponent(channelName)}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  /** Get connection status for all channels. */
  getChannelsStatus: () => request<ChannelStatusMap>("/config/channels/status"),

  /** Reconnect the specified channel. */
  reconnectChannel: (channelName: string) =>
    request<{ status: string; channel: string }>(
      `/config/channels/${encodeURIComponent(channelName)}/reconnect`,
      { method: "POST" },
    ),

  /** Validate channel credentials and check connectivity. */
  checkChannel: (channelName: string, credentials?: Record<string, string>) =>
    request<ChannelCheckResult>(
      `/config/channels/${encodeURIComponent(channelName)}/check`,
      {
        method: "POST",
        ...(credentials ? { body: JSON.stringify(credentials) } : {}),
      },
    ),

  getShowToolDetails: () =>
    request<{ show_tool_details: boolean }>("/config/show_tool_details"),

  updateShowToolDetails: (value: boolean) =>
    request<{ show_tool_details: boolean }>("/config/show_tool_details", {
      method: "PUT",
      body: JSON.stringify({ show_tool_details: value }),
    }),

  getShowThinking: () =>
    request<{ show_thinking: boolean }>("/config/show_thinking"),

  updateShowThinking: (value: boolean) =>
    request<{ show_thinking: boolean }>("/config/show_thinking", {
      method: "PUT",
      body: JSON.stringify({ show_thinking: value }),
    }),
};
