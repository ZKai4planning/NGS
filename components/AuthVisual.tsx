// Abstract glazing-panel artwork for the auth screens' visual side.
// Original geometric composition (no stock photography) in the app's own
// ink/teal/amber palette, echoing tilted glass panels — fitting for a
// glazing/roofing product without relying on an external image asset.
export function AuthVisualSVG() {
  return (
    <svg
      viewBox="0 0 900 1100"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ngs-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1C2430" />
          <stop offset="100%" stopColor="#0F3B3C" />
        </linearGradient>
        <linearGradient id="ngs-panel-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#14B8AA" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#0F7173" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="ngs-panel-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D98E2B" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#D98E2B" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="ngs-panel-c" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#5EEAD4" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#5EEAD4" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      <rect width="900" height="1100" fill="url(#ngs-bg)" />

      {/* Tilted roof/glazing panel grid */}
      <g opacity="0.9">
        <polygon points="-80,260 420,60 620,180 100,420" fill="url(#ngs-panel-a)" />
        <polygon points="380,90 780,-60 980,60 600,220" fill="url(#ngs-panel-b)" />
        <polygon points="60,440 560,240 760,360 240,600" fill="url(#ngs-panel-c)" />
        <polygon points="520,240 900,90 900,320 660,440" fill="url(#ngs-panel-a)" opacity="0.7" />
        <polygon points="-100,520 320,340 500,440 60,660" fill="url(#ngs-panel-b)" opacity="0.6" />
      </g>

      {/* Mullion lines to suggest glazing panel seams */}
      <g stroke="#FFFFFF" strokeOpacity="0.12" strokeWidth="1.5">
        <line x1="-100" y1="340" x2="900" y2="20" />
        <line x1="-100" y1="440" x2="900" y2="120" />
        <line x1="-100" y1="540" x2="900" y2="220" />
        <line x1="-100" y1="640" x2="900" y2="320" />
        <line x1="0" y1="-50" x2="300" y2="1150" />
        <line x1="220" y1="-50" x2="520" y2="1150" />
        <line x1="440" y1="-50" x2="740" y2="1150" />
        <line x1="660" y1="-50" x2="960" y2="1150" />
      </g>

      {/* Soft glow accents */}
      <circle cx="120" cy="880" r="260" fill="#0F7173" opacity="0.25" />
      <circle cx="760" cy="980" r="220" fill="#D98E2B" opacity="0.12" />

      {/* Base gradient to keep the bottom readable behind copy text */}
      <rect x="0" y="760" width="900" height="340" fill="url(#ngs-fade)" />
      <defs>
        <linearGradient id="ngs-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1C2430" stopOpacity="0" />
          <stop offset="100%" stopColor="#1C2430" stopOpacity="0.85" />
        </linearGradient>
      </defs>
    </svg>
  );
}
