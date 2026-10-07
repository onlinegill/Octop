import discordIcon from "../../../../assets/channels/discord.svg";
import dashboardIcon from "../../../../assets/channels/dashboard.svg";
import octopIcon from "../../../../assets/channels/octop.svg";
import consoleIcon from "../../../../assets/channels/console.svg";
import telegramIcon from "../../../../assets/channels/telegram.svg";
import mqttIcon from "../../../../assets/channels/mqtt.png";

/**
 * Catalogue of channel kinds the octop backend's ``ChannelFactory`` knows
 * how to build. Source of truth: ``octop/channels/factory.py``.
 */
export type ChannelKey =
  | "discord"
  | "mqtt"
  | "telegram"
  | "dashboard"
  | "agentchat"
  | "octopbot";

/**
 * Channel kinds backed by Octop ``ChannelKind`` / octop-gateway ``BUILTIN_CHANNELS``.
 * ``dashboard`` / ``agentchat`` are intentionally omitted until implemented.
 */
export const CHANNEL_KEYS: ChannelKey[] = [
  "telegram",
  "discord",
  "mqtt",
];

/** Less-common kinds hidden behind "More channels" until expanded. */
const COLLAPSED_CHANNEL_KEYS = new Set<ChannelKey>([]);

export function isCollapsedChannelKey(key: ChannelKey): boolean {
  return COLLAPSED_CHANNEL_KEYS.has(key);
}

/**
 * Split catalogue into default-visible vs collapsed. Already-configured
 * collapsed kinds stay visible so operators can manage them without expanding.
 */
export function partitionChannelKeys(
  keys: readonly ChannelKey[],
  configuredKinds: ReadonlySet<ChannelKey>,
): { featured: ChannelKey[]; more: ChannelKey[] } {
  const featured: ChannelKey[] = [];
  const more: ChannelKey[] = [];
  for (const key of keys) {
    if (!isCollapsedChannelKey(key) || configuredKinds.has(key)) {
      featured.push(key);
    } else {
      more.push(key);
    }
  }
  return { featured, more };
}

/** i18n key for each channel's display name (``channels.label_{key}``). */
export const CHANNEL_LABEL_KEYS: Record<ChannelKey, string> = {
  discord: "channels.label_discord",
  mqtt: "channels.label_mqtt",
  telegram: "channels.label_telegram",
  dashboard: "channels.label_dashboard",
  agentchat: "channels.label_agentchat",
  octopbot: "channels.label_octopbot",
};

/** Hardcoded English labels used as fallback when t() returns the key. */
export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  discord: "Discord",
  mqtt: "MQTT",
  telegram: "Telegram",
  dashboard: "Console",
  agentchat: "AgentChat",
  octopbot: "OctopBot",
};

export const CHANNEL_ICONS: Record<ChannelKey, string> = {
  discord: discordIcon,
  mqtt: mqttIcon,
  telegram: telegramIcon,
  dashboard: dashboardIcon,
  agentchat: consoleIcon,
  octopbot: octopIcon,
};

/** Brand accent per channel — used for cron task card stripes, badges, etc. */
export const CHANNEL_COLORS: Record<ChannelKey, string> = {
  telegram: "#229ED9",
  mqtt: "#7C3AED",
  discord: "#5865F2",
  dashboard: "#6366F1",
  agentchat: "#64748B",
  octopbot: "#10B981",
};

export function getChannelColor(channel: string): string {
  if (Object.prototype.hasOwnProperty.call(CHANNEL_COLORS, channel)) {
    return CHANNEL_COLORS[channel as ChannelKey];
  }
  return "#8c8c8c";
}

/** External onboarding/credential URLs. */
export const CHANNEL_URLS: Partial<Record<ChannelKey, string>> = {
  discord: "https://discord.com/developers/applications",
  telegram: "https://t.me/BotFather",
};

/** A single field of a channel's config form. */
export interface ChannelField {
  /** ``config`` JSON key. */
  name: string;
  /** Visible label (English; falls back when no i18n key). */
  label: string;
  /** Antd input type. */
  type?: "text" | "password" | "textarea" | "json" | "switch";
  /** Placeholder for the input. */
  placeholder?: string;
  /** True when the field is required at create time. */
  required?: boolean;
  /** Optional i18n key for help beneath the control. */
  helpKey?: string;
}

