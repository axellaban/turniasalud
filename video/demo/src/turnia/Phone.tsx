import React from "react";

/** Marco de celular (400 × 860 px CSS); los hijos ocupan la pantalla debajo de la barra de estado. */
export const Phone: React.FC<{ children: React.ReactNode; time?: string; dark?: boolean; style?: React.CSSProperties }> = ({ children, time = "7:12", dark = false, style }) => {
  const ink = dark ? "#fff" : "#000";
  return (
    <div
      style={{
        position: "absolute",
        width: 400,
        height: 860,
        borderRadius: 64,
        background: "#0d0f14",
        padding: 12,
        boxShadow: "0 0 0 2px #2a2d35, 0 60px 120px -30px rgba(8,24,63,.55), 0 20px 50px -20px rgba(8,24,63,.4)",
        ...style,
      }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 52, overflow: "hidden", background: dark ? "#111" : "#fff" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 50, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 34px 0 40px", fontFamily: "Inter, system-ui", fontWeight: 600, fontSize: 16, color: ink }}>
          <span>{time}</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <svg width="18" height="12" viewBox="0 0 18 12">
              {[0, 1, 2, 3].map((i) => (
                <rect key={i} x={i * 4.6} y={9 - i * 3} width="3.2" height={3 + i * 3} rx="1" fill={ink} />
              ))}
            </svg>
            <svg width="16" height="12" viewBox="0 0 16 12">
              <path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.4 6.8a6.5 6.5 0 0 1 9.2 0L11.4 8a4.8 4.8 0 0 0-6.8 0zM1.2 4.6a9.6 9.6 0 0 1 13.6 0l-1.2 1.2a7.9 7.9 0 0 0-11.2 0z" fill={ink} />
            </svg>
            <svg width="26" height="12" viewBox="0 0 26 12">
              <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke={ink} opacity=".45" />
              <rect x="2" y="2" width="16" height="8" rx="1.8" fill={ink} />
              <rect x="23.5" y="4" width="2" height="4" rx="1" fill={ink} opacity=".45" />
            </svg>
          </span>
        </div>
        <div style={{ position: "absolute", top: 11, left: "50%", marginLeft: -60, width: 120, height: 34, borderRadius: 20, background: "#000", zIndex: 6 }} />
        <div style={{ position: "absolute", top: 50, left: 0, right: 0, bottom: 0 }}>{children}</div>
        <div style={{ position: "absolute", bottom: 8, left: "50%", marginLeft: -68, width: 136, height: 5, borderRadius: 3, background: ink, opacity: 0.85, zIndex: 6 }} />
      </div>
    </div>
  );
};
