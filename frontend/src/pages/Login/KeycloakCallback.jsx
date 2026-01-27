import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { FullScreenLoader } from "@/components/Preloader";
import { AUTH_TOKEN, AUTH_USER } from "@/utils/constants";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";

export default function KeycloakCallback() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function handleCallback() {
      try {
        // Get authorization code from URL
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        
        if (!code) {
          setError("No authorization code received");
          setLoading(false);
          return;
        }

        // Exchange code for token with Keycloak
        const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL;
        const realm = import.meta.env.VITE_KEYCLOAK_REALM;
        const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;
        const redirectUri = window.location.origin + '/login/callback';
        
        const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
        
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('client_id', clientId);
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
        
        const tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        
        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.json();
          throw new Error(errorData.error_description || 'Failed to obtain token');
        }
        
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        
        // Verify token with backend and get user info
        const backendUrl = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';
        const checkResponse = await fetch(`${backendUrl}/system/check-token`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
        
        if (!checkResponse.ok) {
          throw new Error('Backend authentication failed');
        }
        
        // Decode token to get user info
        const tokenParts = accessToken.split('.');
        const payload = JSON.parse(atob(tokenParts[1]));
        
        const user = {
          id: payload.sub,
          username: payload.preferred_username,
          role: 'default',
        };
        
        // Store token and user info
        window.localStorage.setItem(AUTH_TOKEN, accessToken);
        window.localStorage.setItem(AUTH_USER, JSON.stringify(user));
        
        showToast('Successfully logged in with Keycloak', 'success');
        
        // Redirect to home
        window.location = paths.home();
        
      } catch (error) {
        console.error('Keycloak callback error:', error);
        setError(error.message);
        showToast(`Login failed: ${error.message}`, 'error');
        setLoading(false);
      }
    }
    
    handleCallback();
  }, []);

  if (loading) {
    return <FullScreenLoader />;
  }

  if (error) {
    return <Navigate to={paths.login()} />;
  }

  return <FullScreenLoader />;
}
