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
        const isRegistration = urlParams.get('registration') === 'true';
        
        if (!code) {
          setError("No authorization code received");
          setLoading(false);
          return;
        }

        // Exchange code for token with Keycloak
        const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL;
        const realm = import.meta.env.VITE_KEYCLOAK_REALM;
        const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;
        const redirectUri = window.location.origin + '/login/callback' + (isRegistration ? '?registration=true' : '');
        
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
        
        // Verify token with backend and provision user in database
        // This is critical - it creates the user record in the local database
        const backendUrl = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';
        const checkResponse = await fetch(`${backendUrl}/system/check-token`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
        
        if (!checkResponse.ok) {
          throw new Error('Backend authentication failed');
        }
        
        // Get user info from backend (after provisioning)
        const userInfoResponse = await fetch(`${backendUrl}/system/me`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
        
        let user = null;
        if (userInfoResponse.ok) {
          const userInfoData = await userInfoResponse.json();
          user = userInfoData.user;
        }
        
        // Fallback: decode token if backend doesn't return user info
        if (!user) {
          const tokenParts = accessToken.split('.');
          const payload = JSON.parse(atob(tokenParts[1]));
          user = {
            id: payload.sub,
            username: payload.preferred_username,
            role: 'default',
          };
        }
        
        // Check if this is a registration flow
        if (isRegistration) {
          // Registration flow: Logout from Keycloak to clear session, then redirect to login page
          try {
            // Call Keycloak logout endpoint to clear server-side session
            const logoutUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/logout`;
            const logoutParams = new URLSearchParams();
            logoutParams.append('client_id', clientId);
            logoutParams.append('refresh_token', tokenData.refresh_token || '');
            
            await fetch(logoutUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: logoutParams.toString(),
            });
            
            console.log('Keycloak session cleared after registration');
          } catch (logoutError) {
            console.warn('Failed to logout from Keycloak:', logoutError);
            // Continue anyway, user can still login
          }
          
          // Don't store token, redirect to login page
          showToast('注册成功！请使用您的账号密码登录', 'success');
          window.location = paths.login();
        } else {
          // Normal login flow: Store token and redirect to home
          window.localStorage.setItem(AUTH_TOKEN, accessToken);
          window.localStorage.setItem(AUTH_USER, JSON.stringify(user));
          showToast('Successfully logged in with Keycloak', 'success');
          window.location = paths.home();
        }
        
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
