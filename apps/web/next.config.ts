import type { NextConfig } from "next";

function contentSecurityPolicy(): string {
  const sources = new Set<string>();
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (configured) {
    try {
      const origin = new URL(configured).origin;
      sources.add(origin);
      sources.add(origin.replace(/^http/, "ws"));
    } catch {
      // Runtime configuration validation reports the invalid URL.
    }
  }
  const scripts = ["'self'", "'unsafe-inline'"];
  if (process.env.NODE_ENV !== "production") scripts.push("'unsafe-eval'");
  const directives = [
    "default-src 'self'",
    `script-src ${scripts.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${[...sources].join(" ")}`.trim(),
    `img-src 'self' blob: data: ${[...sources].join(" ")}`.trim(),
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (process.env.NODE_ENV === "production") {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
