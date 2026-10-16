import s3 from "./s3.svg";
import filesystem from "./filesystem.svg";
import shell from "./shell.svg";
import docker from "./docker.svg";
import opensandbox from "./opensandbox.svg";
import postgres from "./postgres.svg";
import custom from "./custom.svg";

export const STORAGE_LOGOS: Record<string, string> = {
  s3,
  filesystem,
  shell,
  docker,
  opensandbox,
  postgres,
  custom,
};

export function getStorageLogo(kind: string): string | undefined {
  if (!kind) return undefined;
  return STORAGE_LOGOS[kind.toLowerCase()];
}
