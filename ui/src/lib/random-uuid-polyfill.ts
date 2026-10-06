// Browsers only expose crypto.randomUUID in secure contexts (HTTPS or
// localhost). Boards opened over plain HTTP on a LAN address (for example
// http://192.168.x.x:3100) would otherwise throw on every call site that tags
// comments, uploads, or tabs with a client ID. crypto.getRandomValues remains
// available in insecure contexts, so derive an RFC 4122 v4 UUID from it.

type CryptoLike = {
  getRandomValues?(array: Uint8Array<ArrayBuffer>): unknown;
  randomUUID?(): string;
};

export function randomUuidFromValues(cryptoImpl: Required<Pick<CryptoLike, "getRandomValues">>): string {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export function installRandomUuidPolyfill(cryptoImpl: CryptoLike | undefined = globalThis.crypto): void {
  if (!cryptoImpl || typeof cryptoImpl.randomUUID === "function") return;
  const { getRandomValues } = cryptoImpl;
  if (typeof getRandomValues !== "function") return;
  Object.defineProperty(cryptoImpl, "randomUUID", {
    configurable: true,
    writable: true,
    value: () => randomUuidFromValues({ getRandomValues: (array) => getRandomValues.call(cryptoImpl, array) }),
  });
}

installRandomUuidPolyfill();
