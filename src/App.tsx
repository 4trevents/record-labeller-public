import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { CollectionBrowser } from "./screens/CollectionBrowser";
import { AddRecord } from "./screens/AddRecord";
import { Review } from "./screens/Review";
import { Settings } from "./screens/Settings";
import { loadCollectionIntoDb, exportCollectionFromDb } from "./db/dexie";
import { setActiveFolder, persistCollection } from "./lib/persist";
import {
  isFileSystemAccessSupported,
  getStoredDataFolder,
  chooseDataFolder,
  readCollectionFromFolder,
  downloadCollectionAsFile,
  readCollectionFromUpload,
} from "./lib/collectionSync";

type Tab = "collection" | "add" | "review" | "settings";

function App() {
  const [dataFolder, setDataFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [tab, setTab] = useState<Tab>("collection");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fsaSupported = isFileSystemAccessSupported();

  useEffect(() => {
    (async () => {
      const dir = await getStoredDataFolder();
      if (dir) {
        setDataFolder(dir);
        setActiveFolder(dir);
        const collection = await readCollectionFromFolder(dir);
        if (collection) {
          await loadCollectionIntoDb(collection);
          setStatus(`Loaded ${collection.records.length} records from ${dir.name}/collection.json`);
        } else {
          setStatus(`Connected to ${dir.name}, but no collection.json there yet.`);
        }
      } else {
        setStatus("No data folder connected. Connect one, or import a collection.json manually.");
      }
    })();
  }, []);

  const handleConnect = useCallback(async () => {
    const dir = await chooseDataFolder();
    setDataFolder(dir);
    setActiveFolder(dir);
    const collection = await readCollectionFromFolder(dir);
    if (collection) {
      await loadCollectionIntoDb(collection);
      setStatus(`Loaded ${collection.records.length} records from ${dir.name}/collection.json`);
    } else {
      setStatus(`Connected to ${dir.name}. No collection.json there yet — run an import script first.`);
    }
  }, []);

  const handleSync = useCallback(async () => {
    if (!dataFolder) return;
    await persistCollection();
    const count = await exportCollectionFromDb().then((c) => c.records.length);
    setStatus(`Wrote ${count} records to ${dataFolder.name}/collection.json`);
  }, [dataFolder]);

  const handleExportFallback = useCallback(async () => {
    const collection = await exportCollectionFromDb();
    downloadCollectionAsFile(collection);
  }, []);

  const handleImportFallback = useCallback(async (file: File) => {
    const collection = await readCollectionFromUpload(file);
    await loadCollectionIntoDb(collection);
    setStatus(`Loaded ${collection.records.length} records from ${file.name}`);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Record Labeller</h1>
        <div className="data-source">
          {fsaSupported ? (
            <>
              <button type="button" onClick={handleConnect}>
                {dataFolder ? `Connected: ${dataFolder.name}` : "Connect data folder"}
              </button>
              <button type="button" onClick={handleSync} disabled={!dataFolder}>
                Save to collection.json
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                Import collection.json
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFallback(file);
                }}
              />
              <button type="button" onClick={handleExportFallback}>
                Export collection.json
              </button>
            </>
          )}
        </div>
      </header>
      <p className="status-line">{status}</p>

      <nav className="tabs">
        {(["collection", "add", "review", "settings"] as Tab[]).map((t) => (
          <button key={t} type="button" className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
            {t === "collection" ? "Collection" : t === "add" ? "Add" : t === "review" ? "Review" : "Settings"}
          </button>
        ))}
      </nav>

      <main>
        {tab === "collection" && <CollectionBrowser />}
        {tab === "add" && <AddRecord />}
        {tab === "review" && <Review />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}

export default App;
