import "@/styles/globals.css";

export const metadata = {
  title: "NGS — Rooftop & Window Quoting",
};

// Deliberately minimal: the header/app-chrome lives in
// app/(dashboard)/layout.tsx instead, so auth screens (login,
// forgot-password, reset-password) render full-bleed with no nav bar.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
