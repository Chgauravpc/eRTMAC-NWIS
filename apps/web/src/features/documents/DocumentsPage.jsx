import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Info, RotateCcw, XCircle } from 'lucide-react';
import { UploadDropzone } from './UploadDropzone';
import { DocumentList } from './DocumentList';
import { JobProgress } from './JobProgress';
import { registerDocument, runUpload } from './uploadFlow';

let nextId = 0;
const newId = () => `upload-${Date.now()}-${nextId++}`;

function UploadRow({ entry, onRetryUpload, onRetryRegister }) {
  const sizeMb = (entry.file.size / 1024 / 1024).toFixed(2);
  return (
    <li className="flex flex-col justify-between rounded-lg border border-gray-200 bg-gray-50/50 p-4 shadow-sm md:flex-row md:items-center">
      <div className="mr-4 flex-1">
        <div className="mb-1 flex items-center gap-3">
          <FileText className="h-5 w-5 text-gray-500" aria-hidden="true" />
          <span className="truncate font-bold text-gray-800">{entry.file.name}</span>
        </div>
        <div className="mb-3 ml-8 text-xs font-medium uppercase tracking-wider text-gray-500">Size: {sizeMb} MB</div>

        <div className="ml-8">
          {entry.status === 'uploading' && (
            <div className="w-full">
              <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wider text-blue-600">
                <span>Uploading</span>
                <span>{Math.round(entry.progress)}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={`Uploading ${entry.file.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(entry.progress)}
                className="h-1.5 w-full rounded-full bg-blue-100"
              >
                <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${entry.progress}%` }} />
              </div>
            </div>
          )}

          {entry.status === 'registering' && <div className="text-sm font-bold text-blue-600">Registering document…</div>}

          {entry.status === 'processing' && (
            <JobProgress jobId={entry.jobId} docId={entry.docId} onRetry={() => onRetryRegister(entry.id)} />
          )}

          {entry.status === 'duplicate' && (
            <div className="flex items-center justify-between rounded border border-blue-100 bg-blue-50 p-3 text-sm font-bold text-blue-700">
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4" aria-hidden="true" />
                Already in the library
              </span>
              <Link
                to={`/search?doc=${entry.docId}`}
                className="rounded border border-blue-300 bg-white px-3 py-1 text-xs uppercase tracking-wider hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                View existing
              </Link>
            </div>
          )}

          {entry.status === 'error' && (
            <div role="alert" className="flex items-start gap-2 rounded border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Error: {entry.errorMsg}</span>
            </div>
          )}
        </div>
      </div>

      {entry.status === 'error' && (
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1 rounded border border-gray-300 px-4 py-2 font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:mt-0"
          onClick={() => (entry.uploaded ? onRetryRegister(entry.id) : onRetryUpload(entry.id))}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {entry.uploaded ? 'Retry processing' : 'Retry Upload'}
        </button>
      )}
    </li>
  );
}

export function DocumentsPage() {
  const [uploads, setUploads] = useState([]);
  const uploadsRef = useRef(uploads);
  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  const updateUpload = useCallback((id, changes) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  }, []);

  const start = useCallback(
    (entry) => runUpload(entry, (changes) => updateUpload(entry.id, changes)),
    [updateUpload]
  );

  const handleFilesAdded = (newFiles) => {
    const entries = newFiles.map((f) => ({ ...f, id: newId() }));
    setUploads((prev) => [...entries, ...prev]);
    entries.forEach(start);
  };

  const latest = (id) => uploadsRef.current.find((u) => u.id === id);
  // Retry after a failure before the bytes were stored: run the whole flow again.
  const retryUpload = (id) => {
    const entry = latest(id);
    if (entry) start(entry);
  };
  // Retry when the file is already in storage (or the job failed): re-POST /api/documents only.
  const retryRegister = (id) => {
    const entry = latest(id);
    if (entry) registerDocument(entry, (changes) => updateUpload(id, changes));
  };

  return (
    <div className="mx-auto h-full max-w-7xl overflow-y-auto p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Documents</h1>
        <p className="mt-2 text-gray-600">Upload reports to extract events and feed the risk models.</p>
      </div>

      <UploadDropzone onFilesAdded={handleFilesAdded} />

      {uploads.length > 0 && (
        <section aria-label="Active uploads" className="relative mb-8 overflow-hidden rounded-xl border border-blue-200 bg-white p-6 shadow-md">
          <div className="absolute left-0 top-0 h-full w-1 bg-blue-500" />
          <h2 className="mb-4 text-lg font-black uppercase tracking-wider text-gray-800">Active ingestion</h2>
          <ul className="space-y-4">
            {uploads.map((u) => (
              <UploadRow key={u.id} entry={u} onRetryUpload={retryUpload} onRetryRegister={retryRegister} />
            ))}
          </ul>
        </section>
      )}

      <DocumentList />
    </div>
  );
}
