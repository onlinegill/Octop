import dify from "./dify.svg";
import notion from "./notion.png";
import obsidianCli from "./obsidian-cli.svg";
import openalex from "./openalex.svg";
<<<<<<< HEAD
=======
import qcc from "./qcc.png";
import qqMail from "./qq-mail.png";
import qqMusic from "./qq-music.png";
import tencentDocs from "./tencent-docs.png";
import tencentIma from "./tencent-ima.png";
import tencentMeeting from "./tencent-meeting.png";
import tencentNews from "./tencent-news.png";
import tencentLexiang from "./tencent-lexiang.png";
import tencentWeiyun from "./tencent-weiyun.png";
import wechatReading from "./wechat-reading.png";
import wecomCli from "./wecom-cli.png";
import weknora from "./weknora.svg";
import youdaoNote from "./youdao-note.png";
import yuandian from "./yuandian.png";
import yuqueMcp from "./yuque-mcp.png";
>>>>>>> upstream/main

export const CONNECTOR_LOGOS: Record<string, string> = {
  notion,
  "obsidian-cli": obsidianCli,
  openalex,
  dify,
<<<<<<< HEAD
=======
  "tencent-news": tencentNews,
  "wechat-reading": wechatReading,
  "youdao-note": youdaoNote,
  "tencent-weiyun": tencentWeiyun,
  weknora,
  "yuque-mcp": yuqueMcp,
>>>>>>> upstream/main
};

export function getConnectorLogo(kind: string): string | undefined {
  if (!kind) return undefined;
  const direct = CONNECTOR_LOGOS[kind];
  if (direct) return direct;
  const normalized = kind.toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized !== kind) {
    const fallback = CONNECTOR_LOGOS[normalized];
    if (fallback) return fallback;
  }
  return undefined;
}
