import React, { useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { DOC_TYPES, PROVENANCES } from '../../lib/constants';
import { useWellOptions } from '../../lib/hooks/documents';
import { validateFile } from './validate';

const DOC_TYPE_LABELS = {
  wcr: 'WCR (Well completion report)',
  ddr: 'DDR (Daily drilling report)',
  mud_log: 'Mud log',
  program: 'Drilling / casing program',
  cement_report: 'Cement report',
  incident: 'Incident / NPT report',
  survey: 'Survey',
  las: 'LAS log',
  witsml: 'WITSML',
  other: 'Other',
};
const PROVENANCE_LABELS = { direct: 'Direct (operator data)', analog: 'Analog', synthetic: 'Synthetic' };

const selectClass =
  'w-full border border-gray-300 p-2.5 rounded-lg bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function UploadDropzone({ onFilesAdded }) {
  const [wellboreId, setWellboreId] = useState('');
  const [docType, setDocType] = useState('');
  const [provenance, setProvenance] = useState('direct');
  const [dragActive, setDragActive] = useState(false);
  const [rejections, setRejections] = useState([]);
  const fileInputRef = useRef(null);

  const { data: wells } = useWellOptions();

  const processFiles = (files) => {
    const accepted = [];
    const rejected = [];
    const well = wells?.find((w) => w.wellbore_id === wellboreId);
    for (const f of files) {
      const check = validateFile(f);
      if (!check.ok) {
        rejected.push({ name: f.name, message: check.message });
        continue;
      }
      accepted.push({
        file: f,
        wellId: well?.well_id ?? null,
        wellboreId: wellboreId || null,
        docType: docType || null,
        provenance,
        status: 'pending',
        progress: 0,
      });
    }
    setRejections(rejected);
    if (accepted.length > 0) onFilesAdded(accepted);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer?.files?.length > 0) processFiles(Array.from(e.dataTransfer.files));
  };

  const openPicker = () => fileInputRef.current?.click();

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-8">
      <h2 className="text-xl font-bold mb-6 text-gray-800">Upload new documents</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div>
          <label htmlFor="up-well" className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            Target well (optional)
          </label>
          <select id="up-well" className={selectClass} value={wellboreId} onChange={(e) => setWellboreId(e.target.value)}>
            <option value="">Detect automatically</option>
            {wells?.map((w) => (
              <option key={w.wellbore_id} value={w.wellbore_id}>
                {w.well_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="up-type" className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            Document type
          </label>
          <select id="up-type" className={selectClass} value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">Detect automatically</option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t] || t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="up-prov" className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            Provenance
          </label>
          <select id="up-prov" className={selectClass} value={provenance} onChange={(e) => setProvenance(e.target.value)}>
            {PROVENANCES.map((p) => (
              <option key={p} value={p}>
                {PROVENANCE_LABELS[p] || p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents: click, press Enter, or drop files here"
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50/50 hover:border-blue-400 hover:bg-gray-50'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={handleDrop}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
      >
        <input
          type="file"
          multiple
          className="hidden"
          ref={fileInputRef}
          aria-label="Choose files"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.target.files?.length) processFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        <UploadCloud className="mx-auto mb-4 h-12 w-12 text-gray-600" aria-hidden="true" />
        <p className="font-bold text-gray-800 text-lg">Click to browse or drag and drop files here</p>
        <p className="text-sm text-gray-500 mt-2 font-medium uppercase tracking-wider">PDF, PNG, JPG, TIFF, CSV, XLSX, XML, LAS/TXT</p>
        <p className="text-xs text-gray-500 mt-1">Maximum size: 25 MB per file</p>
      </div>

      {rejections.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold">
              {rejections.length === 1 ? '1 file was not added' : `${rejections.length} files were not added`}
            </p>
            <button
              type="button"
              aria-label="Dismiss upload errors"
              className="rounded p-0.5 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              onClick={() => setRejections([])}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <ul className="mt-1 list-disc pl-5">
            {rejections.map((r, i) => (
              <li key={`${r.name}-${i}`}>{r.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
