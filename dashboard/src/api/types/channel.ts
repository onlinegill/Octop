export interface BaseChannelConfig {
  enabled: boolean;
  bot_prefix: string;
}

export interface DiscordConfig extends BaseChannelConfig {
  bot_token: string;
  allow_all_channels?: boolean;
  http_proxy: string;
  http_proxy_auth: string;
  allowed_channel_ids?: string[];
  allowed_user_ids?: string[];
}

export interface TelegramConfig extends BaseChannelConfig {
  bot_token: string;
  http_proxy?: string;
}

export interface MqttConfig extends BaseChannelConfig {
  host: string;
  port?: number | string;
  username?: string;
  password?: string;
  subscribe_topic?: string;
  publish_topic?: string;
  transport?: string;
}

export type DashboardConfig = BaseChannelConfig;

export interface OctopBotConfig extends BaseChannelConfig {
  api_key: string;
  api_keys: string[];
  api_base_url: string;
  name: string;
  dm_policy: "open" | "allowlist" | "disabled";
  allow_from: string[];
  system_prompt: string;
}

export interface ChannelConfig {
  discord: DiscordConfig;
  telegram: TelegramConfig;
  mqtt: MqttConfig;
  dashboard: DashboardConfig;
  octopbot: OctopBotConfig;
}

export type SingleChannelConfig =
  | DiscordConfig
  | TelegramConfig
  | MqttConfig
  | DashboardConfig
  | OctopBotConfig;
