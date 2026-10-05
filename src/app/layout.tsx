import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
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
      <body>{children}</body>
    </html>
  );
}
