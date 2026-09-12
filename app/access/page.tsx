"use client";
import { useState } from "react";
import { Brand, Footer } from "../components/Brand";
export default function Access() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <header className="site-header">
        <Brand />
      </header>
      <main className="access-page">
        <h1>Open your album.</h1>
        <p>
          Paste the invitation or host link you received. Keep host links and
          recovery cards private.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const url = new URL(link);
              if (!/^\/event\/[a-zA-Z0-9]{16,64}$/.test(url.pathname))
                throw new Error();
              window.location.assign(url.pathname + url.hash);
            } catch {
              setError(
                "Paste a complete Candids event link, including its access key.",
              );
            }
          }}
        >
          <label htmlFor="album-link">Your private album link</label>
          <input
            id="album-link"
            type="password"
            autoComplete="off"
            required
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          <button className="button">Open album</button>
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
        </form>
        <p>
          Still planning an event?{" "}
          <a href="https://www.tinotech.co.za/events" className="text-link">
            Request a managed pilot.
          </a>
        </p>
      </main>
      <Footer />
    </>
  );
}
