import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PageViewer } from './PageViewer';
import { FieldList } from './FieldList';
import { reviewField, getPageImageUrl } from '../../lib/data/review';
import { useProfile } from '../auth/useProfile';

export function ReviewDoc() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const isReadOnly = profile?.role === 'office_engineer';
  
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [imageUrl, setImageUrl] = useState(null);
  const [completed, setCompleted] = useState(false);

  const { data: fields, refetch, isLoading } = useQuery({
    queryKey: ['review_fields', docId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_review_queue')
        .select('*')
        .eq('document_id', docId)
        .order('page');
      if (error) throw error;
      return data || [];
    }
  });

  useEffect(() => {
    if (fields?.length > 0 && !selectedFieldId && !completed) {
      const pending = fields.find(f => f.review_status === 'pending');
      if (pending) {
        setSelectedFieldId(pending.id);
        setCurrentPage(pending.page || 1);
      } else {
        setCompleted(true);
      }
    } else if (fields && fields.length === 0 && !isLoading) {
      setCompleted(true);
    }
  }, [fields, selectedFieldId, isLoading, completed]);

  useEffect(() => {
    if (completed) {
      setTimeout(() => {
        alert("Document fully reviewed!");
        navigate('/review');
      }, 500);
    }
  }, [completed, navigate]);

  useEffect(() => {
    getPageImageUrl(docId, currentPage).then(setImageUrl);
  }, [docId, currentPage]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isReadOnly || !selectedFieldId || completed) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      const currentIdx = fields?.findIndex(f => f.id === selectedFieldId);
      if (currentIdx === -1 || currentIdx == null) return;
      
      switch(e.key) {
        case 'j':
          if (currentIdx < fields.length - 1) {
            setSelectedFieldId(fields[currentIdx + 1].id);
            setCurrentPage(fields[currentIdx + 1].page || currentPage);
          }
          break;
        case 'k':
          if (currentIdx > 0) {
            setSelectedFieldId(fields[currentIdx - 1].id);
            setCurrentPage(fields[currentIdx - 1].page || currentPage);
          }
          break;
        case 'a':
          handleAction('approve');
          break;
        case 'r':
          handleAction('reject');
          break;
        case 'e':
          // Can't easily trigger edit from global listener without dispatching to component,
          // but we provide the physical button for Edit for now, or use a context.
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fields, selectedFieldId, isReadOnly, completed, currentPage]);

  const handleAction = async (action, value = null) => {
    if (isReadOnly) return;
    try {
      await reviewField(selectedFieldId, action, value);
      refetch();
      
      const currentIdx = fields?.findIndex(f => f.id === selectedFieldId);
      if (fields && currentIdx < fields.length - 1) {
        setSelectedFieldId(fields[currentIdx + 1].id);
        setCurrentPage(fields[currentIdx + 1].page || currentPage);
      } else {
        setSelectedFieldId(null);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to review: " + e.message);
    }
  };

  const selectedField = fields?.find(f => f.id === selectedFieldId);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <div className="w-1/2 h-full flex flex-col border-r border-gray-700 bg-[#1e1e1e]">
        <div className="p-3 flex justify-between items-center bg-[#2d2d2d] text-white border-b border-gray-700 shadow-sm z-10">
          <div className="flex gap-2 items-center">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors">Prev</button>
            <span className="font-black px-3 font-mono">PAGE {currentPage}</span>
            <button onClick={() => setCurrentPage(p => p + 1)} className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors">Next</button>
          </div>
          <span className="text-gray-400 font-mono text-xs uppercase tracking-wider">{imageUrl ? 'IMAGE READY' : 'NO IMAGE'}</span>
        </div>
        <div className="flex-1 relative overflow-auto p-6 flex justify-center items-start">
          <PageViewer imageUrl={imageUrl} selectedField={selectedField} />
        </div>
      </div>
      
      <div className="w-1/2 h-full flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200 bg-white flex justify-between items-center shadow-sm z-10">
          <h2 className="text-xl font-black text-gray-900 tracking-tight uppercase">Review Fields</h2>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-100 px-3 py-1 rounded">
            Shortcuts: [J/K] Nav, [A] Approve, [R] Reject
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {fields?.map((f) => (
            <FieldList 
              key={f.id} 
              field={f} 
              isSelected={f.id === selectedFieldId}
              onSelect={() => {
                setSelectedFieldId(f.id);
                setCurrentPage(f.page || currentPage);
              }}
              onAction={(action, val) => {
                setSelectedFieldId(f.id);
                handleAction(action, val);
              }}
              isReadOnly={isReadOnly}
            />
          ))}
          {fields?.length === 0 && <div className="text-center p-10 font-bold text-gray-400 text-lg">No pending fields.</div>}
        </div>
      </div>
    </div>
  );
}