/**
 * Per-kind config field schema. Drives ``ChannelDrawer``'s manual config
 * form. Kinds not listed here fall back to a JSON textarea so any
 * octop-gateway channel still works without UI changes.
 */
export const CHANNEL_FIELDS: Partial<Record<ChannelKey, ChannelField[]>> = {
  discord: [
    { name: "bot_token", label: "Bot Token", type: "password", required: true },
    {
      name: "allow_all_channels",
      label: "channels.discordAllowAllChannels",
      type: "switch",
      helpKey: "channels.discordAllowAllChannelsHelp",
    },
    {
      name: "allowed_channel_ids",
      label: "channels.discordAllowedChannels",
      type: "textarea",
    },
    {
      name: "allowed_user_ids",
      label: "channels.discordAllowedUsers",
      type: "textarea",
    },
    {
      name: "http_proxy",
      label: "HTTP Proxy",
      placeholder: "http://127.0.0.1:18118",
    },
    {
      name: "http_proxy_auth",
      label: "HTTP Proxy Auth",
      type: "password",
      placeholder: "user:password",
    },
  ],
  octopbot: [
    { name: "api_key", label: "API Key", type: "password", required: true },
    { name: "api_base_url", label: "API Base URL", required: true },
  ],
  mqtt: [
    { name: "host", label: "Broker Host", required: true },
    { name: "port", label: "Port", placeholder: "8883" },
    { name: "username", label: "Username" },
    { name: "password", label: "Password", type: "password" },
    {
      name: "subscribe_topic",
      label: "Subscribe Topic",
      placeholder: "devices/+/in",
    },
    {
      name: "publish_topic",
      label: "Publish Topic",
      placeholder: "devices/{client_id}/out",
    },
    { name: "transport", label: "Transport", placeholder: "tcp" },
  ],
  telegram: [
    { name: "bot_token", label: "Bot Token", type: "password", required: true },
    {
      name: "http_proxy",
      label: "HTTP Proxy",
      placeholder: "http://127.0.0.1:18118",
    },
  ],
  // dashboard & agentchat: no required credentials.
};

/** Display-only config keys — excluded from credential field mapping. */
export const CHANNEL_DISPLAY_CONFIG_KEYS = [
  "show_thinking",
  "show_tool_hints",
  "response_mode",
  "c2c_streaming",
] as const;

/** Default per-channel display settings (octop-gateway ChannelConfig). */
export const DEFAULT_CHANNEL_DISPLAY_CONFIG = {
  response_mode: "stream" as const,
  show_thinking: false,
  show_tool_hints: false,
} as const;

/** Parse structured values from schema-driven channel form fields. */
export function normalizeChannelFieldValue(
  fieldName: string,
  value: unknown,
): unknown {
  if (fieldName === "allowed_channel_ids" || fieldName === "allowed_user_ids") {
    const entries = Array.isArray(value)
      ? value
      : String(value ?? "")
          .trim()
          .split(/[,\s]+/)
          .filter(Boolean);
    if (entries.some((entry) => !/^\d+$/.test(String(entry)))) {
      throw new Error("Invalid Discord ID");
    }
    return [...new Set(entries.map(String))];
  }
  return value;
}

/** Required field names per kind — used for "missing creds" UX. */
export const REQUIRED_CREDENTIALS: Partial<Record<ChannelKey, string[]>> =
  Object.fromEntries(
    Object.entries(CHANNEL_FIELDS).map(([key, fields]) => [
      key,
      (fields ?? []).filter((f) => f.required).map((f) => f.name),
    ]),
  );

/** Whether a config blob has all required credentials for the given kind. */
export function hasRequiredCredentials(
  key: ChannelKey,
  config: Record<string, unknown> | undefined,
): boolean {
  const required = REQUIRED_CREDENTIALS[key];
  if (!required || required.length === 0) return true;
  if (!config) return false;
  return required.every((field) => {
    const v = config[field];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}
