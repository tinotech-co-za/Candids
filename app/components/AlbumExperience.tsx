"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Album, Manifest, Photo } from "@/lib/types";
import { sampleAlbum } from "@/lib/demo";
import { downloadArchive, preparePhoto, request, saveFile } from "@/lib/client";
import { Brand, Footer } from "./Brand";

function PhotoDialog({
  photo,
  close,
  download,
}: {
  photo: Photo;
  close: () => void;
  download: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="photo-dialog"
      onClose={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <button className="dialog-close" onClick={close} aria-label="Close photo">
        ×
      </button>
      <img src={photo.url || `/api/photo/${photo.id}`} alt={photo.caption} />
      <div>
        <p>
          {photo.caption}
          <small>Added by {photo.contributor}</small>
        </p>
        <button className="button button-small" onClick={download}>
          Download photo
        </button>
      </div>
    </dialog>
  );
}

export function AlbumExperience({
  demo = false,
  albumId,
}: {
  demo?: boolean;
  albumId: string;
}) {
  const [album, setAlbum] = useState<Album | null>(
    demo ? structuredClone(sampleAlbum) : null,
  );
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"guest" | "host" | "recovery">("guest");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [caption, setCaption] = useState("");
  const [invite, setInvite] = useState("");
  const [selected, setSelected] = useState<Photo | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [recoveryCard, setRecoveryCard] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const localUrls = useRef<string[]>([]);

  async function refresh() {
    try {
      const value = await request<Album>("album");
      if (value.id !== albumId)
        throw new Error(
          "Open the invitation for this album. This browser currently has access to a different event.",
        );
      setAlbum(value);
    } catch (cause) {
      setAlbum(null);
      throw cause;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (demo) {
      const urls = localUrls.current;
      if (new URLSearchParams(window.location.search).get("view") === "guest")
        setAlbum((value) =>
          value ? { ...value, role: "guest", guestName: "Alex" } : value,
        );
      return () => urls.forEach((url) => URL.revokeObjectURL(url));
    }
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const found = (["guest", "host", "recovery"] as const).find((value) =>
      fragment.has(value),
    );
    if (found) {
      setKind(found);
      setKey(fragment.get(found) || "");
      window.history.replaceState(null, "", window.location.pathname);
      setLoading(false);
    } else refresh().catch((cause) => setError(cause.message));
    // Each mounted experience belongs to one fixed route. No external mail or URL is executed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId, demo]);

  async function perform(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The action did not finish. Try again.",
      );
    } finally {
      setBusy("");
    }
  }
  async function openAlbum(event: FormEvent) {
    event.preventDefault();
    await perform("Opening album", async () => {
      const result = await request<{ recoveryCard?: unknown }>("access", {
        albumId,
        key,
        kind,
        name: kind === "guest" ? name : "Host",
        consent,
      });
      setKey("");
      if (result.recoveryCard) setRecoveryCard(result.recoveryCard);
      await refresh();
    });
  }
  async function settings(action: string, value?: boolean, memberId?: string) {
    if (!album || album.role !== "host") return;
    await perform("Saving album", async () => {
      if (demo) {
        if (action === "share") setAlbum({ ...album, shared: !!value });
        if (action === "uploads") setAlbum({ ...album, uploadsOpen: !!value });
        if (action === "block")
          setAlbum({
            ...album,
            members: album.members.map((member) =>
              member.id === memberId ? { ...member, blocked: true } : member,
            ),
          });
        if (action === "invite" || action === "block")
          setInvite(`${window.location.origin}/demo?view=guest`);
      } else {
        const result = await request<{ invite?: string }>("settings", {
          action,
          value,
          memberId,
        });
        if (result.invite) setInvite(result.invite);
        await refresh();
      }
      setNotice(
        action === "share"
          ? value
            ? "The album is now shared with participating guests."
            : "Guests now see only their own photos."
          : action === "uploads"
            ? value
              ? "Guests can add photos again."
              : "New guest entry and uploads are closed."
            : action === "block"
              ? "Guest access removed. Use the new invitation for future guests."
              : "Your guest link is ready. Previous guest links stop admitting new guests.",
      );
    });
  }
  async function upload(files: FileList | null) {
    if (!album || !files?.length) return;
    const file = files[0];
    await perform("Preparing photo", async () => {
      const photo = await preparePhoto(file);
      if (demo) {
        if (
          demoGuestBlocked ||
          !album.uploadsOpen ||
          album.photos.length >= 100 ||
          (album.role === "guest" &&
            album.photos.filter((photo) => photo.contributor === "Alex")
              .length >= 20)
        )
          throw new Error("Uploads are closed or the sample album is full.");
        const url = URL.createObjectURL(photo);
        localUrls.current.push(url);
        setAlbum({
          ...album,
          photos: [
            ...album.photos,
            {
              id: crypto.randomUUID(),
              caption: caption.trim() || "A candid moment",
              contributor: album.role === "host" ? "Host" : "Alex",
              createdAt: Date.now(),
              size: photo.size,
              canDelete: true,
              url,
            },
          ],
          photoCount: album.photoCount + 1,
        });
        setNotice(
          "Photo added to this sample tab only. Nothing was uploaded to a server.",
        );
      } else {
        setBusy("Adding photo");
        const response = await fetch("/api/upload", {
          method: "POST",
          body: photo,
          headers: {
            "content-type": "image/jpeg",
            "x-upload-id": crypto.randomUUID(),
            "x-photo-caption": encodeURIComponent(
              caption.trim() || "A candid moment",
            ),
          },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        await refresh();
        setNotice("Your photo was added.");
      }
      setCaption("");
    });
    if (input.current) input.current.value = "";
  }
  async function removePhoto(id: string) {
    if (!album) return;
    if (
      demo &&
      album.role !== "host" &&
      album.photos.find((photo) => photo.id === id)?.contributor !== "Alex"
    )
      return;
    await perform("Removing photo", async () => {
      if (demo)
        setAlbum({
          ...album,
          photos: album.photos.filter((photo) => photo.id !== id),
          photoCount: Math.max(0, album.photoCount - 1),
        });
      else {
        await request("delete", { photoId: id });
        await refresh();
      }
      setDeleteId(null);
      setSelected(null);
      setNotice("Photo removed from the album.");
    });
  }
  async function exportAlbum() {
    if (!album || album.role !== "host") return;
    await perform("Preparing download", async () => {
      const manifest: Manifest = demo
        ? {
            album: album.name,
            eventDate: album.eventDate,
            expiresAt: album.expiresAt,
            photos: album.photos.map((photo, i) => ({
              id: photo.id,
              filename: `candid-${String(i + 1).padStart(3, "0")}.jpg`,
              caption: photo.caption,
              contributor: photo.contributor,
              size: photo.size,
              url: photo.url,
            })),
          }
        : await request<Manifest>("export");
      await downloadArchive(manifest, (done, total) =>
        setBusy(`Preparing photo ${done} of ${total}`),
      );
      setNotice(
        "Your album ZIP is ready. Keep it somewhere safe before the album expires.",
      );
    });
  }
  async function downloadPhoto(photo: Photo) {
    await perform("Downloading photo", async () => {
      const response = await fetch(
        photo.url || `/api/photo/${photo.id}?download=1`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error(
          "Photo unavailable. Refresh the album and check your access.",
        );
      saveFile(await response.blob(), "candid.jpg");
    });
  }
  const demoGuestBlocked = !!(
    demo &&
    album?.role === "guest" &&
    album.members.some((member) => member.id === "alex" && member.blocked)
  );
  const visible = demoGuestBlocked
    ? []
    : album?.photos.filter(
        (photo) =>
          !demo ||
          album.role === "host" ||
          album.shared ||
          photo.contributor === "Alex",
      ) || [];
  const isHost = album?.role === "host";
  const date = album
    ? new Date(`${album.eventDate}T12:00:00Z`).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

  return (
    <>
      <header className="site-header">
        <Brand />
        <nav aria-label="Album navigation">
          <Link href="/">About Candids</Link>
          {demo ? (
            <a
              href="https://www.tinotech.co.za/events"
              className="button button-small"
            >
              Plan your event
            </a>
          ) : (
            album && (
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() =>
                  perform("Closing album", async () => {
                    await request("logout", {});
                    setAlbum(null);
                    setNotice("This browser is signed out of the album.");
                  })
                }
              >
                Sign out
              </button>
            )
          )}
        </nav>
      </header>
      {demo && (
        <div className="demo-banner">
          <div>
            <strong>Fictional sample album</strong>
            <span>Original illustrations. Your changes stay in this tab.</span>
          </div>
          <label>
            Try the view
            <select
              aria-label="Sample view"
              value={album?.role}
              onChange={(event) => {
                setAlbum((current) =>
                  current
                    ? {
                        ...current,
                        role: event.target.value as "host" | "guest",
                        guestName:
                          event.target.value === "guest" ? "Alex" : "Host",
                      }
                    : current,
                );
                setSelected(null);
                setNotice("");
                setError("");
              }}
            >
              <option value="host">Host</option>
              <option value="guest">Guest (Alex)</option>
            </select>
          </label>
        </div>
      )}
      <main className="album-page">
        {demoGuestBlocked && (
          <p className="message error" role="alert">
            This sample guest was blocked. Switch to Host or refresh to reset
            the demo.
          </p>
        )}
        {(error || notice || busy) && (
          <div
            className={`message ${error ? "error" : ""}`}
            role={error ? "alert" : "status"}
          >
            {error || busy || notice}
          </div>
        )}
        {loading ? (
          <div className="loading-panel" role="status">
            Opening your album…
          </div>
        ) : !album ? (
          <section className="access-panel">
            <span className="album-emblem" aria-hidden="true">
              ✳
            </span>
            <h1>
              A few good moments
              <br />
              are waiting here.
            </h1>
            <p>Open this private event with the key from your invitation.</p>
            <div className="access-tabs" role="group" aria-label="Access type">
              {(["guest", "host", "recovery"] as const).map((type) => (
                <button
                  key={type}
                  className={kind === type ? "selected" : ""}
                  onClick={() => {
                    setKind(type);
                    setKey("");
                  }}
                >
                  {type === "recovery"
                    ? "Recover host access"
                    : type === "host"
                      ? "Host"
                      : "Guest"}
                </button>
              ))}
            </div>
            <form onSubmit={openAlbum}>
              {kind === "guest" && (
                <>
                  <label htmlFor="guest-name">Your display name</label>
                  <input
                    id="guest-name"
                    value={name}
                    maxLength={40}
                    required
                    autoComplete="nickname"
                    onChange={(event) => setName(event.target.value)}
                  />
                </>
              )}
              <label htmlFor="access-key">
                {kind === "recovery" ? "Recovery key" : "Access key"}
              </label>
              <input
                id="access-key"
                type="password"
                autoComplete="off"
                value={key}
                required
                onChange={(event) => setKey(event.target.value.trim())}
              />
              {kind === "guest" && (
                <label className="consent">
                  <input
                    type="checkbox"
                    required
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    I have permission to share my photos with the host and, when
                    the album is shared, other event guests.{" "}
                    <Link href="/privacy">Privacy details</Link>.
                  </span>
                </label>
              )}
              {kind === "recovery" && (
                <p className="help">
                  Recovery replaces your previous host link and recovery key.
                  Save the new recovery card after opening the album.
                </p>
              )}
              <button className="button" disabled={!!busy}>
                {kind === "recovery" ? "Recover host access" : "Open album"}
              </button>
            </form>
            <p className="help">
              Missing your key? Ask your event host or{" "}
              <a href="mailto:info@tinotech.co.za">contact Tinotech</a>.
            </p>
          </section>
        ) : (
          <>
            <section className="album-heading">
              <div>
                <p className="album-date">
                  {date}
                  {demo ? " · Sample event" : ""}
                </p>
                <h1>{album.name}</h1>
                <p>
                  {isHost
                    ? "Your gathering, seen through everyone’s eyes."
                    : `Welcome, ${album.guestName}. Add the moments you noticed.`}
                </p>
              </div>
              <div className="album-state">
                <span
                  className={`status-dot ${album.shared ? "shared" : ""}`}
                />
                {album.shared ? "Shared with guests" : "Host review"}
                <small>
                  {visible.length} {demo ? "sample prints" : "photos"} visible
                  to you
                </small>
              </div>
            </section>
            {recoveryCard !== null && (
              <section className="recovery-notice">
                <h2>Keep your new recovery card.</h2>
                <p>
                  Your previous host and recovery keys no longer work. Store
                  this new card in a password manager; it gives control of the
                  album.
                </p>
                <button
                  className="button"
                  onClick={() =>
                    saveFile(
                      new Blob([JSON.stringify(recoveryCard, null, 2)], {
                        type: "application/json",
                      }),
                      "candids-private-recovery.json",
                    )
                  }
                >
                  Download private recovery card
                </button>
              </section>
            )}
            <div className="album-layout">
              <section className="gallery-section" aria-label="Album photos">
                <div className="gallery-toolbar">
                  <h2>
                    {isHost
                      ? "The collection"
                      : album.shared
                        ? "Our shared collection"
                        : "Your contributions"}
                  </h2>
                  {!demo && (
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() => perform("Refreshing album", refresh)}
                    >
                      Refresh
                    </button>
                  )}
                </div>
                {!isHost && !album.shared && (
                  <p className="gallery-note">
                    The host is reviewing the collection. For now, you can see
                    your own photos.
                  </p>
                )}
                {visible.length === 0 ? (
                  <div className="empty-gallery">
                    <span aria-hidden="true">✳</span>
                    <h3>The first moment is yours.</h3>
                    <p>Add a photo to start this collection.</p>
                  </div>
                ) : (
                  <div className="photo-grid">
                    {visible.map((photo, index) => (
                      <article className="photo-print" key={photo.id}>
                        <button
                          className="photo-open"
                          onClick={() => setSelected(photo)}
                          aria-label={`View ${photo.caption}`}
                        >
                          <img
                            src={photo.url || `/api/photo/${photo.id}`}
                            alt={photo.caption}
                            loading={index < 3 ? "eager" : "lazy"}
                          />
                        </button>
                        <div className="print-caption">
                          <p>{photo.caption}</p>
                          <small>
                            {photo.contributor}
                            {demo ? " · Sample" : ""}
                          </small>
                          {(isHost ||
                            (demo
                              ? photo.contributor === "Alex"
                              : photo.canDelete)) && (
                            <button
                              className="remove-photo"
                              aria-label={`Remove ${photo.caption}`}
                              disabled={!!busy}
                              onClick={() => setDeleteId(photo.id)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        {deleteId === photo.id && (
                          <div className="delete-confirm">
                            <p>
                              Remove this photo from the album? Downloaded
                              copies remain with their owners.
                            </p>
                            <button
                              className="danger-button"
                              disabled={!!busy}
                              onClick={() => removePhoto(photo.id)}
                            >
                              Remove photo
                            </button>
                            <button
                              className="text-button"
                              onClick={() => setDeleteId(null)}
                            >
                              Keep photo
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                <p className="gallery-footnote">
                  {demo
                    ? "These original illustrations and names are fictional. No customer event is shown."
                    : "Share only photos you have permission to share. The host may remove photos from this album."}
                </p>
              </section>
              <aside className="album-sidebar">
                <section className="upload-panel">
                  <h2>Add your perspective.</h2>
                  <p>
                    {album.uploadsOpen && !demoGuestBlocked
                      ? demo
                        ? "Try a photo from your device. It stays in this tab."
                        : `Up to ${isHost ? album.limits.photos : album.limits.guestPhotos} photos ${isHost ? "in this album" : "per guest device"}. We prepare them for the album and remove embedded location data.`
                      : "The host has closed uploads. You can still view the photos available to you."}
                  </p>
                  <label htmlFor="photo-caption">A short caption</label>
                  <input
                    id="photo-caption"
                    value={caption}
                    maxLength={80}
                    placeholder="A candid moment"
                    disabled={!!busy || !album.uploadsOpen || demoGuestBlocked}
                    onChange={(event) => setCaption(event.target.value)}
                  />
                  <input
                    ref={input}
                    className="file-input"
                    id="photo-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={!!busy || !album.uploadsOpen || demoGuestBlocked}
                    onChange={(event) => upload(event.target.files)}
                  />
                  <button
                    className="button upload-button"
                    disabled={!!busy || !album.uploadsOpen || demoGuestBlocked}
                    onClick={() => input.current?.click()}
                  >
                    <span aria-hidden="true">＋</span> Choose a photo
                  </button>
                  <small>
                    JPEG, PNG or WebP, up to 10 MB. One photo at a time.
                  </small>
                </section>
                {isHost && (
                  <section className="host-panel">
                    <div className="panel-heading">
                      <h2>Your host controls</h2>
                      <span>Host only</span>
                    </div>
                    <div className="setting-row">
                      <div>
                        <strong>Share the collection</strong>
                        <p>
                          Let admitted guests see and download everyone’s
                          photos.
                        </p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={album.shared}
                        aria-label="Share collection with guests"
                        className="toggle"
                        disabled={!!busy}
                        onClick={() => settings("share", !album.shared)}
                      >
                        <span />
                      </button>
                    </div>
                    <div className="setting-row">
                      <div>
                        <strong>Accept photos</strong>
                        <p>Allow uploads and new guests to join.</p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={album.uploadsOpen}
                        aria-label="Accept photos and new guests"
                        className="toggle"
                        disabled={!!busy}
                        onClick={() => settings("uploads", !album.uploadsOpen)}
                      >
                        <span />
                      </button>
                    </div>
                    <button
                      className="outline-button"
                      disabled={!!busy}
                      onClick={() => settings("invite")}
                    >
                      Create a fresh guest link
                    </button>
                    <p className="help">
                      A fresh link replaces the previous invitation. Existing
                      guests keep access.
                    </p>
                    {invite && (
                      <div className="invite-box">
                        <label htmlFor="guest-invite">
                          {demo
                            ? "Sample guest link"
                            : "Private guest invitation"}
                        </label>
                        <textarea
                          id="guest-invite"
                          readOnly
                          value={invite}
                          rows={3}
                        />
                        <button
                          className="text-button"
                          onClick={() =>
                            perform("Copying link", async () => {
                              await navigator.clipboard.writeText(invite);
                              setNotice(
                                "Guest link copied. Share it only with your event guests.",
                              );
                            })
                          }
                        >
                          Copy guest link
                        </button>
                      </div>
                    )}
                    <details>
                      <summary>Guest devices ({album.members.length})</summary>
                      {album.members.map((member) => (
                        <div className="member-row" key={member.id}>
                          <span>{member.name}</span>
                          <button
                            className="text-button"
                            disabled={member.blocked || !!busy}
                            onClick={() =>
                              settings("block", undefined, member.id)
                            }
                          >
                            {member.blocked
                              ? "Blocked"
                              : "Block & rotate invite"}
                          </button>
                        </div>
                      ))}
                    </details>
                    <div className="download-section">
                      <h3>Keep the whole album.</h3>
                      <p>
                        Download a ZIP of the images with a caption list. A
                        desktop browser works best for a full album.
                      </p>
                      <button
                        className="button"
                        disabled={!!busy || album.photos.length === 0}
                        onClick={exportAlbum}
                      >
                        Download album ZIP
                      </button>
                    </div>
                  </section>
                )}
                <section className="retention-note">
                  <h3>
                    {demo ? "A sample to explore" : "Keep it before it expires"}
                  </h3>
                  <p>
                    {demo
                      ? "Refresh the page to reset the demo. Nothing here creates a paid event or uploads your files."
                      : `Album access ends ${new Date(album.expiresAt).toLocaleString("en-ZA", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short", timeZone: "UTC" })}. Download your photos before then. Scheduled deletion follows expiry.`}
                  </p>
                  <Link href="/privacy">Privacy & retention</Link>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
      {selected && (
        <PhotoDialog
          photo={selected}
          close={() => setSelected(null)}
          download={() => downloadPhoto(selected)}
        />
      )}
      <Footer />
    </>
  );
}
