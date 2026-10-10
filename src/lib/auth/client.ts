import { createAuthClient } from "better-auth/react";

/** ブラウザ側の Better Auth クライアント (同一オリジンの /api/auth を使う)。 */
export const authClient = createAuthClient();
