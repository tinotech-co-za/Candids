import Link from "next/link";
import { Brand, Footer } from "./components/Brand";
export default function Home() {
  return (
    <>
      <header className="site-header">
        <Brand />
        <nav aria-label="Main">
          <Link href="/access">Open an album</Link>
          <a
            href="https://www.tinotech.co.za/events"
            className="button button-small"
          >
            Plan an event album
          </a>
        </nav>
      </header>
      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <h1>
              One gathering.
              <br />
              Every perspective.
            </h1>
            <p>
              Collect the moments your guests notice. One private event album, a
              simple guest link, and a download to keep when the day is done.
            </p>
            <div className="hero-actions">
              <Link href="/demo" className="button">
                Explore the sample album
              </Link>
              <a href="https://www.tinotech.co.za/events" className="text-link">
                Ask about a managed pilot
              </a>
            </div>
            <p className="hero-note">
              Guests contribute directly from their browser.
            </p>
          </div>
          <div
            className="print-stack"
            aria-label="Original illustrations from our fictional sample event"
          >
            <figure className="hero-print back">
              <img
                src="/demo/flowers.jpg"
                alt="Illustrated flowers in a green vase"
              />
              <figcaption>The little details</figcaption>
            </figure>
            <figure className="hero-print front">
              <img
                src="/demo/table.jpg"
                alt="Original illustration of a long table set for a garden lunch"
              />
              <figcaption>
                A place for everyone <span>Sample artwork</span>
              </figcaption>
            </figure>
          </div>
        </section>
        <section className="how-section">
          <div>
            <h2>Invite. Collect. Keep.</h2>
            <p>
              Made for a small celebration, a team gathering or a community
              event.
            </p>
          </div>
          <ol className="steps">
            <li>
              <span>1</span>
              <h3>We set up your album</h3>
              <p>
                Agree the event, guest allowance and retention date with
                Tinotech. Your host access stays separate from the guest link.
              </p>
            </li>
            <li>
              <span>2</span>
              <h3>Guests add their moments</h3>
              <p>
                Share the invitation with your guests. They choose a display
                name and add photos from their phone.
              </p>
            </li>
            <li>
              <span>3</span>
              <h3>You choose when to share</h3>
              <p>
                Review the collection, open it to your guests, then download the
                album before its retention date.
              </p>
            </li>
          </ol>
        </section>
        <section className="pilot-section">
          <div>
            <h2>
              Your next event,
              <br />
              with a shared album.
            </h2>
            <p>
              The first pilot covers one event, up to 50 guest devices and 100
              photos. Setup, handover and the retention date are agreed in a
              written quote.
            </p>
            <p>
              Payment follows the accepted Tinotech quote. There is no
              subscription or charge to try the sample.
            </p>
            <a href="https://www.tinotech.co.za/events" className="button">
              Request your event quote
            </a>
          </div>
          <figure>
            <img
              src="/demo/garden.jpg"
              alt="Original illustrated garden arch with afternoon light"
            />
            <figcaption>
              Explore the flow with a fictional event. Sample artwork is clearly
              labelled throughout.
            </figcaption>
          </figure>
        </section>
      </main>
      <Footer />
    </>
  );
}
