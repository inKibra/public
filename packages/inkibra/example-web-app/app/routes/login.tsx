/**
 * Login Page
 *
 * Calls the login API to create a session, then navigates to boards.
 * Uses the v2 route props so we get typed apiImplementations (fetch transport)
 * which will persist the returned session into storage.
 */

import type { RoutePageProps } from '@inkibra/router';
import { useState } from 'react';
import { appRoutes } from '../routes';

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f0f0f',
    fontFamily: "'Inter', sans-serif",
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
    border: '1px solid #2a2a2a',
  },
  logo: {
    fontSize: '48px',
    textAlign: 'center' as const,
    marginBottom: '24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ffffff',
    textAlign: 'center' as const,
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666666',
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  input: {
    width: '100%',
    padding: '14px 16px',
    backgroundColor: '#0f0f0f',
    border: '1px solid #2a2a2a',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '16px',
    outline: 'none',
    marginBottom: '16px',
  },
  button: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  buttonDisabled: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'not-allowed',
    opacity: 0.7,
  },
  hint: {
    fontSize: '12px',
    color: '#666666',
    textAlign: 'center' as const,
    marginTop: '16px',
  },
  error: {
    fontSize: '14px',
    color: '#ef4444',
    textAlign: 'center' as const,
    marginTop: '16px',
  },
};

// ============================================================================
// Types
// ============================================================================

type LoginPageProps = RoutePageProps<typeof appRoutes.$pages.main.login>;

// ============================================================================
// Component
// ============================================================================

const LoginPage = ({ navigate, apiImplementations }: LoginPageProps) => {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const result = await apiImplementations.login.execute(
        {
          pathParams: {},
          pathQuery: {},
          body: { username: username.trim() },
          files: undefined,
        },
        {},
      );

      if (result.result.type === 'Err') {
        if (
          result.result.error &&
          typeof result.result.error === 'object' &&
          'type' in result.result.error &&
          (result.result.error as { type?: string }).type === 'InvalidUsername'
        ) {
          setError('Username must be 3-20 alphanumeric characters');
        } else {
          setError('Login failed. Please try again.');
        }
        setIsLoading(false);
        return;
      }

      // Success - navigate to boards
      if (navigate) {
        navigate(appRoutes.$paths.boards.getPath({}));
      } else {
        window.location.href = '/app' + appRoutes.$paths.boards.getPath({});
      }
    } catch {
      setError('Network error. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>📋</div>
        <h1 style={styles.title}>Welcome to Workspace</h1>
        <p style={styles.subtitle}>Enter a username to get started</p>
        <input
          style={styles.input}
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleLogin()}
          disabled={isLoading}
        />
        <button
          type="button"
          style={isLoading ? styles.buttonDisabled : styles.button}
          onClick={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? 'Logging in...' : 'Continue'}
        </button>
        {error && <p style={styles.error}>{error}</p>}
        <p style={styles.hint}>No password needed - just pick a name!</p>
      </div>
    </div>
  );
};

export default LoginPage;
