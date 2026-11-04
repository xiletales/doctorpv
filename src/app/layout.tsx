import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import { PROJECT_TITLE, SITE } from "@/lib/site";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: PROJECT_TITLE,
  description: `${SITE.name}, ${SITE.area}. Prototipe dengan data simulasi.`,
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#070b14" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning className={`${jakarta.variable} ${grotesk.variable} ${jetbrains.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
