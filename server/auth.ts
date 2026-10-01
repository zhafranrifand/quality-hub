import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Request } from "express";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("hex");
export function hashPassword(password: string) {
  const salt = secret();
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string) {
  try {
    const [salt, key] = hash.split(":");
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(key, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
export function cookieToken(req: Request) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("qh_session="))
      ?.slice(11) || ""
  );
}
