import { describe, expect, it } from "vitest";

import { storageBrowseError, storageProbeMessage } from "./storageProbeMessage";

function t(key: string, options?: string | Record<string, unknown>): string {
  const catalog: Record<string, string> = {
    "storage.testFailed": "Detection failed",
    "storage.browseFailed": "Browsing failed",
    "storage.probe_no_such_bucket": "Bucket does not exist, please check Bucket Name",
    "storage.probe_write_failed": "Write probe failed:{{detail}}",
  };
  const template = catalog[key];
  if (!template) {
    if (typeof options === "string") return options;
    if (
      options &&
      typeof options === "object" &&
      typeof options.defaultValue === "string"
    ) {
      return options.defaultValue;
    }
    return key;
  }
  if (
    options &&
    typeof options === "object" &&
    typeof options.detail === "string"
  ) {
    return template.replace("{{detail}}", options.detail);
  }
  return template;
}

describe("storageProbeMessage", () => {
  it("prefers a classified bucket error over the raw SDK dump", () => {
    expect(
      storageProbeMessage(
        {
          ok: false,
          message_key: "probe_no_such_bucket",
          message:
            "The specified bucket does not exist. Check the bucket name.",
        },
        t,
        "storage.testFailed",
      ),
    ).toBe("Bucket does not exist, please check Bucket Name");
  });

  it("interpolates leftover write details", () => {
    expect(
      storageProbeMessage(
        {
          ok: false,
          message_key: "probe_write_failed",
          message: "widget exploded",
        },
        t,
        "storage.testFailed",
      ),
    ).toBe("Write probe failed:widget exploded");
  });
});

describe("storageBrowseError", () => {
  it("uses the classified storage key instead of WORKSPACE_OP_UNSUPPORTED", () => {
    const err = new Error(
      'Request failed: 400 - {"error":{"code":"STORAGE_BROWSE_FAILED","message":"Could not browse this storage backend.","details":{"message_key":"probe_no_such_bucket","reason":"The specified bucket does not exist. Check the bucket name."}}}',
    );
    expect(storageBrowseError(err, t as never)).toBe(
      "Bucket does not exist, please check Bucket Name",
    );
  });
});
