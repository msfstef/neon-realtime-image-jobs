import { type DragEvent, useRef, useState } from "react";

import { api } from "./api";

interface UploaderProps {
  onUploaded: (id: string, txid: string, preview: string) => Promise<void>;
}

export function Uploader({ onUploaded }: UploaderProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string>();

  async function upload(files: FileList | File[]) {
    setError(undefined);
    await Promise.all(
      [...files].map(async (file) => {
        setUploading((count) => count + 1);
        try {
          const { id, txid } = await api.upload(file);
          await onUploaded(id, txid, URL.createObjectURL(file));
        } catch (cause) {
          setError(`${file.name}: ${cause instanceof Error ? cause.message : "upload failed"}`);
        } finally {
          setUploading((count) => count - 1);
        }
      }),
    );
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files);
  }

  return (
    <section
      className={`dropzone${dragging ? " dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <p>
        <strong>Drop images here</strong> or{" "}
        <button className="link" onClick={() => input.current?.click()} type="button">
          choose files
        </button>
      </p>
      <p className="muted small">JPEG, PNG, WebP, GIF, AVIF, or TIFF up to 15 MB</p>
      {uploading > 0 && <p className="small">Uploading {uploading}…</p>}
      {error && <p className="error">{error}</p>}
      <input
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/tiff"
        hidden
        multiple
        onChange={(event) => {
          if (event.target.files) void upload(event.target.files);
          event.target.value = "";
        }}
        ref={input}
        type="file"
        data-testid="file-input"
      />
    </section>
  );
}
