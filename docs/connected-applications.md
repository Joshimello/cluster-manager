# Connected application sign-in

The platform is an OpenID Connect provider for administrator-registered confidential web applications. No workstation agent changes are required. The issuer is `${ORIGIN}/oidc`; discover endpoints at `${ORIGIN}/oidc/.well-known/openid-configuration`.

## Deployment and registration

Generate a 32-byte random `AUTH_ENCRYPTION_KEY` encoded as base64, store it in the deployment's protected environment, and pass it into the platform container. Never check the key into source control or print it in task logs. The platform remains usable without it, but connected sign-in returns 503 until configured. The provided Compose files pass the variable through.

Under Administration → Connected applications, register a display name and exact HTTPS callback URLs. Copy the client ID and one-time client secret to the application's protected configuration. Use discovery, authorization code flow, PKCE S256, client-secret basic authentication, and `openid profile offline_access` scopes. Request `prompt=consent` when requesting offline access. The provider only accepts administrator-created clients; no public registration, password, implicit, client-credentials, or public-client flows are supported.

Users must be active and complete any required password change. Profile claims contain only `sub` (immutable user UUID), `preferred_username`, and `name`; `iss` plus `sub` identifies a user. Linux IDs, credentials, and platform roles are not part of the profile. Every authorization displays its application and requested access, and creates a separate grant. Access/ID tokens expire after five minutes, codes after one minute, and rotating refresh authorizations after a fixed 30 days. Clients must persist rotated refresh tokens before further network operations and serialize refreshes across processes. Refresh-token reuse revokes the grant.

Password changes/resets and changes to account status, deletion state, or required-password-change state advance a database-enforced security version. Old grants cannot become valid again after re-enabling an account. UserInfo, refresh, and introspection check current eligibility. Applications should verify at least every five minutes and fail closed when verification is overdue. Clients may only introspect or revoke tokens issued to themselves. Platform sign-out does not revoke existing application grants, but a provider cookie cannot start another sign-in without a valid platform session.

Editing a client, disabling it, or rotating its secret revokes existing authorizations. Secret rotation requires updating that application's configuration and signing in again. Audit metadata never includes credentials or protocol codes. A client must protect its own browser sessions, API tokens, CSRF defenses, and application permissions.

## Persistence, keys, and rollback

Back up PostgreSQL plus the protected encryption key together. Client secrets, provider payloads, and private signing keys are AES-256-GCM encrypted at rest. Signing keys are generated once under a database lock and survive platform replacements. Do not replace the encryption key without re-encrypting stored records; losing it requires restoring a matching backup or deliberately reinitializing connected identity state and reauthorizing clients.

For signing-key rotation during maintenance, decrypt the `oidc_keys` signing record using the existing encryption key, prepend a newly generated RSA-2048 private JWK with a fresh `kid`, retain previous signing keys through the lifetime of already-issued ID tokens, encrypt the updated record, and restart the platform so all instances load it. Never log the decrypted record. Existing refresh grants remain valid. Keep a protected pre-rotation backup.

Migrations are additive. Keep the previous image and consistent database/environment backup for rollback. The production entrypoint mounts the provider alongside SvelteKit on the existing port, with canonical origin derived from `ORIGIN`; the development Vite middleware provides the same routes. Browser-form CSRF checks remain enabled; protocol routes use their own client/protocol validation rather than broad trusted-origin exceptions.

## Verification

Run the platform's normal checks and database tests. `OIDC_TEST_DATABASE=true DATABASE_URL=<isolated-database> node scripts/oidc-smoke.mjs` exercises real protocol requests and security revocation. It resets identity-provider state and must only target a disposable database. The release workflow runs it against its isolated PostgreSQL service.
