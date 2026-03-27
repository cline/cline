---
name: two-factor-authentication-best-practices
description: Configure TOTP authenticator apps, send OTP codes via email/SMS, manage backup codes, handle trusted devices, and implement 2FA sign-in flows using Better Auth's twoFactor plugin. Use when users need MFA, multi-factor authentication, authenticator setup, or login security with Better Auth.
---

## Setup

1. Add `twoFactor()` plugin to server config with `issuer`
2. Add `twoFactorClient()` plugin to client config
3. Run `npx @better-auth/cli migrate`
4. Verify: check that `twoFactorSecret` column exists on user table

```ts
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";

export const auth = betterAuth({
  appName: "My App",
  plugins: [
    twoFactor({
      issuer: "My App",
    }),
  ],
});
```

### Client-Side Setup

```ts
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/2fa";
      },
    }),
  ],
});
```

## Enabling 2FA for Users

Requires password verification. Returns TOTP URI (for QR code) and backup codes.

```ts
const enable2FA = async (password: string) => {
  const { data, error } = await authClient.twoFactor.enable({
    password,
  });

  if (data) {
    // data.totpURI — generate a QR code from this
    // data.backupCodes — display to user
  }
};
```

`twoFactorEnabled` is not set to `true` until first TOTP verification succeeds. Override with `skipVerificationOnEnable: true` (not recommended).

## TOTP (Authenticator App)

### Displaying the QR Code

```tsx
import QRCode from "react-qr-code";

const TotpSetup = ({ totpURI }: { totpURI: string }) => {
  return <QRCode value={totpURI} />;
};
```

### Verifying TOTP Codes

Accepts codes from one period before/after current time:

```ts
const verifyTotp = async (code: string) => {
  const { data, error } = await authClient.twoFactor.verifyTotp({
    code,
    trustDevice: true,
  });
};
```

### TOTP Configuration Options

```ts
twoFactor({
  totpOptions: {
    digits: 6, // 6 or 8 digits (default: 6)
    period: 30, // Code validity period in seconds (default: 30)
  },
});
```

## OTP (Email/SMS)

### Configuring OTP Delivery

```ts
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { sendEmail } from "./email";

export const auth = betterAuth({
  plugins: [
    twoFactor({
      otpOptions: {
        sendOTP: async ({ user, otp }, ctx) => {
          await sendEmail({
            to: user.email,
            subject: "Your verification code",
            text: `Your code is: ${otp}`,
          });
        },
        period: 5, // Code validity in minutes (default: 3)
        digits: 6, // Number of digits (default: 6)
        allowedAttempts: 5, // Max verification attempts (default: 5)
      },
    }),
  ],
});
```

### Sending and Verifying OTP

Send: `authClient.twoFactor.sendOtp()`. Verify: `authClient.twoFactor.verifyOtp({ code, trustDevice: true })`.

### OTP Storage Security

Configure how OTP codes are stored in the database:

```ts
twoFactor({
  otpOptions: {
    storeOTP: "encrypted", // Options: "plain", "encrypted", "hashed"
  },
});
```

For custom encryption:

```ts
twoFactor({
  otpOptions: {
    storeOTP: {
      encrypt: async (token) => myEncrypt(token),
      decrypt: async (token) => myDecrypt(token),
    },
  },
});
```

## Backup Codes

Generated automatically when 2FA is enabled. Each code is single-use.

### Displaying Backup Codes

```tsx
const BackupCodes = ({ codes }: { codes: string[] }) => {
  return (
    <div>
      <p>Save these codes in a secure location:</p>
      <ul>
        {codes.map((code, i) => (
          <li key={i}>{code}</li>
        ))}
      </ul>
    </div>
  );
};
```

### Regenerating Backup Codes

Invalidates all previous codes:

```ts
const regenerateBackupCodes = async (password: string) => {
  const { data, error } = await authClient.twoFactor.generateBackupCodes({
    password,
  });
  // data.backupCodes contains the new codes
};
```

### Using Backup Codes for Recovery

```ts
const verifyBackupCode = async (code: string) => {
  const { data, error } = await authClient.twoFactor.verifyBackupCode({
    code,
    trustDevice: true,
  });
};
```

### Backup Code Configuration

```ts
twoFactor({
  backupCodeOptions: {
    amount: 10, // Number of codes to generate (default: 10)
    length: 10, // Length of each code (default: 10)
    storeBackupCodes: "encrypted", // Options: "plain", "encrypted"
  },
});
```

## Handling 2FA During Sign-In

Response includes `twoFactorRedirect: true` when 2FA is required:

### Sign-In Flow

1. Call `signIn.email({ email, password })`
2. Check `context.data.twoFactorRedirect` in `onSuccess`
3. If `true`, redirect to `/2fa` verification page
4. Verify via TOTP, OTP, or backup code
5. Session cookie is created on successful verification

```ts
const signIn = async (email: string, password: string) => {
  const { data, error } = await authClient.signIn.email(
    { email, password },
    {
      onSuccess(context) {
        if (context.data.twoFactorRedirect) {
          window.location.href = "/2fa";
        }
      },
    }
  );
};
```

Server-side: check `"twoFactorRedirect" in response` when using `auth.api.signInEmail`.

## Trusted Devices

Pass `trustDevice: true` when verifying. Default trust duration: 30 days (`trustDeviceMaxAge`). Refreshes on each sign-in.

## Security Considerations

### Session Management

Flow: credentials → session removed → temporary 2FA cookie (10 min default) → verify → session created.

```ts
twoFactor({
  twoFactorCookieMaxAge: 600, // 10 minutes in seconds (default)
});
```

### Rate Limiting

Built-in: 3 requests per 10 seconds for all 2FA endpoints. OTP has additional attempt limiting:

```ts
twoFactor({
  otpOptions: {
    allowedAttempts: 5, // Max attempts per OTP code (default: 5)
  },
});
```

### Encryption at Rest

TOTP secrets: encrypted with auth secret. Backup codes: encrypted by default. OTP: configurable (`"plain"`, `"encrypted"`, `"hashed"`). Uses constant-time comparison for verification.

2FA can only be enabled for credential (email/password) accounts.

## Disabling 2FA

Requires password confirmation. Revokes trusted device records:

```ts
const disable2FA = async (password: string) => {
  const { data, error } = await authClient.twoFactor.disable({
    password,
  });
};
```

## Complete Configuration Example

```ts
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { sendEmail } from "./email";

export const auth = betterAuth({
  appName: "My App",
  plugins: [
    twoFactor({
      // TOTP settings
      issuer: "My App",
      totpOptions: {
        digits: 6,
        period: 30,
      },
      // OTP settings
      otpOptions: {
        sendOTP: async ({ user, otp }) => {
          await sendEmail({
            to: user.email,
            subject: "Your verification code",
            text: `Your code is: ${otp}`,
          });
        },
        period: 5,
        allowedAttempts: 5,
        storeOTP: "encrypted",
      },
      // Backup code settings
      backupCodeOptions: {
        amount: 10,
        length: 10,
        storeBackupCodes: "encrypted",
      },
      // Session settings
      twoFactorCookieMaxAge: 600, // 10 minutes
      trustDeviceMaxAge: 30 * 24 * 60 * 60, // 30 days
    }),
  ],
});
```
