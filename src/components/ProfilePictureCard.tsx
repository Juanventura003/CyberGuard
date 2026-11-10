import { useRef, useState, type ChangeEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useProfile } from "../context/ProfileContext";
import { supabase } from "../lib/supabase";
import "./ProfilePictureCard.css";

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const ALL_EXTENSIONS = ["png", "jpg", "webp"];

interface PictureMessage {
  type: "success" | "error";
  text: string;
}

export default function ProfilePictureCard() {
  const { user } = useAuth();
  const { profile, displayName, setProfile } = useProfile();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<PictureMessage | null>(null);

  const avatarUrl = profile?.avatar_url ?? null;
  const initial = (displayName.trim().charAt(0) || "?").toUpperCase();

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;
    setMessage(null);

    const client = supabase;
    if (!client) {
      setMessage({ type: "error", text: "Supabase is not configured, so this action is unavailable." });
      return;
    }

    const extension = EXTENSIONS[file.type];
    if (!extension) {
      setMessage({ type: "error", text: "Choose a PNG, JPEG or WebP image." });
      return;
    }

    if (file.size > MAX_BYTES) {
      setMessage({ type: "error", text: "That image is larger than 2 MB. Choose a smaller one." });
      return;
    }

    setBusy(true);
    const path = `${user.id}/avatar.${extension}`;

    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      setBusy(false);
      setMessage({ type: "error", text: `Could not upload the picture: ${uploadError.message}` });
      return;
    }

    const { data: urlData } = client.storage.from(BUCKET).getPublicUrl(path);
    const url = `${urlData.publicUrl}?v=${Date.now()}`;

    const { data, error: saveError } = await client
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", user.id)
      .select("id");

    if (saveError || !data || data.length === 0) {
      setBusy(false);
      setMessage({
        type: "error",
        text: saveError
          ? saveError.message
          : "No profile was found for your account, so the picture was not saved.",
      });
      return;
    }

    const otherPaths = ALL_EXTENSIONS.filter((ext) => ext !== extension).map(
      (ext) => `${user.id}/avatar.${ext}`
    );
    await client.storage.from(BUCKET).remove(otherPaths);

    setProfile({ avatar_url: url });
    setBusy(false);
    setMessage({ type: "success", text: "Your profile picture was updated." });
  };

  const handleRemove = async () => {
    if (!user) return;
    setMessage(null);

    const client = supabase;
    if (!client) {
      setMessage({ type: "error", text: "Supabase is not configured, so this action is unavailable." });
      return;
    }

    setBusy(true);

    await client.storage.from(BUCKET).remove(ALL_EXTENSIONS.map((ext) => `${user.id}/avatar.${ext}`));

    const { error } = await client.from("profiles").update({ avatar_url: null }).eq("id", user.id);

    setBusy(false);

    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }

    setProfile({ avatar_url: null });
    setMessage({ type: "success", text: "Your profile picture was removed." });
  };

  return (
    <div className="avatar-row">
      <div className="avatar-preview">
        {avatarUrl ? <img src={avatarUrl} alt="Your profile picture" /> : <span>{initial}</span>}
      </div>

      <div className="avatar-actions">
        {message && (
          <p className={`settings-message ${message.type}`} role={message.type === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        )}

        <div className="avatar-buttons">
          <button
            className="settings-button"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            {busy ? "Working..." : avatarUrl ? "Change picture" : "Add a profile picture"}
          </button>

          {avatarUrl && (
            <button className="settings-button secondary" type="button" onClick={handleRemove} disabled={busy}>
              Remove picture
            </button>
          )}
        </div>

        <input
          ref={fileInput}
          className="avatar-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFile}
        />
      </div>
    </div>
  );
}