import { ImageResponse } from "next/og";

// Image metadata
export const alt =
  "mcpmint: Your API, minted for MCP.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

// Brand
const BG = "#0A0A0A";
const ACID = "#E8FF47";
const MUTED = "#8A8A8A";
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: BG,
          backgroundImage:
            "linear-gradient(rgba(232,255,71,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(232,255,71,0.06) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          padding: "72px",
          fontFamily: MONO,
        }}
      >
        {/* Top bar: prompt + accent border */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 28,
            color: MUTED,
          }}
        >
          <span style={{ color: ACID }}>~/mcpmint</span>
          <span style={{ marginLeft: 16 }}>$ npx @mcpmint/cli generate api.yaml</span>
        </div>

        {/* Center: brand + tagline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 132,
              fontWeight: 700,
              letterSpacing: "-4px",
              color: "#F5F5F5",
              lineHeight: 1,
            }}
          >
            mcp
            <span style={{ color: ACID }}>mint</span>
            <span
              style={{
                display: "flex",
                width: 24,
                height: 96,
                marginLeft: 20,
                backgroundColor: ACID,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 32,
              fontSize: 40,
              color: "#D4D4D4",
              maxWidth: 980,
              lineHeight: 1.3,
            }}
          >
            Your API. Minted for MCP. Inspect every tool, trim context,
            and export without sending your file anywhere.
          </div>
        </div>

        {/* Bottom bar: chips */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 26,
            color: BG,
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "12px 24px",
              backgroundColor: ACID,
              fontWeight: 700,
            }}
          >
            OpenAPI
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: 20,
              padding: "12px 24px",
              border: `2px solid ${ACID}`,
              color: ACID,
              fontWeight: 700,
            }}
          >
            Postman
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: 20,
              padding: "12px 24px",
              border: `2px solid ${ACID}`,
              color: ACID,
              fontWeight: 700,
            }}
          >
            MCP
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
