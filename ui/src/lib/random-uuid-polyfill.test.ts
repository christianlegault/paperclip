import { describe, expect, it } from "vitest";
import { installRandomUuidPolyfill, randomUuidFromValues } from "./random-uuid-polyfill";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function insecureCrypto(): { getRandomValues(array: Uint8Array<ArrayBuffer>): unknown; randomUUID?(): string } {
  return { getRandomValues: (array) => globalThis.crypto.getRandomValues(array) };
}

describe("random-uuid-polyfill", () => {
  it("derives RFC 4122 v4 UUIDs from getRandomValues", () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomUuidFromValues(insecureCrypto())));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it("installs randomUUID when the browser omits it outside secure contexts", () => {
    const cryptoImpl = insecureCrypto();
    installRandomUuidPolyfill(cryptoImpl);
    expect(typeof cryptoImpl.randomUUID).toBe("function");
    expect(cryptoImpl.randomUUID!()).toMatch(UUID_V4);
  });

  it("keeps the native randomUUID when present", () => {
    const native = () => "native-id";
    const cryptoImpl = { ...insecureCrypto(), randomUUID: native };
    installRandomUuidPolyfill(cryptoImpl);
    expect(cryptoImpl.randomUUID).toBe(native);
  });
});
