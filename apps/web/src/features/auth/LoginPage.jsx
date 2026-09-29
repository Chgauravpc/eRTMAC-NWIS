import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Card } from '../../components/ui/Primitives';
import { USER_ROLES } from '../../lib/constants';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const isMock = import.meta.env.VITE_USE_MOCKS === 'true';

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else navigate(from, { replace: true });
  };

  const handleMockLogin = (role) => {
    localStorage.setItem('mock_role', role);
    // Fake a login via supabase in mock mode
    supabase.auth.setSession({
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      user: { id: 'mock-uuid', email: 'mock@test.com' }
    });
    navigate(from, { replace: true });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <h2 className="text-2xl font-bold mb-4">Login to NWIS</h2>
        {isMock ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-500 mb-2">Mock Mode Active. Select a role to log in as:</p>
            {USER_ROLES.map(role => (
              <Button key={role} variant="outline" className="w-full justify-start" onClick={() => handleMockLogin(role)}>
                Log in as {role.replace('_', ' ')}
              </Button>
            ))}
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input type="email" required className="mt-1 block w-full rounded border-gray-300 shadow-sm p-2 border" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input type="password" required className="mt-1 block w-full rounded border-gray-300 shadow-sm p-2 border" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full">Sign In</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
