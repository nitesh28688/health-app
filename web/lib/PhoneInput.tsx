"use client";
import { useState } from "react";

// Common countries first; "Other" lets ANY country's code be typed manually so
// nobody is ever blocked — the E.164 validation doesn't care about the list.
const COUNTRIES = [
  { code: "+91", name: "India", flag: "🇮🇳" },
  { code: "+1", name: "US / Canada", flag: "🇺🇸" },
  { code: "+44", name: "UK", flag: "🇬🇧" },
  { code: "+971", name: "UAE", flag: "🇦🇪" },
  { code: "+61", name: "Australia", flag: "🇦🇺" },
  { code: "+65", name: "Singapore", flag: "🇸🇬" },
  { code: "+966", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "+974", name: "Qatar", flag: "🇶🇦" },
  { code: "+968", name: "Oman", flag: "🇴🇲" },
  { code: "+973", name: "Bahrain", flag: "🇧🇭" },
  { code: "+965", name: "Kuwait", flag: "🇰🇼" },
  { code: "+60", name: "Malaysia", flag: "🇲🇾" },
  { code: "+64", name: "New Zealand", flag: "🇳🇿" },
  { code: "+49", name: "Germany", flag: "🇩🇪" },
  { code: "+33", name: "France", flag: "🇫🇷" },
  { code: "+34", name: "Spain", flag: "🇪🇸" },
  { code: "+39", name: "Italy", flag: "🇮🇹" },
  { code: "+31", name: "Netherlands", flag: "🇳🇱" },
  { code: "+41", name: "Switzerland", flag: "🇨🇭" },
  { code: "+46", name: "Sweden", flag: "🇸🇪" },
  { code: "+353", name: "Ireland", flag: "🇮🇪" },
  { code: "+81", name: "Japan", flag: "🇯🇵" },
  { code: "+82", name: "South Korea", flag: "🇰🇷" },
  { code: "+86", name: "China", flag: "🇨🇳" },
  { code: "+852", name: "Hong Kong", flag: "🇭🇰" },
  { code: "+62", name: "Indonesia", flag: "🇮🇩" },
  { code: "+66", name: "Thailand", flag: "🇹🇭" },
  { code: "+63", name: "Philippines", flag: "🇵🇭" },
  { code: "+92", name: "Pakistan", flag: "🇵🇰" },
  { code: "+880", name: "Bangladesh", flag: "🇧🇩" },
  { code: "+94", name: "Sri Lanka", flag: "🇱🇰" },
  { code: "+977", name: "Nepal", flag: "🇳🇵" },
  { code: "+27", name: "South Africa", flag: "🇿🇦" },
  { code: "+234", name: "Nigeria", flag: "🇳🇬" },
  { code: "+254", name: "Kenya", flag: "🇰🇪" },
  { code: "+20", name: "Egypt", flag: "🇪🇬" },
  { code: "+55", name: "Brazil", flag: "🇧🇷" },
  { code: "+52", name: "Mexico", flag: "🇲🇽" },
] as const;

const inputCls =
  "rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base";

/** Combines a country-code select + local number into one E.164 string via onChange. */
export function PhoneInput({ value, onChange, placeholder = "Phone number" }: {
  value: string; onChange: (e164: string) => void; placeholder?: string;
}) {
  const match = COUNTRIES.find((c) => value.startsWith(c.code));
  const [otherMode, setOtherMode] = useState(!match && value.length > 1);
  const [otherCode, setOtherCode] = useState(match ? "" : value.replace(/[^\d+]/g, "").slice(0, 5) || "+");

  const code = match?.code ?? (otherMode ? otherCode : "+91");
  const local = match ? value.slice(match.code.length) : otherMode ? value.slice(code.length) : value.replace(/^\+/, "");

  function setCode(newCode: string) {
    if (newCode === "other") {
      setOtherMode(true);
      onChange(otherCode + local.replace(/\D/g, ""));
      return;
    }
    setOtherMode(false);
    onChange(newCode + local.replace(/\D/g, ""));
  }
  function setOther(v: string) {
    const cleaned = "+" + v.replace(/\D/g, "").slice(0, 4);
    setOtherCode(cleaned);
    onChange(cleaned + local.replace(/\D/g, ""));
  }
  function setLocal(newLocal: string) {
    const digits = newLocal.replace(/\D/g, "");
    onChange(code + digits);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <select value={otherMode ? "other" : code} onChange={(e) => setCode(e.target.value)}
          className={`${inputCls} w-[118px] px-2 shrink-0 text-sm`}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
          ))}
          <option value="other">🌍 Other…</option>
        </select>
        <input type="tel" inputMode="tel" placeholder={placeholder} value={local}
          onChange={(e) => setLocal(e.target.value)} autoComplete="tel-national"
          className={`${inputCls} flex-1 min-w-0`} />
      </div>
      {otherMode && (
        <input type="tel" inputMode="tel" placeholder="Country code, e.g. +212" value={otherCode}
          onChange={(e) => setOther(e.target.value)} className={`${inputCls} w-40`} />
      )}
    </div>
  );
}
