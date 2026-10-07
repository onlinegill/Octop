import { Cable } from "lucide-react";

import { getConnectorLogo } from "../../../assets/connectors";
import type { ConnectorCatalogEntry } from "../../../api/modules/connectors";
import styles from "./index.module.less";

export const MAIL_PROVIDERS = [
  {
    id: "gmail",
    label: "Gmail",
    guideUrl: "https://mail.google.com/",
    emailPlaceholder: "you@gmail.com",
  },
  {
    id: "custom",
    label: "Others",
    guideUrl: null,
    emailPlaceholder: "you@example.com",
  },
] as const;

export type MailProviderId = (typeof MAIL_PROVIDERS)[number]["id"];

/** Connectors that use inline credential guide links instead of top auth buttons. */
export const INLINE_CREDENTIAL_GUIDE_KINDS = new Set<string>([]);

/** Connectors with a top auth button — hide redundant links under form fields. */
export const HIDE_INLINE_FIELD_GUIDE_KINDS = new Set<string>([]);

export function mailProviderById(id: string | undefined) {
  return MAIL_PROVIDERS.find((item) => item.id === id) ?? MAIL_PROVIDERS[0];
}

export function connectorAccent(
  entry: Pick<ConnectorCatalogEntry, "kind" | "color">,
): string {
  return entry.color || "#1677ff";
}

export function ConnectorLogo({
  kind,
  icon,
  size = 22,
}: {
  kind: string;
  icon?: string | null;
  size?: number;
}) {
  const src =
    getConnectorLogo(kind) ?? (icon ? getConnectorLogo(icon) : undefined);
  if (!src) {
    const Icon = Cable;
    return (
      <Icon
        size={size}
        className={styles.connectorMcpFallbackIcon}
        aria-hidden
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={styles.connectorLogo}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
