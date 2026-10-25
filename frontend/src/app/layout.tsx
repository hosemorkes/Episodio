import type { Metadata, Viewport } from "next";
import { Geist, Inter } from "next/font/google";
import { Boot } from "@/components/Boot";
import "./globals.css";

const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", weight: ["400", "500", "600", "700"], display: "swap" });
const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Episodio", template: "%s · Episodio" },
  description: "Личный трекер аниме, сериалов, фильмов, книг и манги",
  applicationName: "Episodio",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Episodio", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0F172A",
};

// Тема ставится до первой отрисовки, чтобы не было вспышки тёмной темы в светлой
const themeScript = `try{var t=localStorage.getItem('episodio-theme')==='light'?'light':'dark';document.documentElement.setAttribute('data-theme',t);var l=localStorage.getItem('episodio-lang')==='en'?'en':'ru';document.documentElement.setAttribute('lang',l);var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',t==='light'?'#F8FAFC':'#0F172A')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" data-theme="dark" suppressHydrationWarning className={`${geist.variable} ${inter.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <Boot />
        {children}
      </body>
    </html>
  );
}
