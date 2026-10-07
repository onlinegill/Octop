import { Tag, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

interface MbtiPersonaTagProps {
  value: string | null | undefined;
  /** Show a placeholder tag when MBTI is not set. */
  showDefault?: boolean;
  /** Click handler — when provided, the tag becomes clickable. */
  onClick?: () => void;
}

const MBTI_ZH_NAMES: Record<string, string> = {
  INTJ: "Architect",
  INTP: "Logician",
  ENTJ: "Commander",
  ENTP: "Debater",
  INFJ: "Advocate",
  INFP: "Mediator",
  ENFJ: "Protagonist",
  ENFP: "Candidate",
  ISTJ: "Logistics division",
  ISFJ: "Guardian",
  ESTJ: "General manager",
  ESFJ: "Consul",
  ISTP: "Connoisseur",
  ISFP: "Explorer",
  ESTP: "Entrepreneur",
  ESFP: "Performer",
};

const MBTI_EN_NAMES: Record<string, string> = {
  INTJ: "Architect",
  INTP: "Logician",
  ENTJ: "Commander",
  ENTP: "Debater",
  INFJ: "Advocate",
  INFP: "Mediator",
  ENFJ: "Protagonist",
  ENFP: "Campaigner",
  ISTJ: "Logistician",
  ISFJ: "Defender",
  ESTJ: "Executive",
  ESFJ: "Consul",
  ISTP: "Virtuoso",
  ISFP: "Adventurer",
  ESTP: "Entrepreneur",
  ESFP: "Entertainer",
};

export default function MbtiPersonaTag({
  value,
  showDefault = true,
  onClick,
}: MbtiPersonaTagProps) {
  const { t, i18n } = useTranslation();

  if (!value && !showDefault) return null;

  const code = value?.toUpperCase() ?? "";
  const localizedName =
    code &&
    (i18n.language === "zh" ? MBTI_ZH_NAMES[code] : MBTI_EN_NAMES[code]);
  const label = code
    ? localizedName
      ? `${code} ${localizedName}`
      : code
    : t("experts.mbtiDefault");
  const clickable = !!onClick;

  const tag = (
    <Tag
      color={value ? "purple" : "default"}
      style={{
        margin: 0,
        cursor: clickable ? "pointer" : undefined,
      }}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      {label}
    </Tag>
  );

  return (
    <>
      {clickable ? (
        <Tooltip title={t("experts.mbtiViewDetail")}>{tag}</Tooltip>
      ) : (
        <Tooltip title={t("nav.mbti")}>{tag}</Tooltip>
      )}
    </>
  );
}
