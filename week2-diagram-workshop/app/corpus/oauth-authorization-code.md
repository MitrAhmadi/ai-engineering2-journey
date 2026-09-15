# OAuth 2.0 authorization code flow with PKCE

The participants are the **User**, the **Client App**, the **Authorization
Server** and the **Resource Server**.

1. The client app generates a random `code_verifier` and derives a
   `code_challenge` from it (SHA-256, base64url).
2. The client redirects the user to the authorization server's `/authorize`
   endpoint, passing `client_id`, `redirect_uri`, `scope`, `state` and the
   `code_challenge`.
3. The user authenticates with the authorization server and consents to the
   requested scopes.
4. The authorization server redirects back to the client's `redirect_uri` with a
   short-lived **authorization code** and the original `state`.
5. The client exchanges that code at the `/token` endpoint, sending the
   `code_verifier`. The server checks it against the earlier `code_challenge`.
6. The authorization server returns an **access token** and usually a **refresh
   token**.
7. The client calls the resource server with `Authorization: Bearer <access
   token>`.

The point of PKCE is step 5: an attacker who intercepts the authorization code
cannot exchange it without the verifier.
