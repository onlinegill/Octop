import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IdCard, Network, Users } from "lucide-react";
import PageShell from "../../../layouts/PageShell";
import TabBar, { type TabBarItem } from "../../../components/TabLabel/TabBar";
import { TAB_ICON_SIZE } from "../../../components/TabLabel";
import { TabPanelHeader } from "../../Settings/AdvancedSettings/TabPanelHeader";
import RolesPanel from "./RolesPanel";
import UsersListPanel from "./UsersListPanel";
import SsoPanel from "./SsoPanel";
import LdapPanel from "./LdapPanel";
import ForbiddenPage from "../../../components/ForbiddenPage";
import { useGatedSearchTabs } from "../../../hooks/useGatedSearchTabs";
import { USERS_TAB_PERMISSIONS } from "../../../utils/permissions";
import openidIcon from "../../../assets/providers/openid.svg";
import styles from "./index.module.less";

type TabKey = "local" | "roles" | "oidc" | "ldap";

function BrandTabIcon({
  src,
  size = TAB_ICON_SIZE,
}: {
  src: string;
  size?: number;
}) {
  return <img src={src} alt="" width={size} height={size} draggable={false} />;
}

const TABS: TabBarItem<TabKey>[] = [
  { key: "local", labelKey: "adminUsers.tabLocal", icon: Users },
  { key: "roles", labelKey: "adminUsers.tabRoles", icon: IdCard },
  {
    key: "oidc",
    labelKey: "adminUsers.tabOidc",
    icon: <BrandTabIcon src={openidIcon} />,
  },
  {
    key: "ldap",
    labelKey: "adminUsers.tabLdap",
    icon: Network,
  },
];

function parseTab(raw: string | null): TabKey {
  if (raw === "roles") return "roles";
  if (raw === "oidc" || raw === "ldap") {
    return raw;
  }
  // Legacy bookmark: combined SSO tab → OIDC.
  if (raw === "sso") return "oidc";
  return "local";
}

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const { allowedTabs, activeTab, forbidden, selectTab } = useGatedSearchTabs({
    tabs: TABS,
    tabPermissions: USERS_TAB_PERMISSIONS,
    parseTab,
    querylessKey: "local",
  });

  if (forbidden) return <ForbiddenPage />;

  let body: ReactNode = <UsersListPanel />;
  if (activeTab === "roles") {
    body = <RolesPanel />;
  } else if (activeTab === "oidc") {
    body = (
      <div className={styles.ssoPanel}>
        <TabPanelHeader
          icon={<BrandTabIcon src={openidIcon} size={22} />}
          title={t("adminSso.oidcTitle")}
          description={t("adminSso.oidcDesc")}
        />
        <SsoPanel />
      </div>
    );
  } else if (activeTab === "ldap") {
    body = (
      <div className={styles.ssoPanel}>
        <TabPanelHeader
          icon={<Network size={22} />}
          title={t("adminSso.ldapTitle")}
          description={t("adminSso.ldapDesc")}
        />
        <LdapPanel />
      </div>
    );
  }

  return (
    <PageShell.Tabbed
      title={t("pageShell.adminUsers.title")}
      subtitle={t("pageShell.adminUsers.subtitle")}
      tabBar={
        <TabBar tabs={allowedTabs} activeKey={activeTab} onChange={selectTab} />
      }
    >
      {body}
    </PageShell.Tabbed>
  );
}
