import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/config";
import { TopBar } from "@/components/top-bar";
import { SwRegister } from "@/components/sw-register";
import { QuickNoteFab } from "@/components/quick-note-fab";
import { ChequeReminders } from "@/components/cheque-reminders";
import { ConnectivityGuard } from "@/components/connectivity-guard";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icons/icon-512.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A7C6B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@100..900&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased">
        <ConnectivityGuard>
          <TopBar />
          <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5">{children}</main>
          <QuickNoteFab />
          <ChequeReminders />
        </ConnectivityGuard>
        <SwRegister />
        <Toaster richColors position="top-center" dir="rtl" closeButton />
      </body>
    </html>
  );
}
