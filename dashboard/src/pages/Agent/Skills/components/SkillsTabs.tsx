/**
 * SkillsTabs — the full skills surface (Installed / Built-in / Packages):
 *   1. Customized Skills  (workspace kind, editable + deletable)
 *   2. Built-in Skills    (builtin kind, toggle only)
 *   3. Skill Packages     (shared skill bundles)
 *
 * Extracted from the Skills page so it can be embedded both on the dedicated
 * `/skills` route and inside drawers (e.g. the expert skill catalog). It takes
 * an explicit `agentId` so callers decide which agent's skills to show.
 */

import { useMemo, useState } from "react";
import { Empty } from "antd";
import { Blocks, Package, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import TabBar, {
  type TabBarItem,
} from "../../../../components/TabLabel/TabBar";
import InstalledSkillsTab from "./InstalledSkillsTab";
import SkillPackagesTab from "./SkillPackagesTab";
import { useSkills } from "../useSkills";
import styles from "../index.module.less";
import { useCurrentUser } from "../../../../hooks/useCurrentUser";
import { userCanAny, PERM } from "../../../../utils/permissions";

type SkillsTab = "custom" | "builtin" | "packages";

const SKILL_TABS: TabBarItem<SkillsTab>[] = [
  { key: "custom", labelKey: "skills.customizedSkills", icon: Sparkles },
  { key: "builtin", labelKey: "skills.builtinSkills", icon: Blocks },
  { key: "packages", labelKey: "skills.skillPackages", icon: Package },
];

interface SkillsTabsProps {
  /** Agent whose skills are shown. */
  agentId: string | null;
}

export default function SkillsTabs({ agentId }: SkillsTabsProps) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  // Hide the skill-packages tab for users without the `skill_packages` permission.
  const canSkillPackages = userCanAny(currentUser, PERM.skillPackages);
  const remoteAgent = Boolean(agentId?.startsWith("bridge:"));
  const [activeTab, setActiveTab] = useState<SkillsTab>("custom");
  const tabs = useMemo(
    () =>
      SKILL_TABS.filter(
        (tab) => tab.key !== "packages" || (canSkillPackages && !remoteAgent),
      ),
    [canSkillPackages, remoteAgent],
  );
  const resolvedTab =
    activeTab === "packages" && (!canSkillPackages || remoteAgent)
      ? "custom"
      : activeTab;
  const onInstalledTab =
    resolvedTab === "custom" ||
    resolvedTab === "builtin" ||
    resolvedTab === "packages";
  const installedSkills = useSkills(agentId, { enabled: onInstalledTab });

  const noAgent = (
    <Empty
      description={t("skills.noAgentSelected")}
      style={{ marginTop: 64 }}
    />
  );

  return (
    <div className={styles.skillsTabs}>
      <TabBar tabs={tabs} activeKey={resolvedTab} onChange={setActiveTab} />

      <div className={styles.skillsTabsContent}>
        {resolvedTab === "custom" || resolvedTab === "builtin" ? (
          agentId ? (
            <InstalledSkillsTab
              key={agentId}
              agentId={agentId}
              kind={resolvedTab === "builtin" ? "builtin" : "custom"}
              {...installedSkills}
            />
          ) : (
            noAgent
          )
        ) : resolvedTab === "packages" && agentId && canSkillPackages ? (
          <SkillPackagesTab
            key={agentId}
            agentId={agentId}
            skills={installedSkills.skills}
            fetchSkills={installedSkills.fetchSkills}
            toggleEnabled={installedSkills.toggleEnabled}
          />
        ) : (
          noAgent
        )}
      </div>
    </div>
  );
}
