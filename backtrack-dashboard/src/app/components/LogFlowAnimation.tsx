"use client";

export default function LogFlowAnimation({ width = 300, height = 105 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 400 140" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="lfa-coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#38D9C5" stopOpacity="0.6"/>
          <stop offset="70%" stopColor="#38D9C5" stopOpacity="0.05"/>
          <stop offset="100%" stopColor="#38D9C5" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="lfa-logFadeL" x1="0" x2="1">
          <stop offset="0" stopColor="#38D9C5" stopOpacity="0"/>
          <stop offset="1" stopColor="#38D9C5" stopOpacity="1"/>
        </linearGradient>
        <linearGradient id="lfa-logFadeR" x1="1" x2="0">
          <stop offset="0" stopColor="#38D9C5" stopOpacity="0"/>
          <stop offset="1" stopColor="#38D9C5" stopOpacity="1"/>
        </linearGradient>
      </defs>
      <style>{`
        @keyframes lfa-flowR{0%{transform:translateX(-140px) scaleX(0.6);opacity:0}20%{opacity:1}55%{transform:translateX(60px) scaleX(1);opacity:1}75%{transform:translateX(72px) scaleX(0.05);opacity:0.8}100%{transform:translateX(72px) scaleX(0);opacity:0}}
        @keyframes lfa-flowL{0%{transform:translateX(140px) scaleX(0.6);opacity:0}20%{opacity:1}55%{transform:translateX(-60px) scaleX(1);opacity:1}75%{transform:translateX(-72px) scaleX(0.05);opacity:0.8}100%{transform:translateX(-72px) scaleX(0);opacity:0}}
        @keyframes lfa-breathe{0%,100%{transform:scale(1);opacity:0.9}50%{transform:scale(1.12);opacity:1}}
        @keyframes lfa-glow{0%,100%{opacity:0.35;transform:scale(1)}50%{opacity:0.7;transform:scale(1.25)}}
        @keyframes lfa-spin{to{transform:rotate(360deg)}}
        @keyframes lfa-spark{0%{opacity:0;transform:translate(0,0) scale(0.2)}20%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(0.6)}}
        @keyframes lfa-dash{to{stroke-dashoffset:-188}}
        .lfa-log{fill:url(#lfa-logFadeR);transform-origin:right center;transform-box:fill-box;animation:lfa-flowR 2.4s cubic-bezier(.5,.05,.5,1) infinite}
        .lfa-log.lfa-left{fill:url(#lfa-logFadeL);transform-origin:left center;animation-name:lfa-flowL}
        .lfa-r2{animation-delay:.35s}.lfa-r3{animation-delay:.7s}.lfa-r4{animation-delay:1.05s}
        .lfa-core{transform-origin:200px 70px;animation:lfa-breathe 2.2s ease-in-out infinite}
        .lfa-glow{transform-origin:200px 70px;animation:lfa-glow 2.2s ease-in-out infinite}
        .lfa-ring{transform-origin:200px 70px;animation:lfa-spin 6s linear infinite;stroke-dasharray:30 158}
        .lfa-prog{stroke-dasharray:188;stroke-dashoffset:188;animation:lfa-dash 4s linear infinite;transform-origin:200px 70px;transform:rotate(-90deg)}
        .lfa-spark{fill:#38D9C5;transform-origin:200px 70px;animation:lfa-spark 1.4s ease-out infinite}
        .lfa-s1{--dx:22px;--dy:-18px;animation-delay:.1s}.lfa-s2{--dx:-24px;--dy:-14px;animation-delay:.5s}
        .lfa-s3{--dx:18px;--dy:20px;animation-delay:.9s}.lfa-s4{--dx:-20px;--dy:16px;animation-delay:1.2s}
      `}</style>
      <circle className="lfa-glow" cx="200" cy="70" r="38" fill="url(#lfa-coreGlow)"/>
      <circle className="lfa-prog" cx="200" cy="70" r="30" fill="none" stroke="#38D9C5" strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
      <circle className="lfa-ring" cx="200" cy="70" r="30" fill="none" stroke="#38D9C5" strokeWidth="1" opacity="0.4"/>
      <circle className="lfa-core" cx="200" cy="70" r="22" fill="none" stroke="#38D9C5" strokeWidth="2"/>
      <circle className="lfa-core" cx="200" cy="70" r="6" fill="#38D9C5"/>
      <circle className="lfa-spark lfa-s1" cx="200" cy="70" r="1.6"/>
      <circle className="lfa-spark lfa-s2" cx="200" cy="70" r="1.2"/>
      <circle className="lfa-spark lfa-s3" cx="200" cy="70" r="1.4"/>
      <circle className="lfa-spark lfa-s4" cx="200" cy="70" r="1"/>
      <rect className="lfa-log"                  x="40"  y="52" width="92" height="5" rx="2.5"/>
      <rect className="lfa-log lfa-r2"            x="40"  y="64" width="70" height="5" rx="2.5"/>
      <rect className="lfa-log lfa-r3"            x="40"  y="76" width="84" height="5" rx="2.5"/>
      <rect className="lfa-log lfa-r4"            x="40"  y="88" width="56" height="5" rx="2.5"/>
      <rect className="lfa-log lfa-left"          x="268" y="52" width="92" height="5" rx="2.5"/>
      <rect className="lfa-log lfa-left lfa-r2"   x="290" y="64" width="70" height="5" rx="2.5"/>
      <rect className="lfa-log lfa-left lfa-r3"   x="276" y="76" width="84" height="5" rx="2.5"/>
      <rect className="lfa-log lfa-left lfa-r4"   x="304" y="88" width="56" height="5" rx="2.5"/>
    </svg>
  );
}
