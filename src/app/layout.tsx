import type { Metadata } from "next";
import { ConsentManager } from "@/features/measurement/consent-ui";
import { publicRuntimeConfig } from "@/server/config/public";
import { resolveAppEnvironment } from "@/server/config/environment";
import { trustedOrigins } from "@/server/config/origins";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(trustedOrigins(resolveAppEnvironment())[0]),
  title: "PkgCompass — Headless CMS guide",
  description:
    "The English foundation preview for the PkgCompass headless CMS guide.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}<ConsentManager publicConfig={publicRuntimeConfig()} /></body>
    </html>
  );
}
