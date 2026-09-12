import type { Metadata } from "next";
import "./globals.css";

const socialImage = new URL(
  "/og.png",
  process.env.CANDIDS_ASSET_URL ||
    process.env.CANDIDS_APP_URL ||
    "https://candids-tinotech.vercel.app",
).href;

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.CANDIDS_APP_URL || "https://candids.tinotech.co.za",
  ),
  title: {
    default: "Candids — one gathering, every perspective",
    template: "%s | Candids",
  },
  description:
    "A private event photo album with a simple guest link, host review and an album download. Explore the fictional sample and request a managed Tinotech pilot.",
  openGraph: {
    title: "Candids — one gathering, every perspective",
    description:
      "Collect your guests’ moments in one event album. Explore the sample and plan a managed Tinotech pilot.",
    images: [
      {
        url: socialImage,
        width: 1200,
        height: 630,
        alt: "Candids event albums by Tinotech",
      },
    ],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: [socialImage] },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
