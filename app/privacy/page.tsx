import { Brand, Footer } from "../components/Brand";
export const metadata = { title: "Privacy and pilot terms" };
export default function Privacy() {
  return (
    <>
      <header className="site-header">
        <Brand />
      </header>
      <main className="prose-page">
        <h1>
          A shared album.
          <br />A clear agreement.
        </h1>
        <h2>The sample album</h2>
        <p>
          The public demo uses fictional names and original illustrated artwork.
          Files you try in the demo stay in this browser tab. They are not sent
          to Tinotech and disappear when the page is refreshed or closed. Demo
          downloads contain the sample images and any photos you added in the
          tab.
        </p>
        <h2>A managed event</h2>
        <p>
          Tinotech provisions a real album after agreeing a written scope with
          the host. The first pilot allows one event, 50 guest devices, 100
          photos and a retention period of up to 30 days. Your quote confirms
          the price, event date, allowance, support and deletion date before
          payment. Request a quote at{" "}
          <a href="https://www.tinotech.co.za/events">Tinotech events</a>.
          Payment and refunds follow the accepted quote and{" "}
          <a href="https://www.tinotech.co.za/policies">Tinotech’s policies</a>.
        </p>
        <h2>Who can see the photographs?</h2>
        <p>
          Before the host shares the album, guests can see their own uploads and
          the host can review all uploads. After sharing, participating guests
          can view and download the collection. Each file request checks current
          access. Do not forward a guest invitation outside your group. Anyone
          who possesses a valid invitation can join; guest identity is not
          verified.
        </p>
        <p>
          Host and recovery keys give administrative access. Store them in a
          password manager. Recovery replaces the old host key and recovery key.
          Blocking a guest also changes the invitation for future guests. Other
          guests already admitted keep their access.
        </p>
        <h2>Only share photographs you may share</h2>
        <p>
          Ask the people in your photos before uploading, and follow your event
          host’s guidance. Do not upload sensitive documents, private material
          without permission or inappropriate content. Guests may delete their
          own photos; hosts may remove any photo. This managed pilot does not
          include automated content moderation.
        </p>
        <h2>Data and retention</h2>
        <p>
          Live albums store your chosen display name, images and upload metadata
          in Tinotech’s dedicated event backend, served through its managed
          application. Access uses a secure session cookie. An hourly
          hashed request identifier limits repeated access attempts; it expires
          within two hours and is removed by scheduled cleanup. Images are
          resized and re-encoded to remove embedded metadata, including GPS. No
          guest email address or card information is collected by Candids.
        </p>
        <p>
          Access stops at the recorded expiry, shown in the album. Scheduled
          cleanup removes album files and records afterward, normally within 30
          minutes for the pilot. Protected backups use a seven-day retention
          rotation, as agreed in the event terms, so deleted photos can remain
          in those backups during that rotation. Hosts should download their
          album before expiry. Copies already downloaded or photographed by a
          participant cannot be revoked.
        </p>
        <p>
          Tinotech keeps the accepted quote, buyer contact and delivery record
          privately for billing and support. Minimal payment references and
          fulfillment records remain after album expiry to prevent duplicate
          activation; they contain no photographs or guest display names. A
          reviewed payment case can pause new uploads while preserving existing
          access and export until the agreed album expiry.
        </p>
        <p>
          For access, deletion, safety or billing questions, contact{" "}
          <a href="mailto:info@tinotech.co.za">info@tinotech.co.za</a>. Give the
          album name or ID; do not email host keys or private photographs unless
          an agreed support process requires them.
        </p>
      </main>
      <Footer />
    </>
  );
}
