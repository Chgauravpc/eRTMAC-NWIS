import React, { useState } from 'react';
import { UploadDropzone } from './UploadDropzone';
import { DocumentList } from './DocumentList';
import { getUploadUrl, uploadToStorage, submitDocumentRecord } from '../../lib/data/documents';
import { JobProgress } from './JobProgress';
import { Button } from '../../components/ui/Primitives';

export function DocumentsPage() {
  const [uploads, setUploads] = useState([]);

  const handleFilesAdded = (newFiles) => {
    const entries = newFiles.map(f => ({
      ...f,
      id: Math.random().toString(36).substring(7),
    }));
    setUploads(prev => [...entries, ...prev]);

    // Fire uploads
    entries.forEach(startUpload);
  };

  const startUpload = async (entry) => {
    updateUpload(entry.id, { status: 'uploading', progress: 10, errorMsg: null });
    try {
      // 1. Get Signed URL
      const { upload_id, storage_path, signed_url, token } = await getUploadUrl(entry.file);
      updateUpload(entry.id, { progress: 30 });
      
      // 2. Upload Bytes (Fake 40% progress bridge since signed url upload progress isn't directly exposed in JS simply here)
      await uploadToStorage(storage_path, token, entry.file, (pct) => {
        updateUpload(entry.id, { progress: 30 + (pct * 0.4) });
      });
      updateUpload(entry.id, { progress: 70 });
      
      // 3. Register with backend inference pipeline
      const res = await submitDocumentRecord({
        storage_path,
        filename: entry.file.name,
        well_id: null,
        wellbore_id: entry.wellboreId,
        doc_type: entry.docType,
        provenance: entry.provenance
      });
      
      if (res.duplicate) {
        updateUpload(entry.id, { 
          status: 'duplicate', 
          docId: res.document_id,
          progress: 100
        });
      } else {
        updateUpload(entry.id, {
          status: 'processing',
          jobId: res.job_id,
          docId: res.document_id,
          progress: 100
        });
      }
    } catch (err) {
      updateUpload(entry.id, { status: 'error', errorMsg: err.message });
    }
  };

  const updateUpload = (id, changes) => {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...changes } : u));
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto h-full overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Documents Pipeline</h1>
        <p className="text-gray-500 mt-2">Upload unstructured reports to extract events and predict risks.</p>
      </div>
      
      <UploadDropzone onFilesAdded={handleFilesAdded} />
      
      {uploads.length > 0 && (
        <div className="bg-white p-6 rounded-xl border border-blue-200 shadow-md mb-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 bg-blue-500 h-full"></div>
          <h2 className="text-lg font-black mb-4 text-gray-800 uppercase tracking-wider">Active Ingestion Pipeline</h2>
          
          <div className="space-y-4">
            {uploads.map(u => (
              <div key={u.id} className="border border-gray-200 p-4 rounded-lg bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between shadow-sm">
                <div className="flex-1 mr-4">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xl">📄</span>
                    <span className="font-bold text-gray-800 truncate">{u.file.name}</span>
                  </div>
                  <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-3 ml-8">
                    Size: {(u.file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                  
                  <div className="ml-8">
                    {u.status === 'uploading' && (
                      <div className="w-full">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-blue-500 mb-1">
                          <span>Uploading...</span>
                          <span>{Math.round(u.progress)}%</span>
                        </div>
                        <div className="w-full bg-blue-100 rounded-full h-1.5">
                          <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${u.progress}%` }}></div>
                        </div>
                      </div>
                    )}
                    
                    {u.status === 'processing' && (
                      <JobProgress jobId={u.jobId} docId={u.docId} />
                    )}
                    
                    {u.status === 'duplicate' && (
                      <div className="text-sm bg-blue-50 text-blue-700 font-bold p-3 rounded border border-blue-100 flex items-center justify-between">
                        <span>ℹ️ Hash match: File already exists in the library.</span>
                        <a href={`/search?doc=${u.docId}`} className="uppercase tracking-wider text-xs border border-blue-300 px-3 py-1 rounded bg-white hover:bg-blue-100 transition-colors">View Existing</a>
                      </div>
                    )}
                    
                    {u.status === 'error' && (
                      <div className="text-sm text-red-600 font-bold bg-red-50 p-3 rounded border border-red-100">
                        ❌ Error: {u.errorMsg}
                      </div>
                    )}
                  </div>
                </div>
                
                {u.status === 'error' && (
                  <Button variant="outline" className="mt-4 md:mt-0 shadow-sm border-gray-300" onClick={() => startUpload(u)}>Retry Upload</Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <DocumentList />
    </div>
  );
}
