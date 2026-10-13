import { isIP } from "node:net";

type Address = { bytes: number[]; mapped: boolean };

function parseAddress(input: string): Address | null {
  // スコープ ID は許可範囲の一部ではないため受け付けない。
  if (input.includes("%")) return null;
  const family = isIP(input);
  if (family === 0) return null;
  if (family === 4) return { bytes: input.split(".").map(Number), mapped: false };

  let address = input;
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const octets = address.slice(lastColon + 1).split(".").map(Number);
    address = `${address.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const [left, right] = address.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const words = right === undefined
    ? head
    : [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  const bytes = words.flatMap((word) => {
    const value = Number.parseInt(word, 16);
    return [value >> 8, value & 255];
  });
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 255 && bytes[11] === 255;
  return { bytes: mapped ? bytes.slice(12) : bytes, mapped };
}

function networkBytes(bytes: number[], prefix: number): number[] {
  return bytes.map((byte, index) => {
    const bits = Math.max(0, Math.min(8, prefix - index * 8));
    return byte & (255 << (8 - bits));
  });
}

function formatAddress(bytes: number[]): string {
  if (bytes.length === 4) return bytes.join(".");
  const words = Array.from({ length: 8 }, (_, index) =>
    ((bytes[index * 2] << 8) | bytes[index * 2 + 1]).toString(16));
  // 最長のゼロ列だけを省略し、同じ長さなら先頭側を選ぶ。
  let bestStart = -1;
  let bestLength = 1;
  for (let index = 0; index < words.length;) {
    if (words[index] !== "0") {
      index++;
      continue;
    }
    const start = index;
    while (index < words.length && words[index] === "0") index++;
    if (index - start > bestLength) {
      bestStart = start;
      bestLength = index - start;
    }
  }
  if (bestStart < 0) return words.join(":");
  return `${words.slice(0, bestStart).join(":")}::${words.slice(bestStart + bestLength).join(":")}`;
}

function parseCidr(input: string): { bytes: number[]; prefix: number } | null {
  const parts = input.trim().split("/");
  if (parts.length > 2) return null;
  const address = parseAddress(parts[0]);
  if (!address) return null;
  if (parts.length === 2 && !/^(0|[1-9]\d*)$/.test(parts[1])) return null;
  const width = address.bytes.length * 8;
  // 射影アドレスの IPv6 接頭辞から、固定の 96 ビットを除く。
  const offset = address.mapped ? 96 : 0;
  const prefix = parts.length === 2 ? Number(parts[1]) - offset : width;
  if (!Number.isInteger(prefix) || prefix < (width === 32 ? 8 : 32) || prefix > width) {
    return null;
  }
  return { bytes: networkBytes(address.bytes, prefix), prefix };
}

export function normalizeCidr(input: string): string | null {
  const network = parseCidr(input);
  return network ? `${formatAddress(network.bytes)}/${network.prefix}` : null;
}

export function cidrContains(cidr: string, ip: string): boolean {
  const network = parseCidr(cidr);
  const address = parseAddress(ip);
  if (!network || !address || network.bytes.length !== address.bytes.length) return false;
  return networkBytes(address.bytes, network.prefix)
    .every((byte, index) => byte === network.bytes[index]);
}

export function isLoopback(ip: string): boolean {
  const address = parseAddress(ip);
  if (!address) return false;
  if (address.bytes.length === 4) return address.bytes[0] === 127;
  return address.bytes.slice(0, 15).every((byte) => byte === 0) && address.bytes[15] === 1;
}

export function allowEntryFor(ip: string): string | null {
  const address = parseAddress(ip);
  if (!address) return null;
  const prefix = address.bytes.length === 4 ? 32 : 64;
  return `${formatAddress(networkBytes(address.bytes, prefix))}/${prefix}`;
}
