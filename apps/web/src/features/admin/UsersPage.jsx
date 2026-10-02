import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { USER_ROLES } from '../../lib/constants';
import { apiFetch } from '../../lib/api';
import { RequireRole } from '../auth/RequireRole';
import { useProfile } from '../auth/useProfile';
import { Loader2, Plus, Edit, X } from 'lucide-react';

export function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [wellNames, setWellNames] = useState({});
  const { profile } = useProfile();

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) setLoadError(error.message || 'Could not load the users.');
    else {
      setLoadError(null);
      setUsers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
    supabase
      .from('v_well_summary')
      .select('wellbore_id, well_name')
      .then(({ data }) => setWellNames(Object.fromEntries((data || []).map((w) => [w.wellbore_id, w.well_name]))));
  }, []);

  return (
    <RequireRole roles={['admin']}>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">User management</h1>
          <button
            onClick={() => { setEditUser(null); setShowDialog(true); }}
            className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Invite User
          </button>
        </div>

        {loadError && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Could not load the users: {loadError}
          </p>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-600" /></div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Name / Email</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Role</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Assigned Wells</th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{u.full_name || '—'}</div>
                      <div className="text-sm text-gray-700">{u.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 capitalize">
                      {u.role.replace('_', ' ')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {u.assigned_wellbore_ids?.length ? (
                        <span title={u.assigned_wellbore_ids.map((id) => wellNames[id] || id).join(', ')}>
                          {u.assigned_wellbore_ids.slice(0, 3).map((id) => wellNames[id] || 'unknown well').join(', ')}
                          {u.assigned_wellbore_ids.length > 3 ? ` +${u.assigned_wellbore_ids.length - 3} more` : ''}
                        </span>
                      ) : (
                        'None'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => { setEditUser(u); setShowDialog(true); }}
                        className="text-blue-800 hover:text-blue-950 flex items-center justify-end gap-1 w-full"
                      >
                        <Edit aria-hidden="true" className="w-4 h-4" /> Edit<span className="sr-only"> {u.full_name || u.email}</span>
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-6 py-10 text-center text-gray-700">No users found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {showDialog && (
          <UserDialog 
            user={editUser}
            selfId={profile?.id}
            onClose={() => setShowDialog(false)} 
            onSaved={() => { setShowDialog(false); fetchUsers(); }} 
          />
        )}
      </div>
    </RequireRole>
  );
}

export function UserDialog({ user, onClose, onSaved, selfId }) {
  const [formData, setFormData] = useState({
    email: user?.email || '',
    full_name: user?.full_name || '',
    role: user?.role || 'office_engineer',
    assigned_wellbore_ids: user?.assigned_wellbore_ids || []
  });
  const [wells, setWells] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const firstRef = useRef(null);
  // An admin who demotes their own account would lock themselves out of this page.
  const isSelf = !!user && !!selfId && user.id === selfId;

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    supabase.from('v_well_summary').select('wellbore_id, well_name, status')
      .then(({ data }) => { if (data) setWells(data); });
  }, []);

  const validate = () => {
    const errs = {};
    if (!user && !formData.email) errs.email = 'Email is required';
    else if (!user && !/\S+@\S+\.\S+/.test(formData.email)) errs.email = 'Invalid email';
    if (!user && !formData.full_name) errs.full_name = 'Full name is required';
    if (!formData.role) errs.role = 'Role is required';
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    
    setSaving(true);
    setError(null);
    try {
      if (user) {
        await apiFetch(`/api/admin/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            role: formData.role,
            assigned_wellbore_ids: formData.assigned_wellbore_ids
          })
        });
      } else {
        await apiFetch('/api/admin/users/invite', {
          method: 'POST',
          body: JSON.stringify({
            email: formData.email,
            full_name: formData.full_name,
            role: formData.role,
            assigned_wellbore_ids: formData.assigned_wellbore_ids
          })
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleWell = (id) => {
    setFormData(prev => ({
      ...prev,
      assigned_wellbore_ids: prev.assigned_wellbore_ids.includes(id) 
        ? prev.assigned_wellbore_ids.filter(wId => wId !== id)
        : [...prev.assigned_wellbore_ids, id]
    }));
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 id="user-dialog-title" className="text-lg font-bold text-gray-900">{user ? 'Edit User' : 'Invite User'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-600 hover:text-gray-900"><X aria-hidden="true" className="w-5 h-5" /></button>
        </div>
        
        <form onSubmit={handleSave} className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && <div role="alert" className="p-3 bg-red-50 text-red-800 rounded text-sm">{error}</div>}
          
          {!user && (
            <>
              <div>
                <label htmlFor="user-email" className="block text-sm font-medium text-gray-800 mb-1">Email address</label>
                <input
                  id="user-email"
                  ref={firstRef}
                  aria-invalid={validationErrors.email ? 'true' : undefined}
                  type="email" 
                  className={`w-full border rounded-lg p-2 text-sm ${validationErrors.email ? 'border-red-500' : 'border-gray-300'}`}
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  data-testid="email-input"
                />
                {validationErrors.email && <p role="alert" className="text-red-700 text-xs mt-1">{validationErrors.email}</p>}
              </div>
              <div>
                <label htmlFor="user-name" className="block text-sm font-medium text-gray-800 mb-1">Full name</label>
                <input
                  id="user-name"
                  aria-invalid={validationErrors.full_name ? 'true' : undefined}
                  type="text" 
                  className={`w-full border rounded-lg p-2 text-sm ${validationErrors.full_name ? 'border-red-500' : 'border-gray-300'}`}
                  value={formData.full_name}
                  onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                  data-testid="name-input"
                />
                {validationErrors.full_name && <p role="alert" className="text-red-700 text-xs mt-1">{validationErrors.full_name}</p>}
              </div>
            </>
          )}

          <div>
            <label htmlFor="user-role" className="block text-sm font-medium text-gray-800 mb-1">Role</label>
            <select
              id="user-role"
              ref={user ? firstRef : undefined}
              disabled={isSelf}
              className={`w-full border rounded-lg p-2 text-sm ${validationErrors.role ? 'border-red-500' : 'border-gray-300'}`}
              value={formData.role}
              onChange={e => setFormData({ ...formData, role: e.target.value })}
              data-testid="role-select"
            >
              {USER_ROLES.map(r => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
            {isSelf && <p className="text-xs text-gray-700 mt-1">You cannot change your own role. Ask another admin.</p>}
          </div>

          <div>
            <span id="wells-label" className="block text-sm font-medium text-gray-800 mb-2">Assigned wells (rig engineers see only these)</span>
            <div role="group" aria-labelledby="wells-label" className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
              {wells.map(w => (
                <label key={w.wellbore_id} className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 mr-3"
                    checked={formData.assigned_wellbore_ids.includes(w.wellbore_id)}
                    onChange={() => toggleWell(w.wellbore_id)}
                    data-testid={`well-check-${w.wellbore_id}`}
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900 block">{w.well_name}</span>
                    <span className="text-xs text-gray-700 capitalize">{w.status}</span>
                  </div>
                </label>
              ))}
              {wells.length === 0 && <div role="status" className="p-4 text-center text-sm text-gray-700">Loading wells...</div>}
            </div>
          </div>
        </form>
        
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-xl">
          <button 
            type="button" 
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
