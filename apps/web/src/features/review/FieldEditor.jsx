import React, { useState } from 'react';
import { Button } from '../../components/ui/Primitives';

export function FieldEditor({ field, onSave, onCancel }) {
  const [val, setVal] = useState(field.value?.value || field.value?.raw || '');

  const handleSave = (e) => {
    e.stopPropagation();
    const payload = {
      ...field.value,
      value: isNaN(Number(val)) ? val : Number(val)
    };
    onSave(payload);
  };

  return (
    <div className="bg-gray-50 p-4 border border-blue-200 rounded-lg flex flex-col gap-3 shadow-inner" onClick={e => e.stopPropagation()}>
      <div className="font-bold text-xs text-blue-800 uppercase tracking-wider mb-1">Modify Value</div>
      
      {field.field_name === 'formation' ? (
        <select className="border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white font-medium" value={val} onChange={e => setVal(e.target.value)}>
          <option value="">Select Formation...</option>
          <option value="Tipam">Tipam</option>
          <option value="Barail">Barail</option>
          <option value="Girujan">Girujan</option>
          <option value="Kopili">Kopili</option>
        </select>
      ) : field.field_name === 'event_type' ? (
        <select className="border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white font-medium" value={val} onChange={e => setVal(e.target.value)}>
          <option value="">Select Event Type...</option>
          <option value="loss_partial">Losses (Partial)</option>
          <option value="loss_total">Losses (Total)</option>
          <option value="stuck_pipe">Stuck Pipe</option>
          <option value="kick">Kick</option>
          <option value="torque_spike">Torque Spike</option>
        </select>
      ) : (
        <input 
          type="text" 
          className="border border-gray-300 p-2.5 rounded-lg w-full focus:ring-2 focus:ring-blue-500 bg-white font-medium"
          value={val}
          onChange={e => setVal(e.target.value)}
          autoFocus
        />
      )}
      
      <div className="flex gap-2 justify-end mt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleSave}>Save Changes</Button>
      </div>
    </div>
  );
}
