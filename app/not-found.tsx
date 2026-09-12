import Link from "next/link";
import { Brand, Footer } from "./components/Brand";
export default function NotFound() {
  return (
    <>
      <Brand />
      <main className="copy-page">
        <p className="eyebrow">404</p>
        <h1>This page is not in the album.</h1>
        <p>
          Your host can share a fresh invitation if your album link has changed.
        </p>
        <Link href="/" className="button">
          Back to Candids
        </Link>
      </main>
      <Footer />
    </>
  );
}
