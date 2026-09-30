import { useState } from "react";
import { getDiscogsToken, setDiscogsToken, getWorkerBaseUrl, setWorkerBaseUrl } from "../lib/settings";

export function Settings() {
  const [token, setToken] = useState(getDiscogsToken());
  const [workerUrl, setWorkerUrl] = useState(getWorkerBaseUrl());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setDiscogsToken(token.trim());
    setWorkerBaseUrl(workerUrl.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-form">
      <label>
        Discogs personal access token
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your token from discogs.com/settings/developers"
        />
      </label>
      <p className="hint">Stored only in this browser's local storage — never written to collection.json.</p>

      <label>
        Discogs proxy Worker URL
        <input
          type="text"
          value={workerUrl}
          onChange={(e) => setWorkerUrl(e.target.value)}
          placeholder="https://record-labeller-discogs-proxy.<you>.workers.dev"
        />
      </label>
      <p className="hint">
        Required for in-app Discogs lookups (Add by ID/URL, barcode scan) — browsers can't set the
        User-Agent header Discogs asks for, so requests go through your deployed Worker instead of
        api.discogs.com directly. See worker/ for deploy instructions.
      </p>

      <button type="button" onClick={handleSave}>
        Save
      </button>
      {saved && <span className="hint"> Saved.</span>}
    </div>
  );
}
