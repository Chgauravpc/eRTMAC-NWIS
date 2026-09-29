import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { USER_ROLES } from '../../lib/constants';
import { apiFetch } from '../../lib/api';
import { RequireRole } from '../auth/RequireRole';
import { Loader2, Plus, Edit, X } from 'lucide-react';

export function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editUser, setEditUser] = useState(null);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (!error && data) setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <RequireRole roles={['admin']}>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <button
            onClick={() => { setEditUser(null); setShowDialog(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Invite User
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name / Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned Wells</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{u.full_name || '—'}</div>
                      <div className="text-sm text-gray-500">{u.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 capitalize">
                      {u.role.replace('_', ' ')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {u.assigned_wellbore_ids?.length || 0} wells
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => { setEditUser(u); setShowDialog(true); }}
                        className="text-blue-600 hover:text-blue-900 flex items-center justify-end gap-1 w-full"
                      >
                        <Edit className="w-4 h-4" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-6 py-10 text-center text-gray-500">No users found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {showDialog && (
          <UserDialog 
            user={editUser} 
            onClose={() => setShowDialog(false)} 
            onSaved={() => { setShowDialog(false); fetchUsers(); }} 
          />
        )}
      </div>
    </RequireRole>
  );
}

export function UserDialog({ user, onClose, onSaved }) {
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">{user ? 'Edit User' : 'Invite User'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        
        <form onSubmit={handleSave} className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}
          
          {!user && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input 
                  type="email" 
                  className={`w-full border rounded-lg p-2 text-sm ${validationErrors.email ? 'border-red-500' : 'border-gray-300'}`}
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  data-testid="email-input"
                />
                {validationErrors.email && <p className="text-red-500 text-xs mt-1">{validationErrors.email}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input 
                  type="text" 
                  className={`w-full border rounded-lg p-2 text-sm ${validationErrors.full_name ? 'border-red-500' : 'border-gray-300'}`}
                  value={formData.full_name}
                  onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                  data-testid="name-input"
                />
                {validationErrors.full_name && <p className="text-red-500 text-xs mt-1">{validationErrors.full_name}</p>}
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select 
              className={`w-full border rounded-lg p-2 text-sm ${validationErrors.role ? 'border-red-500' : 'border-gray-300'}`}
              value={formData.role}
              onChange={e => setFormData({ ...formData, role: e.target.value })}
              data-testid="role-select"
            >
              {USER_ROLES.map(r => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assigned Wells</label>
            <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
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
                    <span className="text-xs text-gray-500 capitalize">{w.status}</span>
                  </div>
                </label>
              ))}
              {wells.length === 0 && <div className="p-4 text-center text-sm text-gray-500">Loading wells...</div>}
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
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
