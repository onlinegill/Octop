import { useTranslation } from "react-i18next";
import { Variable } from "lucide-react";
import { TabPanelHeader } from "../../AdvancedSettings/TabPanelHeader";

interface PageHeaderProps {
  className?: string;
}

export function PageHeader({ className }: PageHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className={className}>
      <TabPanelHeader
        icon={<Variable size={22} />}
        title={t("environments.title")}
        description={t("environments.description")}
      />
    </div>
  );
}
