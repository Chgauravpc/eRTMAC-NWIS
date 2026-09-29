import React, { useState } from 'react';
import { FieldEditor } from './FieldEditor';

const REASON_MAP = {
  low_ocr_confidence: "Scan was hard to read",
  unknown_formation: "Formation name not recognised",
  snippet_not_found: "Couldn't find this text on the page",
  'failed_rule:depth_gt_td': "Depth is deeper than the well's TD",
  'failed_rule:depth_negative': "Depth cannot be negative",
  'failed_rule:formation_order': "Formation order is anomalous",
  'failed_rule:date_out_of_range': "Date is before 1950 or in the future",
  'failed_rule:mw_out_of_range': "Mud weight is outside 0.8–2.4 SG"
};

function displayRawToSI(val) {
  if (!val) return 'Missing value';
  if (val.value != null && val.raw) {
    return `${val.raw} → ${val.value} ${val.unit || ''}`;
  }
  return val.value ?? val.raw ?? JSON.stringify(val);
}

export function FieldList({ field, isSelected, onSelect, onAction, isReadOnly }) {
  const [isEditing, setIsEditing] = useState(false);

  const reasonMsg = field.reason ? (REASON_MAP[field.reason] || field.reason) : null;

  return (
    <div 
      className={`border-2 rounded-xl p-5 transition-all cursor-pointer ${isSelected ? 'border-blue-500 bg-white ring-4 ring-blue-100 shadow-lg scale-[1.02]' : 'border-gray-200 bg-white hover:border-blue-300 shadow-sm opacity-70 hover:opacity-100'}`}
      onClick={onSelect}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="font-black text-gray-900 uppercase tracking-widest text-xs flex gap-2 items-center">
          <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded">{field.entity_type}</span>
          <span className="text-blue-600">{field.field_name}</span>
        </div>
        <div className="flex items-center gap-2">
          {field.confidence != null && (
            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200" title={`Confidence: ${field.confidence}`}>
              <div 
                className={`h-full ${field.confidence > 0.8 ? 'bg-green-500' : field.confidence > 0.5 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(100, Math.max(0, field.confidence * 100))}%` }}
              ></div>
            </div>
          )}
        </div>
      </div>

      <div className="text-xl font-bold text-gray-900 mb-3 font-mono">
        {displayRawToSI(field.value)}
      </div>

      {reasonMsg && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg mb-4 font-bold flex items-start gap-2">
          <span className="text-base leading-none">⚠️</span>
          {reasonMsg}
        </div>
      )}

      {isSelected && !isReadOnly && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          {isEditing ? (
            <FieldEditor 
              field={field} 
              onSave={(val) => { onAction('edit', val); setIsEditing(false); }} 
              onCancel={() => setIsEditing(false)} 
            />
          ) : (
            <div className="flex gap-2">
              <button className="bg-green-100 text-green-800 border border-green-200 px-4 py-2 rounded-lg font-bold hover:bg-green-200 transition-colors text-xs uppercase tracking-wider flex-1" onClick={(e) => { e.stopPropagation(); onAction('approve'); }}>Approve [A]</button>
              <button className="bg-blue-100 text-blue-800 border border-blue-200 px-4 py-2 rounded-lg font-bold hover:bg-blue-200 transition-colors text-xs uppercase tracking-wider flex-1" onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}>Edit [E]</button>
              <button className="bg-red-100 text-red-800 border border-red-200 px-4 py-2 rounded-lg font-bold hover:bg-red-200 transition-colors text-xs uppercase tracking-wider flex-1" onClick={(e) => { e.stopPropagation(); onAction('reject'); }}>Reject [R]</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
