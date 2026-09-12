import Link from "next/link";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Candids home">
      <span className="brand-mark" aria-hidden="true">
        ✳
      </span>
      Candids<span className="brand-by">by Tinotech</span>
    </Link>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <Brand />
      <p>A little more of the day, kept together.</p>
      <nav aria-label="Footer">
        <Link href="/privacy">Privacy & pilot terms</Link>
        <a href="mailto:info@tinotech.co.za">Contact Tinotech</a>
      </nav>
    </footer>
  );
}
