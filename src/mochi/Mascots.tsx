import React from "react";

export const MascotRabbit1: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 140 120">
    <path
      d="M70 16C78 8 92 10 96 20C108 16 118 26 114 36C126 40 128 54 118 60C126 70 120 82 108 84C110 96 98 104 88 98C82 108 66 108 60 98C50 104 38 96 40 84C28 82 22 70 30 60C20 54 22 40 34 36C30 26 40 16 52 20C56 10 66 8 70 16Z"
      fill="#fff"
      stroke="#2a2a2a"
      strokeWidth="5"
      strokeLinejoin="round"
    />
    <circle cx="56" cy="56" r="4" fill="#2a2a2a" />
    <circle cx="84" cy="56" r="4" fill="#2a2a2a" />
    <path d="M62 66q4 5 8 0q4 5 8 0" fill="none" stroke="#2a2a2a" strokeWidth="3.5" strokeLinecap="round" />
    <ellipse cx="45" cy="65" rx="7" ry="4" fill="#f7b8c4" />
    <ellipse cx="95" cy="65" rx="7" ry="4" fill="#f7b8c4" />
  </svg>
);

export const MochiTabIcon: React.FC<{ className?: string; size?: number | string }> = ({ className, size = 18 }) => (
  <svg
    className={className}
    style={{ width: size, height: size, flexShrink: 0 }}
    viewBox="0 0 140 120"
    aria-hidden="true"
  >
    <path
      d="M70 16C78 8 92 10 96 20C108 16 118 26 114 36C126 40 128 54 118 60C126 70 120 82 108 84C110 96 98 104 88 98C82 108 66 108 60 98C50 104 38 96 40 84C28 82 22 70 30 60C20 54 22 40 34 36C30 26 40 16 52 20C56 10 66 8 70 16Z"
      fill="#fff"
      stroke="#2a2a2a"
      strokeWidth="6"
      strokeLinejoin="round"
    />
    <circle cx="56" cy="56" r="5" fill="#2a2a2a" />
    <circle cx="84" cy="56" r="5" fill="#2a2a2a" />
    <path d="M62 66q4 5 8 0q4 5 8 0" fill="none" stroke="#2a2a2a" strokeWidth="4.5" strokeLinecap="round" />
    <ellipse cx="45" cy="65" rx="8" ry="5" fill="#f7b8c4" />
    <ellipse cx="95" cy="65" rx="8" ry="5" fill="#f7b8c4" />
  </svg>
);

export const MascotRabbit2: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 140 120">
    <path
      d="M70 16C78 8 92 10 96 20C108 16 118 26 114 36C126 40 128 54 118 60C126 70 120 82 108 84C110 96 98 104 88 98C82 108 66 108 60 98C50 104 38 96 40 84C28 82 22 70 30 60C20 54 22 40 34 36C30 26 40 16 52 20C56 10 66 8 70 16Z"
      fill="#fff"
      stroke="#2a2a2a"
      strokeWidth="5"
      strokeLinejoin="round"
    />
    <path d="M50 56q5 6 10 0M80 56q5 6 10 0" fill="none" stroke="#2a2a2a" strokeWidth="4" strokeLinecap="round" />
    <path d="M66 66q4 4 8 0" fill="none" stroke="#2a2a2a" strokeWidth="3.5" strokeLinecap="round" />
    <ellipse cx="45" cy="65" rx="7" ry="4" fill="#f7b8c4" />
    <ellipse cx="95" cy="65" rx="7" ry="4" fill="#f7b8c4" />
  </svg>
);

export const StickerMascot: React.FC = () => (
  <svg viewBox="0 0 140 120" style={{ width: 120, height: "auto", display: "block" }}>
    <path
      d="M70 16C78 8 92 10 96 20C108 16 118 26 114 36C126 40 128 54 118 60C126 70 120 82 108 84C110 96 98 104 88 98C82 108 66 108 60 98C50 104 38 96 40 84C28 82 22 70 30 60C20 54 22 40 34 36C30 26 40 16 52 20C56 10 66 8 70 16Z"
      fill="#fff"
      stroke="#2a2a2a"
      strokeWidth="5"
      strokeLinejoin="round"
    />
    <circle cx="56" cy="56" r="4" fill="#2a2a2a" />
    <circle cx="84" cy="56" r="4" fill="#2a2a2a" />
    <path d="M62 66q4 5 8 0q4 5 8 0" fill="none" stroke="#2a2a2a" strokeWidth="3.5" strokeLinecap="round" />
    <ellipse cx="45" cy="65" rx="7" ry="4" fill="#f7b8c4" />
    <ellipse cx="95" cy="65" rx="7" ry="4" fill="#f7b8c4" />
  </svg>
);
