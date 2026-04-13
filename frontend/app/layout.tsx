import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Course Audit",
  description: "AI-powered course audit system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          {/* Animated ambient gradient background */}
          <div className="ambient-bg" aria-hidden="true" />

          {/* Content layer above background */}
          <div className="relative z-10 flex min-h-full w-full">
            <Sidebar />
            <div className="flex flex-1 flex-col min-h-screen ml-60">
              <TopBar />
              <main className="flex-1 px-8 py-6">{children}</main>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
