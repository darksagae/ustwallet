export function IconCoins({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="4" />
      <circle cx="15" cy="15" r="4" />
      <path d="M9 13v2M15 11v2M12 10V8M12 16v-2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCap({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2L4 7v4c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V7l-8-5z" />
    </svg>
  );
}

export function IconReward({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2l3 9 9 .5-7 5.5 2.5 8.5L12 18l-7.5 7.5 2.5-8.5-7-5.5 9-.5L12 2z" />
    </svg>
  );
}

export function IconReserved({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
    </svg>
  );
}

import type { ReactNode } from "react";

const tierIcons: Record<string, ReactNode> = {
  Bronze: (
    <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="8" stroke="#cd7f32" />
      <path d="M12 8v4l2 2" stroke="#cd7f32" strokeLinecap="round" />
    </svg>
  ),
  Silver: (
    <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="8" stroke="#c0c0c0" />
      <path d="M12 6v6l4 2" stroke="#c0c0c0" strokeLinecap="round" />
    </svg>
  ),
  Gold: (
    <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2l2 7h7l-5.5 4 2 7-5.5-4-5.5 4 2-7-5.5-4h7z" stroke="#f59e0b" />
    </svg>
  ),
  Platinum: (
    <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z" stroke="#e5e4e2" />
    </svg>
  ),
  Diamond: (
    <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2l4 8 6 2-5 6-5-4-5 4-5-6 6-2 4-8z" stroke="#22d3ee" strokeLinejoin="round" />
    </svg>
  ),
};

export function TierIcon({ label }: { label: string }) {
  return <span className="flex-shrink-0">{tierIcons[label] ?? tierIcons.Bronze}</span>;
}
