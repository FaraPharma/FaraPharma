import { headers } from "next/headers";

/** IPv6 را به پیشوند /64 تبدیل می‌کند (چرخاندن آدرس داخل یک /64 برای مهاجم رایگان است) */
export function normalizeIp(raw: string): string | null {
  const ip = raw.trim().toLowerCase();
  if (!ip) return null;
  if (!ip.includes(":")) return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
  if (!/^[0-9a-f:.]+$/.test(ip)) return null;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  if (groups.length < 4) return null;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/**
 * IP کلاینت از هدر CF-Connecting-IP (کلودفلر آن را همیشه خودش می‌گذارد و کلاینت نمی‌تواند جعل کند).
 * X-Forwarded-For عمداً نادیده گرفته می‌شود (قابل جعل است). اگر هدر نبود null برمی‌گردد
 * و فقط قفل ایمیل کار می‌کند (نه یک سطل مشترک برای همه).
 */
export async function getClientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const raw = h.get("cf-connecting-ip");
    return raw ? normalizeIp(raw) : null;
  } catch {
    return null;
  }
}
