import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.csv', '.xlsx', '.xml', '.las', '.txt'];

export function UploadDropzone({ onFilesAdded }) {
  const [wellboreId, setWellboreId] = useState('');
  const [docType, setDocType] = useState('');
  const [provenance, setProvenance] = useState('direct');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const { data: wells } = useQuery({
    queryKey: ['v_well_summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_well_summary').select('wellbore_id, well_name');
      if (error) throw error;
      return data || [];
    }
  });

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const processFiles = (files) => {
    const validFiles = [];
    for (const f of files) {
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        window.alert(`File ${f.name} has unsupported type. Allowed: ${ALLOWED_EXTS.join(', ')}`);
        continue;
      }
      if (f.size > MAX_SIZE) {
        window.alert(`File ${f.name} is too large. Max size is 25 MB.`);
        continue;
      }
      validFiles.push({
        file: f,
        wellboreId: wellboreId || null,
        docType: docType || null,
        provenance,
        status: 'pending',
        progress: 0
      });
    }
    if (validFiles.length > 0) {
      onFilesAdded(validFiles);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-8">
      <h2 className="text-xl font-bold mb-6 text-gray-800">Upload New Documents</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Target Well (Optional)</label>
          <select className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 bg-gray-50" value={wellboreId} onChange={e => setWellboreId(e.target.value)}>
            <option value="">-- Detect Automatically --</option>
            {wells?.map(w => (
              <option key={w.wellbore_id} value={w.wellbore_id}>{w.well_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Document Type</label>
          <select className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 bg-gray-50" value={docType} onChange={e => setDocType(e.target.value)}>
            <option value="">-- Detect Automatically --</option>
            <option value="DDR">DDR (Daily Drilling Report)</option>
            <option value="WCR">WCR (Well Completion Report)</option>
            <option value="mud_log">Mud Log</option>
            <option value="wireline">Wireline Log</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Provenance</label>
          <select className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 bg-gray-50" value={provenance} onChange={e => setProvenance(e.target.value)}>
            <option value="direct">Direct Upload</option>
            <option value="legacy_migration">Legacy Migration</option>
          </select>
        </div>
      </div>

      <div 
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${dragActive ? 'border-blue-500 bg-blue-50 scale-[0.99]' : 'border-gray-300 bg-gray-50/50 hover:border-blue-400 hover:bg-gray-50'}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          multiple 
          className="hidden" 
          ref={fileInputRef} 
          onChange={(e) => e.target.files && processFiles(Array.from(e.target.files))} 
        />
        <div className="text-5xl mb-4 opacity-80">📄</div>
        <p className="font-bold text-gray-800 text-lg">Click to browse or drag & drop files here</p>
        <p className="text-sm text-gray-500 mt-2 font-medium uppercase tracking-wider">PDF, PNG, JPG, TIFF, CSV, XLSX, XML, LAS/TXT</p>
        <p className="text-xs text-gray-400 mt-1">Maximum size: 25 MB per file</p>
      </div>
    </div>
  );
}
